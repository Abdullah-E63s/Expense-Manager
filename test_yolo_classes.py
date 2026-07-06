import sys
import os
import torch

os.chdir('YOLOV9_MODEL')
sys.path.insert(0, os.getcwd())

from models.experimental import attempt_load

try:
    model = attempt_load('weights/best.pt', device='cpu')
    print("YOLO Classes:", model.names)
except Exception as e:
    import traceback
    traceback.print_exc()
