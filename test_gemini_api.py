import os
import sys
from dotenv import load_dotenv
import google.generativeai as genai

load_dotenv('.env')

key = os.environ.get('GEMINI_API_KEY')
if not key:
    print("No key")
    sys.exit(1)

genai.configure(api_key=key)

try:
    model = genai.GenerativeModel('gemini-1.5-flash')
    response = model.generate_content("Hello")
    print(f"Gemini API works! Response: {response.text}")
except Exception as e:
    print(f"Gemini API Error: {e}")
