import os
import sys
from app import create_app
from config import Config

app = create_app(Config)
app.config['TESTING'] = True

with app.test_client() as client:
    # Need to create a fake user session if it requires login
    # Or we can just import the _get_yolov9_model directly!
    from routes import _get_yolov9_model
    try:
        model = _get_yolov9_model()
        if model is not None:
            print("YOLOv9 loaded successfully!")
        else:
            print("YOLOv9 returned None!")
            from routes import YOLOV9_LAST_ERROR
            print("Error:", YOLOV9_LAST_ERROR)
    except Exception as e:
        import traceback
        print("Exception:", e)
        traceback.print_exc()

