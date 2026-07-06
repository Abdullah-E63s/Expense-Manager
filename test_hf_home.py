import urllib.request
import urllib.error

url = 'https://ghost993-expensemanager.hf.space/'
try:
    response = urllib.request.urlopen(url)
    print(f"Status: {response.getcode()}")
except urllib.error.HTTPError as e:
    print(f"Status: {e.code}")
    print(f"Response: {e.read().decode('utf-8')[:200]}")
