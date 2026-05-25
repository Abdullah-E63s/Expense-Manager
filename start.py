#!/usr/bin/env python3
"""
Expense Manager Startup Script.
This script ensures the database is properly initialized and starts the Flask application.
"""

import os
import sys
import subprocess
import time
from pathlib import Path

def check_requirements():
    """Check if all required packages are installed."""
    print("🔍 Checking Python requirements...")
    try:
        import flask
        import pymysql
        import firebase_admin
        import flask_mail
        import flask_cors
        import jwt
        import werkzeug
        print("✓ All required Python packages are installed")
        return True
    except ImportError as e:
        print(f"✗ Missing required package: {e}")
        print("Please run: pip install -r requirements.txt")
        return False

def check_mysql_connection():
    """Check if MySQL is running and accessible."""
    print("🔍 Checking MySQL connection...")
    try:
        import pymysql

        connection = pymysql.connect(
            host=os.getenv('MYSQL_HOST', 'localhost'),
            user=os.getenv('MYSQL_USER', 'root'),
            password=os.getenv('MYSQL_PASSWORD', '@abdullah4200'),
            database=os.getenv('MYSQL_DATABASE', 'expense_manager'),
            charset='utf8mb4',
            cursorclass=pymysql.cursors.DictCursor,
            autocommit=True
        )

        # Test the connection
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            result = cursor.fetchone()

        connection.close()
        print("✓ MySQL connection successful")
        return True

    except Exception as e:
        print(f"✗ MySQL connection failed: {e}")
        print("Please ensure MySQL is running and the database is created.")
        print("You can run: python init_database.py")
        return False

def check_environment_variables():
    """Check if all required environment variables are set."""
    print("🔍 Checking environment variables...")

    required_vars = [
        'MYSQL_HOST',
        'MYSQL_USER',
        'MYSQL_PASSWORD',
        'MYSQL_DATABASE',
        'SECRET_KEY',
        'JWT_SECRET_KEY'
    ]

    missing_vars = []
    for var in required_vars:
        if not os.getenv(var):
            missing_vars.append(var)

    if missing_vars:
        print(f"⚠️  Missing environment variables: {', '.join(missing_vars)}")
        print("These will use default values, but consider setting them in your .env file")
    else:
        print("✓ All environment variables are set")

    return True

def run_database_initialization():
    """Run database initialization if needed."""
    print("🔧 Ensuring database is initialized...")
    try:
        result = subprocess.run([sys.executable, 'init_database.py'],
                              capture_output=True, text=True, cwd=os.getcwd())

        if result.returncode == 0:
            print("✓ Database initialization successful")
            return True
        else:
            print(f"✗ Database initialization failed: {result.stderr}")
            return False

    except Exception as e:
        print(f"✗ Error running database initialization: {e}")
        return False

def start_application():
    """Start the Flask application."""
    print("🚀 Starting Expense Manager...")
    print("-" * 40)
    print("📍 Application will be available at: http://localhost:5000")
    print("📍 API endpoints will be available at: http://localhost:5000/api/")
    print("🛑 Press Ctrl+C to stop the server")
    print("-" * 40)

    try:
        # Start the Flask application
        subprocess.run([
            sys.executable, '-m', 'flask', 'run',
            '--host=0.0.0.0',
            '--port=5000',
            '--debug'
        ], cwd=os.getcwd())

    except KeyboardInterrupt:
        print("\n👋 Shutting down Expense Manager...")
    except Exception as e:
        print(f"✗ Error starting application: {e}")

def main():
    """Main startup function."""
    print("🎯 Expense Manager Startup")
    print("=" * 40)
    print(f"📁 Working directory: {os.getcwd()}")
    print(f"🐍 Python version: {sys.version.split()[0]}")
    print("-" * 40)

    # Step 1: Check requirements
    if not check_requirements():
        sys.exit(1)

    # Step 2: Check environment variables
    check_environment_variables()

    # Step 3: Check MySQL connection
    if not check_mysql_connection():
        print("\n🔧 Attempting to initialize database...")
        if not run_database_initialization():
            print("❌ Database initialization failed. Please fix the issues above.")
            sys.exit(1)

    # Step 4: Start the application
    print("\n" + "=" * 40)
    start_application()

if __name__ == "__main__":
    main()
