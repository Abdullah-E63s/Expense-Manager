"""Database models for the Expense Manager application with direct MySQL connection."""
import os
import time
import secrets
import pymysql
from pymysql.cursors import DictCursor
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List
from werkzeug.security import generate_password_hash, check_password_hash
from flask import current_app

class Database:
    _instance = None
    _pool = None
    _pool_size = 5  # Default pool size
    _max_overflow = 10
    _pool_timeout = 30
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(Database, cls).__new__(cls)
        return cls._instance
    
    def _create_connection(self):
        """Create a new database connection."""
        kwargs = dict(
            host=os.getenv('MYSQL_HOST', 'localhost'),
            port=int(os.getenv('MYSQL_PORT', 3306)),
            user=os.getenv('MYSQL_USER', 'root'),
            password=os.getenv('MYSQL_PASSWORD', ''),
            database=os.getenv('MYSQL_DATABASE', 'expense_manager'),
            charset='utf8mb4',
            cursorclass=DictCursor,
            autocommit=True,
            connect_timeout=30,
            read_timeout=30,
            write_timeout=30
        )
        if os.getenv('MYSQL_SSL_REQUIRED', 'false').lower() in ('true', '1', 'yes'):
            kwargs['ssl'] = {}
            
        return pymysql.connect(**kwargs)
        
    def _initialize_pool(self):
        if self._pool is None:
            try:
                self._pool = []
                for _ in range(self._pool_size):
                    conn = self._create_connection()
                    self._pool.append(conn)
                current_app.logger.info("Database connection pool initialized successfully")
            except Exception as e:
                current_app.logger.error(f"Failed to initialize database pool: {str(e)}")
                raise
    
    def get_connection(self):
        """Get a connection from the pool."""
        if self._pool is None:
            self._initialize_pool()
            
        try:
            # Get a connection from the pool
            if not self._pool:  # If pool is empty
                return self._create_connection()
                
            # Try to get a connection from the pool
            conn = self._pool.pop()
            # Test the connection
            conn.ping(reconnect=True)
            return conn
        except pymysql.Error as e:
            current_app.logger.error(f"Failed to get database connection: {str(e)}")
            # Try to reinitialize the pool if connection fails
            if self._pool:
                try:
                    for conn in self._pool:
                        try:
                            conn.close()
                        except:
                            pass
                    self._pool = []
                    self._initialize_pool()
                except Exception as pool_error:
                    current_app.logger.error(f"Error reinitializing connection pool: {str(pool_error)}")
            # Return a new connection if pool reinitialization fails
            return self._create_connection()
    
    def return_connection(self, conn):
        """Return a connection to the pool safely."""
        if conn is None:
            return
        try:
            # Ensure the connection is alive
            conn.ping(reconnect=True)
        except Exception:
            # Close broken connection
            try:
                conn.close()
            except Exception:
                pass
            return
        # Add back to pool, creating it if missing
        try:
            if self._pool is None:
                self._initialize_pool()
            self._pool.append(conn)
        except Exception:
            # Fallback: close connection
            try:
                conn.close()
            except Exception:
                pass
    
    def close(self):
        """Close all connections in the pool."""
        if self._pool is not None:
            try:
                while self._pool:
                    conn = self._pool.pop()
                    try:
                        conn.close()
                    except Exception as e:
                        current_app.logger.error(f"Error closing connection: {str(e)}")
                current_app.logger.info("Database connection pool closed")
            except Exception as e:
                current_app.logger.error(f"Error closing database pool: {str(e)}")
            finally:
                self._pool = None

def get_db():
    """Get a database connection."""
    return Database().get_connection()

