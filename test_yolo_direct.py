import sys
import os
import torch

os.chdir('YOLOV9_MODEL')
sys.path.insert(0, os.getcwd())

from models.experimental import attempt_load

try:
    model = attempt_load('weights/best.pt', map_location='cpu')
    print("YOLO loaded successfully!")
except Exception as e:
    import traceback
    print("YOLO load error:")
    traceback.print_exc()
