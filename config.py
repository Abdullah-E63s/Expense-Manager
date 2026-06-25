"""Configuration module for the Expense Manager Flask application."""

import os
from datetime import timedelta
from dotenv import load_dotenv

load_dotenv()


def _detect_base_url() -> str:
    """
    Auto-detect the public base URL for this deployment.

    Priority:
    1. EXTERNAL_BASE_URL env var (explicit override — always wins)
    2. SPACE_HOST env var injected by Hugging Face Spaces
       (format: "username-spacename.hf.space" — no scheme)
    3. Fallback to http://localhost:5000 for local dev
    """
    explicit = os.getenv("EXTERNAL_BASE_URL", "").strip()
    if explicit:
        return explicit.rstrip("/")

    # Hugging Face Spaces injects SPACE_HOST automatically
    hf_host = os.getenv("SPACE_HOST", "").strip()
    if hf_host:
        return f"https://{hf_host.rstrip('/')}"

    return "http://localhost:5000"


_BASE_URL = _detect_base_url()


class Config:
    """Base configuration shared by all environments."""

    # Secret key — MUST be set as an environment variable in production.
    SECRET_KEY = os.environ.get("SECRET_KEY") or "dev-insecure-key-change-me"
    EMAIL_TOKEN_SALT = os.environ.get("EMAIL_TOKEN_SALT", "email-confirm-salt")

    # -------------------------
    # Email configuration
    # -------------------------
    MAIL_SERVER = os.environ.get("MAIL_SERVER", "smtp.gmail.com")
    MAIL_PORT = int(os.environ.get("MAIL_PORT", 587))
    MAIL_USE_TLS = os.environ.get("MAIL_USE_TLS", "true").lower() == "true"
    MAIL_USE_SSL = os.environ.get("MAIL_USE_SSL", "false").lower() == "true"
    MAIL_TIMEOUT = 10  # Fail quickly instead of hanging and causing 502 Gateway Timeouts
    MAIL_USERNAME = os.environ.get("MAIL_USERNAME", "exp2tester@gmail.com")
    MAIL_PASSWORD = os.environ.get("MAIL_PASSWORD", "")
    MAIL_DEFAULT_SENDER = os.environ.get("MAIL_DEFAULT_SENDER", MAIL_USERNAME)

    # -------------------------
    # Database (raw PyMySQL)
    # -------------------------
    MYSQL_HOST = os.environ.get("MYSQL_HOST", "localhost")
    MYSQL_USER = os.environ.get("MYSQL_USER", "root")
    MYSQL_PASSWORD = os.environ.get("MYSQL_PASSWORD", "")
    MYSQL_DB = os.environ.get("MYSQL_DATABASE", "expense_manager")

    # -------------------------
    # Sessions
    # -------------------------
    PERMANENT_SESSION_LIFETIME = timedelta(days=7)
    # Leave SESSION_COOKIE_DOMAIN as None — Flask will use the current request domain.
    # A hardcoded 'localhost:5000' would break every production deployment.
    SESSION_COOKIE_DOMAIN = None

    # -------------------------
    # File uploads
    # -------------------------
    BASE_DIR = os.path.dirname(__file__)
    STATIC_DIR = os.path.join(BASE_DIR, "static")
    UPLOAD_FOLDER = os.path.join(STATIC_DIR, "images")
    MAX_CONTENT_LENGTH = 20 * 1024 * 1024  # 20 MB max upload
    ALLOWED_IMAGE_EXTENSIONS = {
        "jpg", "jpeg", "png", "webp", "gif", "bmp", "tiff",
        "heic", "avif", "jfif", "pjpeg",
    }

    # -------------------------
    # Google OAuth
    # -------------------------
    GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
    GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")
    # Default derives from _BASE_URL so it works on HF Spaces without manual config.
    GOOGLE_REDIRECT_URI = os.environ.get(
        "GOOGLE_REDIRECT_URI",
        f"{_BASE_URL}/api/auth/google/callback"
    )

    # -------------------------
    # Firebase
    # -------------------------
    FIREBASE_CREDENTIALS = os.environ.get(
        "FIREBASE_CREDENTIALS",
        os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "firebase-credentials.json"),
    )
    FIREBASE_PROJECT_ID = os.environ.get("FIREBASE_PROJECT_ID", "expense-2-63a15")

    # -------------------------
    # Rate limiting (in-memory)
    # -------------------------
    RATE_LIMIT_WINDOW_SEC = int(os.environ.get("RATE_LIMIT_WINDOW_SEC", 60))
    RATE_LIMIT_MAX_REQUESTS = int(os.environ.get("RATE_LIMIT_MAX_REQUESTS", 20))

    # -------------------------
    # reCAPTCHA v3 / Enterprise
    # -------------------------
    RECAPTCHA_SITE_KEY = os.getenv("RECAPTCHA_SITE_KEY", "")
    RECAPTCHA_SECRET_KEY = os.getenv("RECAPTCHA_SECRET_KEY", "")
    RECAPTCHA_ENTERPRISE_API_KEY = os.getenv("RECAPTCHA_ENTERPRISE_API_KEY", "")
    RECAPTCHA_PROJECT_ID = os.getenv("RECAPTCHA_PROJECT_ID", "")
    RECAPTCHA_ENABLED = os.getenv("RECAPTCHA_ENABLED", "true").lower() == "true"
    RECAPTCHA_MIN_SCORE = float(os.getenv("RECAPTCHA_MIN_SCORE", 0.5))
    RECAPTCHA_ACTION = os.getenv("RECAPTCHA_ACTION", "login")

    # -------------------------
    # CDN & External URL
    # -------------------------
    STATIC_CDN_URL = os.getenv("STATIC_CDN_URL", "")

    # Base URL used for building absolute links in emails and OAuth callbacks.
    # Auto-detected from SPACE_HOST on Hugging Face Spaces.
    # Override with EXTERNAL_BASE_URL env var if needed.
    EXTERNAL_BASE_URL = _BASE_URL


class DevelopmentConfig(Config):
    DEBUG = True
    RECAPTCHA_ENABLED = False  # Disable reCAPTCHA in development


class ProductionConfig(Config):
    DEBUG = False


def get_config() -> type:
    """Return the config class based on FLASK_ENV."""
    env = os.environ.get("FLASK_ENV", "development").lower()
    return ProductionConfig if env == "production" else DevelopmentConfig
