import google.generativeai as genai
import os
from dotenv import load_dotenv
load_dotenv('.env')
genai.configure(api_key=os.environ.get('GEMINI_API_KEY'))
try:
  print([m.name for m in genai.list_models() if 'generateContent' in m.supported_generation_methods])
except Exception as e:
  print('Error:', e)
