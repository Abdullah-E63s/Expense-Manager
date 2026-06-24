// Forgot Password JavaScript
document.addEventListener('DOMContentLoaded', function() {
    // Get form elements
    const form = document.getElementById('forgot-password-form');
    if (!form) return; // Exit if no form found
    
    const emailInput = document.getElementById('email');
    const submitBtn = form.querySelector('button[type="submit"]');
    const successEl = document.getElementById('success-message');
    const errorEl = document.getElementById('error-message');
    const backToLogin = document.querySelector('.back-to-login');
    
    // CSRF token handling
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
    if (csrfToken) {
        // Remove any existing CSRF token input
        const existingCsrf = form.querySelector('input[name="_csrf_token"]');
        if (existingCsrf) existingCsrf.remove();
        
        // Add CSRF token to form
        const csrfInput = document.createElement('input');
        csrfInput.type = 'hidden';
        csrfInput.name = '_csrf_token';
        csrfInput.value = csrfToken;
        form.appendChild(csrfInput);
    }
    
    // Email validation helper
    function isValidEmail(email) {
        const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return re.test(String(email).toLowerCase());
    }
    
    // Show message helper
    function showMessage(message, type = 'info') {
        // Hide both first
        if (successEl) {
            successEl.textContent = '';
            successEl.style.display = 'none';
        }
        if (errorEl) {
            errorEl.textContent = '';
            errorEl.style.display = 'none';
        }
        
        if (type === 'clear') return;
        
        if (type === 'success' && successEl) {
            successEl.textContent = message;
            successEl.style.display = 'block';
        } else if (errorEl) {
            errorEl.textContent = message;
            errorEl.style.display = 'block';
        }
    }
    
    // CSRF helper (DRY)
    function getCsrfToken() {
        const meta = document.querySelector('meta[name="csrf-token"]');
        return meta ? meta.content : '';
    }
  
    // Handle form submission
    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const email = emailInput.value.trim();
        
        // Basic email validation
        if (!isValidEmail(email)) {
            showMessage('Please enter a valid email address', 'error');
            emailInput.focus();
            return;
        }
        
        // Show loading state
        const originalBtnText = submitBtn.innerHTML;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Sending...';
        
        // Hide any previous messages
        showMessage('', 'clear');
        
        let didSucceed = false;
        try {
            // Send reset password request
            const response = await fetch('/api/auth/forgot-password', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Accept': 'application/json',
                    'X-CSRFToken': getCsrfToken()
                },
                credentials: 'include',
                body: JSON.stringify({ email })
            });
            
            // Read response once and parse it
            const responseText = await response.text();
            let data;
            
            try {
                data = responseText ? JSON.parse(responseText) : {};
            } catch (e) {
                console.error('Failed to parse JSON response:', responseText);
                throw new Error('Invalid response from server');
            }
            
            if (response.ok) {
                // Show success message
                showMessage(
                    data.message || 'If an account exists with this email, password reset instructions have been sent.', 
                    'success'
                );
                didSucceed = true;
                
                // In development, the backend may include a direct reset link
                // if (data.dev_reset_link && successEl) {
                //     const info = document.createElement('div');
                //     info.style.marginTop = '8px';
                //     info.innerHTML = `Dev reset link: <a href="${data.dev_reset_link}">Open reset page</a>`;
                //     successEl.appendChild(info);
                // }
                
                // Clear the form
                form.reset();
                
                // Show back to login link if it exists
                if (backToLogin) {
                    backToLogin.style.display = 'block';
                }
                
                // Disable the form after successful submission
                submitBtn.disabled = true;
                emailInput.disabled = true;
                
            } else {
                // Show error message from server or fallback
                const errorMsg = data.message || 
                               (data.error && data.error.message) || 
                               'Failed to process your request. Please try again.';
                throw new Error(errorMsg);
            }
            
        } catch (error) {
            console.error('Password reset error:', error);
            
            // User-friendly error messages
            let errorMessage = 'An error occurred while processing your request. Please try again.';
            
            if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
                errorMessage = 'Unable to connect to the server. Please check your internet connection and try again.';
            } else if (error.message) {
                errorMessage = error.message;
            }
            
            showMessage(errorMessage, 'error');
            
        } finally {
            // Reset button state
            if (submitBtn) {
                if (!didSucceed) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = originalBtnText;
                } else {
                    submitBtn.disabled = true;
                    submitBtn.innerHTML = 'Email Sent';
                }
            }
        }
    });
});