def execute_query(query, params=None, fetch_one=False, fetch_all=False, commit=False):
    """Execute a SQL query and return the results with retry logic."""
    max_retries = 3
    retry_delay = 1  # seconds
    last_exception = None
    connection = None
    
    for attempt in range(max_retries):
        try:
            connection = get_db()
            with connection.cursor() as cursor:
                try:
                    cursor.execute(query, params or ())
                    if commit:
                        connection.commit()
                    if fetch_one:
                        result = cursor.fetchone()
                        return result
                    if fetch_all:
                        result = cursor.fetchall()
                        return result
                    return cursor.lastrowid if commit else None
                except (pymysql.OperationalError, pymysql.InterfaceError) as e:
                    if connection:
                        try:
                            connection.rollback()
                        except:
                            pass
                    if attempt == max_retries - 1:  # Last attempt
                        current_app.logger.error(f"Database query failed after {max_retries} attempts: {str(e)}")
                        last_exception = e
                        break
                    
                    # If connection was lost, force a reconnection
                    if any(err in str(e) for err in ['2006', '2013', 'InterfaceError', 'Lost connection']):
                        current_app.logger.warning(f"Database connection lost. Attempting to reconnect (attempt {attempt + 1}/{max_retries})")
                        try:
                            db = Database()
                            db.close()  # Force close the broken connection
                        except:
                            pass
                        time.sleep(retry_delay * (attempt + 1))  # Exponential backoff
                        continue
                    raise
                finally:
                    # Ensure cursor is closed
                    try:
                        cursor.close()
                    except:
                        pass
        except (pymysql.OperationalError, pymysql.InterfaceError) as e:
            if attempt == max_retries - 1:  # Last attempt
                current_app.logger.error(f"Database connection failed after {max_retries} attempts: {str(e)}")
                last_exception = e
                break
                
            current_app.logger.warning(f"Database connection error (attempt {attempt + 1}/{max_retries}): {str(e)}")
            time.sleep(retry_delay * (attempt + 1))  # Exponential backoff
            
        except Exception as e:
            current_app.logger.error(f"Unexpected database error: {str(e)}", exc_info=True)
            last_exception = e
            break
        finally:
            # Ensure connection is properly closed
            if connection:
                try:
                    connection.close()
                except:
                    pass
    
    # If we get here, all retries failed
    error_msg = "Database operation failed after multiple attempts"
    if last_exception:
        error_msg += f": {str(last_exception)}"
    raise Exception(error_msg) from last_exception

