import urllib.request
import urllib.error

url = 'https://ghost993-expensemanager.hf.space/api/yolo/detect'
boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW'
body = (
    '--' + boundary + '\r\n'
    'Content-Disposition: form-data; name="image"; filename="test.jpg"\r\n'
    'Content-Type: image/jpeg\r\n\r\n'
    'fakeimagebytes\r\n'
    '--' + boundary + '--\r\n'
).encode('utf-8')

req = urllib.request.Request(url, data=body, method='POST')
req.add_header('Content-Type', f'multipart/form-data; boundary={boundary}')
try:
    response = urllib.request.urlopen(req)
    print(f"Status: {response.getcode()}")
except urllib.error.HTTPError as e:
    print(f"Status: {e.code}")
    print(f"Response: {e.read().decode('utf-8')[:200]}")
