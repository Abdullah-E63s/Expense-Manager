"""Configuration module for the Expense Manager Flask application."""

import os
from datetime import timedelta
from dotenv import load_dotenv

load_dotenv()


class Config:
    """Base configuration shared by all environments."""

    # Secret key — MUST be set as an environment variable in production.
    # Never use a hardcoded fallback in production; leave empty to force explicit configuration.
    SECRET_KEY = os.environ.get("SECRET_KEY") or "dev-insecure-key-change-me"
    EMAIL_TOKEN_SALT = os.environ.get("EMAIL_TOKEN_SALT", "email-confirm-salt")

    # -------------------------
    # Email configuration
    # -------------------------
    MAIL_SERVER = os.environ.get("MAIL_SERVER", "smtp.gmail.com")
    MAIL_PORT = int(os.environ.get("MAIL_PORT", 587))
    MAIL_USE_TLS = os.environ.get("MAIL_USE_TLS", "true").lower() == "true"
    MAIL_USE_SSL = os.environ.get("MAIL_USE_SSL", "false").lower() == "true"
    MAIL_USERNAME = os.environ.get("MAIL_USERNAME", "exp2tester@gmail.com")
    MAIL_PASSWORD = os.environ.get("MAIL_PASSWORD", "")  # Must be set in .env
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
    GOOGLE_REDIRECT_URI = os.environ.get(
        "GOOGLE_REDIRECT_URI", "http://localhost:5000/api/auth/google/callback"
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
    # Set STATIC_CDN_URL to your Vercel deployment URL (e.g. https://my-app.vercel.app)
    # to offload static asset delivery from Flask to the Vercel CDN.
    STATIC_CDN_URL = os.getenv("STATIC_CDN_URL", "")

    # Base URL used for building absolute links in emails and OAuth callbacks.
    # e.g. https://your-app.hf.space  (no trailing slash)
    EXTERNAL_BASE_URL = os.getenv("EXTERNAL_BASE_URL", "http://localhost:5000")


class DevelopmentConfig(Config):
    DEBUG = True
    RECAPTCHA_ENABLED = False  # Disable reCAPTCHA in development


class ProductionConfig(Config):
    DEBUG = False


def get_config() -> type:
    """Return the config class based on FLASK_ENV."""
    env = os.environ.get("FLASK_ENV", "development").lower()
    return ProductionConfig if env == "production" else DevelopmentConfig
