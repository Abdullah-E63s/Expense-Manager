import os
import io
from app import create_app
from config import Config

app = create_app(Config)
app.config['TESTING'] = True

with app.test_client() as client:
    # We need a dummy image
    image_data = b'GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;'
    data = {'file': (io.BytesIO(image_data), 'test.gif')}
    response = client.post('/api/yolo/detect', data=data, content_type='multipart/form-data')
    print(f"Status: {response.status_code}")
    try:
        print(response.get_json())
    except:
        print(response.get_data(as_text=True)[:200])
