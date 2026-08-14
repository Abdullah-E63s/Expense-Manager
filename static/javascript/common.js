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
// Global Floating Action HUD Pill (Glowing Spinning Logo - Non-Blocking)
// ═══════════════════════════════════════════════════════════════════════════════

let _loadingTimeout = null;
let _activeRequestsCount = 0;

/**
 * Ensure the non-blocking floating HUD pill DOM element exists on the page
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
                <div class="loading-text-container">
                    <div id="global-loading-title" class="loading-text-title">Processing...</div>
                    <div id="global-loading-sub" class="loading-text-subtitle">Connecting to server</div>
                </div>
                <div class="loading-indicator-badge">
                    <div class="loading-pulse-dot"></div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
    }
    return overlay;
}

/**
 * Show the non-blocking floating action HUD pill with custom title & subtitle
 * @param {string} title - Action description (e.g. "Changing Profile Pic...", "Adding Budget...")
 * @param {string} subtitle - Helpful context (e.g. "Uploading photo", "Saving target")
 * @param {number} autoDismissMs - Optional auto dismiss time in ms
 */
function showLoading(title = 'Processing...', subtitle = 'Connecting to server', autoDismissMs = 25000) {
    const overlay = ensureLoadingOverlay();
    const titleEl = document.getElementById('global-loading-title');
    const subEl = document.getElementById('global-loading-sub');
    
    if (titleEl) titleEl.textContent = title;
    if (subEl) subEl.textContent = subtitle;
    
    overlay.classList.add('active');
    
    // Auto-dismiss safety timer so HUD never stays stuck
    if (_loadingTimeout) clearTimeout(_loadingTimeout);
    if (autoDismissMs > 0) {
        _loadingTimeout = setTimeout(() => {
            hideLoading();
        }, autoDismissMs);
    }
}

/**
 * Hide the floating action HUD pill
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
 * Resolve the exact task name based on request URL and HTTP Method
 */
function resolveTaskMessage(url, options = {}) {
    const method = (options.method || (options.body ? 'POST' : 'GET')).toUpperCase();
    const u = (typeof url === 'string' ? url : (url?.url || '')).toLowerCase();

    // 1. Receipt & AI YOLO OCR
    if (u.includes('/api/yolo/detect') || u.includes('/detect')) {
        return { title: 'Processing Receipt...', sub: 'Running AI YOLO Neural OCR' };
    }

    // 2. Profile Picture / Avatar
    if (u.includes('profile-picture') || u.includes('avatar')) {
        if (method === 'DELETE') {
            return { title: 'Deleting Profile Picture...', sub: 'Resetting to default avatar' };
        }
        return { title: 'Changing Profile Pic...', sub: 'Uploading & updating image' };
    }

    // 3. User Profile & Account
    if (u.includes('/api/auth/account/profile') || u.includes('/api/user/profile')) {
        if (method === 'POST' || method === 'PUT') {
            return { title: 'Updating Profile...', sub: 'Saving account preferences' };
        }
        return { title: 'Opening Account...', sub: 'Loading profile details' };
    }

    if (u.includes('/delete-account') || u.includes('/account/delete') || (u.includes('/api/auth/account') && method === 'DELETE')) {
        return { title: 'Deleting Account...', sub: 'Removing user records' };
    }

    if (u.includes('/change-password') || u.includes('/reset-password') || u.includes('/set-password')) {
        return { title: 'Changing Password...', sub: 'Updating security credentials' };
    }

    if (u.includes('/forgot-password')) {
        return { title: 'Sending Password Reset...', sub: 'Sending recovery link to email' };
    }

    if (u.includes('/send-verification') || u.includes('/verify-code') || u.includes('/verify-email') || u.includes('/resend-code')) {
        return { title: 'Verifying Email...', sub: 'Checking authentication code' };
    }

    // 4. Authentication (Login / Signup / Google / Logout)
    if (u.includes('/api/auth/login')) {
        return { title: 'Signing In...', sub: 'Verifying your credentials' };
    }

    if (u.includes('/api/auth/google')) {
        return { title: 'Signing In with Google...', sub: 'Authenticating with Google OAuth' };
    }

    if (u.includes('/api/auth/signup')) {
        return { title: 'Creating Account...', sub: 'Setting up your new profile' };
    }

    if (u.includes('/api/auth/logout')) {
        return { title: 'Logging Out...', sub: 'Clearing user session' };
    }

    // 5. Budget Management
    if (u.includes('/budget')) {
        if (method === 'DELETE') {
            return { title: 'Deleting Budget...', sub: 'Clearing monthly spending limit' };
        }
        if (method === 'POST' || method === 'PUT') {
            return { title: 'Adding Budget...', sub: 'Setting monthly spending goal' };
        }
        return { title: 'Loading Budget...', sub: 'Recalculating targets' };
    }

    // 6. Expense Management
    if (u.includes('/api/expenses/all') && method === 'DELETE') {
        return { title: 'Deleting All Expenses...', sub: 'Clearing transaction history' };
    }

    if (u.includes('/api/expenses/export') || u.includes('/export')) {
        return { title: 'Exporting Report...', sub: 'Generating file download' };
    }

    if (u.includes('/api/expenses/analytics')) {
        return { title: 'Generating Analytics...', sub: 'Rendering financial trends' };
    }

    if (u.includes('/api/expenses')) {
        if (method === 'POST') {
            return { title: 'Saving Expense...', sub: 'Recording new transaction' };
        }
        if (method === 'PUT' || method === 'PATCH') {
            return { title: 'Updating Expense...', sub: 'Saving modifications' };
        }
        if (method === 'DELETE') {
            return { title: 'Deleting Expense...', sub: 'Removing from transaction log' };
        }
        return { title: 'Loading Expenses...', sub: 'Refreshing transaction records' };
    }

    // 7. Categories
    if (u.includes('/categories')) {
        return { title: 'Updating Categories...', sub: 'Syncing category list' };
    }

    return { title: 'Processing...', sub: 'Communicating with server' };
}

