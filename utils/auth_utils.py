"""Authentication utility functions."""
import requests
from flask import session, current_app, jsonify, redirect, url_for, request
from functools import wraps


def handle_google_auth(code, redirect_uri):
    """Handle Google OAuth token exchange and user info fetching."""
    token_url = 'https://oauth2.googleapis.com/token'
    token_data = {
        'code': code,
        'client_id': current_app.config['GOOGLE_CLIENT_ID'],
        'client_secret': current_app.config['GOOGLE_CLIENT_SECRET'],
        'redirect_uri': redirect_uri,
        'grant_type': 'authorization_code'
    }

    try:
        response = requests.post(token_url, data=token_data, timeout=10)
        response.raise_for_status()
        token_response = response.json()

        if 'error' in token_response:
            current_app.logger.error(f"Token exchange error: {token_response}")
            return None, 'token_exchange_failed'

        userinfo_url = 'https://www.googleapis.com/oauth2/v1/userinfo'
        headers = {'Authorization': f"Bearer {token_response['access_token']}"}
        userinfo_response = requests.get(userinfo_url, headers=headers, timeout=10)
        userinfo_response.raise_for_status()
        userinfo = userinfo_response.json()

        if 'error' in userinfo:
            current_app.logger.error(f"User info error: {userinfo}")
            return None, 'user_info_fetch_failed'

        return userinfo, None

    except requests.exceptions.RequestException as e:
        current_app.logger.error(f"OAuth request failed: {str(e)}")
        return None, 'oauth_request_failed'


def set_user_session(user_info):
    """Set user session variables."""
    session['user_id'] = user_info.get('id')
    session['user_email'] = user_info.get('email')
    session['user_name'] = user_info.get('name')
    session.permanent = True


def clear_user_session():
    """Clear user session variables."""
    session.pop('user_id', None)
    session.pop('user_email', None)
    session.pop('user_name', None)


def login_required(f):
    """Decorator to ensure user is logged in."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                return jsonify({'error': 'Unauthorized'}), 401
            return redirect(url_for('login', next=request.url))
        return f(*args, **kwargs)
    return decorated_function