def init_db():
    """Initialize the database with required tables."""
    create_tables = """
    CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255),
        first_name VARCHAR(100),
        last_name VARCHAR(100),
        username VARCHAR(100) UNIQUE,
        phone_country_code VARCHAR(10),
        phone_number VARCHAR(20),
        profile_picture_url VARCHAR(512),
        is_active BOOLEAN DEFAULT FALSE,
        is_admin BOOLEAN DEFAULT FALSE,
        verification_code VARCHAR(10),
        code_expiration_time DATETIME,
        is_google_signed_in BOOLEAN DEFAULT FALSE,
        firebase_uid VARCHAR(128) UNIQUE,
        reset_token VARCHAR(100) UNIQUE,
        reset_token_expires DATETIME,
        is_verified BOOLEAN DEFAULT FALSE,
        needs_password_reset BOOLEAN DEFAULT FALSE,
        last_login_at DATETIME,
        password_changed_at DATETIME,
        signed_up_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL DEFAULT NULL,
        INDEX idx_email (email),
        INDEX idx_firebase_uid (firebase_uid),
        INDEX idx_is_admin (is_admin)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

    CREATE TABLE IF NOT EXISTS expenses (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        description TEXT,
        value DECIMAL(10, 2) NOT NULL,
        category VARCHAR(255),
        picture_url VARCHAR(255),
        receipt_data LONGBLOB,
        receipt_mime VARCHAR(50),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at DATETIME,
        INDEX idx_user_id (user_id),
        INDEX idx_category (category),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

    CREATE TABLE IF NOT EXISTS budgets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        amount DECIMAL(10, 2) NOT NULL,
        period VARCHAR(50) NOT NULL DEFAULT 'monthly',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP NULL DEFAULT NULL,
        INDEX idx_user_id (user_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

    CREATE TABLE IF NOT EXISTS users_archive (
        id INT AUTO_INCREMENT PRIMARY KEY,
        original_user_id INT,
        email VARCHAR(255) NOT NULL,
        username VARCHAR(150),
        first_name VARCHAR(100),
        last_name VARCHAR(100),
        phone_country_code VARCHAR(10),
        phone_number VARCHAR(30),
        is_google_signed_in BOOLEAN,
        firebase_uid VARCHAR(128),
        is_verified BOOLEAN,
        last_login_at DATETIME,
        password_changed_at DATETIME,
        signed_up_at DATETIME,
        created_at DATETIME,
        updated_at DATETIME,
        deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        deleted_reason VARCHAR(255),
        INDEX idx_archived_email (email),
        INDEX idx_archived_user (original_user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    """
    
    try:
        for statement in create_tables.split(';'):
            if statement.strip():
                execute_query(statement, commit=True)

        # Ensure new columns exist on existing installations without relying on
        # "IF NOT EXISTS" (which may not be supported on some servers)
        try:
            db_name = os.getenv('MYSQL_DATABASE', 'expense_manager')
            cols_query = (
                """
                SELECT COLUMN_NAME FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = %s AND TABLE_NAME = 'users'
                """
            )
            existing_cols_rows = execute_query(cols_query, (db_name,), fetch_all=True)
            existing_cols = {row['COLUMN_NAME'] for row in (existing_cols_rows or [])}

            # Build conditional ALTERs only for missing columns
            conditional_alters = []
            if 'username' not in existing_cols:
                conditional_alters.append(
                    "ALTER TABLE users ADD COLUMN username VARCHAR(150) AFTER last_name"
                )
            if 'phone_country_code' not in existing_cols:
                conditional_alters.append(
                    "ALTER TABLE users ADD COLUMN phone_country_code VARCHAR(10) AFTER username"
                )
            if 'phone_number' not in existing_cols:
                conditional_alters.append(
                    "ALTER TABLE users ADD COLUMN phone_number VARCHAR(30) AFTER phone_country_code"
                )
            if 'profile_picture_url' not in existing_cols:
                conditional_alters.append(
                    "ALTER TABLE users ADD COLUMN profile_picture_url VARCHAR(255) AFTER phone_number"
                )
            if 'last_login_at' not in existing_cols:
                conditional_alters.append(
                    "ALTER TABLE users ADD COLUMN last_login_at DATETIME"
                )
            if 'password_changed_at' not in existing_cols:
                conditional_alters.append(
                    "ALTER TABLE users ADD COLUMN password_changed_at DATETIME"
                )
            if 'signed_up_at' not in existing_cols:
                conditional_alters.append(
                    "ALTER TABLE users ADD COLUMN signed_up_at DATETIME"
                )
            if 'is_admin' not in existing_cols:
                conditional_alters.append(
                    "ALTER TABLE users ADD COLUMN is_admin BOOLEAN DEFAULT FALSE AFTER is_active"
                )

            # Check expenses table for missing columns
            try:
                cols_query_exp = "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = %s AND TABLE_NAME = 'expenses'"
                existing_cols_exp = {row['COLUMN_NAME'] for row in (execute_query(cols_query_exp, (db_name,), fetch_all=True) or [])}
                if 'picture_url' not in existing_cols_exp:
                    conditional_alters.append("ALTER TABLE expenses ADD COLUMN picture_url VARCHAR(512) AFTER category")
                if 'receipt_data' not in existing_cols_exp:
                    conditional_alters.append("ALTER TABLE expenses ADD COLUMN receipt_data LONGBLOB AFTER picture_url")
                if 'receipt_mime' not in existing_cols_exp:
                    conditional_alters.append("ALTER TABLE expenses ADD COLUMN receipt_mime VARCHAR(50) AFTER receipt_data")
            except Exception: pass

            # Check budgets table for missing columns
            try:
                cols_query_bud = "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = %s AND TABLE_NAME = 'budgets'"
                existing_cols_bud = {row['COLUMN_NAME'] for row in (execute_query(cols_query_bud, (db_name,), fetch_all=True) or [])}
                if 'period' not in existing_cols_bud:
                    conditional_alters.append("ALTER TABLE budgets ADD COLUMN period VARCHAR(50) DEFAULT 'monthly' AFTER amount")
            except Exception: pass

            for alter_stmt in conditional_alters:
                try:
                    execute_query(alter_stmt, commit=True)
                except Exception:
                    # Ignore column-exists or other non-critical migration errors
                    pass
        except Exception:
            # If information_schema is not accessible, continue without failing startup
            pass
        print("Database tables created successfully.")
    except Exception as e:
        print(f"Error initializing database: {e}")
        raise

