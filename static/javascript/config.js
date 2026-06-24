/**
 * config.js — Central API configuration for Expense Manager frontend.
 *
 * When hosted on Vercel (separate domain from the Flask backend on HF Spaces),
 * all fetch() calls must use the full absolute URL of the backend.
 *
 * HOW IT WORKS:
 *  - On Vercel (or any external host): API_BASE_URL = "https://ghost993-expensemanager.hf.space"
 *  - When running locally on same origin (Flask dev server): API_BASE_URL = "" (relative URLs)
 *
 * All JS files use `window.API_BASE` as the prefix for every fetch() call.
 */
(function () {
    // Detect if we are running on the same origin as the Flask backend.
    // If yes, use relative URLs (works with local dev + Flask-served templates).
    // If on a different domain (Vercel etc.), point to the HF Space backend.
    const HF_BACKEND = 'https://ghost993-expensemanager.hf.space';

    const isSameOrigin =
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1' ||
        window.location.hostname.endsWith('.hf.space');

    window.API_BASE = isSameOrigin ? '' : HF_BACKEND;

    /**
     * apiFetch — drop-in replacement for fetch() that:
     *  1. Prepends API_BASE to relative paths
     *  2. Always sends credentials (cookies) for session auth
     *  3. Reads the CSRF token from the meta tag automatically
     */
    window.apiFetch = function (path, options) {
        options = options || {};

        // Prepend base URL if path is relative
        const url = path.startsWith('http') ? path : (window.API_BASE + path);

        // Always send cookies for cross-domain session auth
        options.credentials = options.credentials || 'include';

        // Auto-inject CSRF token header
        const csrfToken =
            document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';

        if (csrfToken) {
            options.headers = options.headers || {};
            options.headers['X-CSRFToken'] = options.headers['X-CSRFToken'] || csrfToken;
        }

        return fetch(url, options);
    };

    console.log('[Config] API_BASE =', window.API_BASE || '(same-origin)');
})();
