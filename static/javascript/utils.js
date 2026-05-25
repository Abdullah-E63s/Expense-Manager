/**
 * Utility functions for the Expense Manager application
 */

// Global configuration
const CONFIG = {
    VERSION: '1.0.0',
    ENV: {}
};

/**
 * Initialize application configuration
 * @param {Object} env - Environment variables from the server
 */
function initConfig(env) {
    // Merge with default values
    CONFIG.ENV = {
        GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID || '359684919711-q7ehjfbsapj9tenm4h3e4q2f678igong.apps.googleusercontent.com',
        FIREBASE_PROJECT_ID: env.FIREBASE_PROJECT_ID || 'expense-2-63a15',
        ...env
    };
    
    console.log('Application configuration initialized:', CONFIG.ENV);
    return CONFIG.ENV;
}

/**
 * Add cache-busting version to static resources
 */
function setupCacheBusting() {
    const version = CONFIG.VERSION;
    
    // Add version to all static resources
    const updateResource = (element, attr) => {
        const url = element.getAttribute(attr);
        if (url && url.includes('/static/') && !url.includes('?')) {
            element.setAttribute(attr, `${url}?v=${version}`);
        }
    };
    
    // Process existing elements
    document.querySelectorAll('script[src*="/static/"]').forEach(el => updateResource(el, 'src'));
    document.querySelectorAll('link[href*="/static/"]').forEach(el => updateResource(el, 'href'));
    document.querySelectorAll('img[src*="/static/"]').forEach(el => updateResource(el, 'src'));
    
    // Watch for dynamically added elements
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === 1) { // Element node
                    if (node.matches('script[src*="/static/"]')) {
                        updateResource(node, 'src');
                    } else if (node.matches('link[href*="/static/"]')) {
                        updateResource(node, 'href');
                    } else if (node.matches('img[src*="/static/"]')) {
                        updateResource(node, 'src');
                    }
                    // Check child elements
                    node.querySelectorAll('script[src*="/static/"]').forEach(el => updateResource(el, 'src'));
                    node.querySelectorAll('link[href*="/static/"]').forEach(el => updateResource(el, 'href'));
                    node.querySelectorAll('img[src*="/static/"]').forEach(el => updateResource(el, 'src'));
                }
            });
        });
    });
    
    // Start observing the document with the configured parameters
    observer.observe(document.documentElement, { 
        childList: true, 
        subtree: true 
    });
}

/**
 * Initialize the application
 * @param {Object} env - Environment variables from the server
 */
function initApp(env) {
    // Initialize configuration
    initConfig(env);
    
    // Setup cache busting for static resources
    setupCacheBusting();
    
    // Make config available globally
    window.APP_CONFIG = CONFIG.ENV;
    
    console.log('Application initialized');
}

// Export for use in other modules
export {
    CONFIG,
    initApp,
    initConfig,
    setupCacheBusting
};

function getMeta(name) {
    const el = document.querySelector(`meta[name="${name}"]`);
    return el ? el.getAttribute('content') : '';
}

async function getRecaptchaToken(action = 'submit') {
    try {
        const enabledRaw = getMeta('recaptcha-enabled') || getMeta('RECAPTCHA_ENABLED');
        const enabled = String(enabledRaw || '').toLowerCase() === 'true';
        const siteKey = getMeta('recaptcha-site-key') || getMeta('RECAPTCHA_SITE_KEY');
        if (!enabled || !siteKey) {
            console.log('[reCAPTCHA] Disabled or site key missing');
            return null;
        }
        if (!window.grecaptcha) {
            console.warn('[reCAPTCHA] Library not loaded');
            return null;
        }
        const gre = window.grecaptcha.enterprise || window.grecaptcha;
        return await new Promise((resolve) => {
            try {
                gre.ready(function() {
                    gre.execute(siteKey, { action }).then(function(token) {
                        console.log(`[reCAPTCHA] Token acquired for action "${action}" (length=${(token||'').length})`);
                        resolve(token);
                    }).catch(function(err) {
                        console.warn('[reCAPTCHA] execute failed', err);
                        resolve(null);
                    });
                });
            } catch (e) {
                console.warn('[reCAPTCHA] ready/execute error', e);
                resolve(null);
            }
        });
    } catch (e) {
        console.warn('[reCAPTCHA] Error obtaining token', e);
        return null;
    }
}

window.getRecaptchaToken = getRecaptchaToken;