class TimestampMixin:
    """Mixin adding created/updated/deleted timestamps and soft-delete helper."""
    
    @classmethod
    def _get_timestamp(cls):
        """Get current UTC timestamp."""
        return datetime.utcnow()
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert model to dictionary."""
        raise NotImplementedError("Subclasses must implement to_dict()")

class User(TimestampMixin):
    """User account with password hashing and email verification support."""
    
    def __init__(self, **kwargs):
        self.id = kwargs.get('id')
        self.email = kwargs.get('email')
        self.password_hash = kwargs.get('password_hash')
        self.first_name = kwargs.get('first_name')
        self.last_name = kwargs.get('last_name')
        self.username = kwargs.get('username')
        self.phone_country_code = kwargs.get('phone_country_code')
        self.phone_number = kwargs.get('phone_number')
        self.profile_picture_url = kwargs.get('profile_picture_url')
        self.is_active = kwargs.get('is_active', False)
        self.is_admin = kwargs.get('is_admin', False)  # Admin flag
        self.verification_code = kwargs.get('verification_code')
        self.code_expiration_time = kwargs.get('code_expiration_time')
        self.is_google_signed_in = kwargs.get('is_google_signed_in', False)
        self.firebase_uid = kwargs.get('firebase_uid')
        self.reset_token = kwargs.get('reset_token')
        self.reset_token_expires = kwargs.get('reset_token_expires')
        self.is_verified = kwargs.get('is_verified', False)
        self.needs_password_reset = kwargs.get('needs_password_reset', False)
        self.last_login_at = kwargs.get('last_login_at')
        self.password_changed_at = kwargs.get('password_changed_at')
        self.signed_up_at = kwargs.get('signed_up_at')
        self.created_at = kwargs.get('created_at')
        self.updated_at = kwargs.get('updated_at')
        self.deleted_at = kwargs.get('deleted_at')
    
    @classmethod
    def get_by_id(cls, user_id: int):
        """Get a user by ID."""
        query = """
            SELECT * FROM users 
            WHERE id = %s AND deleted_at IS NULL
        """
        result = execute_query(query, (user_id,), fetch_one=True)
        if not result:
            return None
        # Ensure needs_password_reset is set (for existing users before this field was added)
        if 'needs_password_reset' not in result:
            result['needs_password_reset'] = False
        return cls(**result)
    
    @classmethod
    def get_by_email(cls, email: str):
        """Get a user by email."""
        query = """
            SELECT * FROM users 
            WHERE email = %s AND deleted_at IS NULL
        """
        result = execute_query(query, (email,), fetch_one=True)
        if not result:
            return None
        # Ensure needs_password_reset is set (for existing users before this field was added)
        if 'needs_password_reset' not in result:
            result['needs_password_reset'] = False
        return cls(**result)

    @classmethod
    def get_by_email_any(cls, email: str):
        """Get a user by email, regardless of deleted status (includes soft-deleted)."""
        query = """
            SELECT * FROM users 
            WHERE email = %s
            LIMIT 1
        """
        result = execute_query(query, (email,), fetch_one=True)
        if not result:
            return None
        if 'needs_password_reset' not in result:
            result['needs_password_reset'] = False
        return cls(**result)

    def restore(self) -> None:
        """Restore a soft-deleted user by clearing deleted_at and activating the account."""
        query = """
            UPDATE users
            SET deleted_at = NULL,
                is_active = TRUE,
                updated_at = NOW()
            WHERE id = %s
        """
        execute_query(query, (self.id,), commit=True)

    @classmethod
    def get_by_reset_token(cls, token: str):
        """Get a user by password reset token."""
        query = """
            SELECT * FROM users 
            WHERE reset_token = %s AND deleted_at IS NULL
        """
        result = execute_query(query, (token,), fetch_one=True)
        if not result:
            return None
        if 'needs_password_reset' not in result:
            result['needs_password_reset'] = False
        return cls(**result)
    
    @classmethod
    def get_by_firebase_uid(cls, firebase_uid: str):
        """Get a user by Firebase UID."""
        query = """
            SELECT * FROM users 
            WHERE firebase_uid = %s AND deleted_at IS NULL
        """
        result = execute_query(query, (firebase_uid,), fetch_one=True)
        if not result:
            return None
        # Ensure needs_password_reset is set (for existing users before this field was added)
        if 'needs_password_reset' not in result:
            result['needs_password_reset'] = False
        return cls(**result)
    
    def set_password(self, raw_password: str) -> None:
        """Hash and store the given password."""
        self.password_hash = generate_password_hash(raw_password)

    def check_password(self, raw_password: str) -> bool:
        """Verify a plaintext password against the stored hash."""
        if not self.password_hash:
            return False
        try:
            return check_password_hash(self.password_hash, raw_password)
        except Exception:
            return False
    
    def issue_verification_code(self, minutes_valid: int = None, seconds_valid: int = None) -> str:
        """Generate and store a verification code with expiration time.
        
        Args:
            minutes_valid: Number of minutes until the code expires
            seconds_valid: Number of seconds until the code expires (overrides minutes if both are provided)
            
        Returns:
            The generated verification code
        """
        self.verification_code = str(secrets.randbelow(10**6)).zfill(6)  # 6-digit code
        
        if seconds_valid is not None:
            self.code_expiration_time = datetime.utcnow() + timedelta(seconds=seconds_valid)
        else:
            # Default to 1 minute if no time is specified
            minutes = minutes_valid if minutes_valid is not None else 1
            self.code_expiration_time = datetime.utcnow() + timedelta(minutes=minutes)
            
        self.save()
        return self.verification_code
    
    def clear_verification(self) -> None:
        """Clear verification code and its expiration timestamp."""
        query = """
            UPDATE users 
            SET verification_code = NULL, code_expiration_time = NULL 
            WHERE id = %s
        """
        execute_query(query, (self.id,), commit=True)

    def verify_code(self, code: str) -> bool:
        """Return True if the provided code matches and is not expired."""
        if not self.verification_code or not self.code_expiration_time:
            return False
        if datetime.utcnow() > self.code_expiration_time:
            return False
        # Safe compare
        try:
            return str(self.verification_code).strip() == str(code).strip()
        except Exception:
            return False
    
    def save(self):
        """
        Save the user to the database.
        
        Returns:
            The user instance (self) on success
            
        Raises:
            ValueError: If a user with this email already exists (for new users)
            Exception: For other database errors
        """
        now = datetime.utcnow()
        if not self.id:
            # New user - first check if a user with this email already exists
            existing_user = User.get_by_email(self.email)
            if existing_user:
                raise ValueError(f"A user with email {self.email} already exists")
                
            try:
                # For Google Sign-In users, password_hash can be NULL
                if self.is_google_signed_in and not self.password_hash:
                    password_hash = None
                else:
                    password_hash = self.password_hash
                # Derive a username from email if not provided
                if not self.username and self.email:
                    try:
                        self.username = (self.email.split('@')[0] or '').strip()[:150]
                    except Exception:
                        self.username = None

                query = """
                    INSERT INTO users (
                        email, password_hash, first_name, last_name, username,
                        phone_country_code, phone_number, profile_picture_url, is_active,
                        verification_code, code_expiration_time, is_google_signed_in,
                        firebase_uid, reset_token, reset_token_expires,
                        is_verified, needs_password_reset,
                        last_login_at, password_changed_at, signed_up_at,
                        created_at, updated_at
                    ) VALUES (
                        %s, %s, %s, %s, %s,
                        %s, %s, %s, %s,
                        %s, %s, %s,
                        %s, %s, %s,
                        %s, %s,
                        %s, %s, %s,
                        %s, %s
                    )
                """

                params = (
                    self.email, password_hash, self.first_name, self.last_name, self.username,
                    self.phone_country_code, self.phone_number, self.profile_picture_url, self.is_active,
                    self.verification_code, self.code_expiration_time, self.is_google_signed_in,
                    self.firebase_uid, self.reset_token, self.reset_token_expires,
                    self.is_verified, self.needs_password_reset,
                    self.last_login_at, self.password_changed_at, self.signed_up_at,
                    now, now
                )
                
                inserted_id = execute_query(query, params, commit=True)
                # execute_query returns cursor.lastrowid when commit=True
                self.id = inserted_id
                return self
                
            except Exception as e:
                # Do not swallow duplicate entry errors; report clearly
                if 'Duplicate entry' in str(e) and 'users.email' in str(e):
                    raise ValueError(f"A user with email {self.email} already exists")
                # Re-raise the original exception otherwise
                raise
        else:
            # Update existing user
            query = """
                UPDATE users SET 
                    email = %s, password_hash = %s,
                    first_name = %s, last_name = %s, username = %s,
                    phone_country_code = %s, phone_number = %s, profile_picture_url = %s,
                    is_active = %s, 
                    verification_code = %s, code_expiration_time = %s, 
                    is_google_signed_in = %s, firebase_uid = %s, 
                    reset_token = %s, reset_token_expires = %s,
                    is_verified = %s, needs_password_reset = %s,
                    last_login_at = %s, password_changed_at = %s, signed_up_at = %s,
                    updated_at = %s
                WHERE id = %s
            """
            # For Google Sign-In users, password_hash can be NULL
            if self.is_google_signed_in and not self.password_hash:
                password_hash = None
            else:
                password_hash = self.password_hash
                
            params = (
                self.email, password_hash,
                self.first_name, self.last_name, self.username,
                self.phone_country_code, self.phone_number, self.profile_picture_url,
                self.is_active, 
                self.verification_code, self.code_expiration_time,
                self.is_google_signed_in, self.firebase_uid,
                self.reset_token, self.reset_token_expires,
                self.is_verified, self.needs_password_reset,
                self.last_login_at, self.password_changed_at, self.signed_up_at,
                now, self.id
            )
            execute_query(query, params, commit=True)
        return self

    def delete(self, reason: str | None = None) -> None:
        """Archive then soft delete the user by marking deleted_at and deactivating the account."""
        archive_query = """
            INSERT INTO users_archive (
                original_user_id, email, username, first_name, last_name,
                phone_country_code, phone_number, is_google_signed_in, firebase_uid,
                is_verified, last_login_at, password_changed_at, signed_up_at,
                created_at, updated_at, deleted_at, deleted_reason
            )
            SELECT id, email, username, first_name, last_name,
                   phone_country_code, phone_number, is_google_signed_in, firebase_uid,
                   is_verified, last_login_at, password_changed_at, signed_up_at,
                   created_at, updated_at, NOW(), %s
            FROM users WHERE id = %s
        """
        execute_query(archive_query, (reason, self.id), commit=True)
        # Soft delete: mark as deleted and deactivate
        update_query = (
            "UPDATE users SET deleted_at = NOW(), is_active = FALSE, "
            "verification_code = NULL, code_expiration_time = NULL, updated_at = NOW() WHERE id = %s"
        )
        execute_query(update_query, (self.id,), commit=True)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert user to dictionary."""
        return {
            'id': self.id,
            'email': self.email,
            'username': self.username,
            'first_name': self.first_name,
            'last_name': self.last_name,
            'phone_country_code': self.phone_country_code,
            'phone_number': self.phone_number,
            'profile_picture_url': self.profile_picture_url,
            'is_active': self.is_active,
            'is_google_signed_in': self.is_google_signed_in,
            'firebase_uid': self.firebase_uid,
            'is_verified': self.is_verified,
            'needs_password_reset': self.needs_password_reset,
            'last_login_at': self.last_login_at.isoformat() if self.last_login_at else None,
            'password_changed_at': self.password_changed_at.isoformat() if self.password_changed_at else None,
            'signed_up_at': self.signed_up_at.isoformat() if self.signed_up_at else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }

