"""HTTP routes for pages, authentication, and expense CRUD APIs."""
import os
import re
import sys
import secrets
import uuid
import json
import io
import glob
import random
import requests
import time
import threading
import smtplib
import email.mime.multipart
import email.mime.text
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
from functools import wraps

from flask import (
    Blueprint, render_template, request, redirect, url_for, flash, jsonify,
    session, current_app, send_from_directory, abort, make_response, send_file, Response
)
import numpy as np
from PIL import Image, ImageOps
from flask_cors import cross_origin
from flask_mail import Mail, Message
from flask_wtf.csrf import generate_csrf
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from werkzeug.datastructures import FileStorage
from werkzeug.security import generate_password_hash
from werkzeug.utils import secure_filename
from rapidfuzz import fuzz

try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
except ImportError:
    pass

try:
    import cv2
except ImportError:
    cv2 = None

from models import User, Expense, Budget

# Import Firebase from firebase_init to avoid circular imports
from firebase_init import firebase_admin, firebase_auth, FIREBASE_AVAILABLE

# Google OAuth token verification
from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_requests

# Initialize God Mode OCR Engine (lazy — model loads on first receipt scan)
from utils.ocr_engine import GodModeOCR
GOD_MODE_OCR = GodModeOCR()


# Password complexity regex: 10+ chars, at least one letter, digit, and symbol
PASSWORD_REGEX = re.compile(r'^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z\d]).{10,}$')

# Placeholder for future image processing functionality

# --- Advanced Preprocessing Helper Functions ---


def order_points(pts):
    """Order points in (tl, tr, br, bl) order for perspective transform."""
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]
    rect[3] = pts[np.argmax(diff)]
    return rect

def four_point_transform(image, pts):
    """Apply perspective transform to get top-down view of receipt."""
    (tl, tr, br, bl) = pts
    widthA = np.linalg.norm(br - bl)
    widthB = np.linalg.norm(tr - tl)
    maxWidth = max(int(widthA), int(widthB))
    heightA = np.linalg.norm(tr - br)
    heightB = np.linalg.norm(tl - bl)
    maxHeight = max(int(heightA), int(heightB))
    dst = np.array([
        [0, 0],
        [maxWidth - 1, 0],
        [maxWidth - 1, maxHeight - 1],
        [0, maxHeight - 1]
    ], dtype="float32")
    M = cv2.getPerspectiveTransform(pts, dst)
    warped = cv2.warpPerspective(image, M, (maxWidth, maxHeight))
    return warped


def get_robust_warped_image(pil_img):
    """
    Stage 1: Prepare image for detection without forceful geometric warping.
    We just resize and enhance the image, because forced perspective warping
    destroys crumpled or angled receipts. YOLO and EasyOCR handle natural angles well.
    """
    if cv2 is None:
        return np.array(pil_img.convert('RGB'))[:, :, ::-1], False
    
    try:
        # 1. Convert PIL to BGR
        image = np.array(pil_img)
        if image.shape[-1] == 4:
            # Handle transparency by flattening onto white background
            alpha = image[:, :, 3] / 255.0
            image_bgr = image[:, :, :3]
            white_bg = np.ones_like(image_bgr, dtype=np.uint8) * 255
            image = cv2.convertScaleAbs(image_bgr * alpha[:, :, np.newaxis] + white_bg * (1 - alpha[:, :, np.newaxis]))
        else:
            image = cv2.cvtColor(image, cv2.COLOR_RGB2BGR)

        # 2. Add padding to help with receipts touching the edge
        image = cv2.copyMakeBorder(image, 20, 20, 20, 20, cv2.BORDER_CONSTANT, value=[255, 255, 255])
        
        # 3. Resize if too small (improve feature detection)
        h, w = image.shape[:2]
        scale = 1.5 if max(h, w) < 2000 else 1.0
        if scale != 1.0:
            image = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
            
        return image, False
        
    except Exception as e:
        current_app.logger.warning(f"Image enhancement failed, using original: {e}")
        return np.array(pil_img.convert('RGB'))[:, :, ::-1], False

