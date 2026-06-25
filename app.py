"""Expense Manager — Flask application entry point."""
import os
import logging
from datetime import timedelta
from functools import wraps
from logging.handlers import RotatingFileHandler

from dotenv import load_dotenv

# ── Environment variables — load before everything else ──────────────────────
_env_path = os.path.join(os.path.dirname(__file__), '.env')
if os.path.exists(_env_path):
    load_dotenv(_env_path)

# ── Core Flask imports ────────────────────────────────────────────────────────
from flask import Flask, render_template, request, redirect, url_for, jsonify, session, current_app
from flask_mail import Mail
from flask_cors import CORS
from flask_wtf.csrf import CSRFProtect, generate_csrf
from werkzeug.security import generate_password_hash, check_password_hash

# ── Application modules ───────────────────────────────────────────────────────
from config import get_config
from models import init_db, User, execute_query, Database

# ── App factory ──────────────────────────────────────────────────────────────
app = Flask(__name__, static_folder='static', template_folder='templates')
app.config.from_object(get_config())

# Ensure session cookie settings are explicitly set
app.config.update(
    SESSION_COOKIE_SECURE=not app.debug,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
    PERMANENT_SESSION_LIFETIME=timedelta(days=30),
)

# ── Extensions ────────────────────────────────────────────────────────────────
# Build the allowed origins list from env vars, auto-detecting HF Spaces URL.
# ALLOWED_ORIGINS can be set to a comma-separated list to explicitly restrict origins.
# When not set, we allow localhost (dev) + the detected production URL automatically.
def _build_allowed_origins() -> list:
    raw = os.getenv("ALLOWED_ORIGINS", "").strip()
    if raw:
        return [o.strip() for o in raw.split(",") if o.strip()]

    origins = [
        "http://localhost:5000",
        "http://127.0.0.1:5000",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]
    # Auto-add the Hugging Face Space URL if running on HF
    hf_host = os.getenv("SPACE_HOST", "").strip()
    if hf_host:
        origins.append(f"https://{hf_host.rstrip('/')}")
    # Also add whatever EXTERNAL_BASE_URL is set to
    ext_url = os.getenv("EXTERNAL_BASE_URL", "").strip()
    if ext_url and ext_url not in origins:
        origins.append(ext_url.rstrip("/"))
    return origins

_allowed_origins = _build_allowed_origins()

CORS(app,
     resources={
         r"/api/*": {
             "origins": _allowed_origins,
             "supports_credentials": True,
             "allow_headers": ["Content-Type", "X-CSRFToken", "Authorization"],
             "methods": ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
         }
     })

csrf = CSRFProtect(app)
mail = Mail(app)

# ── Logging ───────────────────────────────────────────────────────────────────
def _setup_logging():
    """Configure logging for production.

    On Hugging Face Spaces (SPACE_ID env var is set automatically) or any
    container environment, write to stdout only — disk paths may not be
    persistent. In regular production servers a rotating file handler is
    used as a fallback.
    """
    if app.debug:
        logging.basicConfig(level=logging.DEBUG)
        return

    fmt = logging.Formatter('%(asctime)s %(levelname)s: %(message)s [%(pathname)s:%(lineno)d]')

    # Clear existing handlers to avoid duplicates on reload
    for h in app.logger.handlers[:]:
        app.logger.removeHandler(h)

    # HF Spaces / container: always log to stdout
    _on_hf_spaces = bool(os.getenv('SPACE_ID') or os.getenv('SPACES_ZERO_GPU'))
    if _on_hf_spaces:
        stream_handler = logging.StreamHandler()
        stream_handler.setFormatter(fmt)
        stream_handler.setLevel(logging.INFO)
        app.logger.addHandler(stream_handler)
        app.logger.setLevel(logging.INFO)
        app.logger.info('Expense Manager started (HF Spaces / container mode — stdout logging).')
        return

    # Standard server: rotating file + stdout
    try:
        logs_dir = os.path.join(os.path.dirname(__file__), 'logs')
        os.makedirs(logs_dir, exist_ok=True)
        log_file = os.path.join(logs_dir, 'expense_manager.log')

        handler = RotatingFileHandler(
            log_file, maxBytes=10 * 1024 * 1024, backupCount=5, encoding='utf-8'
        )
        handler.setFormatter(fmt)
        handler.setLevel(logging.INFO)
        app.logger.addHandler(handler)
        app.logger.setLevel(logging.INFO)
        app.logger.info('Expense Manager started.')
    except Exception as e:
        logging.basicConfig(level=logging.INFO)
        app.logger.error('Logging setup failed: %s', e)


