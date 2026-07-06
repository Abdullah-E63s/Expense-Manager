import sys
import os
import traceback

from routes import get_yolo_model

try:
    model = get_yolo_model()
    if model:
        print("YOLO loaded successfully via get_yolo_model!")
    else:
        print("YOLO returned None!")
except Exception as e:
    print("YOLO load error:")
    traceback.print_exc()
