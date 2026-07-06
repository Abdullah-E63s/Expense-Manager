import requests
import json

url = 'https://ghost993-expensemanager.hf.space/api/yolo/detect'
try:
    with open('static/images/receipt-demo.jpg', 'rb') as f:
        files = {'file': f}
        response = requests.post(url, files=files)
        print(f"Status: {response.status_code}")
        try:
            data = response.json()
            print(f"Items detected: {len(data.get('items', []))}")
            if data.get('error'):
                print(f"Error: {data.get('error')}")
            else:
                print(json.dumps(data.get('items', []), indent=2))
        except:
            print("Response is not JSON. HTML preview:")
            print(response.text[:500])
except Exception as e:
    print(f"Request failed: {e}")
