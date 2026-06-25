"""
GodModeOCR — Production-grade receipt OCR using Gemini Vision API.

Replaces the old EasyOCR/CPU pipeline entirely. Sends the image to
Gemini 2.5 Flash Vision and returns structured JSON with line items,
totals, date and receipt context.
"""
import os
import io
import json
import logging
import time
import re
import ast

logger = logging.getLogger("GodModeOCR")
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(levelname)s [%(name)s] %(message)s"))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)

# Detect which Gemini SDK is available (prefer new google.genai over deprecated google.generativeai)
try:
    import google.genai as _genai_new  # noqa: F401
    _USE_NEW_SDK = True
except ImportError:
    _USE_NEW_SDK = False

# --- Gemini configuration ---

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")

GENERATION_CONFIG = {
    "temperature": 0.0,
    "top_p": 0.95,
    "top_k": 1,
    "response_mime_type": "application/json",
}

SYSTEM_INSTRUCTION = """
You are a highly accurate receipt parsing assistant. Extract structured data from the provided receipt image.
Return valid JSON exactly matching this structure:
{
  "items": [
    {
      "name": "string (cleaned item description without SKU codes or trailing tax letters)",
      "price": float (item price, negative if it is a discount/coupon),
      "category": "string (guess the category, e.g., 'Food', 'Groceries', 'Transport', 'Utilities', 'Shopping', 'Misc')"
    }
  ],
  "total": float (the grand total paid),
  "subtotal": float (the subtotal before tax/tip, optional),
  "date": "string (DD/MM/YYYY format if present, else null)",
  "receipt_context": "string (e.g., 'food', 'retail', 'utilities', 'unknown', or 'not_a_receipt' if the image is clearly not a receipt or invoice)"
}

IMPORTANT RULES:
1. Ignore payment authorization details, credit card numbers, pure barcodes, and other noise.
2. Do not include Taxes, Tips, or Subtotals in the 'items' array. Only purchased products/services.
3. If an item name contains a leading SKU, UPC, or #ref code, strip it in the extracted name.
4. If an item name has a trailing tax letter (T, F, X), strip it.
5. If the receipt has items and prices on separate lines, intelligently match them.
6. YOU MUST properly escape all inner quotes in strings.
7. Only set "receipt_context" to "not_a_receipt" if the image is CLEARLY not a financial document (e.g. a selfie, a landscape photo, a blank page). If the image contains ANY text resembling prices, item names, totals, or a list of goods/services — even if partially visible, rotated, or low quality — treat it as a receipt and extract what you can. When in doubt, attempt extraction rather than rejecting.
"""

_EMPTY_RESULT = {
    "items": [], "total": None, "subtotal": None,
    "date": None, "receipt_context": "error"
}


