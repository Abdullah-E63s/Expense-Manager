"""Test database connection and setup."""
import os
from dotenv import load_dotenv
import pymysql

# Load environment variables
load_dotenv()

def test_connection():
    """Test MySQL database connection."""
    try:
        # Get database credentials from environment
        host = os.getenv('MYSQL_HOST', 'localhost')
        user = os.getenv('MYSQL_USER', 'root')
        password = os.getenv('MYSQL_PASSWORD', '')
        database = os.getenv('MYSQL_DATABASE', 'expense_manager')
        port = int(os.getenv('MYSQL_PORT', 3306))
        
        print(f"Attempting to connect to MySQL database...")
        print(f"Host: {host}")
        print(f"Port: {port}")
        print(f"User: {user}")
        print(f"Database: {database}")
        print()
        
        # Try to connect
        connection = pymysql.connect(
            host=host,
            user=user,
            password=password,
            database=database,
            port=port,
            cursorclass=pymysql.cursors.DictCursor
        )
        
        print("✅ Successfully connected to MySQL database!")
        
        # Test query
        with connection.cursor() as cursor:
            cursor.execute("SELECT VERSION()")
            version = cursor.fetchone()
            print(f"MySQL Version: {version['VERSION()']}")
            
            # Check if users table exists
            cursor.execute("SHOW TABLES LIKE 'users'")
            table_exists = cursor.fetchone()
            
            if table_exists:
                print("✅ Users table exists")
                
                # Count users
                cursor.execute("SELECT COUNT(*) as count FROM users")
                user_count = cursor.fetchone()
                print(f"Total users in database: {user_count['count']}")
                
                # Check table structure
                cursor.execute("DESCRIBE users")
                columns = cursor.fetchall()
                print("\nUsers table structure:")
                for col in columns:
                    print(f"  - {col['Field']}: {col['Type']}")
                
                # Show sample users (without passwords) - use only existing columns
                cursor.execute("SELECT * FROM users LIMIT 5")
                users = cursor.fetchall()
                
                if users:
                    print("\nSample users:")
                    for user in users:
                        print(f"  - {user}")
                else:
                    print("\n⚠️  No users found in database")
            else:
                print("❌ Users table does not exist")
                print("Please run the database initialization script")
        
        connection.close()
        return True
        
    except pymysql.Error as e:
        print(f"❌ MySQL Error: {e}")
        print("\nPlease check:")
        print("1. MySQL server is running")
        print("2. Database credentials in .env file are correct")
        print("3. Database 'expense_manager' exists")
        print("4. User has proper permissions")
        return False
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        return False

if __name__ == "__main__":
    test_connection()