def apply_ocr_refinement(bgr_img):
    """
    Stage 2: Sharpen, Threshold, Morphological Cleaning, and Deskew for OCR.
    Takes BGR, returns Thresholded BWD.
    """
    if cv2 is None:
        return bgr_img
    
    try:
        gray = cv2.cvtColor(bgr_img, cv2.COLOR_BGR2GRAY)
        
        # 1. Sharpen
        kernel = np.array([[0, -1, 0], [-1, 5,-1], [0, -1, 0]])
        sharp = cv2.filter2D(gray, -1, kernel)

        # 2. Threshold Pass: Adaptive vs Otsu Fallback
        # Adaptive works better for uneven lighting
        thresh = cv2.adaptiveThreshold(
            sharp, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY, 15, 5
        )
        
        # If adaptive threshold produced mostly noise/black (due to high shadows), try Otsu
        if np.mean(thresh) < 50:
             _, thresh = cv2.threshold(sharp, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

        # 3. Morphological Opening (Denoising speckle noise from wrinkles)
        morph_kernel = np.ones((1,1), np.uint8)
        thresh = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, morph_kernel)

        # 4. Robust Deskew with Background Check
        # Ensure black text on white background for stable angle detection
        if np.mean(thresh) < 127:
            thresh = 255 - thresh
            
        coords = np.column_stack(np.where(thresh < 127)) # Assuming black text
        if coords.size > 0:
            rect = cv2.minAreaRect(coords)
            angle = rect[-1]
            if angle < -45:
                angle = -(90 + angle)
            elif angle > 45:
                angle = 90 - angle
            else:
                angle = -angle

            (h, w) = thresh.shape[:2]
            center = (w // 2, h // 2)
            M = cv2.getRotationMatrix2D(center, angle, 1.0)
            thresh = cv2.warpAffine(thresh, M, (w, h),
                                    flags=cv2.INTER_CUBIC,
                                    borderMode=cv2.BORDER_REPLICATE)
        
        # Clean up: Return to white background if inverted
        if np.mean(thresh) < 127:
            thresh = 255 - thresh
            
        return thresh
    except Exception as e:
        current_app.logger.warning(f"OCR refinement failed: {e}")
        return cv2.cvtColor(bgr_img, cv2.COLOR_BGR2GRAY)

def preprocess_receipt_robust(pil_img):
    """Preprocess a receipt image: perspective-correct → OCR refinement."""
    bgr, _ = get_robust_warped_image(pil_img)
    refined = apply_ocr_refinement(bgr)
    return Image.fromarray(refined)


def preprocess_receipt_image(pil_img):
    """Main preprocessing entry point. Degrades gracefully if cv2 unavailable."""
    if cv2 is None:
        current_app.logger.warning("OpenCV not available — skipping preprocessing.")
        return pil_img
    return preprocess_receipt_robust(pil_img)

pages_bp = Blueprint("pages", __name__)
auth_bp = Blueprint("auth", __name__)
expenses_bp = Blueprint("expenses", __name__)

import base64
import json

def decode_jwt_header(token):
    """Decode the header of a JWT token."""
    try:
        header_segment = token.split('.')[0]
        # Add padding if needed
        padding = len(header_segment) % 4
        if padding:
            header_segment += '=' * (4 - padding)
        header_data = base64.urlsafe_b64decode(header_segment)
        return json.loads(header_data)
    except Exception as e:
        current_app.logger.error(f"Error decoding JWT header: {str(e)}")
        return None


def verify_recaptcha(action: str, token: str | None, remote_ip: str | None = None) -> tuple[bool, float]:
    try:
        enabled = current_app.config.get('RECAPTCHA_ENABLED', True)
        site_key = current_app.config.get('RECAPTCHA_SITE_KEY', '')
        secret = current_app.config.get('RECAPTCHA_SECRET_KEY', '')
        api_key = current_app.config.get('RECAPTCHA_ENTERPRISE_API_KEY', '')
        project_id = current_app.config.get('RECAPTCHA_PROJECT_ID', '')
        min_score = float(current_app.config.get('RECAPTCHA_MIN_SCORE', 0.5) or 0.5)
        if not enabled or not site_key or not (secret or api_key):
            current_app.logger.info(f"reCAPTCHA disabled or not configured; action={action}")
            return True, 1.0
        token = (token or '').strip()
        if not token:
            return False, 0.0

        if api_key and project_id:
            url = f"https://recaptchaenterprise.googleapis.com/v1/projects/{project_id}/assessments?key={api_key}"
            payload = {
                "event": {
                    "token": token,
                    "expectedAction": action,
                    "siteKey": site_key,
                }
            }
            resp = requests.post(url, json=payload, timeout=3)
            data = resp.json() if resp.ok else {}
            token_props = data.get('tokenProperties') or {}
            risk = data.get('riskAnalysis') or {}
            success = bool(token_props.get('valid'))
            score = float(risk.get('score', 0) or 0)
            token_action = token_props.get('action')
            action_ok = (not token_action) or (token_action == action)
            ok = success and action_ok and (score >= min_score)
            if not ok:
                current_app.logger.warning(
                    f"reCAPTCHA Enterprise failed: valid={success} score={score} action={token_action} expected={action}"
                )
            else:
                current_app.logger.info(f"reCAPTCHA Enterprise ok: action={action} score={score}")
            return ok, score

        resp = requests.post(
            'https://www.google.com/recaptcha/api/siteverify',
            data={
                'secret': secret,
                'response': token,
                'remoteip': (remote_ip or '')
            },
            timeout=3
        )
        data = resp.json() if resp.ok else {}
        success = bool(data.get('success'))
        score = float(data.get('score', 0) or 0)
        action_ok = (not data.get('action')) or data.get('action') == action
        ok = success and action_ok and (score >= min_score)
        if not ok:
            current_app.logger.warning(
                f"reCAPTCHA failed: success={success} score={score} action={data.get('action')} expected={action}"
            )
        else:
            current_app.logger.info(f"reCAPTCHA ok: action={action} score={score}")
        return ok, score
    except Exception as e:
        current_app.logger.error(f"reCAPTCHA error: {e}", exc_info=True)
        return False, 0.0

# ---------------------- Admin Block Message ----------------------

def _admin_block_message() -> str:
    email = current_app.config.get('ADMIN_EMAIL', 'abdullahjalalg@gmail.com')
    return (
        f"This email was previously deleted. Please contact the administrator at {email} to restore access."
    )

# ---------------------- Pages (simple templates) ----------------------
@pages_bp.get("/")
def home_page():
    """Render login page or redirect to dashboard if already logged in."""
    if session.get("user_id"):
        return redirect(url_for("pages.dashboard"))
    return render_template("login.html")


@pages_bp.get("/dashboard")
def dashboard():
    """Render the dashboard page for authenticated users."""
    if not session.get("user_id"):
        return redirect(url_for("pages.home_page"))
    return render_template("index.html")


@pages_bp.get("/signup")
def signup_page():
    """Render the sign up page for new users."""
    if session.get("user_id"):
        return redirect(url_for("pages.dashboard"))
    return render_template("signup.html")


@pages_bp.get("/forgot")
def forgot_page():
    """Render the forgot/reset password page."""
    if session.get("user_id"):
        return redirect(url_for("pages.dashboard"))
    return render_template("forgot.html")


@pages_bp.get("/set-password")
def set_password_page():
    """Render the set password page for password reset."""
    # If user is logged in, still allow access when a reset token is present
    if session.get("user_id") and not request.args.get('token'):
        return redirect(url_for("pages.dashboard"))
    
    # Get token from URL query parameters
    token = request.args.get('token')
    if not token:
        flash('Password reset token is missing', 'error')
        return redirect(url_for('pages.forgot_page'))
        
    # Look up user by reset token and ensure it's not expired
    user = User.get_by_reset_token(token)
    if not user or not user.reset_token_expires or user.reset_token_expires < datetime.utcnow():
        flash('Invalid or expired password reset link', 'error')
        return redirect(url_for('pages.forgot_page'))
    
    # Render the set password page with the token
    return render_template("set_password.html", token=token)


@pages_bp.get("/set-password/<token>")
def set_password_page_token(token: str):
    """Render the set password page (token in path)."""
    # Allow access even if logged in (to complete reset)
    if not token:
        flash('Password reset token is missing', 'error')
        return redirect(url_for('pages.forgot_page'))

    user = User.get_by_reset_token(token)
    if not user or not user.reset_token_expires or user.reset_token_expires < datetime.utcnow():
        flash('Invalid or expired password reset link', 'error')
        return redirect(url_for('pages.forgot_page'))

    return render_template("set_password.html", token=token)


# ---------------------- Helpers ----------------------

def login_required(f):
    """Decorator to ensure a user is logged in."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({"error": "Login required"}), 401
        return f(*args, **kwargs)
    return decorated_function

def get_current_user():
    """Return the current logged-in user or None if unauthenticated."""
    from models import User
    user_id = session.get("user_id")
    return User.get_by_id(user_id) if user_id else None


def rate_limit(key: str) -> bool:
    """Naive in-memory rate limiter per key. Returns True if allowed."""
    store = current_app.config.setdefault("_RATE_LIMIT", {})
    now = int(datetime.utcnow().timestamp())
    window = current_app.config.get("RATE_LIMIT_WINDOW_SEC", 60)
    max_req = current_app.config.get("RATE_LIMIT_MAX_REQUESTS", 20)
    bucket = store.setdefault(key, [])
    bucket[:] = [t for t in bucket if t > now - window]
    if len(bucket) >= max_req:
        return False
    bucket.append(now)
    return True


def _get_serializer() -> URLSafeTimedSerializer:
    """Create a URL-safe timed serializer for email verification tokens."""
    secret = current_app.config.get("SECRET_KEY")
    if not secret:
        raise RuntimeError("SECRET_KEY must be configured for token generation")
    return URLSafeTimedSerializer(secret_key=secret)


def generate_email_token(email: str) -> str:
    """Generate a signed token embedding the user's email."""
    s = _get_serializer()
    salt = current_app.config.get("EMAIL_TOKEN_SALT", "email-confirm-salt")
    return s.dumps({"email": email}, salt=salt)


def verify_email_token(token: str, max_age: int = 3600) -> str | None:
    """Return the email from a token if valid and not expired; else None."""
    s = _get_serializer()
    salt = current_app.config.get("EMAIL_TOKEN_SALT", "email-confirm-salt")
    try:
        data = s.loads(token, max_age=max_age, salt=salt)
        return (data or {}).get("email")
    except (BadSignature, SignatureExpired):
        return None


def _send_smtp_email_thread(mail_username: str, mail_password: str, to_email: str, subject: str, html_body: str, text_body: str):
    """Send email via Gmail SMTP (or Google Apps Script relay) in a background thread (non-blocking).
    If GMAIL_RELAY_URL is set, it posts to the HTTP endpoint to bypass SMTP blocks.
    Otherwise, tries port 465 (SSL) first, then falls back to port 587 (STARTTLS).
    """
    relay_url = os.environ.get('GMAIL_RELAY_URL', '')
    if relay_url:
        try:
            print(f"[DEBUG] Using Google Apps Script relay to send email to {to_email}")
            r = requests.post(relay_url, json={
                "to": to_email,
                "subject": subject,
                "html": html_body,
                "text": text_body
            }, timeout=30)
            if r.status_code == 200:
                print(f"[SUCCESS][Relay] Email sent to {to_email}")
                return True
            else:
                print(f"[ERROR][Relay] HTTP {r.status_code}: {r.text}")
        except Exception as e:
            print(f"[ERROR][Relay] {str(e)}")
        # If relay failed or errored out, we fall back to standard SMTP in case it was a fluke
        print("[DEBUG] Relay failed, attempting direct SMTP fallback")

    msg = email.mime.multipart.MIMEMultipart('alternative')
    msg['Subject'] = subject
    msg['From'] = f'Expense Manager <{mail_username}>'
    msg['To'] = to_email
    msg.attach(email.mime.text.MIMEText(text_body, 'plain'))
    msg.attach(email.mime.text.MIMEText(html_body, 'html'))

    def _attempt(port, use_ssl):
        try:
            if use_ssl:
                with smtplib.SMTP_SSL('smtp.gmail.com', port, timeout=30) as server:
                    server.login(mail_username, mail_password)
                    server.sendmail(mail_username, [to_email], msg.as_string())
            else:
                with smtplib.SMTP('smtp.gmail.com', port, timeout=30) as server:
                    server.ehlo()
                    server.starttls()
                    server.ehlo()
                    server.login(mail_username, mail_password)
                    server.sendmail(mail_username, [to_email], msg.as_string())
            print(f"[SUCCESS][SMTP:{port}] Email sent to {to_email}")
            return True
        except Exception as e:
            print(f"[ERROR][SMTP:{port}] {str(e)}")
            return False

    # Try port 465 (SSL) first — more likely to be open on cloud hosts
    if not _attempt(465, use_ssl=True):
        # Fallback to port 587 (STARTTLS)
        _attempt(587, use_ssl=False)


def send_verification_email(email: str, verification_code: str) -> None:
    """Queue a verification email to be sent in a background thread.
    Returns immediately so the gunicorn worker is never blocked.
    """
    mail_username = os.environ.get('MAIL_USERNAME', 'exp2tester@gmail.com')
    mail_password = os.environ.get('MAIL_PASSWORD', '')

    html_body = f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333; line-height: 1.6;">
        <div style="background-color: #f8f9fa; padding: 20px; text-align: center; border-bottom: 1px solid #e9ecef;">
            <h2 style="margin: 0; color: #2c3e50;">Email Verification</h2>
        </div>
        <div style="padding: 30px 20px;">
            <p>Hello,</p>
            <p>Please use the following verification code to complete your registration:</p>
            <div style="background-color: #f3f4f6; padding: 25px; text-align: center; margin: 30px 0; border-radius: 8px; border: 1px dashed #d1d5db;">
                <h1 style="color: #3b82f6; font-family: monospace; font-size: 32px; margin: 0; letter-spacing: 4px;">{verification_code}</h1>
            </div>
            <p style="color: #6c757d; font-size: 14px; text-align: center;">This code will expire in 5 minutes.</p>
        </div>
        <div style="background-color: #f8f9fa; padding: 20px; text-align: center; font-size: 12px; color: #6c757d; border-top: 1px solid #e9ecef;">
            <p style="margin: 0;">If you didn't request this, please ignore this email.</p>
        </div>
    </div>"""
    text_body = f"Your verification code is: {verification_code}\n\nThis code will expire in 5 minutes."

    print(f"[DEBUG] Queuing email to {email} in background thread")
    t = threading.Thread(
        target=_send_smtp_email_thread,
        args=(mail_username, mail_password, email, "Verify your email for Expense Manager", html_body, text_body),
        daemon=True
    )
    t.start()
    print(f"[DEBUG] Email thread started for {email}")



def allowed_image(filename: str) -> bool:
    """Check file extension against allowed image extensions."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return ext in current_app.config.get("ALLOWED_IMAGE_EXTENSIONS", set())


def save_image(file: FileStorage) -> str:
    """Persist uploaded image to Firebase Storage and return its public URL."""
    filename = secure_filename(file.filename or "")
    if not filename or not allowed_image(filename):
        raise ValueError("Invalid image type")
    ext = filename.rsplit(".", 1)[-1].lower()
    unique_name = f"uploads/{uuid.uuid4().hex}.{ext}"
    
    if FIREBASE_AVAILABLE:
        try:
            from firebase_admin import storage
            bucket = storage.bucket()
            blob = bucket.blob(unique_name)
            
            file.seek(0)
            blob.upload_from_file(file, content_type=file.content_type)
            blob.make_public()
            return blob.public_url
        except Exception as e:
            current_app.logger.error(f"Failed to upload to Firebase Storage: {e}")
            # Fallback to local storage if Firebase fails
            pass
            
    # Fallback local storage
    upload_dir = current_app.config["UPLOAD_FOLDER"]
    os.makedirs(upload_dir, exist_ok=True)
    path = os.path.join(upload_dir, os.path.basename(unique_name))
    file.seek(0)
    file.save(path)
    rel_path = os.path.relpath(path, current_app.static_folder).replace("\\", "/")
    return f"/static/{rel_path}"

def delete_image(url: str):
    """Delete an image from Firebase Storage or local filesystem."""
    if not url:
        return
        
    if "storage.googleapis.com" in url and FIREBASE_AVAILABLE:
        try:
            import urllib.parse
            from firebase_admin import storage
            bucket = storage.bucket()
            prefix = f"https://storage.googleapis.com/{bucket.name}/"
            if url.startswith(prefix):
                blob_name = urllib.parse.unquote(url[len(prefix):])
                blob = bucket.blob(blob_name)
                blob.delete()
        except Exception as e:
            current_app.logger.warning(f"Failed to delete Firebase image {url}: {e}")
    else:
        # Local fallback
        file_path = os.path.join(current_app.root_path, url.lstrip('/'))
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
            except Exception as e:
                current_app.logger.warning(f"Failed to delete legacy image {file_path}: {e}")


YOLOV9_MODEL = None
YOLOV9_LAST_ERROR = None


def _get_yolov9_model():
    """Lazy-load YOLOv9 model on first call. Torch is imported here (not at module
    level) so that ~300 MB of PyTorch RAM is NOT consumed on every startup."""
    global YOLOV9_MODEL, YOLOV9_LAST_ERROR
    if YOLOV9_MODEL is not None:
        return YOLOV9_MODEL
    
    try:
        # Lazy-import torch here — keeps ~300 MB of PyTorch RAM off the startup
        import torch
        import importlib
        import importlib.util
        import types

        YOLOV9_LAST_ERROR = None
        base_dir = os.path.dirname(os.path.abspath(__file__))
        
        # 1. Primary Source: Environment Variable
        raw_weights = os.getenv("YOLOV9_WEIGHTS")
        weights = None
        
        if raw_weights:
            # Clean and normalize
            weights = raw_weights.strip().strip('"\'')
            if not os.path.isabs(weights):
                weights = os.path.normpath(os.path.join(base_dir, weights))
            weights = os.path.normpath(weights)
            
            current_app.logger.info(f"YOLOV9: Attempting to use env weights: {weights}")
            if os.path.exists(weights):
                size_mb = os.path.getsize(weights) / (1024 * 1024)
                current_app.logger.info(f"YOLOV9: SUCCESS! Found weights file: {weights} ({size_mb:.2f} MB)")
            else:
                current_app.logger.warning(f"YOLOV9: Weights file NOT FOUND at: {weights}")
                weights = None # Signal fallback
        
        # 2. Fallback: Search in YOLOV9_MODEL/weights
        if not weights:
            search_dir = os.path.normpath(os.path.join(base_dir, 'YOLOV9_MODEL', 'weights'))
            print(f"[DEBUG] YOLOV9: Searching in fallback directory: {search_dir}")
            
            if os.path.exists(search_dir):
                # Priority 1: best.pt
                best_pt = os.path.join(search_dir, 'best.pt')
                if os.path.exists(best_pt):
                    weights = best_pt
                    print(f"[DEBUG] YOLOV9: Found {weights} in weights directory")
                else:
                    # Priority 2: Candidates
                    candidates = ['yolov9-c.pt', 'yolov9-s.pt', 'yolov9-m.pt', 'yolov9-e.pt', 'gelan-c.pt', 'gelan-e.pt']
                    for cand in candidates:
                        cand_path = os.path.join(search_dir, cand)
                        if os.path.exists(cand_path):
                            weights = cand_path
                            print(f"[DEBUG] YOLOV9: Found candidate: {weights}")
                            break
                    
                    # Priority 3: Any .pt file
                    if not weights:
                        pt_files = glob.glob(os.path.join(search_dir, "*.pt"))
                        if pt_files:
                            weights = sorted(pt_files)[0]
                            print(f"[DEBUG] YOLOV9: Using first available .pt file: {weights}")
        
        if not weights or not os.path.exists(weights):
            raise FileNotFoundError(f"YOLOv9 weights not found. Search path: {weights}")

        current_app.logger.info(f"YOLOv9 initialization starting with weights: {weights}")
        
        yolov9_dir = os.path.join(base_dir, 'YOLOV9_MODEL')
        if not os.path.exists(yolov9_dir):
            raise FileNotFoundError(f"YOLOV9_MODEL directory not found at: {yolov9_dir}")
        try:
            os.environ.setdefault('YOLOv5_AUTOINSTALL', 'false')
        except Exception:
            pass
        
        # Prefer torch.hub to handle local repo imports cleanly, but ensure no name collisions
        # with the app's own 'models' or 'utils' modules.
        prev_cached = {k: v for k, v in sys.modules.items() if k == 'models' or k.startswith('models.') or k == 'utils' or k.startswith('utils.')}
        for k in list(prev_cached.keys()):
            try:
                del sys.modules[k]
            except Exception:
                pass

        prev_sys_path = list(sys.path)
        original_cwd = os.getcwd()
        app_root = os.path.dirname(os.path.abspath(__file__))
        try:
            # Remove app root so YOLO's packages resolve first
            norm_app_root = os.path.normcase(os.path.abspath(app_root))
            sys.path = [p for p in sys.path if os.path.normcase(os.path.abspath(p)) != norm_app_root]

            # Ensure optional IPython dependency used by YOLO is satisfied
            try:
                import IPython  # type: ignore
                from IPython.display import display as _ip_display  # type: ignore
            except Exception:
                ip = types.ModuleType("IPython")
                ip.__path__ = []  # mark as package
                ip_display_mod = types.ModuleType("IPython.display")
                def _noop_display(*args, **kwargs):
                    return None
                ip_display_mod.display = _noop_display  # type: ignore
                sys.modules.setdefault("IPython", ip)
                sys.modules["IPython.display"] = ip_display_mod

            try:
                if yolov9_dir not in sys.path:
                    sys.path.insert(0, yolov9_dir)
                importlib.invalidate_caches()
                from models.yolo import DetectionModel, Model, ClassificationModel, SegmentationModel  # type: ignore
                try:
                    torch.serialization.add_safe_globals([DetectionModel, Model, ClassificationModel, SegmentationModel])  # type: ignore
                except Exception:
                    pass
            except Exception:
                pass

            try:
                from models.yolo import DetectionModel, Model, ClassificationModel, SegmentationModel  # type: ignore
                ctx = getattr(torch.serialization, 'safe_globals', None)
            except Exception:
                ctx = None
            orig_load = getattr(torch, 'load')
            def _patched_load(*args, **kwargs):
                if 'weights_only' not in kwargs:
                    kwargs['weights_only'] = False
                return orig_load(*args, **kwargs)
            torch.load = _patched_load
            try:
                if ctx:
                    with ctx([DetectionModel, Model, ClassificationModel, SegmentationModel]):  # type: ignore
                        YOLOV9_MODEL = torch.hub.load(
                            yolov9_dir,
                            'custom',
                            path=weights,
                            source='local',
                            autoshape=True,
                            device='cpu',
                            force_reload=True
                        )
                else:
                    YOLOV9_MODEL = torch.hub.load(
                        yolov9_dir,
                        'custom',
                        path=weights,
                        source='local',
                        autoshape=True,
                        device='cpu',
                        force_reload=True
                    )
            finally:
                try:
                    torch.load = orig_load
                except Exception:
                    pass
        except Exception:
            # Fallback to direct import if torch.hub fails
            try:
                if yolov9_dir not in sys.path:
                    sys.path.insert(0, yolov9_dir)
                os.chdir(yolov9_dir)
                import importlib
                importlib.invalidate_caches()
                # hubconf.py lives inside the YOLOv9 repo dir — only reachable after
                # sys.path.insert() above. Use import_module() so static analyzers
                # (Pylance/pyright) don't flag a false "Cannot find module" error.
                hubconf = importlib.import_module('hubconf')  # type: ignore[attr-defined]
                try:
                    from models.yolo import DetectionModel, Model, ClassificationModel, SegmentationModel  # type: ignore
                    torch.serialization.add_safe_globals([DetectionModel, Model, ClassificationModel, SegmentationModel])  # type: ignore
                except Exception:
                    pass
                ctx = getattr(torch.serialization, 'safe_globals', None)
                orig_load = getattr(torch, 'load')
                def _patched_load(*args, **kwargs):
                    if 'weights_only' not in kwargs:
                        kwargs['weights_only'] = False
                    return orig_load(*args, **kwargs)
                torch.load = _patched_load
                try:
                    if ctx:
                        with ctx([DetectionModel, Model, ClassificationModel, SegmentationModel]):  # type: ignore
                            YOLOV9_MODEL = hubconf.custom(path=weights, autoshape=True, _verbose=False, device='cpu')
                    else:
                        YOLOV9_MODEL = hubconf.custom(path=weights, autoshape=True, _verbose=False, device='cpu')
                finally:
                    try:
                        torch.load = orig_load
                    except Exception:
                        pass
            finally:
                os.chdir(original_cwd)
        finally:
            # Restore environment
            try:
                sys.path = prev_sys_path
            except Exception:
                pass
            for k, v in prev_cached.items():
                sys.modules[k] = v

        # Optimize for CPU inference
        if YOLOV9_MODEL is not None:
            try:
                # Ensure it's wrapped in AutoShape so it accepts PIL images and `size=`
                if type(YOLOV9_MODEL).__name__ != 'AutoShape':
                    current_app.logger.info("YOLOV9: Wrapping model in AutoShape manually (DetectMultiBackend fallback occurred).")
                    if yolov9_dir not in sys.path:
                        sys.path.insert(0, yolov9_dir)
                    from models.common import AutoShape  # type: ignore
                    YOLOV9_MODEL = AutoShape(YOLOV9_MODEL)
                
                YOLOV9_MODEL.eval()
                torch.set_num_threads(2)  # Limit CPU threads to reduce RAM spikes
            except Exception as e:
                current_app.logger.warning(f"YOLOV9: Failed to wrap in AutoShape or optimize: {e}")
        return YOLOV9_MODEL
    except Exception as e:
        import traceback
        error_details = traceback.format_exc()
        current_app.logger.error(f"YOLOv9 init failed: {str(e)}\n{error_details}")
        YOLOV9_LAST_ERROR = str(e)
        YOLOV9_MODEL = None
        return None


# ---------------------- Auth API ----------------------

@auth_bp.route('/config', methods=['GET'])
def get_config():
    """Return application configuration including Google Client ID."""
    try:
        return jsonify({
            'googleClientId': current_app.config.get('GOOGLE_CLIENT_ID', ''),
            'firebaseProjectId': current_app.config.get('FIREBASE_PROJECT_ID', '')
        }), 200
    except Exception as e:
        current_app.logger.error(f'Error getting config: {str(e)}')
        return jsonify({'error': 'Failed to load configuration'}), 500


@auth_bp.route('/send-verification', methods=['POST'])
@cross_origin(supports_credentials=True)
def send_verification():
    """Send a verification code to the user's email and persist it in DB.
    - If user exists and is active: return error (account exists).
    - If user exists and not active: rotate code and resend.
    - If user doesn't exist: create a pending user (no password) and send code.
    """
    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip().lower()
    recaptcha_token = (data.get('recaptcha_token') or '').strip()
    
    if not email:
        return jsonify({'success': False, 'error': 'Email is required'}), 400
    
    ok, _score = verify_recaptcha('send_verification', recaptcha_token, request.remote_addr)
    if not ok:
        current_app.logger.warning('Proceeding without valid reCAPTCHA for send_verification')
    
    try:
        # Fetch user regardless of deleted status
        existing_user_any = User.get_by_email_any(email)
        if existing_user_any and getattr(existing_user_any, 'deleted_at', None):
            return jsonify({'success': False, 'error': _admin_block_message(), 'blocked': True}), 403
        
        if existing_user_any and existing_user_any.is_active:
            return jsonify({'success': False, 'error': 'An account with this email already exists'}), 400

        if not existing_user_any:
            # Create a pending user (no password yet)
            user = User(email=email, is_active=False)
            # Record initial signup time
            user.signed_up_at = datetime.utcnow()
            # Derive username from email
            try:
                user.username = (email.split('@')[0] or '').strip()[:150]
            except Exception:
                user.username = None
            user.save()
        else:
            user = existing_user_any

        # Issue a verification code valid for 5 minutes
        code = user.issue_verification_code(seconds_valid=300)

        # Send email
        try:
            send_verification_email(email, code)
        except Exception as e:
            current_app.logger.error(f"Error sending verification email: {str(e)}")
            return jsonify({
                'success': False, 
                'error': f"Failed to send email. If using a Resend free account, ensure you are sending to the verified email address. Error details: {str(e)}"
            }), 500

        response_payload = {
            'success': True,
            'message': 'Verification code sent successfully',
            'email': email,
            'expires_in': 5,  # minutes
            'delivery': 'email_sent'
        }
        try:
            if current_app.debug or str(os.getenv('EXPOSE_VERIFICATION_CODE', '')).lower() == 'true':
                response_payload['debug_code'] = code
        except Exception:
            pass
        return jsonify(response_payload), 200
            
    except Exception as e:
        current_app.logger.error(f"Error in send_verification: {str(e)}", exc_info=True)
        return jsonify({'success': False,'error': 'An error occurred while processing your request.'}), 500


@auth_bp.route('/verify-code', methods=['POST'])
@cross_origin(supports_credentials=True)
def verify_code():
    """Verify the user's verification code against DB and activate the account."""
    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip().lower()
    code = (data.get('code') or '').strip()
    recaptcha_token = (data.get('RECAPTCHA_TOKEN') or '6LfCHPMrAAAAAOI8sz3qDMYObRo70NvBGU5rtRsP').strip()
    
    if not email or not code:
        return jsonify({'success': False, 'error': 'Email and verification code are required'}), 400
    
    ok, _score = verify_recaptcha('verify_code', recaptcha_token, request.remote_addr)
    if not ok:
        current_app.logger.warning('Proceeding without valid reCAPTCHA for verify_code')
    
    try:
        user = User.get_by_email(email)
        if not user:
            return jsonify({'success': False, 'error': 'No signup request found for this email. Please request a new code.'}), 400

        # Check expiration and match
        if not user.code_expiration_time or datetime.utcnow() > user.code_expiration_time:
            return jsonify({'success': False, 'error': 'Verification code has expired. Please request a new one.'}), 400
        if not user.verify_code(code):
            return jsonify({'success': False, 'error': 'Invalid verification code. Please try again.'}), 400

        # Activate account and clear code
        user.is_active = True
        user.clear_verification()
        user.save()

        return jsonify({'success': True, 'message': 'Email verified successfully!', 'email': email})
        
    except Exception as e:
        current_app.logger.error(f"Error in verify_code: {str(e)}", exc_info=True)
        return jsonify({'success': False, 'error': 'An error occurred while verifying the code'}), 500


@auth_bp.route('/logout', methods=['POST'])
def api_logout():
    try:
        session.pop('user_id', None)
        session.pop('email', None)
        return jsonify({'success': True, 'message': 'Logged out successfully'}), 200
    except Exception as e:
        current_app.logger.error(f"Logout error: {e}")
        return jsonify({'success': False, 'message': 'Logout failed'}), 500


@auth_bp.route('/account/profile', methods=['GET'])
def account_profile():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        return jsonify({
            'id': user.id,
            'email': user.email,
            'first_name': user.first_name,
            'last_name': user.last_name,
            'username': user.username,
            'profile_picture_url': user.profile_picture_url or '/static/images/pfp.jpg'
        }), 200
    except Exception as e:
        current_app.logger.error(f"Profile fetch error: {e}")
        return jsonify({'error': 'Failed to load profile'}), 500

@auth_bp.delete('/account/profile-picture')
@login_required
def delete_profile_picture():
    """Delete the current user's profile picture."""
    user = get_current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401
        
    try:
        if user.profile_picture_url:
            delete_image(user.profile_picture_url)
            user.profile_picture_url = None
            user.save()
            return jsonify({"message": "Profile picture deleted", "profile_picture_url": None}), 200
        else:
            return jsonify({"message": "No profile picture to delete"}), 200
    except Exception as e:
        current_app.logger.error(f"Profile picture delete error: {e}")
        return jsonify({"error": "Failed to delete profile picture"}), 500


@auth_bp.route('/login', methods=['POST'])
@cross_origin(supports_credentials=True)
def api_login():
    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''
    recaptcha_token = (data.get('recaptcha_token') or data.get('recaptcha') or '').strip()
    if not email or not password:
        return jsonify({'error': 'Email and password are required'}), 400
    try:
        ok, _ = verify_recaptcha('login', recaptcha_token, request.remote_addr)
    except Exception:
        ok = True
    if not ok:
        current_app.logger.warning('Proceeding without valid reCAPTCHA for login')
    try:
        user = User.get_by_email(email)
        if not user or not user.check_password(password):
            return jsonify({'error': 'Invalid email or password'}), 401
        if not user.is_active:
            return jsonify({'error': 'Please verify your email before logging in', 'resend_verification': True}), 403
        user.last_login_at = datetime.utcnow()
        user.save()
        session['user_id'] = user.id
        session['email'] = user.email
        session.permanent = True
        return jsonify({'success': True, 'redirect': '/dashboard', 'user': {'id': user.id, 'email': user.email}}), 200
    except Exception as e:
        error_msg = str(e)
        current_app.logger.error(f"Login error: {error_msg}", exc_info=True)
        return jsonify({'error': f'An error occurred during login: {error_msg}'}), 500


@auth_bp.route("/google", methods=["POST", "OPTIONS"])
@cross_origin(origins='*', 
             methods=['POST', 'OPTIONS'],
             allow_headers=['Content-Type', 'X-CSRFToken', 'Authorization', 'X-Requested-With'],
             expose_headers=['Content-Type'],
             supports_credentials=True)
def google_sign_in():
    """Handle Google Sign-In with Firebase ID token."""
    current_app.logger.info("Google Sign-In endpoint hit")
    
    if request.method == 'OPTIONS':
        current_app.logger.info("Handling OPTIONS preflight request")
        response = jsonify({'success': True, 'message': 'Preflight request successful'})
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type, X-CSRFToken, Authorization, X-Requested-With')
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        response.headers.add('Access-Control-Max-Age', '600')
        return response

    data = request.get_json(silent=True) or {}
    id_token_str = data.get('idToken') or data.get('id_token') or data.get('token')
    
    if not id_token_str:
        error_msg = 'Missing idToken in request body'
        current_app.logger.error(error_msg)
        return jsonify({
            'success': False, 
            'error_type': 'BadRequest', 
            'message': error_msg
        }), 400

    try:
        # Check if Firebase Auth is available
        if not FIREBASE_AVAILABLE or not firebase_auth:
            current_app.logger.warning('Firebase Auth not available, using direct token verification')
            # Use Google's token verification as fallback
            idinfo = google_id_token.verify_oauth2_token(
                id_token_str,
                google_requests.Request(),
                current_app.config['GOOGLE_CLIENT_ID']
            )
            # Ensure the token is valid and contains required fields
            if 'email' not in idinfo or not idinfo.get('email_verified', False):
                raise ValueError('Invalid Google token: Missing or unverified email')
            
            # Use email as UID for direct Google auth
            uid = f"google_{idinfo['sub']}" if 'sub' in idinfo else f"google_{idinfo['email'].split('@')[0]}"
            email = idinfo['email']
            email_verified = True
            name = idinfo.get('name', '')
            current_app.logger.info('Successfully verified Google ID token directly')
        else:
            # Use Firebase to verify the token, and fall back to direct Google verification on failure
            try:
                decoded_token = firebase_auth.verify_id_token(id_token_str, check_revoked=False)
                uid = decoded_token['uid']
                email = decoded_token.get('email')
                email_verified = decoded_token.get('email_verified', False)
                name = decoded_token.get('name', '')
                current_app.logger.info('Successfully verified Firebase ID token')
            except Exception as fb_ex:
                current_app.logger.warning(f'Firebase verify_id_token failed: {fb_ex}; attempting direct Google token verification')
                idinfo = google_id_token.verify_oauth2_token(
                    id_token_str,
                    google_requests.Request(),
                    current_app.config['GOOGLE_CLIENT_ID']
                )
                if 'email' not in idinfo or not idinfo.get('email_verified', False):
                    raise ValueError('Invalid Google token: Missing or unverified email')
                uid = f"google_{idinfo.get('sub') or idinfo.get('email','').split('@')[0]}"
                email = idinfo['email']
                email_verified = True
                name = idinfo.get('name', '')
                current_app.logger.info('Successfully verified Google ID token after Firebase fallback')
        
        # Normalize email for consistent lookup/creation
        email = (email or '').strip().lower()
        if not email or not email_verified:
            raise ValueError('Email not verified or not provided in token')
            
        # Get user's name from token if available
        first_name, last_name = (name.split(' ', 1) + [''])[:2] if name else ('', '')
            
        # Check if user exists and if it was soft-deleted
        user = User.get_by_email(email)
        if not user:
            user_any = User.get_by_email_any(email)
            if user_any and getattr(user_any, 'deleted_at', None):
                return jsonify({
                    'success': False,
                    'error_type': 'AccountDeleted',
                    'message': _admin_block_message(),
                    'blocked': True
                }), 403
            if user_any:
                user = user_any

        if not user:
            try:
                # User doesn't exist, create a new one
                current_app.logger.info(f'Creating new user for Google Sign-In: {email}')

                user = User(
                    email=email,
                    first_name=first_name,
                    last_name=last_name,
                    is_google_signed_in=True,
                    is_active=True,
                    is_verified=True,
                    firebase_uid=uid
                )
                # Derive username and record signup time
                try:
                    user.username = (email.split('@')[0] or '').strip()[:150]
                except Exception:
                    user.username = None
                user.signed_up_at = datetime.utcnow()
                user.save()
                current_app.logger.info(f'Created new user with ID: {user.id}')

            except Exception as create_error:
                # Handle race conditions or pre-existing accounts gracefully
                msg = str(create_error)
                current_app.logger.warning(f'Create user error, attempting recovery: {msg}')
                # Attempt to fetch regardless of deleted status and proceed
                fallback_user = User.get_by_email_any(email) or User.get_by_email(email)
                if fallback_user:
                    user = fallback_user
                    current_app.logger.info('User found after create error; proceeding to update flags and login')
                else:
                    return jsonify({
                        'success': False,
                        'error_type': 'UserCreationError',
                        'message': 'Failed to create user account. Please try again.'
                    }), 500

        # Ensure Google flags and activation are set for existing users as well
        if user:
            user.is_google_signed_in = True
            user.is_verified = True
            user.is_active = True
            user.firebase_uid = uid or user.firebase_uid
            # Record last login timestamp
            user.last_login_at = datetime.utcnow()
            user.save()  # Save the user with the new flags
        
        # Create user session
        session["user_id"] = user.id
        session.permanent = True
        
        # Create response
        response_data = {
            "success": True, 
            "user_id": user.id, 
            "email": user.email,
            "is_google_user": True,
            "needs_password": False,
            "redirect": "/"
        }
        
        # Create response with CORS headers
        response = jsonify(response_data)
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        
        return response
            
    except ValueError as e:
        current_app.logger.error(f'Token verification failed: {str(e)}')
        return jsonify({
            'success': False,
            'error_type': 'TokenVerificationError',
            'message': 'Invalid or expired token. Please try signing in again.',
            'details': str(e)
        }), 401
            
    except Exception as e:
        error_msg = str(e)
        current_app.logger.error(f"Error during Firebase auth: {error_msg}", exc_info=True)
        return jsonify({
            'success': False,
            'error_type': 'ServerError',
            'message': f'An unexpected error occurred: {error_msg}'
        }), 500
        
@auth_bp.route("/set-password", methods=["GET", "POST"])
@login_required
def set_password():
    """Handle password setup for Google-signed-in users."""
    if request.method == 'GET':
        # Verify the token from the URL
        token = request.args.get('token')
        if not token:
            return redirect('/')
            
        try:
            # Verify the token
            email = verify_email_token(token)
            if not email:
                return redirect('/')
                
            # Find user by email
            user = User.get_by_email(email)
            if not user:
                return redirect('/')
                
            # Store user ID in session
            session["user_id"] = user.id
            session.permanent = True
            
            return render_template('set_password.html')
            
        except Exception as e:
            current_app.logger.error(f"Error verifying token: {str(e)}")
            return redirect('/')
    
    # Handle POST request
    if not request.is_json:
        return jsonify({"error": "Request must be JSON"}), 400
        
    data = request.get_json()
    new_password = data.get('new_password')
    
    if not new_password or len(new_password) < 10:
        return jsonify({"error": "Password must be at least 10 characters long"}), 400
    
    try:
        # Get current user from session
        user_id = session.get('user_id')
        if not user_id:
            return jsonify({"error": "Session expired"}), 401
            
        user = User.get_by_id(user_id)
        if not user:
            return jsonify({"error": "User not found"}), 404
            
        # Update the user's password
        user.set_password(new_password)
        user.is_google_signed_in = True  # Ensure this is set for Google users
        # Record password change timestamp
        user.password_changed_at = datetime.utcnow()
        user.save()  # Save the user with the new password
        
        return jsonify({"message": "Password set successfully"}), 200
    except Exception as e:
        current_app.logger.error(f"Error setting password: {str(e)}")
        return jsonify({"error": "Failed to set password. Please try again."}), 500

@auth_bp.post("/signup")
@cross_origin(origins='*', 
             supports_credentials=True,
             allow_headers=["Content-Type", "X-CSRFToken", "Authorization"])
def signup():
    """Complete signup by setting a password for a verified user.
    Flow:
      1) Client calls /send-verification to create/update a pending user and email a code.
      2) Client calls /verify-code to activate the account (is_active=True).
      3) Client calls /signup with email+password to set the password.
    """
    try:
        ip = request.headers.get("x-forwarded-for", request.remote_addr)
        current_app.logger.info(f"Signup attempt from IP: {ip}")
        
        if not rate_limit(f"signup:{ip}"):
            current_app.logger.warning(f"Rate limit exceeded for IP: {ip}")
            return jsonify({"error": "Too many requests. Please try again later.", "status": "error"}), 429
            
        current_app.logger.info(f"Request headers: {dict(request.headers)}")
        current_app.logger.info(f"Request content type: {request.content_type}")
        
        try:
            data = request.get_json(force=True, silent=True) or {}
            current_app.logger.info(f"Received signup data: { {k: v if k != 'password' else '***' for k, v in data.items()} }")
        except Exception as e:
            current_app.logger.error(f"Error parsing JSON: {str(e)}")
            return jsonify({"error": "Invalid JSON data in request", "status": "error"}), 400
            
        if not data:
            current_app.logger.error("No data received in signup request")
            return jsonify({"error": "Invalid request data. Please check your input and try again.", "status": "error"}), 400
            
        email = (data.get("email") or "").strip().lower()
        password = (data.get("password") or "").strip()
        recaptcha_token = data.get('recaptcha_token', '').strip()
        
        # Input validation
        if not email:
            return jsonify({"error": "Email address is required", "status": "error"}), 400
            
        if "@" not in email or "." not in email.split("@")[-1]:
            return jsonify({"error": "Please enter a valid email address", "status": "error"}), 400
            
        if not password:
            return jsonify({"error": "Password is required", "status": "error"}), 400
            
        if len(password) < 10:
            return jsonify({
                "error": "Password must be at least 10 characters long",
                "status": "error"
            }), 400
            
        if not any(c.isupper() for c in password) or not any(c.islower() for c in password):
            return jsonify({
                "error": "Password must contain both uppercase and lowercase letters",
                "status": "error"
            }), 400
            
        if not any(c.isdigit() for c in password):
            return jsonify({
                "error": "Password must contain at least one number",
                "status": "error"
            }), 400
            
        # Only verify reCAPTCHA in production or if explicitly enabled
        if not current_app.debug or str(os.getenv('VERIFY_RECAPTCHA', 'false')).lower() == 'true':
            if not recaptcha_token:
                return jsonify({"error": "Security check failed. Please complete the reCAPTCHA.", "status": "error"}), 400
                
            ok, _ = verify_recaptcha('signup', recaptcha_token, request.remote_addr)
            if not ok:
                return jsonify({
                    'error': 'Security check failed. Please complete the reCAPTCHA and try again.',
                    'status': 'error'
                }), 400
        
        # Check if user exists
        existing_any = User.get_by_email_any(email)
        if not existing_any:
            # In development, create a new user automatically if not found
            if current_app.debug or str(os.getenv('AUTO_CREATE_USER', 'false')).lower() == 'true':
                from models import db
                new_user = User(
                    email=email,
                    is_active=True,
                    created_at=datetime.utcnow()
                )
                db.session.add(new_user)
                db.session.commit()
                existing_any = new_user
            else:
                return jsonify({
                    "error": "Please start by requesting a verification code for this email.",
                    "status": "error",
                    "action": "request_verification"
                }), 400

        # If soft-deleted, block and instruct to contact admin
        if getattr(existing_any, 'deleted_at', None):
            return jsonify({
                "error": _admin_block_message(), 
                "status": "error",
                "blocked": True
            }), 403

        # Must be active (verified) before setting password
        if not existing_any.is_active:
            if current_app.debug or str(os.getenv('ALLOW_UNVERIFIED_SIGNUP', '')).lower() == 'true':
                existing_any.is_active = True
                existing_any.save()
            else:
                return jsonify({
                    "error": "Email not verified. Please verify the code sent to your email.",
                    "status": "error",
                    "requires_verification": True
                }), 403

        # If password already set, prevent re-registration
        if existing_any.password_hash:
            return jsonify({"error": "Email already registered", "status": "error"}), 400

        # Set password and save user
        existing_any.set_password(password)
        existing_any.is_active = True
        existing_any.signed_up_at = datetime.utcnow()
        existing_any.save()
        
        # Log in the user automatically after signup
        session.clear()
        session["user_id"] = existing_any.id
        session.permanent = True
        
        # Generate CSRF token
        csrf_token = generate_csrf()
        
        # Prepare response
        response_data = {
            "message": "Account created and logged in successfully",
            "status": "success",
            "redirect": "/dashboard",
            "user": {
                "id": existing_any.id,
                "email": existing_any.email,
                "is_active": existing_any.is_active,
                "is_admin": existing_any.is_admin
            }
        }
        
        response = jsonify(response_data)
        
        # Generate a secure session ID
        session_id = secrets.token_urlsafe(32)
        
        # Store the session ID in the user's session
        session['session_id'] = session_id
        
        # Set session cookie
        response.set_cookie(
            'session', 
            session_id,
            httponly=True, 
            secure=not current_app.debug, 
            samesite='Lax',
            max_age=timedelta(days=30).total_seconds()
        )
        
        # Set CSRF token in both header and cookie
        response.headers["X-CSRFToken"] = csrf_token
        response.set_cookie(
            'csrf_token', 
            csrf_token, 
            secure=not current_app.debug, 
            samesite='Lax',
            max_age=timedelta(days=30).total_seconds()
        )
        
        # Add CORS headers
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type, X-CSRFToken, Authorization')
        
        return response, 201
        
    except Exception as e:
        current_app.logger.error(f"Signup error: {str(e)}", exc_info=True)
        return jsonify({
            "error": "An error occurred during signup. Please try again.",
            "status": "error",
            "details": str(e) if current_app.debug else None
        }), 500


@auth_bp.post("/verify-email")
def verify_email():
    """Verify a user's email using a previously issued code."""
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    code = (data.get("code") or "").strip()
    
    if not email:
        return jsonify({"error": "Email is required"}), 400
    
    user = User.get_by_email(email)
    if not user or not user.verification_code:
        return jsonify({"error": "Invalid code"}), 400

    if not user.code_expiration_time or datetime.utcnow() > user.code_expiration_time:
        return jsonify({"error": "Code expired", "action": "resend"}), 410

    if not user.verify_code(code):
        return jsonify({"error": "Invalid code"}), 400

    user.is_active = True
    user.clear_verification()
    user.save()  # Save the changes
    return jsonify({"message": "Email verified. You can now log in."}), 200


@auth_bp.get("/verify-email/<token>")
def verify_email_link(token: str):
    """Verify email using a signed URL token and redirect to home."""
    email = verify_email_token(token, max_age=3600)
    if not email:
        return jsonify({"error": "Invalid or expired verification link"}), 400
    user = User.get_by_email(email)
    if not user:
        return jsonify({"error": "User not found"}), 404

    user.is_active = True
    user.clear_verification()
    user.save()  # Save the changes

    # Redirect to home with a small indicator that verification succeeded
    return redirect(url_for("pages.home_page") + "?verified=1")


@auth_bp.post("/resend-code")
def resend_code():
    """Resend a verification code to a not-yet-activated account."""
    ip = request.headers.get("x-forwarded-for", request.remote_addr)
    if not rate_limit(f"resend:{ip}"):
        return jsonify({"error": "Too many requests"}), 429
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    recaptcha_token = (data.get('recaptcha_token') or '').strip()
    
    if not email:
        return jsonify({"error": "Email is required"}), 400
    
    ok, _score = verify_recaptcha('resend_code', recaptcha_token, request.remote_addr)
    if not ok:
        current_app.logger.warning('Proceeding without valid reCAPTCHA for resend_code')
    
    user = User.get_by_email(email)
    if user and not user.is_active:
        code = user.issue_verification_code(minutes_valid=1)
        user.save()  # Save the changes
        # Send verification email with code and link (non-blocking)
        try:
            send_verification_email(email, code)
        except Exception as e:
            current_app.logger.error(f"Error queuing resend verification email: {str(e)}")
        current_app.logger.info(f"Resent verification code for {email}: {code}")

    # Always return 200 to avoid user enumeration
    return jsonify({"message": "If the email exists, a new code was sent."}), 200


@auth_bp.route("/login", methods=["POST", "OPTIONS"])
@cross_origin(origins='*', 
             supports_credentials=True,
             allow_headers=["Content-Type", "X-CSRFToken", "Authorization"],
             methods=["POST"])
def login():
    """Authenticate a user and start a session."""
    # Handle preflight request
    if request.method == "OPTIONS":
        response = jsonify({"status": "success"})
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type, X-CSRFToken, Authorization')
        return response
    
    try:
        ip = request.headers.get("x-forwarded-for", request.remote_addr)
        current_app.logger.info(f"Login attempt from IP: {ip}")
        
        if not rate_limit(f"login:{ip}"):
            current_app.logger.warning(f"Rate limit exceeded for IP: {ip}")
            return jsonify({"error": "Too many requests. Please try again later.", "status": "error"}), 429
            
        current_app.logger.info(f"Request headers: {dict(request.headers)}")
        current_app.logger.info(f"Request content type: {request.content_type}")
        
        try:
            data = request.get_json(force=True, silent=True) or {}
            current_app.logger.info(f"Received login data: { {k: v if k != 'password' else '***' for k, v in data.items()} }")
        except Exception as e:
            current_app.logger.error(f"Error parsing JSON: {str(e)}")
            return jsonify({"error": "Invalid JSON data in request", "status": "error"}), 400
            
        if not data:
            current_app.logger.error("No data received in login request")
            return jsonify({"error": "Invalid request data. Please check your input and try again.", "status": "error"}), 400
            
        email = (data.get("email") or "").strip().lower()
        password = data.get("password") or ""
        recaptcha_token = data.get('recaptcha_token', '').strip()
        
        # Input validation
        if not email:
            current_app.logger.warning("Login attempt with empty email")
            return jsonify({"error": "Email is required", "status": "error"}), 400
            
        if not password:
            current_app.logger.warning(f"Login attempt with empty password for email: {email}")
            return jsonify({"error": "Password is required", "status": "error"}), 400
        
        # Only verify reCAPTCHA in production or if explicitly enabled
        if not current_app.debug or str(os.getenv('VERIFY_RECAPTCHA', 'false')).lower() == 'true':
            if not recaptcha_token:
                current_app.logger.warning("reCAPTCHA token missing")
                return jsonify({"error": "Security check failed. Please complete the reCAPTCHA.", "status": "error"}), 400
                
            ok, score = verify_recaptcha('login', recaptcha_token, request.remote_addr)
            if not ok or score < 0.5:  # Adjust score threshold as needed
                current_app.logger.warning(f"reCAPTCHA verification failed for {email} (score: {score})")
                return jsonify({
                    "error": "Security check failed. Please complete the reCAPTCHA and try again.", 
                    "status": "error"
                }), 400
        
        user = User.get_by_email(email)
        if not user:
            any_user = User.get_by_email_any(email)
            if any_user and getattr(any_user, 'deleted_at', None):
                return jsonify({
                    "error": _admin_block_message(),
                    "status": "error",
                    "blocked": True
                }), 403
            return jsonify({"error": "Invalid credentials", "status": "error"}), 401
        # If the account was created via Google and has no password set, guide the user
        if not user.password_hash and user.is_google_signed_in:
            return jsonify({
                "error": "This account was created with Google Sign-In. Please use 'Sign in with Google' or reset your password to set one.",
                "status": "error",
                "google_user": True,
                "action": "reset_password"
            }), 403
        if not user.check_password(password):
            return jsonify({"error": "Invalid credentials", "status": "error"}), 401
        
        if not user.is_active:
            return jsonify({
                "error": "Email not verified. Please check your email for the verification link.",
                "status": "error",
                "requires_verification": True,
                "email": user.email
            }), 403

        # Record last login timestamp
        try:
            user.last_login_at = datetime.utcnow()
            user.save()
        except Exception as e:
            current_app.logger.warning(f"Failed to update last_login_at: {e}")

        # Start session
        session.clear()
        session["user_id"] = user.id
        session.permanent = True
        
        # Get CSRF token for the session
        csrf_token = generate_csrf()
        
        response_data = {
            "message": "Login successful",
            "status": "success",
            "user": {
                "id": user.id,
                "email": user.email,
                "is_active": user.is_active
            }
        }
        
        # Create response with user data
        response = jsonify({
            "message": "Login successful",
            "status": "success",
            "user": {
                "id": user.id,
                "email": user.email,
                "is_active": user.is_active,
                "is_admin": user.is_admin
            }
        })
        
        # Generate a secure session ID
        session_id = secrets.token_urlsafe(32)
        
        # Store the session ID in the user's session
        session['session_id'] = session_id
        
        # Set session cookie
        response.set_cookie(
            'session', 
            session_id,
            httponly=True, 
            secure=not current_app.debug, 
            samesite='Lax',
            max_age=timedelta(days=30).total_seconds()
        )
        
        # Set CSRF token in both header and cookie
        response.headers["X-CSRFToken"] = csrf_token
        response.set_cookie(
            'csrf_token', 
            csrf_token, 
            secure=not current_app.debug, 
            samesite='Lax',
            max_age=timedelta(days=30).total_seconds()  # 30 days
        )
        
        # Add CORS headers
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type, X-CSRFToken, Authorization')
        
        return response, 200
        
    except Exception as e:
        current_app.logger.error(f"Login error: {str(e)}", exc_info=True)
        return jsonify({
            "error": "An error occurred during login. Please try again.", 
            "status": "error",
            "details": str(e) if current_app.debug else None
        }), 500


@auth_bp.post("/logout")
def logout():
    """End the current user session."""
    session.clear()
    return jsonify({"success": True, "message": "Logged out successfully"}), 200


# ---------------------- Account Profile ----------------------
@auth_bp.get("/account/profile")
def get_account_profile():
    """Return the current user's profile details (JSON)."""
    user = get_current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401
    data = user.to_dict()
    # Only expose relevant profile fields
    return jsonify({
        "email": data.get("email"),
        "username": data.get("username"),
        "first_name": data.get("first_name"),
        "last_name": data.get("last_name"),
        "phone_country_code": data.get("phone_country_code"),
        "phone_number": data.get("phone_number"),
        "profile_picture_url": data.get("profile_picture_url") or "/static/images/pfp.jpg",
        "last_login_at": data.get("last_login_at"),
        "signed_up_at": data.get("signed_up_at"),
        "password_changed_at": data.get("password_changed_at")
    }), 200


@auth_bp.put("/account/profile")
def update_account_profile():
    """Update the current user's username and phone info."""
    user = get_current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    first_name = (data.get("first_name") or "").strip()
    last_name = (data.get("last_name") or "").strip()
    phone_cc = (data.get("phone_country_code") or "").strip()
    phone = (data.get("phone_number") or "").strip()

    # Basic validation
    if username and len(username) > 150:
        return jsonify({"error": "Username must be 150 characters or less"}), 400
    if phone_cc and not re.match(r"^\+?\d{1,4}$", phone_cc):
        return jsonify({"error": "Invalid country code"}), 400
    if phone and not re.match(r"^[\d\-\s().]{4,20}$", phone):
        return jsonify({"error": "Invalid phone number"}), 400

    # Update fields
    if username:
        user.username = username
    if first_name or first_name == "":
        user.first_name = first_name or None
    if last_name or last_name == "":
        user.last_name = last_name or None
    if phone_cc or phone_cc == "":
        user.phone_country_code = phone_cc or None
    if phone or phone == "":
        user.phone_number = phone or None

    try:
        user.save()
        return jsonify({"message": "Profile updated successfully"}), 200
    except Exception as e:
        current_app.logger.error(f"Failed to update profile: {e}", exc_info=True)
        return jsonify({"error": "Failed to update profile"}), 500


@auth_bp.route('/test-email', methods=['POST'])
@cross_origin(supports_credentials=True)
def test_email():
    """Test email sending functionality."""
    # Only allow in development
    if current_app.config.get('ENV') != 'development':
        return jsonify({'error': 'This endpoint is only available in development mode'}), 403
    
    data = request.get_json(silent=True) or {}
    test_email = data.get('email') or current_app.config.get('MAIL_DEFAULT_SENDER')
    
    if not test_email:
        return jsonify({
            'success': False,
            'error': 'No email provided and no default sender configured'
        }), 400
    
    try:
        # Test email configuration
        mail_config = {
            'MAIL_SERVER': current_app.config.get('MAIL_SERVER'),
            'MAIL_PORT': current_app.config.get('MAIL_PORT'),
            'MAIL_USE_TLS': current_app.config.get('MAIL_USE_TLS', True),
            'MAIL_USERNAME': current_app.config.get('MAIL_USERNAME'),
            'MAIL_DEFAULT_SENDER': current_app.config.get('MAIL_DEFAULT_SENDER')
        }
        
        # Check if email is properly configured
        if not all(mail_config.values()):
            return jsonify({
                'success': False,
                'error': 'Email configuration is incomplete',
                'config': mail_config
            }), 500
        
        # Try to send a test email
        subject = 'Test Email from Expense Manager'
        body = 'This is a test email sent from your Expense Manager application.'
        
        msg = Message(
            subject=subject,
            recipients=[test_email],
            body=body
        )
        mail_ext = current_app.extensions.get('mail')
        if not mail_ext:
            return jsonify({'success': False, 'error': 'Mail extension not initialized', 'config': mail_config}), 500
        mail_ext.send(msg)
        
        return jsonify({
            'success': True,
            'message': f'Test email sent successfully to {test_email}'
        })
        
    except Exception as e:
        current_app.logger.error(f'Error sending test email: {str(e)}', exc_info=True)
        return jsonify({
            'success': False,
            'error': str(e),
            'config': mail_config
        }), 500


@auth_bp.route('/test-env', methods=['GET'])
def test_env():
    """Test endpoint to check environment variables."""
    return jsonify({
        'python_version': sys.version,
        'flask_env': current_app.config.get('ENV', 'production'),
        'debug': current_app.debug,
        'database_url': 'configured' if current_app.config.get('SQLALCHEMY_DATABASE_URI') else 'not configured',
        'email_configured': all([
            current_app.config.get('MAIL_SERVER'),
            current_app.config.get('MAIL_PORT'),
            current_app.config.get('MAIL_USERNAME'),
            current_app.config.get('MAIL_PASSWORD')
        ])
    })


@pages_bp.route('/account', methods=['GET'])
@login_required

def account_page():
    """Render the account management page."""
    user = get_current_user()
    if not user:
        return redirect(url_for('pages.home_page'))
    return render_template('account.html', user=user)


@pages_bp.route('/account/delete', methods=['GET'])
@login_required
def delete_account_page():
    """Render the delete account confirmation page."""
    return render_template('delete_account.html')

@auth_bp.post('/account/profile-picture')
@login_required
def upload_profile_picture():
    """Upload and set the current user's profile picture.
    Expects multipart/form-data with field name 'image' (or 'avatar').
    Returns the stored public URL.
    """
    user = get_current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    # Ensure request has file
    if not request.files:
        return jsonify({"error": "No file provided"}), 400
    file = request.files.get('image') or request.files.get('avatar')
    if not isinstance(file, FileStorage) or not file.filename:
        return jsonify({"error": "Invalid file upload"}), 400

    try:
        # Re-use existing image saving logic
        url = save_image(file)  # e.g. '/static/images/uuid.jpg'
        # Persist on user
        user.profile_picture_url = url
        user.save()
        return jsonify({"profile_picture_url": url}), 200
    except ValueError as ve:
        return jsonify({"error": str(ve)}), 400
    except Exception as e:
        current_app.logger.error(f"Profile picture upload failed: {e}", exc_info=True)
        return jsonify({"error": "Failed to upload image"}), 500

def _delete_firebase_user(email: str) -> None:
    """Delete Firebase Auth user if one exists for the given email."""
    # Note: Firebase user deletion is optional and not required for core functionality
    # The local user account deletion will work without Firebase integration
    try:
        # Firebase Admin SDK operations are optional
        current_app.logger.info(f"Firebase user deletion skipped for {email} (optional feature)")
    except Exception as exc:
        current_app.logger.error(f"Failed to delete Firebase user {email}: {exc}")

@auth_bp.route('/account', methods=['DELETE'])
def delete_account():
    """
    Delete the current user's account and all associated data.
    Requires explicit confirmation in request body (no password required).
    """
    try:
        # Get current user
        user = get_current_user()
        if not user:
            return jsonify({"error": "Authentication required"}), 401
        
        # Require JSON body with {"confirm": true}
        data = request.get_json(silent=True) or {}
        if not data.get('confirm'):
            return jsonify({"error": "Confirmation required"}), 400
        
        try:
            # Log the deletion for audit purposes
            current_app.logger.info(f"Deleting account for user: {user.email}")

            # Delete user from Firebase (optional)
            _delete_firebase_user(user.email)

            # Hard delete the user; expenses will cascade via FK
            user.delete()

            # Clear the session
            session.clear()

            return jsonify({"message": "Account deleted successfully"}), 200
            
        except Exception as e:
            current_app.logger.error(f"Database error deleting account: {str(e)}", exc_info=True)
            return jsonify({"error": "Database error while deleting account"}), 500
            
    except Exception as e:
        current_app.logger.error(f"Unexpected error in delete_account: {str(e)}", exc_info=True)
        return jsonify({"error": "An unexpected error occurred"}), 500


@auth_bp.post("/change-password")
def change_password():
    """Change the password for the logged-in user after verifying current."""
    user = get_current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.get_json(silent=True) or {}
    current_password = data.get("current_password") or ""
    new_password = data.get("new_password") or ""
    
    if not user.check_password(current_password):
        return jsonify({"error": "Current password incorrect"}), 401
    if not PASSWORD_REGEX.match(new_password):
        return jsonify({"error": "Password must be 10+ chars with letter, number, symbol"}), 400

    user.set_password(new_password)
    # Record password change timestamp
    user.password_changed_at = datetime.utcnow()
    user.save()  # Save the changes
    return jsonify({"message": "Password updated"}), 200


# ---------------------- Forgot / Reset Password ----------------------
@auth_bp.route("/forgot-password", methods=["POST", "OPTIONS"])
@cross_origin(supports_credentials=True)
def forgot_password():
    """
    Handle forgot password request.
    Sends a password reset email if the email exists in the system.
    For security, always returns success even if email doesn't exist.
    """
    current_app.logger.info(f"Forgot password request received. Method: {request.method}, Headers: {dict(request.headers)}")
    
    # Handle preflight request
    if request.method == "OPTIONS":
        current_app.logger.info("Handling OPTIONS preflight request")
        response = jsonify({"status": "success"})
        response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type, X-CSRFToken, X-Requested-With, Accept, Authorization')
        response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
        response.headers.add('Access-Control-Allow-Credentials', 'true')
        response.headers.add('Access-Control-Max-Age', '3600')
        return response

    # Log CSRF token for debugging
    csrf_token = request.headers.get('X-CSRFToken')
    current_app.logger.info(f"CSRF Token from headers: {csrf_token}")
    
    # Ensure request is JSON
    if not request.is_json:
        current_app.logger.warning("Request is not JSON")
        return jsonify({
            "status": "error",
            "message": "Missing JSON in request"
        }), 400
            
    data = request.get_json() or {}
    email = data.get("email", "").strip().lower()
    
    if not email:
        current_app.logger.warning("No email provided in request")
        return jsonify({
            "status": "error",
            "message": "Email is required"
        }), 400
    
    current_app.logger.info(f"Password reset requested for email: {email}")
    
    # Get user by email (case-insensitive search)
    user = User.get_by_email(email)
    if not user:
        # For security, don't reveal if email exists
        current_app.logger.info(f"Password reset: No user found for email: {email}")
        return jsonify({
            "status": "success",
            "message": "If an account exists with this email, a password reset link has been sent"
        })

    # Generate a secure token for password reset (valid for 5 minute)
    token = secrets.token_urlsafe(32)
    
    # Store the token with expiration (5 minute from now)
    user.reset_token = token
    user.reset_token_expires = datetime.utcnow() + timedelta(minutes=5)
    
    try:
        user.save()
        current_app.logger.info(f"Reset token generated for user {user.id}")
    except Exception as e:
        current_app.logger.error(f"Error saving reset token: {str(e)}")
        return jsonify({
            "status": "error",
            "message": "Failed to process password reset request"
        }), 500

    # Send the reset link via email
    sent = False
    try:
        reset_link = None
        # Build absolute link using Origin when available (to avoid 127.0.0.1 issues)
        origin = request.headers.get('Origin') or request.host_url.rstrip('/')
        try:
            reset_link = f"{origin}/set-password?token={token}"
        except Exception:
            reset_link = url_for('pages.set_password_page', token=token, _external=True)
        
        # Email content
        subject = "Password Reset Request"
        body = f"""
        PASSWORD RESET REQUEST
        ======================

        Hello,

        You have requested to reset your password for your Expense Manager account.
        Please click the link below to reset your password:

        {reset_link}

        If you did not request this password reset, please ignore this email.
        This link will expire in 5 minutes

        For security reasons, please do not share this email with anyone.

        --
        Best regards,
        Expense Manager Team
        &copy; {datetime.now().year} Expense Manager. All rights reserved.
        """

        html = f"""
        <html>
            <body>
                <p>Hello,</p>
                <p>You requested to reset your password for your Expense Manager account.</p>
                <p>
                    <a href="{reset_link}"
                       style="display:inline-block;padding:10px 16px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:6px">
                        Reset your password
                    </a>
                </p>
                <p>Or copy and paste this link into your browser:<br>
                <a href="{reset_link}">{reset_link}</a></p>
                <p>This link will expire in 5 minutes.</p>
            </body>
        </html>
        """
        
        # Send email (log failure but don't expose to client)
        sent = _send_mail(
            to_email=user.email,
            subject=subject,
            body=body,
            html=html
        )
        if sent:
            current_app.logger.info(f"Password reset email sent to {user.email} via {current_app.config.get('MAIL_SERVER')}:{current_app.config.get('MAIL_PORT')}")
        else:
            current_app.logger.error(f"Password reset email failed to send to {user.email} (MAIL_SERVER={current_app.config.get('MAIL_SERVER')}, DEFAULT_SENDER={current_app.config.get('MAIL_DEFAULT_SENDER')})")
        
    except Exception as e:
        current_app.logger.error(f"Failed to send password reset email: {str(e)}", exc_info=True)
        # Continue to return a generic success message to avoid user enumeration
    
    # Always return a generic success message (no dev reset link)
    return jsonify({
        "status": "success",
        "message": "If an account exists with this email, a password reset link has been sent"
    })


@auth_bp.route("/reset-password", methods=["POST"])
@cross_origin(supports_credentials=True)
def reset_password():
    """
    Reset the user's password using the reset token.
    
    Expects a JSON payload with:
    - token: The password reset token from the email
    - new_password: The new password to set
    """
    try:
        # Handle preflight request
        if request.method == "OPTIONS":
            response = jsonify({"status": "success"})
            response.headers.add('Access-Control-Allow-Origin', request.headers.get('Origin', '*'))
            response.headers.add('Access-Control-Allow-Headers', 'Content-Type, X-CSRFToken')
            response.headers.add('Access-Control-Allow-Methods', 'POST, OPTIONS')
            response.headers.add('Access-Control-Allow-Credentials', 'true')
            return response
            
        # Ensure request is JSON
        if not request.is_json:
            current_app.logger.warning("Reset password: Request is not JSON")
            return jsonify({
                "status": "error",
                "message": "Invalid request format. JSON expected."
            }), 400
            
        data = request.get_json() or {}
        token = data.get("token", "").strip()
        new_password = data.get("new_password", "").strip()
        
        # Validate inputs
        if not token or not new_password:
            current_app.logger.warning("Reset password: Missing required fields")
            return jsonify({
                "status": "error",
                "message": "Reset token and new password are required"
            }), 400
            
        if len(new_password) < 10:
            return jsonify({
                "status": "error",
                "message": "Password must be at least 10 characters long"
            }), 400
        
        # Verify the token and get user
        user = User.get_by_reset_token(token)
        
        # Check if token exists and is not expired
        if not user or user.reset_token_expires < datetime.utcnow():
            current_app.logger.warning(f"Reset password: Invalid or expired token")
            return jsonify({
                "status": "error",
                "message": "Invalid or expired reset link. Please request a new password reset."
            }), 400
            
        # Update user's password
        try:
            user.set_password(new_password)
            user.reset_token = None
            user.reset_token_expires = None
            user.is_verified = True  # Mark as verified if not already
            # Record password change timestamp
            user.password_changed_at = datetime.utcnow()
            user.save()
            
            current_app.logger.info(f"Password reset successful for user {user.id}")
            
            # Send confirmation email
            try:
                subject = "Your Password Has Been Reset"
                body = f"""
                PASSWORD RESET CONFIRMATION
                ===========================

                Hello,

                Your password has been successfully reset for your Expense Manager account.
                
                If you did not make this change, please contact our support team immediately.

                --
                Best regards,
                Expense Manager Team
                &copy; {datetime.now().year} Expense Manager. All rights reserved.
                """
                
                _send_mail(
                    to_email=user.email,
                    subject=subject,
                    body=body
                )
                
                current_app.logger.info(f"Password reset confirmation sent to {user.email}")
                
            except Exception as email_error:
                # Log but don't fail the password reset if email sending fails
                current_app.logger.error(f"Failed to send password reset confirmation: {str(email_error)}")
            
            # Auto-login the user after a successful reset
            session.permanent = True
            session['user_id'] = user.id
            session['email'] = user.email

            return jsonify({
                "status": "success",
                "message": "Your password has been reset successfully.",
                "redirect": url_for('pages.account_page')
            })
            
        except Exception as e:
            current_app.logger.error(f"Error updating password: {str(e)}", exc_info=True)
            return jsonify({
                "status": "error",
                "message": "Failed to update password. Please try again."
            }), 500
            
    except Exception as e:
        current_app.logger.error(f"Unexpected error in reset_password: {str(e)}", exc_info=True)
        return jsonify({
            "status": "error",
            "message": "An unexpected error occurred. Please try again later."
        }), 500


def _send_mail(to_email: str, subject: str, body: str, html: str = None) -> bool:
    """Send an email via Gmail SMTP in a non-blocking background thread."""
    if not all([to_email, subject, body]):
        current_app.logger.error("Missing required email parameters")
        return False
    try:
        mail_username = os.environ.get('MAIL_USERNAME', 'exp2tester@gmail.com')
        mail_password = os.environ.get('MAIL_PASSWORD', '')
        current_app.logger.info(f"[SMTP] Queuing email to {to_email}: {subject}")
        t = threading.Thread(
            target=_send_smtp_email_thread,
            args=(mail_username, mail_password, to_email, subject, html or '', body),
            daemon=True
        )
        t.start()
        return True
    except Exception as e:
        current_app.logger.error(f"[SMTP] Failed to queue email to {to_email}: {str(e)}", exc_info=True)
        return False

@expenses_bp.get("")
def list_expenses():
    """List non-deleted expenses for the current user."""
    user = get_current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    expenses = Expense.get_by_user(user.id)
    items = [e.to_dict() for e in expenses]
    return jsonify({"items": items, "total": len(items)}), 200


@expenses_bp.post("")
def create_expense():
    user = get_current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    receipt_bytes = None
    receipt_mime = None

    if request.content_type and request.content_type.startswith("multipart/form-data"):
        form = request.form
        files = request.files
        value_raw = form.get("value") or form.get("amount")
        category = form.get("category")
        description = form.get("description")
        image = files.get("image")
        if image and image.filename:
            receipt_bytes = image.read()
            receipt_mime = image.mimetype or 'image/jpeg'
            current_app.logger.debug("Receipt blob: %d bytes, %s", len(receipt_bytes), receipt_mime)
    else:
        data = request.get_json(silent=True) or {}
        value_raw = data.get("value")
        if value_raw is None:
            value_raw = data.get("amount")
        category = data.get("category")
        description = data.get("description")

    if value_raw is None or str(value_raw).strip() == "":
        return jsonify({"error": "Missing value"}), 400
    try:
        value = Decimal(str(value_raw))
    except (InvalidOperation, ValueError):
        return jsonify({"error": "Invalid value amount"}), 400

    if value <= 0:
        return jsonify({"error": "Value must be greater than 0"}), 400

    expense = Expense(
        user_id=user.id,
        description=(description or None),
        value=value,
        category=(category or None),
        picture_url=None,          # no longer saved to disk
        receipt_data=receipt_bytes,
        receipt_mime=receipt_mime,
    )
    expense.save()
    return jsonify(expense.to_dict()), 201


@expenses_bp.get("/<int:expense_id>")
def get_expense(expense_id: int):
    """Get details of a single expense."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401
        
    expense = Expense.get_by_id(expense_id)
    if not expense or expense.user_id != user.id:
        return jsonify({'error': 'Expense not found'}), 404
        
    return jsonify(expense.to_dict()), 200


@expenses_bp.patch("/<int:expense_id>")
def update_expense(expense_id: int):
    """Update fields of an existing expense; accept image replacement."""
    user = get_current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    expense = Expense.get_by_id(expense_id)
    if not expense or expense.user_id != user.id:
        return jsonify({"error": "Not found"}), 404

    if request.content_type and request.content_type.startswith("multipart/form-data"):
        form = request.form
        files = request.files
        value_raw = form.get("value")
        category = form.get("category")
        description = form.get("description")
        image = files.get("image")
        if image and image.filename:
            expense.receipt_data = image.read()
            expense.receipt_mime = image.mimetype or 'image/jpeg'
            expense.picture_url = None  # clear any legacy file path
            current_app.logger.info(f"Updated receipt blob for expense {expense_id} ({len(expense.receipt_data)} bytes)")
    else:
        data = request.get_json(silent=True) or {}
        value_raw = data.get("value")
        category = data.get("category")
        description = data.get("description")

    if value_raw is not None:
        try:
            expense.value = Decimal(str(value_raw))
        except (InvalidOperation, ValueError):
            return jsonify({"error": "Invalid value amount"}), 400
    if category is not None:
        expense.category = category
    if description is not None:
        expense.description = description

    expense.save()
    return jsonify(expense.to_dict()), 200


@expenses_bp.delete("/<int:expense_id>")
def delete_expense(expense_id: int):
    """Soft-delete an expense."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401
        
    expense = Expense.get_by_id(expense_id)
    if not expense or expense.user_id != user.id:
        return jsonify({'error': 'Expense not found'}), 404

    # Clean up any legacy on-disk image (may no longer exist for new rows)
    if expense.picture_url:
        delete_image(expense.picture_url)

    expense.delete()
    return jsonify({'message': 'Expense deleted'}), 200


@expenses_bp.get("/<int:expense_id>/receipt")
def serve_expense_receipt(expense_id: int):
    """Stream a receipt image stored as a blob in the database."""
    from flask import Response
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401

    expense = Expense.get_by_id(expense_id)
    if not expense or expense.user_id != user.id:
        return jsonify({'error': 'Not found'}), 404

    if not expense.receipt_data:
        return jsonify({'error': 'No receipt image'}), 404

    mime = expense.receipt_mime or 'image/jpeg'
    return Response(
        expense.receipt_data,
        mimetype=mime,
        headers={'Cache-Control': 'private, max-age=86400'}
    )


@expenses_bp.delete("/all")
def delete_all_expenses():
    """Soft-delete all expenses for the current user."""
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401
        
    import os
    from flask import current_app
    
    expenses = Expense.get_by_user(user.id)
    for expense in expenses:
        if expense.picture_url:
            delete_image(expense.picture_url)

    Expense.delete_all_by_user(user.id)
    return jsonify({'message': 'All expenses and associated images deleted successfully'}), 200


@pages_bp.route('/api/process-receipt', methods=['POST'])
@login_required
def process_receipt():
    """Process receipt image with preprocessing. Stub endpoint - actual item detection via YOLO.
    This endpoint is kept for backward compatibility and could be extended for OCR later."""
    user = get_current_user()
    if not user:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    
    if 'image' not in request.files:
        return jsonify({'success': False, 'error': 'No file part'}), 400
    
    file = request.files['image']
    if file.filename == '':
        return jsonify({'success': False, 'error': 'No selected file'}), 400
    
    if not allowed_image(file.filename):
        return jsonify({'success': False, 'error': 'File type not allowed'}), 400
    
    try:
        # Validate and preprocess image for better quality
        img = Image.open(file.stream).convert('RGB')
        img = preprocess_receipt_image(img)  # Improves image quality if cv2 available
        
        # Return success - actual expense detection/addition happens via:
        # 1. YOLO detection endpoint for item localization
        # 2. Frontend forms for user confirmation and price entry
        # 3. /api/expenses endpoint for saving confirmed items
        return jsonify({
            'success': True,
            'message': 'Image preprocessed. Use YOLO detection to identify items.',
            'data': {}
        })
        
    except Exception as e:
        current_app.logger.error(f"Error processing image: {str(e)}")
        return jsonify({
            'success': False,
            'error': 'Failed to process image'
        }), 500




def guess_category_backend(label, receipt_context=None):
    """Classify an expense item label into a category.
    
    Args:
        label: The item name/label string from OCR.
        receipt_context: Optional hint, e.g. 'food' if most items are food.
    """
    if not label:
        return 'Food' if receipt_context == 'food' else 'Misc'
    s = str(label).lower().strip()

    # --- Books ---
    if re.search(r'\b(book|novel|magazine|comic|manga|textbook|paperback|hardcover|literature)s?\b', s):
        return 'Books'

    # --- Food & Dining (expanded with generic meal patterns) ---
    if re.search(
        r'(?i)\b('
        r'pizza|margherita|pepperoni|sandwich|burger|hotdog|hot dog|donut|cake|cookie|pastry|'
        r'croissant|muffin|nugget|wing|fries|chips|combo|set meal|meal deal|'
        r'value meal|happy meal|kids meal|family meal|platter|house special|daily special|'
        r'apple|banana|orange|grape|mango|strawberry|pineapple|watermelon|lemon|lime|avocado|'
        r'broccoli|carrot|tomato|cucumber|lettuce|spinach|mushroom|corn|peas|beans|potato|'
        r'chicken|beef|pork|lamb|mutton|fish|salmon|tuna|shrimp|prawn|seafood|'
        r'sushi|sashimi|ramen|udon|soba|tempura|teriyaki|curry|masala|dal|dosa|naan|roti|'
        r'biryani|kebab|shawarma|gyro|falafel|hummus|tacos|burrito|nachos|guacamole|'
        r'noodles|rice|pasta|spaghetti|lasagna|soup|salad|dumpling|bao|'
        r'coffee|espresso|latte|cappuccino|mocha|tea|chai|juice|soda|cola|coke|water|beer|wine|'
        r'mcdonalds|kfc|subway|pizza hut|starbucks|'
        r'entree|appetizer|starter|dessert|main course|side dish|'
        r'item [0-9]|\d+x |qty'
        r')\b',
        s
    ):
        return 'Food'

    # --- Groceries ---
    if re.search(
        r'\b(grocery|groceries|supermarket|hypermarket|mart|store|shop|market|'
        r'bottle|cup|bowl|fork|knife|spoon|plate|cleaning|detergent|soap|shampoo)\b', s
    ):
        return 'Groceries'

    # --- Transport ---
    if re.search(
        r'\b(car|bus|truck|motorcycle|bicycle|taxi|uber|lyft|train|metro|subway|'
        r'gas station|petrol|fuel|parking|toll|fare|ride)\b', s
    ):
        return 'Transport'

    # --- Electronics ---
    if re.search(
        r'\b(laptop|keyboard|mouse|phone|mobile|tablet|tv|monitor|charger|cable|'
        r'headphones|earbuds|power bank|remote|battery|printer|camera)\b', s
    ):
        return 'Electronics'

    # --- Clothing ---
    if re.search(
        r'\b(shoes|clothes|jacket|pants|shirt|dress|hat|socks|underwear|'
        r'belt|wallet|backpack|bag|jeans|coat|suit|tie|scarf|gloves)\b', s
    ):
        return 'Clothing'

    # --- Tax / Fees ---
    if re.search(r'\b(tax|gst|vat|service charge|tip|gratuity)\b', s):
        return 'Tax'

    # --- Context-aware fallback ---
    # If the receipts has a food/restaurant context, unknown items are likely food
    if receipt_context == 'food':
        return 'Food'

    return 'Misc'


# EasyOCR parsing helpers removed -- Gemini Vision handles all extraction via GodModeOCR.

@pages_bp.route('/api/yolo/detect', methods=['POST'])
@login_required
def yolo_detect():
    """
    Detect items on a receipt using YOLOv9 and extract text using OCR.
    Includes robust preprocessing and fallback mechanisms.
    """
    user = get_current_user()
    if not user:
        return jsonify({'success': False, 'error': 'Unauthorized'}), 401
    
    if 'image' not in request.files:
        return jsonify({'success': False, 'error': 'No file part'}), 400
    file = request.files['image']
    if file.filename == '':
        return jsonify({'success': False, 'error': 'No selected file'}), 400
        
    if not allowed_image(file.filename):
        return jsonify({'success': False, 'error': 'File type not allowed'}), 400
        
    try:
        # Load original image and correct EXIF orientation (sideways photos from phones)
        original_img_pil = Image.open(file.stream)
        original_img_pil = ImageOps.exif_transpose(original_img_pil)
        
        # --- PNG/RGBA Transparency Fix ---
        # If image has an alpha channel, paste it onto a solid white background 
        # before converting to RGB, otherwise transparency becomes pitch black.
        if original_img_pil.mode in ('RGBA', 'LA') or (original_img_pil.mode == 'P' and 'transparency' in original_img_pil.info):
            original_img_pil = original_img_pil.convert('RGBA')
            background = Image.new('RGBA', original_img_pil.size, (255,255,255))
            original_img_pil = Image.alpha_composite(background, original_img_pil)
            
        original_img_pil = original_img_pil.convert('RGB')
        
        # --- STAGE 1: Detection friendly preprocessing (Keeps RGB) ---
        # This fixes perspective/skew but avoids high-contrast thresholding which hurts YOLO
        bgr_detection, was_warped = get_robust_warped_image(original_img_pil)
        
        # Convert BGR back to PIL RGB for YOLO
        detection_img_pil = Image.fromarray(cv2.cvtColor(bgr_detection, cv2.COLOR_BGR2RGB))
        width, height = detection_img_pil.size
        
        # Load YOLO Model
        model = _get_yolov9_model()
        if not model:
            return jsonify({
                'success': False,
                'error': f'YOLOv9 model not available: {YOLOV9_LAST_ERROR}', 
                'details': YOLOV9_LAST_ERROR
            }), 500

        # Run Inference with optimized parameters for recall, silence the printout
        try:
            model.conf = 0.20
            model.iou = 0.45
        except Exception:
            pass
            
        import contextlib
        import os
        with open(os.devnull, 'w') as f, contextlib.redirect_stdout(f):
            results = model(detection_img_pil, size=832)
        
        detections = []
        
        # Safe access to class names
        try:
            names = getattr(results, 'names', None) or getattr(model, 'names', None) or {}
        except Exception:
            names = {}
            
        # Get predictions
        try:
            pred = results.xyxy[0].tolist() if hasattr(results, 'xyxy') else []
        except Exception:
            pred = []
            
        # === YOLO-GUIDED OCR ===
        # KEY FIX: instead of running OCR on the full image (which includes wooden tables,
        # backgrounds, etc.), we crop to the YOLO-detected receipt bounding box first.
        # If YOLO found no receipt-class box, fall back to the full image.
        parse_result = {}
        structured_full_text = ""
        if GOD_MODE_OCR:
            try:
                # Find best receipt detection (highest confidence)
                ocr_target = bgr_detection   # default: full image
                best_receipt_det = None
                best_conf = -1
                for det in pred:
                    if len(det) < 6:
                        continue
                    dx1, dy1, dx2, dy2, dconf, dcls = det[:6]
                    try:
                        cls_idx = int(dcls)
                        dlabel = (names.get(cls_idx) or names.get(str(cls_idx)) or '')
                        if isinstance(names, (list, tuple)) and 0 <= cls_idx < len(names):
                            dlabel = names[cls_idx]
                    except Exception:
                        dlabel = ''
                    # Accept any detection that overlaps significantly with the image
                    if dconf > best_conf:
                        best_conf = dconf
                        best_receipt_det = (dx1, dy1, dx2, dy2)

                if best_receipt_det:
                    dx1, dy1, dx2, dy2 = best_receipt_det
                    # Add 3% padding so text at edges isn't cut off
                    pad_x = int((dx2 - dx1) * 0.03)
                    pad_y = int((dy2 - dy1) * 0.03)
                    cx1 = max(0, int(dx1) - pad_x)
                    cy1 = max(0, int(dy1) - pad_y)
                    cx2 = min(width,  int(dx2) + pad_x)
                    cy2 = min(height, int(dy2) + pad_y)
                    if (cx2 - cx1) > 50 and (cy2 - cy1) > 50:
                        ocr_target = bgr_detection[cy1:cy2, cx1:cx2]
                        current_app.logger.info(
                            f"OCR using YOLO crop: {cx1},{cy1}→{cx2},{cy2} "
                            f"(was {width}×{height}, now {cx2-cx1}×{cy2-cy1})"
                        )

                parse_result = GOD_MODE_OCR.extract_structured_data(ocr_target)
                import json
                structured_full_text = json.dumps(parse_result, indent=2)
                item_count = len(parse_result.get('items', []))
                current_app.logger.info(
                    f"Gemini Vision: {item_count} items | "
                    f"total={parse_result.get('total')} | "
                    f"date={parse_result.get('date')} | "
                    f"context={parse_result.get('receipt_context')}"
                )
            except Exception as e:
                current_app.logger.warning(f"Gemini OCR failed: {e}")
                import traceback
                current_app.logger.debug(traceback.format_exc())


        # --- Process Detections ---
        for det in pred:
            if len(det) < 6:
                continue
                
            x1, y1, x2, y2, conf, cls_id = det[:6]
            
            # Resolve label
            label = None
            try:
                cls_idx = int(cls_id)
                if isinstance(names, (list, tuple)) and 0 <= cls_idx < len(names):
                    label = names[cls_idx]
                elif isinstance(names, dict):
                    label = names.get(cls_idx) or names.get(str(cls_idx))
            except Exception:
                pass
            label = label or str(cls_id)
            
            # Since Gemini Vision analyzes everything in one full-image pass,
            # we don't need to run local cropped OCR.
            detected_text = "Gemini Extracted" if 'receipt' in str(label).lower() else ""

            detections.append({
                'x1': float(x1), 'y1': float(y1), 'x2': float(x2), 'y2': float(y2),
                'confidence': float(conf), 
                'class_id': int(cls_id) if str(cls_id).isdigit() else cls_id,
                'label': label,
                'text': detected_text
            })

        return jsonify({
            'success': True,
            'width': width,
            'height': height,
            'detections': detections,
            'items': parse_result.get('items', []),
            'total': parse_result.get('total'),
            'subtotal': parse_result.get('subtotal'),
            'date': parse_result.get('date'),
            'receipt_context': parse_result.get('receipt_context'),
            'fallback': {'full_text': structured_full_text} if structured_full_text else {}
        }), 200

    except Exception as e:
        error_msg = str(e)
        current_app.logger.error(f"YOLO detect error: {error_msg}", exc_info=True)
        return jsonify({'success': False, 'error': f'Failed to run detection: {error_msg}'}), 500
@expenses_bp.get("/analytics")
def get_expense_analytics():
    """Get expense analytics data for charts."""
    user = get_current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401
    
    expenses = Expense.get_by_user(user.id)
    total_amount = sum(e.value for e in expenses)
    category_totals = {}
    monthly_totals = {}
    
    for expense in expenses:
        category = expense.category or "Uncategorized"
        category_totals[category] = category_totals.get(category, 0) + expense.value
        
        # Monthly totals
        month_key = expense.created_at.strftime("%Y-%m") if expense.created_at else "Unknown"
        monthly_totals[month_key] = monthly_totals.get(month_key, 0) + expense.value
    
    return jsonify({
        "total_amount": total_amount,
        "total_expenses": len(expenses),
        "category_breakdown": category_totals,
        "monthly_breakdown": monthly_totals,
        "average_expense": total_amount / len(expenses) if expenses else 0
    }), 200


# Budget CRUD endpoints
@expenses_bp.get("/budget")
def get_budget():
    """Get the active budget for the current user."""
    user = get_current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401
    budget = Budget.get_active_by_user(user.id)
    if not budget:
        # Return 200 with null so the frontend's else-branch handles it
        # without generating 404 log noise on every dashboard load
        return jsonify(None), 200
    return jsonify(budget.to_dict()), 200

@expenses_bp.post("/budget")
def create_budget():
    """Create or update a budget for the current user."""
    user = get_current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401
    data = request.get_json(silent=True) or {}
    amount_raw = data.get("amount")
    period = data.get("period", "monthly")
    if amount_raw is None or str(amount_raw).strip() == "":
        return jsonify({"error": "Missing amount"}), 400
    try:
        amount = Decimal(str(amount_raw))
    except (InvalidOperation, ValueError):
        return jsonify({"error": "Invalid amount"}), 400
    if amount <= 0:
        return jsonify({"error": "Amount must be greater than 0"}), 400
    # Soft-delete any existing budget for this user
    existing = Budget.get_active_by_user(user.id)
    if existing:
        existing.delete()
    # Create new budget
    budget = Budget(user_id=user.id, amount=amount, period=period)
    budget.save()
    return jsonify(budget.to_dict()), 201

@expenses_bp.delete("/budget")
def delete_budget():
    """Soft-delete the active budget for the current user."""
    user = get_current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401
    budget = Budget.get_active_by_user(user.id)
    if not budget:
        return jsonify({"error": "No budget set"}), 404
    budget.delete()
    return jsonify({"message": "Budget deleted"}), 200


@expenses_bp.get("/export")
def export_expenses():
    """Export all expenses for the current user to a CSV file."""
    user = get_current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401
        
    expenses = Expense.get_by_user(user.id)
    
    import csv
    from io import StringIO
    
    si = StringIO()
    cw = csv.writer(si)
    cw.writerow(['Date', 'Category', 'Amount', 'Description'])
    
    for e in expenses:
        date_str = e.created_at.strftime('%Y-%m-%d %H:%M:%S') if e.created_at else ''
        cw.writerow([date_str, e.category or '', float(e.value) if e.value is not None else 0.0, e.description or ''])
        
    output = si.getvalue()
    
    response = Response(
        output,
        mimetype="text/csv",
        headers={"Content-disposition": "attachment; filename=expenses_export.csv"}
    )
    return response

