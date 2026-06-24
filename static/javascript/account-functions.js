// Account Page JavaScript
document.addEventListener('DOMContentLoaded', function() {
    // DOM Elements
    const changePasswordForm = document.getElementById('change-password-form');
    const emailPreferencesForm = document.getElementById('email-preferences');
    const deleteAccountBtn = document.getElementById('delete-account-btn');
    const deleteModal = document.getElementById('delete-account-modal');
    const closeModal = document.querySelector('.close-modal');
    const cancelDelete = document.getElementById('cancel-delete');
    const confirmDelete = document.getElementById('confirm-delete');
    const confirmEmail = document.getElementById('confirm-email');
    const currentPasswordInput = document.getElementById('current-password');
    const newPasswordInput = document.getElementById('new-password');
    const confirmPasswordInput = document.getElementById('confirm-password');
    const msgElement = document.getElementById('account-msg');
    
    // CSRF Token
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
    
    // Initialize the page
    initAccountPage();
    
    // Event Listeners
    if (changePasswordForm) {
        changePasswordForm.addEventListener('submit', handleChangePassword);
    }
    
    if (emailPreferencesForm) {
        emailPreferencesForm.addEventListener('submit', handleEmailPreferences);
    }
    
    if (deleteAccountBtn) {
        deleteAccountBtn.addEventListener('click', showDeleteModal);
    }
    
    if (closeModal) closeModal.addEventListener('click', hideDeleteModal);
    if (cancelDelete) cancelDelete.addEventListener('click', hideDeleteModal);
    
    // Close modal when clicking outside
    window.addEventListener('click', (e) => {
        if (e.target === deleteModal) {
            hideDeleteModal();
        }
    });
    
    // Enable/disable delete button based on email confirmation
    if (confirmEmail) {
        confirmEmail.addEventListener('input', updateDeleteButtonState);
    }
    
    // Toggle password visibility
    document.querySelectorAll('.toggle-password').forEach(button => {
        button.addEventListener('click', function() {
            const input = this.previousElementSibling;
            const isPassword = input.type === 'password';
            input.type = isPassword ? 'text' : 'password';
            this.textContent = isPassword ? '👁️' : '👁️';
            this.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
        });
    });
    
    // Password strength indicator
    if (newPasswordInput) {
        newPasswordInput.addEventListener('input', updatePasswordStrength);
    }
    
    // Initialize functions
    function initAccountPage() {
        // Load any saved preferences
        loadUserPreferences();
        
        // Set up any initial UI states
        if (confirmEmail) {
            updateDeleteButtonState();
        }
    }
    
    // Handle change password form submission
    async function handleChangePassword(e) {
        e.preventDefault();
        
        const currentPassword = currentPasswordInput.value.trim();
        const newPassword = newPasswordInput.value.trim();
        const confirmPassword = confirmPasswordInput.value.trim();
        
        // Validate form
        if (!currentPassword || !newPassword || !confirmPassword) {
            showMessage('Please fill in all fields', 'error');
            return;
        }
        
        if (newPassword !== confirmPassword) {
            showMessage('New passwords do not match', 'error');
            return;
        }
        
        if (newPassword.length < 8) {
            showMessage('Password must be at least 8 characters long', 'error');
            return;
        }
        
        // Show loading state
        const submitBtn = changePasswordForm.querySelector('button[type="submit"]');
        const originalBtnText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.classList.add('btn-loading');
        submitBtn.textContent = 'Updating...';
        
        try {
            const response = await fetch('/api/account/change-password', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfToken || ''
                },
                body: JSON.stringify({
                    currentPassword,
                    newPassword
                })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                showMessage('Password updated successfully!', 'success');
                changePasswordForm.reset();
            } else {
                throw new Error(data.message || 'Failed to update password');
            }
        } catch (error) {
            console.error('Password change error:', error);
            showMessage(error.message || 'An error occurred. Please try again.', 'error');
        } finally {
            // Reset button state
            submitBtn.disabled = false;
            submitBtn.classList.remove('btn-loading');
            submitBtn.textContent = originalBtnText;
        }
    }
    
    // Handle email preferences form submission
    async function handleEmailPreferences(e) {
        e.preventDefault();
        
        const formData = new FormData(emailPreferencesForm);
        const preferences = {
            monthlyReport: formData.get('monthly-report') === 'on',
            expenseAlerts: formData.get('expense-alerts') === 'on',
            promotional: formData.get('promotional') === 'on'
        };
        
        // Show loading state
        const submitBtn = emailPreferencesForm.querySelector('button[type="submit"]');
        const originalBtnText = submitBtn.textContent;
        submitBtn.disabled = true;
        submitBtn.classList.add('btn-loading');
        submitBtn.textContent = 'Saving...';
        
        try {
            const response = await fetch('/api/account/preferences', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfToken || ''
                },
                body: JSON.stringify(preferences)
            });
            
            const data = await response.json();
            
            if (response.ok) {
                showMessage('Preferences saved successfully!', 'success');
            } else {
                throw new Error(data.message || 'Failed to save preferences');
            }
        } catch (error) {
            console.error('Preferences save error:', error);
            showMessage(error.message || 'An error occurred. Please try again.', 'error');
        } finally {
            // Reset button state
            submitBtn.disabled = false;
            submitBtn.classList.remove('btn-loading');
            submitBtn.textContent = originalBtnText;
        }
    }
    
    // Show delete account confirmation modal
    function showDeleteModal() {
        if (deleteModal) {
            deleteModal.style.display = 'flex';
            document.body.style.overflow = 'hidden'; // Prevent scrolling
            
            // Set focus on the email input when modal opens
            setTimeout(() => {
                if (confirmEmail) confirmEmail.focus();
            }, 100);
        }
    }
    
    // Hide delete account confirmation modal
    function hideDeleteModal() {
        if (deleteModal) {
            deleteModal.style.display = 'none';
            document.body.style.overflow = ''; // Re-enable scrolling
            
            // Reset the form
            if (confirmEmail) {
                confirmEmail.value = '';
                updateDeleteButtonState();
            }
        }
    }
    
    // Update delete button state based on email confirmation
    function updateDeleteButtonState() {
        if (!confirmDelete || !confirmEmail) return;
        
        const userEmail = document.querySelector('.user-email')?.textContent || '';
        const isEmailConfirmed = confirmEmail.value.trim() === userEmail.trim();
        
        confirmDelete.disabled = !isEmailConfirmed;
        confirmDelete.classList.toggle('btn-danger', isEmailConfirmed);
        confirmDelete.classList.toggle('btn-secondary', !isEmailConfirmed);
    }
    
    // Handle account deletion
    if (confirmDelete) {
        confirmDelete.addEventListener('click', async function() {
            const email = confirmEmail.value.trim();
            
            if (!email) {
                showMessage('Please enter your email address', 'error');
                return;
            }
            
            // Show loading state
            const originalBtnText = this.textContent;
            this.disabled = true;
            this.classList.add('btn-loading');
            this.textContent = 'Deleting...';
            
            try {
                const response = await fetch('/api/account/delete', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRF-Token': csrfToken || ''
                    },
                    body: JSON.stringify({ email })
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    showMessage('Your account has been deleted. Redirecting to home page...', 'success');
                    
                    // Redirect to home page after a short delay
                    setTimeout(() => {
                        window.location.href = '/';
                    }, 2000);
                } else {
                    throw new Error(data.message || 'Failed to delete account');
                }
            } catch (error) {
                console.error('Account deletion error:', error);
                showMessage(error.message || 'An error occurred. Please try again.', 'error');
                
                // Reset button state
                this.disabled = false;
                this.classList.remove('btn-loading');
                this.textContent = originalBtnText;
            }
        });
    }
    
    // Load user preferences
    async function loadUserPreferences() {
        try {
            const response = await fetch('/api/account/preferences', {
                headers: {
                    'X-Requested-With': 'XMLHttpRequest'
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                
                // Update form fields with the retrieved preferences
                if (data.preferences) {
                    const prefs = data.preferences;
                    const form = document.getElementById('email-preferences');
                    
                    if (form) {
                        form.querySelector('[name="monthly-report"]').checked = prefs.monthlyReport || false;
                        form.querySelector('[name="expense-alerts"]').checked = prefs.expenseAlerts || false;
                        form.querySelector('[name="promotional"]').checked = prefs.promotional || false;
                    }
                }
            }
        } catch (error) {
            console.error('Error loading preferences:', error);
        }
    }
    
    // Update password strength indicator
    function updatePasswordStrength() {
        const password = newPasswordInput.value;
        const strengthMeter = document.getElementById('password-strength-meter');
        const strengthText = document.getElementById('password-strength-text');
        
        if (!strengthMeter || !strengthText) return;
        
        // Calculate password strength (0-100)
        let strength = 0;
        
        // Length check
        if (password.length >= 8) strength += 20;
        if (password.length >= 12) strength += 20;
        
        // Character type checks
        if (/[A-Z]/.test(password)) strength += 20;
        if (/[0-9]/.test(password)) strength += 20;
        if (/[^A-Za-z0-9]/.test(password)) strength += 20;
        
        // Update the strength meter
        strengthMeter.value = strength;
        
        // Update the text and color based on strength
        if (strength <= 40) {
            strengthText.textContent = 'Weak';
            strengthText.style.color = '#ef4444'; // Red
        } else if (strength <= 70) {
            strengthText.textContent = 'Moderate';
            strengthText.style.color = '#f59e0b'; // Orange
        } else {
            strengthText.textContent = 'Strong';
            strengthText.style.color = '#10b981'; // Green
        }
    }
    
    // Show message helper function
    function showMessage(message, type = 'info') {
        if (!msgElement) return;
        
        msgElement.textContent = message;
        msgElement.className = 'msg';
        
        // Add appropriate class based on message type
        if (type === 'error') {
            msgElement.classList.add('error');
        } else if (type === 'success') {
            msgElement.classList.add('success');
        } else {
            msgElement.classList.add('info');
        }
        
        // Show the message
        msgElement.style.display = 'block';
        
        // Auto-hide non-error messages after 5 seconds
        if (type !== 'error') {
            setTimeout(() => {
                msgElement.style.display = 'none';
            }, 5000);
        }
        
        // Scroll to the message
        msgElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
});