_setup_logging()

# ── Database ──────────────────────────────────────────────────────────────────
with app.app_context():
    init_db()
    # Ensure admin account exists and is up-to-date on every startup.
    # ADMIN_EMAIL and ADMIN_PASSWORD MUST be set as environment variables.
    # No hardcoded fallback passwords — fail loudly if not configured in production.
    try:
        _admin_email = os.getenv('ADMIN_EMAIL')
        _admin_pass  = os.getenv('ADMIN_PASSWORD')
        if not _admin_email or not _admin_pass:
            app.logger.warning(
                'ADMIN_EMAIL or ADMIN_PASSWORD env vars not set — skipping admin account sync. '
                'Set these in your environment/.env file before deploying to production.'
            )
        else:
            _row = execute_query(
                "SELECT id FROM users WHERE email = %s", (_admin_email,), fetch_one=True
            )
            if _row:
                execute_query(
                    """UPDATE users
                       SET is_admin=TRUE, is_active=TRUE, is_verified=TRUE,
                           deleted_at=NULL, password_hash=%s, updated_at=NOW()
                       WHERE email=%s""",
                    (generate_password_hash(_admin_pass), _admin_email), commit=True
                )
            else:
                execute_query(
                    """INSERT INTO users
                           (email, password_hash, first_name, last_name,
                            is_active, is_admin, is_verified, created_at, updated_at)
                       VALUES (%s, %s, 'Admin', 'User', TRUE, TRUE, TRUE, NOW(), NOW())""",
                    (_admin_email, generate_password_hash(_admin_pass)), commit=True
                )
            app.logger.info('Admin account verified: %s', _admin_email)
    except Exception as _e:
        app.logger.warning('Could not ensure admin account: %s', _e)

# ── Blueprint registration ────────────────────────────────────────────────────
from routes import pages_bp, auth_bp, expenses_bp
from admin_routes import admin_bp

app.register_blueprint(pages_bp)
app.register_blueprint(auth_bp, url_prefix='/api/auth')
app.register_blueprint(expenses_bp, url_prefix='/api/expenses')
app.register_blueprint(admin_bp)

# ── Template context processors ───────────────────────────────────────────────
@app.context_processor
def inject_csrf_token():
    """Inject CSRF token and reCAPTCHA config into every template."""
    try:
        site_key        = app.config.get('RECAPTCHA_SITE_KEY', '')
        secret_key      = app.config.get('RECAPTCHA_SECRET_KEY', '')
        enterprise_key  = app.config.get('RECAPTCHA_ENTERPRISE_API_KEY', '')
        enabled         = app.config.get('RECAPTCHA_ENABLED', True)
        recaptcha_on    = bool(enabled and site_key and (secret_key or enterprise_key))
    except Exception:
        site_key = enterprise_key = ''
        recaptcha_on = False
    return dict(
        csrf_token=generate_csrf,
        recaptcha_site_key=site_key,
        recaptcha_enabled=recaptcha_on,
        recaptcha_enterprise_enabled=bool(enterprise_key),
        recaptcha_enterprise_api_key=enterprise_key,
    )


