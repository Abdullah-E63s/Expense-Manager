"""Script to initialize the database with the updated schema."""
import os
import sys

# Add the current directory to the path so we can import models
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from models import init_db

def main():
    print("Initializing database with updated schema...")
    try:
        init_db()
        print("Database initialized successfully!")
    except Exception as e:
        print(f"Error initializing database: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
