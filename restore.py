import sys
import argparse
from app import app
from models import User

def restore_user(email):
    """Restore a soft-deleted user by their email address."""
    with app.app_context():
        user = User.get_by_email_any(email)
        if not user:
            print(f"❌ Error: No user found with email '{email}'")
            sys.exit(1)
        
        if user.is_active and not user.deleted_at:
            print(f"ℹ️ User '{email}' is already active and not deleted.")
            sys.exit(0)
            
        try:
            user.restore()
            print(f"✅ Account for '{email}' has been successfully restored.")
        except Exception as e:
            print(f"❌ Error restoring user '{email}': {str(e)}")
            sys.exit(1)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Restore a soft-deleted user account.")
    parser.add_argument("email", help="The email address of the user to restore.")
    args = parser.parse_args()
    
    restore_user(args.email)
