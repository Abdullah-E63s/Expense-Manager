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

// Add event listeners when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', function () {
    // Add logout button event listener if it exists
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn && !logoutBtn.dataset.boundLogout) {
        logoutBtn.addEventListener('click', handleLogout);
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
