// Signup Page JavaScript

// Global variables
let resendTimer;
const CODE_EXPIRATION_SECONDS = 60;

// Make sure CSRF token is available
function getCSRFToken() {
    return document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
}

// Email validator (DRY helper)
function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
}

document.addEventListener('DOMContentLoaded', function() {
    // Initialize form elements
    const signupForm = document.getElementById('signup-form');
    const emailInput = document.getElementById('signup-email');
    const verificationCodeInput = document.getElementById('verification-code');
    const passwordInput = document.getElementById('signup-password');
    const confirmPasswordInput = document.getElementById('confirm-password');
    const sendVerificationBtn = document.getElementById('send-verification');
    const resendCodeBtn = document.getElementById('resend-code');
    const msgEl = document.getElementById('signup-msg');
    const passwordHint = document.getElementById('password-hint');
    const confirmPasswordHint = document.getElementById('confirm-password-hint');
    // Toggle password visibility
    function togglePassword(inputId) {
        const input = document.getElementById(inputId);
        if (!input) return;
        const type = input.type === 'password' ? 'text' : 'password';
        input.type = type;
    }

    // Make togglePassword available globally for inline handlers
    window.togglePassword = togglePassword;

    // Show message helper function
    function showMessage(element, message, type = 'info') {
        if (!element) return;
        element.textContent = message;
        element.className = 'msg ' + type;
        if (type !== 'error') {
            setTimeout(() => {
                element.textContent = '';
                element.className = 'msg';
            }, 5000);
        }
    }

    // Make showMessage available globally
    window.showMessage = showMessage;

    // Check password strength
    function checkPasswordStrength(password) {
        const hasMinLength = password.length >= 10;
        const hasUppercase = /[A-Z]/.test(password);
        const hasLowercase = /[a-z]/.test(password);
        const hasNumbers = /\d/.test(password);
        const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);
        
        let strength = 0;
        if (hasMinLength) strength++;
        if (hasUppercase) strength++;
        if (hasLowercase) strength++;
        if (hasNumbers) strength++;
        if (hasSpecial) strength++;
        
        return {
            strength,
            hasMinLength,
            hasUppercase,
            hasLowercase,
            hasNumbers,
            hasSpecial
        };
    }

    // Update password strength UI
    function updatePasswordStrength(password) {
        if (!password) {
            passwordHint.innerHTML = '';
            return 0;
        }
        
        const { strength, ...checks } = checkPasswordStrength(password);
        
        let strengthText = '';
        let strengthClass = '';
        
        if (strength <= 2) {
            strengthText = 'Weak';
            strengthClass = 'error';
        } else if (strength <= 4) {
            strengthText = 'Moderate';
            strengthClass = 'warning';
        } else {
            strengthText = 'Strong';
            strengthClass = 'success';
        }
        
        passwordHint.innerHTML = `
            <div>Password Strength: <span class="${strengthClass}">${strengthText}</span></div>
            <div class="password-requirements">
                <div class="${checks.hasMinLength ? 'valid' : 'invalid'}">At least 10 characters</div>
                <div class="${checks.hasUppercase ? 'valid' : 'invalid'}">Uppercase letter (A-Z)</div>
                <div class="${checks.hasLowercase ? 'valid' : 'invalid'}">Lowercase letter (a-z)</div>
                <div class="${checks.hasNumbers ? 'valid' : 'invalid'}">Number (0-9)</div>
                <div class="${checks.hasSpecial ? 'valid' : 'invalid'}">Special character (!@#$%^&*)</div>
            </div>
        `;
        
        return strength;
    }

    // Check if passwords match
    function checkPasswordsMatch() {
        const password = passwordInput.value;
        const confirmPassword = confirmPasswordInput.value;
        
        if (!confirmPassword) {
            confirmPasswordHint.textContent = '';
            return false;
        }
        
        if (password === confirmPassword) {
            confirmPasswordHint.textContent = 'Passwords match';
            confirmPasswordHint.className = 'msg success';
            return true;
        } else {
            confirmPasswordHint.textContent = 'Passwords do not match';
            confirmPasswordHint.className = 'msg error';
            return false;
        }
    }

    // Enable/disable form elements based on verification status
    function updateFormState(isVerified) {
        verificationCodeInput.disabled = isVerified;
        passwordInput.disabled = !isVerified;
        confirmPasswordInput.disabled = !isVerified;
        signupForm.querySelector('button[type="submit"]').disabled = !isVerified;
        
        if (isVerified) {
            sendVerificationBtn.textContent = 'Verified ✓';
            sendVerificationBtn.disabled = true;
            if (resendCodeBtn) resendCodeBtn.style.display = 'none';
        } else {
            sendVerificationBtn.textContent = 'Send Code';
            sendVerificationBtn.disabled = false;
            if (resendCodeBtn) resendCodeBtn.style.display = 'inline-block';
        }
    }

    // Send verification code
async function sendVerificationCode() {
    const email = emailInput.value.trim();
    if (!email) {
        showMessage(msgEl, 'Please enter your email address', 'error');
        return;
    }
    if (!isValidEmail(email)) {
        showMessage(msgEl, 'Please enter a valid email address', 'error');
        return;
    }

    try {
        // Show loading state on button
        const originalText = sendVerificationBtn.textContent;
        sendVerificationBtn.disabled = true;
        sendVerificationBtn.innerHTML = '<span class="spinner-border spinner-border-sm" aria-hidden="true"></span> Sending...';

        const recaptcha_token = typeof window.getRecaptchaToken === 'function'
            ? await window.getRecaptchaToken('send_verification')
            : null;

        const response = await fetch('/api/auth/send-verification', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCSRFToken(),
                'Accept': 'application/json'
            },
            body: JSON.stringify({ email, recaptcha_token }),
            credentials: 'include'
        });


        const data = await response.json();
        
        if (!response.ok || data.success === false) {
            throw new Error(data.error || 'Failed to send verification code');
        }
        
        showMessage(msgEl, 'Verification code sent to your email', 'success');
        verificationCodeInput.disabled = false;
        passwordInput.disabled = false;
        confirmPasswordInput.disabled = false;
        sendVerificationBtn.disabled = true;
        sendVerificationBtn.textContent = 'Code Sent';
        startResendTimer();
        
    } catch (error) {
        console.error('Error sending verification code:', error);
        showMessage(msgEl, error.message || 'Failed to send verification code. Please try again.', 'error');
        // Restore button state
        sendVerificationBtn.disabled = false;
        sendVerificationBtn.textContent = 'Send Code';
    }
    }

    // Verify the code
    async function verifyCode(code) {
        const email = emailInput.value.trim();

        if (!email || !code) {
            showMessage(msgEl, 'Email and verification code are required', 'error');
            return false;
        }
        
        try {
            const recaptcha_token = typeof window.getRecaptchaToken === 'function'
                ? await window.getRecaptchaToken('verify_code')
                : null;
            const response = await fetch('/api/auth/verify-code', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCSRFToken(),
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    email: emailInput.value.trim(),
                    code: code,
                    recaptcha_token
                }),
                credentials: 'include'
            });

            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Verification failed');
            }
            
            showMessage(msgEl, 'Email verified successfully!', 'success');
            return true;
            
        } catch (error) {
            console.error('Error verifying code:', error);
            showMessage(msgEl, error.message || 'Failed to verify code. Please try again.', 'error');
            return false;
        }
    }

    // Start resend cooldown timer (60s)
    function startResendTimer() {
        if (!resendCodeBtn) return;
        let remaining = CODE_EXPIRATION_SECONDS;
        resendCodeBtn.disabled = true;
        resendCodeBtn.style.display = 'inline-block';
        resendCodeBtn.textContent = `Resend (${remaining}s)`;
        clearInterval(resendTimer);
        resendTimer = setInterval(() => {
            remaining -= 1;
            if (remaining <= 0) {
                clearInterval(resendTimer);
                resendCodeBtn.disabled = false;
                resendCodeBtn.textContent = 'Resend Code';
            } else {
                resendCodeBtn.textContent = `Resend (${remaining}s)`;
            }
        }, 1000);
    }

    // Handle form submission
    if (signupForm) {
        signupForm.addEventListener('submit', async function(event) {
            event.preventDefault();
            
            // Get form data
            const formData = new FormData(signupForm);
            const submitBtn = signupForm.querySelector('button[type="submit"]');
            const originalBtnText = submitBtn.textContent;
            
            // Show loading state
            submitBtn.disabled = true;
            submitBtn.textContent = 'Creating Account...';
            
            try {
                // Get reCAPTCHA token dynamically
                let recaptcha_token = '';
                if (typeof window.getRecaptchaToken === 'function') {
                    recaptcha_token = await window.getRecaptchaToken('signup');
                }
                if (!recaptcha_token && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
                    throw new Error('Failed to verify you are human. Please try again.');
                }

                // Prepare the request data
                const requestData = {
                    email: formData.get('email'),
                    verification_code: formData.get('verification_code'),
                    password: formData.get('password'),
                    confirm_password: formData.get('confirm_password'),
                    recaptcha_token: recaptcha_token,
                    csrf_token: getCSRFToken()
                };

                console.log('Sending signup request:', {
                    ...requestData,
                    password: '***',
                    confirm_password: '***',
                    recaptcha_token: recaptcha_token ? '***' : 'missing'
                });

                const response = await fetch(signupForm.action || '/api/auth/signup', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'X-Requested-With': 'XMLHttpRequest'
                    },
                    body: JSON.stringify(requestData),
                    credentials: 'include'
                });
                
                let data;
                try {
                    data = await response.json();
                    console.log('Signup response:', data);
                } catch (e) {
                    console.error('Error parsing response:', e);
                    throw new Error('Invalid server response');
                }
                
                if (!response.ok) {
                    throw new Error(data.error || `Signup failed with status ${response.status}`);
                }
                
                // Signup successful
                showMessage('#signup-msg', 'Account created successfully! Redirecting...', 'success');
                
                // Redirect to login or dashboard
                setTimeout(() => {
                    window.location.href = '/';
                }, 1500);
                
            } catch (error) {
                console.error('Signup error:', error);
                showMessage('#signup-msg', 
                    error.message || 'An error occurred during signup. Please try again.', 
                    'error'
                );
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = originalBtnText;
            }
        });
    }
    
    // Enable send verification button when valid email is present (including autofill)
    if (emailInput && sendVerificationBtn) {
        const refreshSendState = () => {
            const email = emailInput.value.trim();
            sendVerificationBtn.disabled = !isValidEmail(email);
        };
        // Initial check (handles autofill)
        refreshSendState();
        emailInput.addEventListener('input', refreshSendState);
        emailInput.addEventListener('change', refreshSendState);
        emailInput.addEventListener('blur', refreshSendState);
        // Also re-check after a short delay to handle late autofill
        setTimeout(refreshSendState, 300);
    }
    // Bind UI events
    if (sendVerificationBtn) {
        sendVerificationBtn.addEventListener('click', sendVerificationCode);
    }
    if (resendCodeBtn) {
        resendCodeBtn.addEventListener('click', sendVerificationCode);
    }
    if (verificationCodeInput) {
        verificationCodeInput.addEventListener('input', async (e) => {
            const code = e.target.value.trim();
            if (code.length >= 6) {
                const ok = await verifyCode(code);
                if (ok) updateFormState(true);
            }
        });
    }
    if (passwordInput) {
        passwordInput.addEventListener('input', (e) => {
            updatePasswordStrength(e.target.value);
            checkPasswordsMatch();
        });
    }
    if (confirmPasswordInput) {
        confirmPasswordInput.addEventListener('input', checkPasswordsMatch);
    }
}); // End of DOMContentLoaded
