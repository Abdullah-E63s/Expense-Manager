-- Make password_hash column nullable to support Google Sign-In
ALTER TABLE users MODIFY COLUMN password_hash VARCHAR(255) NULL;
