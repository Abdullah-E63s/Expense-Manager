import os
import io
import traceback
from app import create_app
from config import Config
from routes import get_yolo_model

app = create_app(Config)
app.config['TESTING'] = True

with app.test_request_context():
    try:
        model = get_yolo_model()
        print("YOLO loaded successfully!")
    except Exception as e:
        print("YOLO Load Error:")
        traceback.print_exc()
