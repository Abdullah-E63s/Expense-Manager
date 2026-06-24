// Google OAuth2 Configuration
let GOOGLE_CLIENT_ID = "359684919711-q7ehjfbsapj9tenm4h3e4q2f678igong.apps.googleusercontent.com";
let isGoogleInitialized = false;

// Get client ID from server configuration first, fallback to constant
async function getGoogleClientId() {
    try {
        const response = await fetch('/api/auth/config');
        if (response.ok) {
            const data = await response.json();
            if (data && data.googleClientId) {
                GOOGLE_CLIENT_ID = data.googleClientId;
                console.log('Using Google Client ID from server config');
                return GOOGLE_CLIENT_ID;
            }
        } else {
            console.warn('Failed to load /api/auth/config:', response.status, response.statusText);
        }
    } catch (error) {
        console.warn('Error fetching Google Client ID from server:', error);
    }

    // Fallbacks: window.ENV then hardcoded constant
    const envClientId = (window.ENV && window.ENV.GOOGLE_CLIENT_ID) ? window.ENV.GOOGLE_CLIENT_ID : null;
    if (envClientId) {
        GOOGLE_CLIENT_ID = envClientId;
        console.log('Using Google Client ID from window.ENV');
        return GOOGLE_CLIENT_ID;
    }

    if (GOOGLE_CLIENT_ID) {
        console.warn('Using fallback Google Client ID constant');
        return GOOGLE_CLIENT_ID;
    }

    throw new Error('GOOGLE_CLIENT_ID is not configured.');
}

// Initialize Google Identity Services
async function initializeGoogleIdentity() {
    if (isGoogleInitialized) {
        console.log('Google Identity already initialized');
        return true;
    }

    if (!window.google || !window.google.accounts) {
        console.warn('Google Identity Services not loaded, loading now...');
        await loadGoogleIdentityScript();
        // Wait a bit for the script to load
        await new Promise(resolve => setTimeout(resolve, 1000));

        if (!window.google || !window.google.accounts) {
            console.error('Failed to load Google Identity Services');
            showError('Failed to load Google Sign-In. Please refresh the page and try again.');
            return false;
        }
    }

    try {
        const clientId = await getGoogleClientId();
        // Configure Google Sign-In
        google.accounts.id.initialize({
            client_id: clientId,
            callback: handleCredentialResponse,
            auto_select: false,
            ux_mode: 'popup',
            context: 'signin',
            prompt_parent_id: 'google-signin-button',
            itp_support: true,
            login_uri: window.location.origin + '/api/auth/google',
            cancel_on_tap_outside: true
        });

        isGoogleInitialized = true;
        console.log('Google Identity Services initialized successfully');
        return true;
    } catch (error) {
        console.error('Error initializing Google Identity:', error);
        showError('Error initializing Google Sign-In. Please try again.');
        return false;
    }
}

// Show error message function
function showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'alert alert-error';
    errorDiv.textContent = message;

    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        const firstChild = loginForm.firstElementChild;
        if (firstChild) {
            loginForm.insertBefore(errorDiv, firstChild);
        } else {
            loginForm.appendChild(errorDiv);
        }

        // Remove error after 5 seconds
        setTimeout(() => {
            errorDiv.remove();
        }, 5000);
    }

    console.error('Google Auth Error:', message);
}

// Function to get CSRF token from cookies
function getCSRFToken() {
    const cookieValue = document.cookie
        .split('; ')
        .find(row => row.startsWith('csrf_token='))
        ?.split('=')[1];
    return cookieValue || '';
}

// Load Google Identity Services library
function loadGoogleIdentityScript() {
    return new Promise((resolve, reject) => {
        if (window.google && window.google.accounts) {
            console.log('Google Identity Services already loaded');
            resolve();
            return;
        }

        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;

        script.onload = () => {
            console.log('Google Identity Services script loaded');
            resolve();
        };

        script.onerror = (error) => {
            console.error('Failed to load Google Identity Services:', error);
            showError('Failed to load Google Sign-In. Please check your internet connection and try again.');
            reject(new Error('Failed to load Google Identity Services'));
        };

        document.head.appendChild(script);
    });
}
// Initialize Google Sign-In and render button on page load
document.addEventListener('DOMContentLoaded', async () => {
    const googleLoginBtn = document.getElementById('google-login-btn');
    if (!googleLoginBtn) return;

    // Optional: show a subtle initializing text (avoid spinner to keep UI clean)
    const originalHTML = googleLoginBtn.innerHTML;
    try {
        console.log('Initializing Google Sign-In...');
        const isInitialized = await initializeGoogleIdentity();
        if (!isInitialized) throw new Error('Failed to initialize Google Identity Services');

        // Render the Google button into the container
        google.accounts.id.renderButton(
            googleLoginBtn,
            {
                type: 'standard',
                theme: 'outline',
                size: 'large',
                text: 'signin_with',
                shape: 'rectangular',
                logo_alignment: 'left',
                width: googleLoginBtn.offsetWidth || 250
            }
        );
    } catch (error) {
        console.error('Google Sign-In init/render error:', error);
        showError('Failed to load Google Sign-In. Please refresh and try again.');
        // Restore original HTML so user can retry after refresh
        googleLoginBtn.innerHTML = originalHTML || 'Sign in with Google';
    }
});
// Handle the Google Sign-In response
async function handleCredentialResponse(response) {
    const googleLoginBtn = document.getElementById('google-login-btn');
    const msgEl = document.querySelector('#login-msg');
    const originalBtnText = googleLoginBtn?.innerHTML;

    try {
        if (!response || !response.credential) {
            throw new Error('No credential received from Google');
        }

        const idToken = response.credential;
        console.log('Received ID token from Google (first 20 chars):', idToken.substring(0, 20) + '...');

        // Get CSRF token from meta tag or cookie
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || getCSRFToken();

        if (!csrfToken) {
            console.warn('CSRF token not found in meta tag or cookies');
        }

        // Show loading state
        if (msgEl) {
            if (typeof window.showMessage === 'function') {
                window.showMessage(msgEl, 'Verifying your account...', 'info');
            } else {
                showError('Verifying your account...');
            }
        }

        // Send token to backend for verification
        const url = '/api/auth/google';
        const requestBody = {
            id_token: idToken,
            _csrf: csrfToken
        };

        console.log('Sending token to backend for verification...');

        const fetchResponse = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken || ''
            },
            credentials: 'include',
            body: JSON.stringify(requestBody)
        });

        console.log('Received response from server:', {
            status: fetchResponse.status,
            statusText: fetchResponse.statusText
        });

        let data;
        try {
            data = await fetchResponse.json();
            console.log('Response data:', data);
        } catch (jsonError) {
            console.error('Failed to parse JSON response:', jsonError);
            const text = await fetchResponse.text();
            console.error('Raw response:', text);
            throw new Error(`Invalid server response: ${text.substring(0, 100)}...`);
        }

        if (!fetchResponse.ok) {
            const errorMessage = data?.message ||
                data?.error ||
                `Authentication failed with status ${fetchResponse.status}`;
            console.error('Authentication failed:', errorMessage, data);
            throw new Error(errorMessage);
        }

        console.log('Authentication successful, redirecting...');

        // Redirect to dashboard or home page
        if (data.redirect) {
            window.location.href = data.redirect;
        } else {
            window.location.href = '/';
        }

    } catch (error) {
        console.error('Google Sign-In error:', error);
        const errorMessage = error.message || 'Failed to sign in with Google. Please try again.';

        if (msgEl && typeof window.showMessage === 'function') {
            window.showMessage(msgEl, errorMessage, 'error');
        } else {
            showError(errorMessage);
        }
    } finally {
        // Reset button state
        if (googleLoginBtn) {
            googleLoginBtn.disabled = false;
            googleLoginBtn.innerHTML = originalBtnText || 'Sign in with Google';
        }
    }
}
