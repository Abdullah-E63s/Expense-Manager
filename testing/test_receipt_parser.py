"""
Test suite for the overhauled receipt parsing pipeline.
No image required — tests are driven by mock OCR data.

Run with:
  cd "x:\\chapters acording to fakhar\\expense manager (web app)"
  python testing/test_receipt_parser.py
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# ── Import the functions under test ──────────────────────────────────────────
import re
from rapidfuzz import fuzz

# We need to import the route functions — since they live in routes.py at module
# level (not inside a Flask app), we can import them directly.
from routes import (
    parse_structured_receipt,
    is_noise_keyword,
    guess_category_backend,
    extract_metadata_from_text,
)

PASS = "✅ PASS"
FAIL = "❌ FAIL"
results = []

def check(name, condition):
    status = PASS if condition else FAIL
    results.append((name, status))
    print(f"{status}  {name}")

# ─────────────────────────────────────────────────────────────────────────────
# Helper: build a mock structured line
# ─────────────────────────────────────────────────────────────────────────────
def make_line(words, y_top=100, section="items"):
    """Simulate a line returned by GodModeOCR.reconstruct_structured_lines."""
    line = []
    x = 10
    for word in words:
        x_right = x + len(word) * 8
        line.append({
            "text": word,
            "conf": 0.92,
            "bbox": [[x, y_top], [x_right, y_top], [x_right, y_top + 20], [x, y_top + 20]],
            "y_top": float(y_top),
            "x_left": float(x),
            "section": section,
        })
        x = x_right + 8
    return line


# ─────────────────────────────────────────────────────────────────────────────
# TEST GROUP 1: is_noise_keyword
# ─────────────────────────────────────────────────────────────────────────────
print("\n── is_noise_keyword ─────────────────────────────────────────────────")

check("'TOTAL 45.00' is noise", is_noise_keyword("TOTAL 45.00"))
check("'T0TAL 45.00' is noise (OCR typo)", is_noise_keyword("T0TAL 45.00"))
check("'Grand Total 120.50' is noise", is_noise_keyword("Grand Total 120.50"))
check("'SUBTOTAL 30.00' is noise", is_noise_keyword("SUBTOTAL 30.00"))
check("'Paid by VISA' is noise", is_noise_keyword("Paid by VISA"))
check("'Thank you!' is noise", is_noise_keyword("Thank you!"))
check("'CASH TENDER' is noise", is_noise_keyword("CASH TENDER"))

# These are VALID items, should NOT be noise
check("'Chicken Burger 5.99' is NOT noise", not is_noise_keyword("Chicken Burger 5.99"))
check("'Delivery Meal 12.00' is NOT noise", not is_noise_keyword("Delivery Meal 12.00"))
check("'Shipping Box Pack 8.00' is NOT noise", not is_noise_keyword("Shipping Box Pack 8.00"))
check("'Fries Large 2.50' is NOT noise", not is_noise_keyword("Fries Large 2.50"))
check("'Tax 1.20' is NOT noise (it's an info line, ok to keep)", not is_noise_keyword("Tax 1.20"))


# ─────────────────────────────────────────────────────────────────────────────
# TEST GROUP 2: guess_category_backend
# ─────────────────────────────────────────────────────────────────────────────
print("\n── guess_category_backend ───────────────────────────────────────────")

check("'Chicken Burger' → Food", guess_category_backend("Chicken Burger") == "Food")
check("'Combo Meal' → Food", guess_category_backend("Combo Meal") == "Food")
check("'Set A Rice' → Food", guess_category_backend("Set A Rice") == "Food")
check("'House Special' → Food", guess_category_backend("House Special") == "Food")
check("'Espresso' → Food", guess_category_backend("Espresso") == "Food")
check("'Uber Ride' → Transport", guess_category_backend("Uber Ride") == "Transport")
check("'Laptop Charger' → Electronics", guess_category_backend("Laptop Charger") == "Electronics")

# Context fallback: unknown items on food receipts → Food
check("Unknown item on food receipt → Food", guess_category_backend("Special Item X", receipt_context="food") == "Food")
check("Unknown item no context → Misc", guess_category_backend("Special Item X") == "Misc")


# ─────────────────────────────────────────────────────────────────────────────
# TEST GROUP 3: parse_structured_receipt — section awareness
# ─────────────────────────────────────────────────────────────────────────────
print("\n── parse_structured_receipt ─────────────────────────────────────────")

# Simulate a full restaurant receipt
mock_lines = [
    # Header: store name at top
    make_line(["THE", "BURGER", "PALACE"], y_top=5, section="header"),
    make_line(["123", "Main", "Street"], y_top=30, section="header"),
    make_line(["Tel:", "0300-1234567"], y_top=55, section="header"),
    # Items in the middle
    make_line(["Chicken", "Burger", "5.99"], y_top=200, section="items"),
    make_line(["Large", "Fries", "2.50"], y_top=230, section="items"),
    make_line(["Cola", "1.25"], y_top=260, section="items"),
    make_line(["Delivery", "Meal", "12.00"], y_top=290, section="items"),  # delivery is a valid item
    # Footer: totals
    make_line(["TOTAL", "21.74"], y_top=400, section="footer"),
    make_line(["Thank", "You"], y_top=430, section="footer"),
]

result = parse_structured_receipt(mock_lines)
items = result.get("items", [])
item_names = [i["name"] for i in items]

print(f"  → Items found: {item_names}")
print(f"  → Total extracted: {result.get('total')}")
print(f"  → Receipt context: {result.get('receipt_context')}")

check("Store name not extracted as item", not any("BURGER PALACE" in n or "Burger Palace" in n or "Main Street" in n for n in item_names))
check("Phone number not extracted as item", not any("0300" in n for n in item_names))
check("'Chicken Burger 5.99' extracted", any("Chicken" in n for n in item_names))
check("'Large Fries 2.50' extracted", any("Fries" in n for n in item_names))
check("'Delivery Meal 12.00' extracted (delivery is valid!)", any("Delivery" in n or "Meal" in n for n in item_names))
check("Total = 21.74", result.get("total") == 21.74)
check("'Thank You' not an item", not any("Thank" in n for n in item_names))
check("Food context detected", result.get("receipt_context") == "food")
check("Chicken Burger categorized as Food",
      next((i["category"] for i in items if "Chicken" in i["name"]), None) == "Food")


# ─────────────────────────────────────────────────────────────────────────────
# TEST GROUP 4: extract_metadata_from_text (legacy helper)
# ─────────────────────────────────────────────────────────────────────────────
print("\n── extract_metadata_from_text ───────────────────────────────────────")

sample_text = """
THE PIZZA PLACE
Date: 25/02/2026
Pepperoni Pizza  12.50
Garlic Bread      3.00
Subtotal         15.50
Tax               1.09
TOTAL            16.59
Thank You!
"""

date_val, total_val = extract_metadata_from_text(sample_text)
check("Date extracted correctly", date_val is not None and "25" in str(date_val))
check("Total extracted correctly", total_val is not None and "16" in str(total_val))


# ─────────────────────────────────────────────────────────────────────────────
# SUMMARY
# ─────────────────────────────────────────────────────────────────────────────
print("\n" + "=" * 60)
passed = sum(1 for _, s in results if s == PASS)
failed = sum(1 for _, s in results if s == FAIL)
print(f"Results: {passed}/{passed + failed} passed")
if failed == 0:
    print("🎉 All tests passed!")
else:
    print(f"⚠️  {failed} test(s) failed — review output above.")
print("=" * 60)
