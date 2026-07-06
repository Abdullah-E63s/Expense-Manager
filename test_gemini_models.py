import os
import sys
from dotenv import load_dotenv
import google.generativeai as genai

load_dotenv('.env')

key = os.environ.get('GEMINI_API_KEY')
genai.configure(api_key=key)

for m in genai.list_models():
    if 'generateContent' in m.supported_generation_methods:
        print(m.name)
