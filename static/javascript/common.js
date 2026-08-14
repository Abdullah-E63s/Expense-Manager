/**
 * Common JavaScript functions used across the Expense Manager application
 */

/**
 * Toggle password visibility
 * @param {string} inputId - The ID of the password input field
 * @param {HTMLElement} button - The button element that was clicked
 */
function togglePasswordVisibility(inputId, button) {
    const input = document.getElementById(inputId);
    if (input.type === 'password') {
        input.type = 'text';
        button.textContent = '👁️';
    } else {
        input.type = 'password';
        button.textContent = '👁️';
    }
}

/**
 * Get CSRF token from meta tag
 * @returns {string} CSRF token
 */
function getCsrfToken() {
    return document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
}

/**
 * Show a message to the user
 * @param {string|HTMLElement} element - The element or selector to show the message in
 * @param {string} message - The message to display
 * @param {string} type - The type of message (info, success, error, warning)
 */
function showMessage(element, message, type = 'info') {
    const msgElement = typeof element === 'string'
        ? document.querySelector(element)
        : element;

    if (!msgElement) {
        console.warn('Message element not found:', element);
        return;
    }

    // Clear existing classes and content
    msgElement.className = 'msg';

    // Add the appropriate class based on message type
    // Support both msg-type and just type
    msgElement.classList.add(type);
    msgElement.classList.add(`msg-${type}`);

    // Set the message content
    msgElement.textContent = message;
    msgElement.style.display = 'block';

    // Auto-hide after 5 seconds for non-error messages
    if (type !== 'error') {
        setTimeout(() => {
            if (msgElement.textContent === message) {
                msgElement.style.display = 'none';
                msgElement.textContent = '';
                msgElement.className = 'msg';
            }
        }, 5000);
    }
}

/**
 * Handle logout action
 */
function handleLogout() {
    fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || ''
        },
        credentials: 'include'
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                window.location.href = '/';
            } else {
                showMessage('#global-msg', data.message || 'Logout failed', 'error');
            }
        })
        .catch(error => {
            console.error('Logout error:', error);
            showMessage('#global-msg', 'An error occurred during logout', 'error');
        });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Global Action & Processing Loading Screen (Glowing Spinning Logo)
// ═══════════════════════════════════════════════════════════════════════════════

let _loadingTimeout = null;
let _activeRequestsCount = 0;

/**
 * Ensure the loading overlay DOM element exists on the page
 */
function ensureLoadingOverlay() {
    let overlay = document.getElementById('global-loading-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'global-loading-overlay';
        overlay.innerHTML = `
            <div class="loading-card-content">
                <div class="spinner-logo-wrapper">
                    <div class="spinner-logo-pulse"></div>
                    <div class="spinner-logo-ring"></div>
                    <img src="/static/images/logo.png" alt="Expense Manager" class="spinner-logo-img" onerror="this.src='/static/images/logo.png'">
                </div>
                <div id="global-loading-title" class="loading-text-title">Processing...</div>
                <div id="global-loading-sub" class="loading-text-subtitle">Connecting to server, please wait</div>
                <div class="loading-progress-bar"></div>
            </div>
        `;
        document.body.appendChild(overlay);
    }
    return overlay;
}

/**
 * Show the global spinning logo loading overlay
 * @param {string} title - Main loading title
 * @param {string} subtitle - Subtitle or helpful status
 */
function showLoading(title = 'Processing...', subtitle = 'Connecting to server, please wait') {
    const overlay = ensureLoadingOverlay();
    const titleEl = document.getElementById('global-loading-title');
    const subEl = document.getElementById('global-loading-sub');
    
    if (titleEl) titleEl.textContent = title;
    if (subEl) subEl.textContent = subtitle;
    
    overlay.classList.add('active');
    
    // Safety auto-dismiss after 35 seconds to avoid locking the UI permanently
    if (_loadingTimeout) clearTimeout(_loadingTimeout);
    _loadingTimeout = setTimeout(() => {
        hideLoading();
    }, 35000);
}

/**
 * Hide the global spinning logo loading overlay
 */
