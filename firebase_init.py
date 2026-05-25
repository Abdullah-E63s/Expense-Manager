"""Firebase initialization module — lazy and safe."""
import os
import json
import logging
from pathlib import Path
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

# Load environment variables from .env file (only if not already loaded)
try:
    env_path = Path(__file__).parent / '.env'
    if env_path.exists():
        load_dotenv(dotenv_path=env_path)
except Exception as e:
    logger.warning("Could not load .env: %s", str(e))

# Credential path — check multiple env var names for compatibility
FIREBASE_CREDENTIALS_PATH = (
    os.getenv('FIREBASE_CREDENTIALS_PATH')
    or os.getenv('FIREBASE_CREDENTIALS')
    or os.getenv('GOOGLE_APPLICATION_CREDENTIALS')
    or 'firebase-credentials.json'
)

# Module-level references populated by init_firebase()
firebase_admin = None
firebase_app = None
firebase_auth = None


def init_firebase():
    """Initialize Firebase Admin SDK with proper error handling.
    
    Does NOT make any network requests during init — only loads credentials
    from the local JSON file. The first actual Firebase API call will
    establish the connection lazily.
    """
    global firebase_admin, firebase_app, firebase_auth

    try:
        import firebase_admin as _firebase_admin
        from firebase_admin import credentials, auth, _apps

        firebase_admin = _firebase_admin

        # If already initialized, reuse the existing app
        if len(_apps) > 0:
            firebase_app = _apps.get('[DEFAULT]')
            if firebase_app:
                firebase_auth = auth
                logger.info("Firebase Admin SDK already initialized — reusing existing app.")
                return True

        # Resolve absolute path to credentials file
        base_dir = os.path.dirname(os.path.abspath(__file__))
        cred_path = FIREBASE_CREDENTIALS_PATH
        if not os.path.isabs(cred_path):
            cred_path = os.path.join(base_dir, cred_path)

        if not os.path.exists(cred_path):
            logger.warning(
                "Firebase credentials file not found at: %s — Firebase Auth will be unavailable.", cred_path
            )
            return False

        # Load project_id from credentials without making any network requests
        try:
            with open(cred_path) as f:
                cred_data = json.load(f)
            project_id = cred_data.get('project_id', '')
        except Exception as read_err:
            logger.error("Could not read Firebase credentials JSON: %s", read_err)
            return False

        cred = credentials.Certificate(cred_path)

        # Try to get existing app first, create if absent
        try:
            firebase_app = _firebase_admin.get_app()
        except ValueError:
            options = {}
            if project_id:
                options['storageBucket'] = f"{project_id}.appspot.com"
                options['databaseURL'] = f"https://{project_id}.firebaseio.com/"
            firebase_app = _firebase_admin.initialize_app(cred, options)

        firebase_auth = auth
        logger.info("Firebase Admin SDK initialized successfully (project: %s).", project_id)
        return True

    except ImportError:
        logger.warning("firebase-admin package not installed — Firebase features disabled.")
        return False
    except Exception as e:
        logger.error("Unexpected error initializing Firebase: %s", str(e))
        return False


# Initialize on module import
FIREBASE_AVAILABLE = init_firebase()
if FIREBASE_AVAILABLE:
    logger.info("Firebase status: ✓ Available")
else:
    logger.warning("Firebase status: ✗ Not available — Google Sign-In may be limited.")
