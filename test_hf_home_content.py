import urllib.request

url = 'https://ghost993-expensemanager.hf.space/'
response = urllib.request.urlopen(url)
print(response.read().decode('utf-8')[:500])
