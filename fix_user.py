"""Fix user account to allow sign-in."""
import os
from dotenv import load_dotenv
import pymysql
from werkzeug.security import generate_password_hash

# Load environment variables
load_dotenv()

def fix_user(email):
    """Restore and fix user account."""
    try:
        # Get database credentials from environment
        host = os.getenv('MYSQL_HOST', 'localhost')
        user = os.getenv('MYSQL_USER', 'root')
        password = os.getenv('MYSQL_PASSWORD', '')
        database = os.getenv('MYSQL_DATABASE', 'expense_manager')
        port = int(os.getenv('MYSQL_PORT', 3306))
        
        print(f"Fixing user account for: {email}")
        
        # Connect to database
        connection = pymysql.connect(
            host=host,
            user=user,
            password=password,
            database=database,
            port=port,
            cursorclass=pymysql.cursors.DictCursor
        )
        
        with connection.cursor() as cursor:
            # Check if user exists
            cursor.execute("SELECT * FROM users WHERE email = %s", (email,))
            user_data = cursor.fetchone()
            
            if not user_data:
                print(f"❌ User with email {email} not found")
                return False
            
            print(f"\nCurrent user status:")
            print(f"  - ID: {user_data['id']}")
            print(f"  - Email: {user_data['email']}")
            print(f"  - Has password: {'Yes' if user_data['password_hash'] else 'No'}")
            print(f"  - Is active: {user_data['is_active']}")
            print(f"  - Is verified: {user_data['is_verified']}")
            print(f"  - Is Google user: {user_data['is_google_signed_in']}")
            print(f"  - Deleted at: {user_data['deleted_at']}")
            
            # Fix the user account
            updates = []
            
            # Restore deleted user
            if user_data['deleted_at']:
                updates.append("deleted_at = NULL")
                print("\n✓ Will restore deleted user")
            
            # Ensure user is active
            if not user_data['is_active']:
                updates.append("is_active = 1")
                print("✓ Will activate user")
            
            # Ensure user is verified
            if not user_data['is_verified']:
                updates.append("is_verified = 1")
                print("✓ Will verify user")
            
            # Set a default password if none exists (for Google users)
            if not user_data['password_hash']:
                # Generate a random password hash (user can reset it later)
                default_password = "GoogleUser123!@#"  # This is just a placeholder
                password_hash = generate_password_hash(default_password)
                updates.append(f"password_hash = '{password_hash}'")
                print(f"✓ Will set a default password (you can reset it later)")
            
            # Clear reset token if expired
            if user_data['reset_token_expires']:
                from datetime import datetime
                if user_data['reset_token_expires'] < datetime.now():
                    updates.append("reset_token = NULL")
                    updates.append("reset_token_expires = NULL")
                    print("✓ Will clear expired reset token")
            
            # Update user
            if updates:
                update_query = f"UPDATE users SET {', '.join(updates)} WHERE email = %s"
                cursor.execute(update_query, (email,))
                connection.commit()
                
                print(f"\n✅ Successfully fixed user account!")
                print(f"\nYou can now sign in with:")
                print(f"  - Email: {email}")
                if user_data['is_google_signed_in']:
                    print(f"  - Method: Google Sign-In (recommended)")
                    print(f"  - Or use password: {default_password if not user_data['password_hash'] else '(your existing password)'}")
                else:
                    print(f"  - Password: {default_password if not user_data['password_hash'] else '(your existing password)'}")
            else:
                print("\n✅ User account is already in good state!")
        
        connection.close()
        return True
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    # Fix the user from the database
    fix_user("malikabdullah2jz911@gmail.com")
