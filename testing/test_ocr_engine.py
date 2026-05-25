import sys
import os
from PIL import Image
import numpy as np
import cv2

# Add project root to sys.path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils.ocr_engine import GodModeOCR

def test_ocr():
    print("🚀 Initializing GodModeOCR...")
    engine = GodModeOCR(gpu=False) # Force CPU for testing if needed
    
    # Path to a sample receipt if exists, otherwise create a dummy
    sample_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "test_processed.jpg")
    
    if os.path.exists(sample_path):
        print(f"📄 Loading sample: {sample_path}")
        img = Image.open(sample_path)
    else:
        print("🧪 Creating dummy receipt image for testing...")
        img_np = np.ones((500, 500, 3), dtype=np.uint8) * 255
        cv2.putText(img_np, "TOTAL: $123.45", (50, 250), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 0), 2)
        cv2.putText(img_np, "DATE: 2026-02-22", (50, 300), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 0), 2)
        img = Image.fromarray(cv2.cvtColor(img_np, cv2.COLOR_BGR2RGB))

    print("🧠 Running God Mode OCR Pipeline...")
    lines = engine.extract_text(img)
    
    print("\n--- EXTRACTED LINES ---")
    for idx, line in enumerate(lines):
        print(f"{idx+1}: {line}")
    print("-----------------------\n")
    
    if lines:
        print("✅ Success: Text extracted!")
    else:
        print("❌ Failure: No text extracted.")

if __name__ == "__main__":
    test_ocr()