/**
 * Automatically hook fetch calls to show the non-blocking HUD with exact task names
 */
function setupGlobalFetchInterceptor() {
    if (window._fetchHooked) return;
    window._fetchHooked = true;

    const originalFetch = window.fetch;
    window.fetch = function(...args) {
        const url = args[0];
        const options = args[1] || {};
        const urlStr = typeof url === 'string' ? url : (url?.url || '');
        
        // Skip silent background heartbeats or analytics pollers
        const isBackgroundCheck = urlStr.includes('/heartbeat') || urlStr.includes('/poll') || urlStr.includes('/config');
        
        if (!isBackgroundCheck) {
            _activeRequestsCount++;
            const task = resolveTaskMessage(urlStr, options);
            showLoading(task.title, task.sub);
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
 * Auto-attach loading HUD indicators to form submissions, action buttons, and navigation
 */
function setupActionListeners() {
    ensureLoadingOverlay();
    setupGlobalFetchInterceptor();

    // Form submissions
    document.addEventListener('submit', function(e) {
        const form = e.target;
        if (!form) return;
        
        const formId = (form.id || '').toLowerCase();
        if (formId === 'login-form') {
            showLoading('Signing In...', 'Verifying your account details');
        } else if (formId === 'signup-form') {
            showLoading('Creating Account...', 'Setting up your secure profile');
        } else if (formId === 'expense-form') {
            showLoading('Saving Expense...', 'Adding to your financial log');
        } else if (formId === 'budget-form' || formId.includes('budget')) {
            showLoading('Adding Budget...', 'Setting monthly target');
        } else if (formId.includes('profile')) {
            showLoading('Updating Profile...', 'Saving account preferences');
        } else if (formId.includes('password')) {
            showLoading('Changing Password...', 'Applying new security key');
        } else {
            showLoading('Processing...', 'Please wait a moment');
        }
    }, true);

    // Interactive button clicks
    document.addEventListener('click', function(e) {
        const target = e.target;
        if (!target) return;

        // Google login button
        const googleBtn = target.closest('#google-login-btn') || target.closest('#google-signin-btn');
        if (googleBtn) {
            showLoading('Signing In with Google...', 'Connecting to secure authorization');
            return;
        }

        // Avatar change or delete
        const avatarChangeBtn = target.closest('#change-avatar-btn');
        if (avatarChangeBtn) {
            showLoading('Changing Profile Pic...', 'Choose a photo to upload', 6000);
            return;
        }
        const avatarDeleteBtn = target.closest('#delete-avatar-btn');
        if (avatarDeleteBtn) {
            showLoading('Deleting Profile Picture...', 'Resetting to default avatar');
            return;
        }

        // Budget delete
        const budgetDeleteBtn = target.closest('#delete-budget-btn');
        if (budgetDeleteBtn) {
            showLoading('Deleting Budget...', 'Clearing monthly spending limit');
            return;
        }

        // Delete all expenses
        const deleteAllBtn = target.closest('#delete-all-btn');
        if (deleteAllBtn) {
            showLoading('Deleting All Expenses...', 'Clearing transaction records');
            return;
        }

        // Single expense delete or edit
        const expenseDeleteBtn = target.closest('.delete-btn') || target.closest('[data-action="delete"]');
        if (expenseDeleteBtn) {
            showLoading('Deleting Expense...', 'Removing transaction');
            return;
        }
        const expenseEditBtn = target.closest('.edit-btn') || target.closest('[data-action="edit"]');
        if (expenseEditBtn) {
            showLoading('Opening Expense...', 'Loading transaction for editing', 4000);
            return;
        }

        // Navigation links
        const navLink = target.closest('a[href]');
        if (navLink) {
            const href = (navLink.getAttribute('href') || '').toLowerCase();
            if (href === '/account' || href.includes('account.html')) {
                showLoading('Opening Account...', 'Loading profile & preferences');
            } else if (href === '/dashboard' || href === '/') {
                showLoading('Opening Dashboard...', 'Loading financial overview');
            } else if (href.includes('login')) {
                showLoading('Opening Sign In...', 'Loading login form');
            } else if (href.includes('signup')) {
                showLoading('Opening Sign Up...', 'Loading registration form');
            }
        }
    }, true);

    // File input changes (Avatar & Receipt uploads)
    document.addEventListener('change', function(e) {
        const input = e.target;
        if (!input || input.type !== 'file') return;
        
        if (input.id === 'avatar-input') {
            showLoading('Changing Profile Pic...', 'Uploading and updating image');
        } else if (input.id === 'receipt-file' || input.id === 'receipt-input' || input.name === 'receipt') {
            showLoading('Processing Receipt...', 'Running AI YOLO Neural OCR');
        }
    }, true);
}

// ── Web Pull-to-Refresh Gesture for Mobile ──────────────────────────────────
function initPullToRefresh() {
    // Only enable on touch devices
    if (!('ontouchstart' in window) && !navigator.maxTouchPoints) return;

    let startY = 0;
    let currentY = 0;
    let isPulling = false;
    let isRefreshing = false;

    let indicator = document.getElementById('pull-to-refresh-indicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'pull-to-refresh-indicator';
        indicator.innerHTML = `
            <div class="ptr-content">
                <span class="ptr-spinner-dot"></span>
                <span class="ptr-text">Pull to refresh</span>
            </div>
        `;
        document.body.prepend(indicator);
    }

    const ptrText = indicator.querySelector('.ptr-text');

    window.addEventListener('touchstart', (e) => {
        const top = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
        if (top <= 3 && e.touches.length === 1 && !isRefreshing) {
            startY = e.touches[0].pageY;
            isPulling = true;
        } else {
            isPulling = false;
        }
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
        if (!isPulling || isRefreshing) return;
        currentY = e.touches[0].pageY;
        const diff = currentY - startY;
        const top = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;

        if (diff > 8 && top <= 3) {
            const pullDistance = Math.min(diff * 0.42, 65);
            indicator.style.transform = `translateX(-50%) translateY(${pullDistance}px)`;
            indicator.style.opacity = `${Math.min(pullDistance / 25, 1)}`;

            if (pullDistance >= 40) {
                if (ptrText) ptrText.textContent = 'Release to refresh';
                indicator.classList.add('ptr-ready');
            } else {
                if (ptrText) ptrText.textContent = 'Pull to refresh';
                indicator.classList.remove('ptr-ready');
            }
        }
    }, { passive: true });

    window.addEventListener('touchend', async () => {
        if (!isPulling || isRefreshing) return;
        const diff = currentY - startY;
        isPulling = false;

        const top = window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
        if (diff * 0.42 >= 40 && top <= 3) {
            isRefreshing = true;
            indicator.style.transform = 'translateX(-50%) translateY(30px)';
            indicator.style.opacity = '1';
            indicator.classList.add('ptr-refreshing');
            if (ptrText) ptrText.textContent = 'Refreshing...';

            if (typeof showLoading === 'function') {
                showLoading('Refreshing App...', 'Syncing latest data');
            }

            try {
                if (typeof window.loadExpenses === 'function') {
                    await window.loadExpenses();
                    if (typeof window.loadAnalytics === 'function') await window.loadAnalytics();
                    if (typeof window.loadBudget === 'function') await window.loadBudget();
                    setTimeout(() => {
                        indicator.style.transform = 'translateX(-50%) translateY(-80px)';
                        indicator.style.opacity = '0';
                        indicator.classList.remove('ptr-refreshing', 'ptr-ready');
                        isRefreshing = false;
                        if (typeof hideLoading === 'function') hideLoading();
                    }, 400);
                } else {
                    window.location.reload();
                }
            } catch (_) {
                window.location.reload();
            }
        } else {
            indicator.style.transform = 'translateX(-50%) translateY(-80px)';
            indicator.style.opacity = '0';
            indicator.classList.remove('ptr-ready');
        }
        startY = 0;
        currentY = 0;
    }, { passive: true });
}

// Add event listeners when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', function () {
    setupActionListeners();
    initPullToRefresh();

    // Add logout button event listener if it exists
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn && !logoutBtn.dataset.boundLogout) {
        logoutBtn.addEventListener('click', function() {
            showLoading('Logging Out...', 'Clearing session securely');
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
window.initPullToRefresh = initPullToRefresh;