function hideLoading() {
    const overlay = document.getElementById('global-loading-overlay');
    if (overlay) {
        overlay.classList.remove('active');
    }
    if (_loadingTimeout) {
        clearTimeout(_loadingTimeout);
        _loadingTimeout = null;
    }
}

/**
 * Automatically hook fetch calls to show the loading screen on background actions
 */
function setupGlobalFetchInterceptor() {
    if (window._fetchHooked) return;
    window._fetchHooked = true;

    const originalFetch = window.fetch;
    window.fetch = function(...args) {
        const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
        
        // Skip background heartbeats or analytics polling if any
        const isBackgroundCheck = url.includes('/heartbeat') || url.includes('/analytics/poll');
        
        if (!isBackgroundCheck) {
            _activeRequestsCount++;
            
            let message = 'Processing...';
            let sub = 'Communicating with server';
            
            if (url.includes('/api/yolo/detect') || url.includes('/detect')) {
                message = 'Analyzing Receipt with AI...';
                sub = 'Running God Mode YOLO Neural OCR';
            } else if (url.includes('/api/auth/login') || url.includes('/api/auth/google')) {
                message = 'Signing In...';
                sub = 'Verifying credentials securely';
            } else if (url.includes('/api/expenses')) {
                message = 'Saving Expense...';
                sub = 'Updating your financial records';
            } else if (url.includes('/api/auth/logout')) {
                message = 'Logging Out...';
                sub = 'Clearing session';
            }
            
            showLoading(message, sub);
        }

        return originalFetch.apply(this, args)
            .then(res => {
                if (!isBackgroundCheck) {
                    _activeRequestsCount = Math.max(0, _activeRequestsCount - 1);
                    if (_activeRequestsCount === 0) {
                        hideLoading();
                    }
                }
                return res;
            })
            .catch(err => {
                if (!isBackgroundCheck) {
                    _activeRequestsCount = Math.max(0, _activeRequestsCount - 1);
                    if (_activeRequestsCount === 0) {
                        hideLoading();
                    }
                }
                throw err;
            });
    };
}

/**
 * Auto-attach loading indicators to form submissions and action buttons
 */
function setupActionListeners() {
    ensureLoadingOverlay();
    setupGlobalFetchInterceptor();

    // Attach to standard forms
    document.addEventListener('submit', function(e) {
        const form = e.target;
        if (!form) return;
        
        const formId = form.id || '';
        if (formId === 'login-form') {
            showLoading('Signing In...', 'Verifying your account details');
        } else if (formId === 'signup-form') {
            showLoading('Creating Account...', 'Setting up your secure space');
        } else if (formId === 'expense-form') {
            showLoading('Saving Expense...', 'Adding to your financial log');
        } else if (formId === 'budget-form') {
            showLoading('Updating Budget...', 'Recalculating monthly target');
        } else if (formId.includes('account') || formId.includes('profile')) {
            showLoading('Updating Account...', 'Saving your preferences');
        } else {
            showLoading('Processing...', 'Please wait a moment');
        }
    }, true);

    // Auto-attach to Google button click
    document.addEventListener('click', function(e) {
        const googleBtn = e.target.closest('#google-login-btn') || e.target.closest('#google-signin-btn');
        if (googleBtn) {
            showLoading('Connecting to Google...', 'Redirecting to secure authorization');
        }
    }, true);
}

// Add event listeners when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', function () {
    setupActionListeners();

    // Add logout button event listener if it exists
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn && !logoutBtn.dataset.boundLogout) {
        logoutBtn.addEventListener('click', function() {
            showLoading('Logging out...', 'Securing your session');
            handleLogout();
        });
        logoutBtn.dataset.boundLogout = '1';
    }

    // Add current year to footer if the element exists
    const currentYearElement = document.getElementById('current-year');
    if (currentYearElement) {
        currentYearElement.textContent = new Date().getFullYear();
    }
});

// Make functions available globally
window.togglePasswordVisibility = togglePasswordVisibility;
window.showMessage = showMessage;
window.showLoading = showLoading;
window.hideLoading = hideLoading;
