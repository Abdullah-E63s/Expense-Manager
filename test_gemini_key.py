import os
import sys
from dotenv import load_dotenv

load_dotenv('.env')

key = os.environ.get('GEMINI_API_KEY')
print(f"Key exists: {bool(key)}")
if key:
    print(f"Key length: {len(key)}")
    print(f"Key starts with: {key[:5]}")