@app.context_processor
def inject_admin_user():
    """Inject admin display name for admin templates."""
    admin_user_name = None
    user_id = session.get('user_id')
    if user_id:
        try:
            u = User.get_by_id(user_id)
            if u and u.is_admin:
                admin_user_name = u.first_name or u.email
        except Exception:
            pass
    return dict(admin_user_name=admin_user_name)


@app.context_processor
def override_url_for():
    """Cache-busting url_for wrapper for static assets."""
    return dict(url_for=_versioned_url_for)


def _versioned_url_for(endpoint, **values):
    if endpoint == 'static':
        filename = values.get('filename')
        if filename:
            file_path = os.path.join(app.root_path, endpoint, filename)
            try:
                values['v'] = int(os.stat(file_path).st_mtime)
            except OSError:
                pass
        # If a Vercel CDN URL is configured, rewrite static asset URLs to the CDN.
        # This offloads CSS/JS/image delivery from the Flask server.
        cdn_url = app.config.get('STATIC_CDN_URL', '').rstrip('/')
        if cdn_url:
            generated = url_for(endpoint, **values)
            # Strip the /static prefix and prepend CDN base
            return cdn_url + generated.replace('/static', '', 1)
    return url_for(endpoint, **values)


# ── Request lifecycle hooks ───────────────────────────────────────────────────
@app.after_request
def add_security_headers(response):
    """Apply security and cache-control headers on every response."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'SAMEORIGIN'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'

    if request.path.startswith('/static/'):
        # Aggressively cache static assets on CDNs (like Vercel) for 1 year,
        # and on the browser for 1 day.
        response.headers['Cache-Control'] = 'public, max-age=86400, s-maxage=31536000'
    elif request.path.startswith('/api/'):
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate, max-age=0'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
    else:
        response.cache_control.no_store = True
        response.cache_control.no_cache = True

    origin = request.headers.get('Origin')
    if origin:
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Vary'] = 'Origin'
        response.headers['Access-Control-Allow-Credentials'] = 'true'
    else:
        response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-CSRFToken'
    return response


# ── Core routes ───────────────────────────────────────────────────────────────
@app.route('/')
def root():
    """Redirect root to dashboard or login."""
    return redirect('/dashboard' if session.get('user_id') else '/login')


@app.route('/health')
def health():
    """Health check endpoint — required for deployment platforms."""
    return jsonify({'status': 'healthy'}), 200


@app.route('/admin/login', methods=['GET', 'POST'])
def admin_login():
    """Admin login — sets session used by admin_required decorator."""
    if request.method == 'GET':
        return render_template('admin_login.html')

    data = request.get_json(silent=True) or {}
    email    = data.get('username', '').strip()
    password = data.get('password', '').strip()

    if not email or not password:
        return jsonify({'success': False, 'error': 'Email and password are required.'}), 400

    user = User.get_by_email(email)
    if not user or not user.check_password(password):
        return jsonify({'success': False, 'error': 'Invalid credentials.'}), 401
    if not user.is_admin:
        return jsonify({'success': False, 'error': 'Admin privileges required.'}), 403

    session.permanent = True
    session['user_id'] = user.id
    session['email']   = user.email
    return jsonify({'success': True})


@app.route('/logout', methods=['GET', 'POST', 'OPTIONS'])
def logout():
    """Session logout — supports GET/POST/AJAX."""
    if request.method == 'OPTIONS':
        resp = jsonify({'status': 'ok'})
        resp.headers['Access-Control-Allow-Origin'] = request.headers.get('Origin', '*')
        resp.headers['Access-Control-Allow-Headers'] = 'Content-Type, X-CSRFToken'
        resp.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
        resp.headers['Access-Control-Allow-Credentials'] = 'true'
        return resp

    session.pop('user_id', None)
    session.pop('email', None)

    if request.method == 'POST' or request.headers.get('X-Requested-With') == 'XMLHttpRequest':
        return jsonify({'success': True, 'message': 'Logged out successfully'}), 200
    return redirect(url_for('root'))


# ── Development runner ────────────────────────────────────────────────────────
if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)