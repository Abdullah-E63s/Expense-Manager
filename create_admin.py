"""Script to create an admin user if they don't exist."""
import os
import sys
from werkzeug.security import generate_password_hash
from datetime import datetime

# Add the project root to the Python path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app import app, db
from models import User

def create_admin_user():
    """Create an admin user if they don't exist."""
    with app.app_context():
        admin_email = 'abdullahjalalg@gmail.com'
        admin_password = 'musa4200'
        
        # Check if admin user already exists
        conn = db.get_connection()
        try:
            with conn.cursor() as cursor:
                cursor.execute(
                    'SELECT * FROM users WHERE email = %s', 
                    (admin_email,)
                )
                existing_user = cursor.fetchone()
                
                if existing_user:
                    # Update existing admin user
                    cursor.execute("""
                        UPDATE users 
                        SET password_hash = %s, 
                            is_admin = 1, 
                            is_verified = 1,
                            is_active = 1,
                            updated_at = %s
                        WHERE email = %s
                    """, (generate_password_hash(admin_password), datetime.utcnow(), admin_email))
                    print(f"Updated existing admin user: {admin_email}")
                else:
                    # Create new admin user
                    cursor.execute("""
                        INSERT INTO users (
                            email, 
                            password_hash, 
                            is_admin, 
                            is_verified, 
                            is_active,
                            created_at,
                            updated_at
                        ) VALUES (%s, %s, 1, 1, 1, %s, %s)
                    """, (
                        admin_email,
                        generate_password_hash(admin_password),
                        datetime.utcnow(),
                        datetime.utcnow()
                    ))
                    print(f"Created new admin user: {admin_email}")
                
                conn.commit()
                print("Admin user setup completed successfully!")
                
        except Exception as e:
            conn.rollback()
            print(f"Error setting up admin user: {str(e)}")
            raise
        finally:
            db.return_connection(conn)

if __name__ == "__main__":
    create_admin_user()
