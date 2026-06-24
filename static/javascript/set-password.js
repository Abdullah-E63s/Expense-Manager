// Set Password JavaScript

document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('set-password-form');
    const passwordInput = document.getElementById('new-password');
    const confirmPasswordInput = document.getElementById('confirm-password');
    const submitBtn = document.getElementById('submit-btn');
    const successMessage = document.getElementById('success-message');
    const errorMessage = document.getElementById('error-message');
    const strengthMeter = document.getElementById('strength-meter');
    const passwordHints = document.querySelectorAll('.hint-item');
    function getResetToken() {
        const fromQuery = new URLSearchParams(window.location.search).get('token');
        if (fromQuery) return fromQuery;
        const hidden = document.getElementById('reset-token');
        return hidden?.value || '';
    }

    const token = getResetToken();
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
    
    // Password requirements
    const requirements = [
        { regex: /.{10,}/, message: 'At least 10 characters' },
        { regex: /[A-Z]/, message: 'At least one uppercase letter' },
        { regex: /[a-z]/, message: 'At least one lowercase letter' },
        { regex: /[0-9]/, message: 'At least one number' },
        { regex: /[^A-Za-z0-9]/, message: 'At least one special character' }
    ];
    
    // Check password strength
    function checkPasswordStrength(password) {
        if (!password) return 0;
        
        let strength = 0;
        const length = password.length;
        
        // Length check
        if (length >= 10) strength += 2;
        else if (length >= 8) strength += 1;
        
        // Check requirements
        const passedRequirements = requirements.filter(req => req.regex.test(password));
        strength += passedRequirements.length;
        
        // Update strength meter
        return Math.min(Math.floor((strength / 7) * 100), 100);
    }
    
    // Update password strength meter
    function updateStrengthMeter(password) {
        const strength = checkPasswordStrength(password);
        const meter = document.getElementById('strength-meter-fill');
        
        if (!meter) return;
        
        meter.style.width = `${strength}%`;
        
        if (strength < 30) {
            meter.className = 'strength-meter-fill strength-weak';
        } else if (strength < 70) {
            meter.className = 'strength-meter-fill strength-medium';
        } else {
            meter.className = 'strength-meter-fill strength-strong';
        }
    }
    
    // Update password hints
    function updatePasswordHints(password) {
        requirements.forEach((req, index) => {
            const hint = passwordHints[index];
            if (!hint) return;
            
            const isValid = req.regex.test(password);
            hint.classList.toggle('valid', isValid);
            
            const icon = hint.querySelector('.hint-icon');
            if (icon) {
                icon.textContent = isValid ? '✓' : '•';
            }
        });
    }
    
    // Toggle password visibility
    function togglePasswordVisibility(inputId) {
        const input = document.getElementById(inputId);
        const toggle = input?.nextElementSibling;
        
        if (!input || !toggle) return;
        
        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        toggle.textContent = isPassword ? '👁️' : '👁️';
        toggle.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
    }
    
    // Show success message
    function showSuccess(message) {
        if (successMessage) {
            successMessage.textContent = message;
            successMessage.classList.add('show');
            
            if (errorMessage) {
                errorMessage.classList.remove('show');
            }
            
            // Auto-hide after 10 seconds
            setTimeout(() => {
                successMessage.classList.remove('show');
            }, 10000);
        }
    }
    
    // Show error message
    function showError(message) {
        if (errorMessage) {
            errorMessage.textContent = message;
            errorMessage.classList.add('show');
            
            if (successMessage) {
                successMessage.classList.remove('show');
            }
            
            // Scroll to error message
            errorMessage.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
    
    // Validate form
    function validateForm() {
        const password = passwordInput.value.trim();
        const confirmPassword = confirmPasswordInput.value.trim();
        
        // Check if passwords match
        if (password !== confirmPassword) {
            showError('Passwords do not match');
            return false;
        }
        
        // Check password strength
        const strength = checkPasswordStrength(password);
        if (strength < 50) {
            showError('Please choose a stronger password');
            return false;
        }
        
        return true;
    }
    
    // Handle form submission
    async function handleSubmit(e) {
        e.preventDefault();
        
        // Validate form
        if (!validateForm()) {
            return;
        }
        
        const password = passwordInput.value.trim();
        
        // Show loading state
        const originalBtnText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.classList.add('btn-loading');
        submitBtn.textContent = 'Updating...';
        
        try {
            // Get token from URL if not already set
            const resetToken = getResetToken();
            
            if (!resetToken) {
                throw new Error('Invalid or expired reset link');
            }
            
            // Send reset password request
            const response = await fetch('/api/auth/reset-password', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                    'X-CSRFToken': csrfToken || ''
                },
                credentials: 'include',
                body: JSON.stringify({
                    token: resetToken,
                    new_password: password
                })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                // Show success message
                showSuccess(data.message || 'Your password has been updated successfully!');
                
                // Reset form
                form.reset();
                
                // Redirect to account (or backend-provided URL) after a brief delay
                const target = data.redirect || '/account';
                setTimeout(() => {
                    window.location.href = target;
                }, 1000);
            } else {
                throw new Error(data.message || 'Failed to update password');
            }
        } catch (error) {
            console.error('Password reset error:', error);
            showError(error.message || 'An error occurred. Please try again.');
        } finally {
            // Reset button state
            submitBtn.disabled = false;
            submitBtn.classList.remove('btn-loading');
            submitBtn.textContent = originalBtnText;
        }
    }
    
    // Event Listeners
    if (passwordInput) {
        passwordInput.addEventListener('input', (e) => {
            updateStrengthMeter(e.target.value);
            updatePasswordHints(e.target.value);
            
            // Clear error message when user starts typing
            if (errorMessage) {
                errorMessage.classList.remove('show');
            }
        });
    }
    
    if (confirmPasswordInput) {
        confirmPasswordInput.addEventListener('input', () => {
            // Clear error message when user starts typing in confirm password
            if (errorMessage) {
                errorMessage.classList.remove('show');
            }
        });
    }
    
    // Toggle password visibility buttons
    document.querySelectorAll('.toggle-password').forEach(button => {
        button.addEventListener('click', (e) => {
            const input = e.target.previousElementSibling;
            if (input && input.type) {
                const isPassword = input.type === 'password';
                input.type = isPassword ? 'text' : 'password';
                e.target.textContent = isPassword ? '👁️' : '👁️';
                e.target.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
            }
        });
    });
    
    // Form submission
    if (form) {
        form.addEventListener('submit', handleSubmit);
    }
    
    // Check token on page load
    if (!token) {
        showError('Invalid or expired reset link. Please request a new password reset link.');
        if (submitBtn) submitBtn.disabled = true;
    }
});
