// Delete Account Page JavaScript

document.addEventListener('DOMContentLoaded', function() {
    const cancelBtn = document.getElementById('cancel-btn');
    const confirmBtn = document.getElementById('confirm-delete-btn');
    const errorMsg = document.getElementById('error-msg');
    
    // Handle cancel button click
    if (cancelBtn) {
        cancelBtn.addEventListener('click', function() {
            // Redirect back to account page or previous page
            window.history.back();
        });
    }
    
    // Handle delete account button click
    if (confirmBtn) {
        confirmBtn.addEventListener('click', showDeleteConfirmation);
    }
    
    // Show confirmation modal
    function showDeleteConfirmation() {
        // Hide any previous error messages
        if (errorMsg) {
            errorMsg.style.display = 'none';
        }
        
        // Create modal overlay
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        
        // Modal content
        modal.innerHTML = `
            <div class="modal-content">
                <h3>Confirm Account Deletion</h3>
                <p>Are you sure you want to delete your account? This action cannot be undone. All your data will be permanently removed from our servers.</p>
                <p>To confirm, please type <strong>DELETE</strong> in the box below:</p>
                <input type="text" id="confirm-delete-input" class="form-control" placeholder="Type DELETE to confirm" style="width: 100%; margin: 1rem 0;">
                <div class="modal-actions">
                    <button id="modal-cancel-btn" class="btn secondary">Cancel</button>
                    <button id="modal-confirm-btn" class="btn danger" disabled>Permanently Delete My Account</button>
                </div>
            </div>
        `;
        
        // Add modal to the page
        document.body.appendChild(modal);
        
        // Get modal elements
        const confirmInput = modal.querySelector('#confirm-delete-input');
        const modalCancelBtn = modal.querySelector('#modal-cancel-btn');
        const modalConfirmBtn = modal.querySelector('#modal-confirm-btn');
        
        // Enable/disable confirm button based on input
        if (confirmInput && modalConfirmBtn) {
            confirmInput.addEventListener('input', function() {
                modalConfirmBtn.disabled = this.value.trim().toUpperCase() !== 'DELETE';
            });
            
            // Handle Enter key press
            confirmInput.addEventListener('keypress', function(e) {
                if (e.key === 'Enter' && !modalConfirmBtn.disabled) {
                    deleteAccount();
                }
            });
        }
        
        // Handle cancel button in modal
        if (modalCancelBtn) {
            modalCancelBtn.addEventListener('click', function() {
                document.body.removeChild(modal);
            });
        }
        
        // Handle confirm button in modal
        if (modalConfirmBtn) {
            modalConfirmBtn.addEventListener('click', deleteAccount);
        }
        
        // Function to handle account deletion
        async function deleteAccount() {
            const originalText = modalConfirmBtn.textContent;
            
            try {
                // Show loading state
                modalConfirmBtn.disabled = true;
                modalConfirmBtn.textContent = 'Deleting...';
                
                // Get CSRF token if using Flask-WTF
                const csrfToken = document.querySelector('input[name="csrf_token"]')?.value;
                
                // Send delete request
                const response = await fetch('/api/account/delete', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': csrfToken || ''
                    },
                    credentials: 'same-origin'
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    // Account deleted successfully
                    showMessage('Your account has been successfully deleted. Redirecting to home page...', 'success');
                    
                    // Clear any user session data
                    localStorage.removeItem('authToken');
                    
                    // Redirect to home page after a short delay
                    setTimeout(() => {
                        window.location.href = '/';
                    }, 2000);
                } else {
                    throw new Error(data.message || 'Failed to delete account');
                }
            } catch (error) {
                console.error('Error deleting account:', error);
                
                // Show error message in modal or main page
                const errorMessage = error.message || 'An error occurred while deleting your account. Please try again.';
                
                if (modal && modal.parentNode) {
                    // If modal is still open, show error there
                    const errorDiv = document.createElement('div');
                    errorDiv.className = 'msg error';
                    errorDiv.textContent = errorMessage;
                    
                    const modalContent = modal.querySelector('.modal-content');
                    if (modalContent) {
                        modalContent.appendChild(errorDiv);
                    }
                } else if (errorMsg) {
                    // Otherwise show in main error message
                    errorMsg.textContent = errorMessage;
                    errorMsg.style.display = 'block';
                }
                
                // Re-enable the button
                modalConfirmBtn.disabled = false;
                modalConfirmBtn.textContent = originalText;
            }
        }
    }
    
    // Helper function to show messages
    function showMessage(message, type = 'info') {
        // Create a toast notification
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        
        // Add to page
        document.body.appendChild(toast);
        
        // Remove after delay
        setTimeout(() => {
            toast.classList.add('show');
            
            setTimeout(() => {
                toast.classList.remove('show');
                
                // Remove from DOM after animation
                setTimeout(() => {
                    if (toast.parentNode) {
                        document.body.removeChild(toast);
                    }
                }, 300);
            }, 5000);
        }, 100);
    }
});