class Expense(TimestampMixin):
    """Expense record belonging to a specific user."""
    
    def __init__(self, **kwargs):
        self.id = kwargs.get('id')
        self.user_id = kwargs.get('user_id')
        self.description = kwargs.get('description')
        self.value = kwargs.get('value')
        self.category = kwargs.get('category')
        self.picture_url = kwargs.get('picture_url')  # legacy file-path (kept for old rows)
        self.receipt_data = kwargs.get('receipt_data')  # binary blob stored in DB
        self.receipt_mime = kwargs.get('receipt_mime')  # e.g. 'image/jpeg'
        self.created_at = kwargs.get('created_at')
        self.updated_at = kwargs.get('updated_at')
        self.deleted_at = kwargs.get('deleted_at')
    
    @classmethod
    def get_by_id(cls, expense_id: int) -> Optional['Expense']:
        """Get an expense by ID."""
        query = """
            SELECT * FROM expenses 
            WHERE id = %s AND deleted_at IS NULL
        """
        expense_data = execute_query(query, (expense_id,), fetch_one=True)
        return cls(**expense_data) if expense_data else None
    
    @classmethod
    def get_by_user(cls, user_id: int) -> List['Expense']:
        """Get all expenses for a user."""
        query = """
            SELECT * FROM expenses 
            WHERE user_id = %s AND deleted_at IS NULL
            ORDER BY created_at DESC
        """
        expenses_data = execute_query(query, (user_id,), fetch_all=True)
        return [cls(**expense) for expense in expenses_data]
    
    def save(self) -> 'Expense':
        """Save the expense to the database."""
        if self.id is None:
            # Insert new expense
            query = """
                INSERT INTO expenses (
                    user_id, description, value, category, picture_url,
                    receipt_data, receipt_mime
                ) VALUES (%s, %s, %s, %s, %s, %s, %s)
            """
            params = (
                self.user_id, self.description, self.value,
                self.category, self.picture_url,
                self.receipt_data, self.receipt_mime
            )
            self.id = execute_query(query, params, commit=True)
        else:
            # Update existing expense
            query = """
                UPDATE expenses SET
                    description = %s, value = %s,
                    category = %s, picture_url = %s,
                    receipt_data = %s, receipt_mime = %s,
                    updated_at = NOW()
                WHERE id = %s
            """
            params = (
                self.description, self.value,
                self.category, self.picture_url,
                self.receipt_data, self.receipt_mime,
                self.id
            )
            execute_query(query, params, commit=True)
        return self
    
    def delete(self) -> None:
        """Soft delete the expense."""
        query = "UPDATE expenses SET deleted_at = NOW() WHERE id = %s"
        execute_query(query, (self.id,), commit=True)
    
    @staticmethod
    def delete_all_by_user(user_id: int) -> None:
        """Soft delete all expenses for a specific user."""
        query = "UPDATE expenses SET deleted_at = NOW() WHERE user_id = %s AND deleted_at IS NULL"
        execute_query(query, (user_id,), commit=True)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert expense to dictionary."""
        # Build a receipt URL: prefer DB blob, fall back to legacy file path
        receipt_url = None
        if self.receipt_data:
            receipt_url = f"/api/expenses/{self.id}/receipt"
        elif self.picture_url:
            receipt_url = self.picture_url  # legacy on-disk path
        return {
            'id': self.id,
            'user_id': self.user_id,
            'description': self.description,
            'value': float(self.value) if self.value is not None else None,
            'category': self.category,
            'picture_url': receipt_url,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }

class Budget(TimestampMixin):
    """Budget record for a user within a period."""
    
    def __init__(self, **kwargs):
        self.id = kwargs.get('id')
        self.user_id = kwargs.get('user_id')
        self.amount = kwargs.get('amount')
        self.period = kwargs.get('period')  # e.g., 'monthly', 'weekly'
        self.created_at = kwargs.get('created_at')
        self.updated_at = kwargs.get('updated_at')
        self.deleted_at = kwargs.get('deleted_at')
    
    @classmethod
    def get_active_by_user(cls, user_id: int) -> Optional['Budget']:
        """Get the active (non-deleted) budget for a user."""
        query = """
            SELECT * FROM budgets 
            WHERE user_id = %s AND deleted_at IS NULL 
            ORDER BY created_at DESC LIMIT 1
        """
        budget_data = execute_query(query, (user_id,), fetch_one=True)
        return cls(**budget_data) if budget_data else None
    
    def save(self) -> 'Budget':
        """Save the budget to the database."""
        if self.id is None:
            # Insert new budget
            query = """
                INSERT INTO budgets (user_id, amount, period)
                VALUES (%s, %s, %s)
            """
            params = (self.user_id, self.amount, self.period)
            self.id = execute_query(query, params, commit=True)
        else:
            # Update existing budget
            query = """
                UPDATE budgets SET
                    amount = %s, period = %s, updated_at = NOW()
                WHERE id = %s
            """
            params = (self.amount, self.period, self.id)
            execute_query(query, params, commit=True)
        return self
    
    def delete(self) -> None:
        """Soft delete the budget."""
        query = "UPDATE budgets SET deleted_at = NOW() WHERE id = %s"
        execute_query(query, (self.id,), commit=True)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert budget to dictionary."""
        return {
            'id': self.id,
            'user_id': self.user_id,
            'amount': float(self.amount) if self.amount is not None else None,
            'period': self.period,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }
