/**
 * login.js - Handles login form functionality for the Expense Manager application
 */

/**
 * Gets a cookie by name
 * @param {string} name - The name of the cookie to get
 * @returns {string|null} The cookie value or null if not found
 */
function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
}

document.addEventListener('DOMContentLoaded', function() {
    // Add event listener for login form
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }

// Expose for other modules (e.g., google-auth.js)
window.showMessage = showMessage;
    
    // Add event listener for password visibility toggle
    document.querySelectorAll('.show-password-btn').forEach(button => {
        button.addEventListener('click', function() {
            const inputId = this.getAttribute('data-input-id') || 'login-password';
            togglePasswordVisibility(inputId, this);
        });
    });
    
    // Handle logo error
    const logo = document.getElementById('logo');
    if (logo) {
        logo.addEventListener('error', function() {
            this.style.display = 'none';
        });
    }
});

/**
 * Toggles the visibility of a password field
 * @param {string} inputId - The ID of the password input field
 * @param {HTMLElement} button - The button element that was clicked
 */
function togglePasswordVisibility(inputId, button) {
    const input = document.getElementById(inputId);
    if (!input) return;
    
    if (input.type === 'password') {
        input.type = 'text';
        button.textContent = 'ðŸ‘ï¸';
    } else {
        input.type = 'password';
        button.textContent = 'ðŸ‘ï¸';
    }
}

/**
 * Shows a message to the user
 * @param {string|HTMLElement} element - The element or selector to show the message in
 * @param {string} message - The message to display
 * @param {string} type - The type of message (info, success, error, warning)
 */
function showMessage(element, message, type = 'info') {
    let targetElement;
    
    // Handle both element and selector
    if (typeof element === 'string') {
        targetElement = document.querySelector(element);
        if (!targetElement) {
            console.error(`Element not found: ${element}`);
            return;
        }
    } else if (element instanceof Element) {
        targetElement = element;
    } else {
        console.error('Invalid element provided to showMessage');
        return;
    }
    
    targetElement.textContent = message;
    targetElement.className = 'msg';
    
    // Add type class if provided
    if (type) {
        targetElement.classList.add(type);
    }
    
    // Auto-hide after 5 seconds for non-error messages
    if (type !== 'error') {
        setTimeout(() => {
            targetElement.textContent = '';
            targetElement.className = 'msg';
        }, 5000);
    }
}

/**
 * Handles the login form submission
 * @param {Event} event - The form submission event
 */

async function handleLogin(event) {
    event.preventDefault();
    
    const form = event.target;
    const formData = new FormData(form);
    const submitBtn = form.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn.textContent;
    
    // Get form data
    const formObject = {};
    formData.forEach((value, key) => {
        formObject[key] = value.trim();
    });
    
    // Get CSRF token from meta tag or form input
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || 
                     form.querySelector('input[name="csrf_token"]')?.value ||
                     getCookie('csrf_token');
    
    if (!csrfToken) {
        console.error('CSRF token not found');
        showMessage('#login-msg', 'Security error. Please refresh the page and try again.', 'error');
        return;
    }
    
    const { email, password } = formObject;
    
    // Basic validation
    if (!email || !password) {
        showMessage('#login-msg', 'Please enter both email and password', 'error');
        return;
    }
    
    // Show loading state
    submitBtn.disabled = true;
    submitBtn.textContent = 'Logging in...';
    
    try {
        // Always call the API login endpoint
        const action = '/api/auth/login';
        console.log('Sending login request to:', action, { email: email.substring(0, 3) + '...' });

        const recaptcha_token = typeof window.getRecaptchaToken === 'function'
            ? await window.getRecaptchaToken('login')
            : null;
        if (recaptcha_token) {
            console.log('[reCAPTCHA] login token acquired');
        } else {
            console.warn('[reCAPTCHA] login token missing');
        }

        const response = await fetch(action, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                'X-CSRFToken': csrfToken
            },
            credentials: 'include',
            body: JSON.stringify({ 
                email, 
                password, 
                recaptcha_token,
                csrf_token: csrfToken 
            })
        });
        
        let data;
        try {
            data = await response.json();
            console.log('Login response status:', response.status, data);
        } catch (e) {
            console.error('Error parsing response:', e);
            throw new Error('Invalid server response. Please try again.');
        }
        
        if (!response.ok) {
            // Handle specific error cases
            if (response.status === 401) {
                throw new Error('Invalid email or password');
            } else if (response.status === 403) {
                // Special case: account created via Google Sign-In (no password set)
                if (data && data.google_user) {
                    throw new Error("This account uses Google Sign-In. Click 'Sign in with Google' or reset your password to set one.");
                }
                throw new Error(data.error || 'Account not active. Please check your email for verification.');
            } else {
                throw new Error(data.error || `Login failed with status ${response.status}`);
            }
        }


        
        // Login successful
        showMessage('#login-msg', 'Login successful! Redirecting...', 'success');
        
        // Store user data in localStorage if needed
        if (data.user) {
            localStorage.setItem('user', JSON.stringify(data.user));
        }
        
        // Redirect to dashboard (use API_BASE for cross-domain Vercel â†’ HF)
        window.location.href = '/dashboard';
        
    } catch (error) {
        console.error('Login error:', error);
        
        // More specific error messages
        let errorMessage = 'An error occurred during login. Please try again.';
        
        if (error.message.includes('Failed to fetch')) {
            errorMessage = 'Unable to connect to the server. Please check your internet connection.';
        } else if (error.message.includes('Invalid server response')) {
            errorMessage = 'Invalid response from server. Please try again.';
        } else if (error.message) {
            errorMessage = error.message;
        }
        
        showMessage('#login-msg', errorMessage, 'error');
    } finally {
        // Re-enable the submit button
        submitBtn.disabled = false;
        submitBtn.textContent = originalBtnText;
    }
}