class GodModeOCR:
    """
    Gemini Vision-based receipt OCR engine.
    Model is initialized lazily on first use to avoid startup overhead.
    """

    def __init__(self):
        self._model = None
        self._configured = False

    def _get_model(self):
        """Lazy-initialize the Gemini model on first call.
        
        Prefers the new google.genai SDK; falls back to the deprecated
        google.generativeai if the new package is not installed.
        """
        if self._model is not None:
            return self._model

        if not GEMINI_API_KEY:
            logger.error("GEMINI_API_KEY is not set — OCR will fail.")
            return None

        if _USE_NEW_SDK:
            # ── New google.genai SDK ──────────────────────────────────────────
            try:
                import google.genai as genai
                from google.genai import types as genai_types

                self._client = genai.Client(api_key=GEMINI_API_KEY)
                self._genai_types = genai_types
                # Store sentinel so extract_structured_data knows which path to use
                self._model = "NEW_SDK"
                logger.info("Gemini 2.5 Flash model initialized (google.genai SDK).")
            except Exception as e:
                logger.error("Failed to initialize google.genai model: %s", e)
        else:
            # ── Legacy google.generativeai SDK ────────────────────────────────
            try:
                import google.generativeai as genai  # type: ignore
                from google.generativeai.types import HarmCategory, HarmBlockThreshold  # type: ignore

                if not self._configured:
                    genai.configure(api_key=GEMINI_API_KEY)
                    self._configured = True

                safety_settings = {
                    HarmCategory.HARM_CATEGORY_HARASSMENT: HarmBlockThreshold.BLOCK_NONE,
                    HarmCategory.HARM_CATEGORY_HATE_SPEECH: HarmBlockThreshold.BLOCK_NONE,
                    HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: HarmBlockThreshold.BLOCK_NONE,
                    HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_NONE,
                }

                self._model = genai.GenerativeModel(
                    model_name="gemini-2.5-flash",
                    generation_config=GENERATION_CONFIG,
                    safety_settings=safety_settings,
                    system_instruction=SYSTEM_INSTRUCTION,
                )
                logger.info("Gemini 2.5 Flash model initialized (google.generativeai legacy SDK).")
            except ImportError:
                logger.error("Neither google.genai nor google-generativeai package is installed.")
            except Exception as e:
                logger.error("Failed to initialize Gemini model: %s", e)

        return self._model

    def extract_structured_data(self, img_bgr):
        """
        Accepts a BGR numpy array (from OpenCV / YOLO crop or full image).
        Returns the parsed receipt dict matching the JSON schema above.
        """
        model = self._get_model()
        if model is None:
            raise ValueError("Gemini model not available. Check GEMINI_API_KEY.")

        # Lazy import heavy libs — only needed during actual OCR call
        import cv2
        from PIL import Image
        import io as _io

        start = time.time()

        # Convert BGR → RGB PIL image
        img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
        pil_img = Image.fromarray(img_rgb)

        # Upscale tiny images so Gemini can read text (min 200px on shortest side)
        min_dim = min(pil_img.size)
        if min_dim < 200:
            scale = 200 / min_dim
            new_size = (int(pil_img.size[0] * scale), int(pil_img.size[1] * scale))
            pil_img = pil_img.resize(new_size, Image.Resampling.LANCZOS)

        # Cap longest side at 1600px to reduce bandwidth/latency
        max_dim = max(pil_img.size)
        if max_dim > 1600:
            scale = 1600 / max_dim
            new_size = (int(pil_img.size[0] * scale), int(pil_img.size[1] * scale))
            pil_img = pil_img.resize(new_size, Image.Resampling.LANCZOS)

        logger.info("Sending %dx%d image to Gemini Vision...", pil_img.width, pil_img.height)

        prompt = "Extract the receipt data into the requested JSON format. System: " + SYSTEM_INSTRUCTION

        try:
            if _USE_NEW_SDK and model == "NEW_SDK":
                # ── New google.genai SDK path ─────────────────────────────────
                # Convert PIL image to bytes for upload
                buf = _io.BytesIO()
                pil_img.save(buf, format='JPEG', quality=90)
                img_bytes = buf.getvalue()

                genai_types = self._genai_types
                response = self._client.models.generate_content(
                    model="gemini-2.5-flash",
                    contents=[
                        genai_types.Part.from_bytes(data=img_bytes, mime_type="image/jpeg"),
                        genai_types.Part.from_text(text="Extract the receipt data into the requested JSON format."),
                    ],
                    config=genai_types.GenerateContentConfig(
                        system_instruction=SYSTEM_INSTRUCTION,
                        response_mime_type="application/json",
                        temperature=0.0,
                    ),
                )
                json_text = response.text.strip() if response.text else ""
            else:
                # ── Legacy google.generativeai SDK path ───────────────────────
                response = model.generate_content(
                    ["Extract the receipt data into the requested JSON format.", pil_img]
                )
                json_text = response.text.strip() if response.text else ""

            # Strip markdown code fences if present
            json_text = re.sub(r'^```(?:json)?\s*', '', json_text)
            json_text = re.sub(r'\s*```$', '', json_text).strip()

            if not json_text:
                logger.warning("Gemini returned empty response — returning empty result.")
                return dict(_EMPTY_RESULT)

            try:
                data = json.loads(json_text)
            except json.JSONDecodeError as je:
                logger.warning("JSON parse error: %s — attempting repair...", je)
                # Strip control characters
                json_text = re.sub(r'[\x00-\x1f\x7f-\x9f]', '', json_text)
                try:
                    data = ast.literal_eval(json_text)
                except Exception:
                    logger.error("Could not repair JSON — returning empty result.")
                    data = dict(_EMPTY_RESULT)

            elapsed = time.time() - start
            logger.info(
                "Gemini extraction: %.2fs | %d items | total=%s",
                elapsed, len(data.get('items', [])), data.get('total')
            )
            return data

        except Exception as e:
            logger.error("Gemini OCR failed: %s", e)
            raise

    def extract_text(self, img_bgr):
        """
        Alias for extract_structured_data — returns the full structured dict.
        Kept for backward compatibility with any callers using the old EasyOCR
        interface that expected a plain text return value.
        """
        return self.extract_structured_data(img_bgr)
