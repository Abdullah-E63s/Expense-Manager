// Account Page JavaScript
document.addEventListener('DOMContentLoaded', function () {
    // Initialize elements
    const profileForm = document.getElementById('profile-form');
    const usernameInput = document.getElementById('profile-username');
    const emailInput = document.getElementById('profile-email');
    const firstNameInput = document.getElementById('profile-first-name');
    const lastNameInput = document.getElementById('profile-last-name');
    const phoneCcInput = document.getElementById('profile-phone-cc');
    const phoneInput = document.getElementById('profile-phone');
    const lastLoginEl = document.getElementById('profile-last-login');
    const signedUpEl = document.getElementById('profile-signed-up');
    const pwdChangedEl = document.getElementById('profile-password-changed');
    const avatarImg = document.getElementById('profile-avatar');
    const changeAvatarBtn = document.getElementById('change-avatar-btn');
    const avatarInput = document.getElementById('avatar-input');
    const accountMsg = document.getElementById('account-msg');

    // Load profile info
    async function loadProfile() {
        if (!profileForm) return;
        try {
            const res = await fetch('/api/auth/account/profile', {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
                credentials: 'include'
            });
            if (!res.ok) throw new Error('Failed to load profile');
            const data = await res.json();

            if (usernameInput) usernameInput.value = data.username || '';
            if (emailInput) emailInput.value = data.email || '';
            if (firstNameInput) firstNameInput.value = data.first_name || '';
            if (lastNameInput) lastNameInput.value = data.last_name || '';
            if (phoneCcInput) phoneCcInput.value = data.phone_country_code || '';
            if (phoneInput) phoneInput.value = data.phone_number || '';

            const fmt = (dtStr) => dtStr ? new Date(dtStr).toLocaleString() : 'N/A';
            if (lastLoginEl) lastLoginEl.textContent = 'Last login: ' + fmt(data.last_login_at);
            if (signedUpEl) signedUpEl.textContent = 'Signed up: ' + fmt(data.signed_up_at);
            if (pwdChangedEl) pwdChangedEl.textContent = 'Password changed: ' + fmt(data.password_changed_at);
            if (avatarImg) avatarImg.src = data.profile_picture_url || '/static/images/pfp.jpg';
        } catch (e) {
            console.error('Profile load error:', e);
        }
    }

    // Profile update
    if (profileForm) {
        profileForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const saveBtn = document.getElementById('save-profile-btn');
            const orig = saveBtn ? saveBtn.textContent : '';
            if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }
            showMessage(accountMsg, 'Saving profile...', 'info');
            try {
                const payload = {
                    username: usernameInput?.value?.trim() || '',
                    first_name: firstNameInput?.value?.trim() || '',
                    last_name: lastNameInput?.value?.trim() || '',
                    phone_country_code: phoneCcInput?.value?.trim() || '',
                    phone_number: phoneInput?.value?.trim() || ''
                };
                const recaptcha_token = typeof window.getRecaptchaToken === 'function'
                    ? await window.getRecaptchaToken('save_profile')
                    : null;
                if (recaptcha_token) console.log('[reCAPTCHA] save_profile token acquired');
                else console.warn('[reCAPTCHA] save_profile token missing');

                const res = await fetch('/api/auth/account/profile', {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRF-TOKEN': getCsrfToken()
                    },
                    credentials: 'include',
                    body: JSON.stringify({ ...payload, recaptcha_token })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.error || 'Failed to update profile');
                showMessage(accountMsg, '✓ Profile saved successfully', 'success');
                loadProfile();
            } catch (err) {
                console.error('Profile save error:', err);
                showMessage(accountMsg, err.message, 'error');
            } finally {
                if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = orig; }
            }
        });
        loadProfile();
    }

    // Avatar upload
    if (changeAvatarBtn && avatarInput) {
        changeAvatarBtn.addEventListener('click', () => avatarInput.click());
        avatarInput.addEventListener('change', async () => {
            const file = avatarInput.files && avatarInput.files[0];
            if (!file) return;

            const formData = new FormData();
            formData.append('image', file);
            try {
                const res = await fetch('/api/auth/account/profile-picture', {
                    method: 'POST',
                    headers: { 'X-CSRF-TOKEN': getCsrfToken() },
                    body: formData,
                    credentials: 'include'
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.error || 'Failed to upload image');
                if (avatarImg && data.profile_picture_url) {
                    avatarImg.src = data.profile_picture_url;
                }
                showMessage(accountMsg, 'Profile picture updated', 'success');
            } catch (err) {
                console.error('Avatar upload error:', err);
                showMessage(accountMsg, err.message, 'error');
            } finally {
                avatarInput.value = '';
            }
        });
    }

    // Avatar delete
    const deleteAvatarBtn = document.getElementById('delete-avatar-btn');
    if (deleteAvatarBtn) {
        deleteAvatarBtn.addEventListener('click', async () => {
            if (!confirm('Are you sure you want to delete your profile picture?')) return;
            
            showMessage(accountMsg, 'Deleting avatar...', 'info');
            try {
                const res = await fetch('/api/auth/account/profile-picture', {
                    method: 'DELETE',
                    headers: { 'X-CSRF-TOKEN': getCsrfToken() },
                    credentials: 'include'
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.error || 'Failed to delete avatar');
                
                if (avatarImg) {
                    avatarImg.src = '/static/images/pfp.jpg';
                }
                showMessage(accountMsg, 'Profile picture deleted', 'success');
            } catch (err) {
                console.error('Avatar delete error:', err);
                showMessage(accountMsg, err.message, 'error');
            }
        });
    }

    // Password Change
    const changePasswordForm = document.getElementById('change-password-form');
    if (changePasswordForm) {
        changePasswordForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const updateBtn = document.getElementById('update-password-btn');
            const orig = updateBtn ? updateBtn.textContent : '';
            const currentPassword = document.getElementById('current-password').value;
            const newPassword = document.getElementById('new-password').value;
            const confirmPassword = document.getElementById('confirm-password').value;

            if (newPassword !== confirmPassword) {
                showMessage(accountMsg, 'New passwords do not match', 'error');
                return;
            }

            if (updateBtn) { updateBtn.disabled = true; updateBtn.textContent = 'Updating...'; }
            showMessage(accountMsg, 'Updating password...', 'info');

            try {
                const recaptcha_token = typeof window.getRecaptchaToken === 'function'
                    ? await window.getRecaptchaToken('change_password')
                    : null;
                if (recaptcha_token) console.log('[reCAPTCHA] change_password token acquired');
                else console.warn('[reCAPTCHA] change_password token missing');

                const res = await fetch('/api/auth/change-password', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRF-TOKEN': getCsrfToken()
                    },
                    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword, recaptcha_token })
                });
                const data = await res.json();
                if (res.ok) {
                    showMessage(accountMsg, '✓ Password changed successfully', 'success');
                    changePasswordForm.reset();
                } else {
                    throw new Error(data.message || data.error || 'Failed to change password');
                }
            } catch (err) {
                showMessage(accountMsg, err.message, 'error');
            } finally {
                if (updateBtn) { updateBtn.disabled = false; updateBtn.textContent = orig; }
            }
        });
    }

    // Forgot Password Modal
    const forgotBtn = document.getElementById('forgot-password-btn');
    const forgotModal = document.getElementById('forgot-password-modal');
    const cancelForgot = document.getElementById('cancel-forgot-password');
    const submitForgot = document.getElementById('submit-forgot-password');
    const forgotEmailInput = document.getElementById('forgot-email');
    const forgotError = document.getElementById('forgot-error');

    if (forgotBtn && forgotModal) {
        forgotBtn.addEventListener('click', () => forgotModal.classList.add('active'));
    }

    const hideForgot = () => {
        forgotModal?.classList.remove('active');
        if (forgotEmailInput) forgotEmailInput.value = '';
        if (forgotError) forgotError.textContent = '';
    };

    if (cancelForgot) cancelForgot.addEventListener('click', hideForgot);

    if (submitForgot) {
        submitForgot.addEventListener('click', async () => {
            const email = forgotEmailInput?.value?.trim();
            if (!email) {
                showMessage(forgotError, 'Email is required', 'error');
                return;
            }
            const origText = submitForgot.textContent;
            submitForgot.disabled = true;
            submitForgot.textContent = 'Sending...';
            showMessage(forgotError, 'Sending reset link...', 'info');
            try {
                const recaptcha_token = typeof window.getRecaptchaToken === 'function'
                    ? await window.getRecaptchaToken('forgot_password')
                    : null;

                const res = await fetch('/api/auth/forgot-password', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRF-TOKEN': getCsrfToken()
                    },
                    body: JSON.stringify({ email, recaptcha_token })
                });
                if (res.ok) {
                    showMessage(accountMsg, '✓ Reset link sent! Check your email inbox.', 'success');
                    hideForgot();
                } else {
                    const data = await res.json();
                    throw new Error(data.message || 'Failed to send reset link');
                }
            } catch (err) {
                showMessage(forgotError, err.message, 'error');
            } finally {
                submitForgot.disabled = false;
                submitForgot.textContent = origText;
            }
        });
    }

    // Delete Account Modal
    const deleteBtn = document.getElementById('delete-account-btn');
    const deleteModal = document.getElementById('delete-account-modal');
    const cancelDelete = document.getElementById('cancel-delete-account');
    const confirmDelete = document.getElementById('confirm-delete-account');
    const pwdDelete = document.getElementById('confirm-password-delete');
    const deleteError = document.getElementById('delete-account-error');

    if (deleteBtn && deleteModal) {
        deleteBtn.addEventListener('click', () => deleteModal.classList.add('active'));
    }

    const hideDelete = () => deleteModal?.classList.remove('active');
    if (cancelDelete) cancelDelete.addEventListener('click', hideDelete);

    if (confirmDelete) {
        confirmDelete.addEventListener('click', async () => {
            const password = pwdDelete?.value?.trim();
            if (!password) {
                showMessage(deleteError, 'Password required', 'error');
                return;
            }
            const origText = confirmDelete.textContent;
            confirmDelete.disabled = true;
            confirmDelete.textContent = 'Deleting...';
            showMessage(deleteError, 'Deleting account...', 'info');
            try {
                const recaptcha_token = typeof window.getRecaptchaToken === 'function'
                    ? await window.getRecaptchaToken('delete_account')
                    : null;
                if (recaptcha_token) console.log('[reCAPTCHA] delete_account token acquired');
                else console.warn('[reCAPTCHA] delete_account token missing');

                const res = await fetch('/api/auth/account', {
                    method: 'DELETE',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRF-TOKEN': getCsrfToken()
                    },
                    body: JSON.stringify({ confirm: true, password, recaptcha_token })
                });
                if (res.ok) {
                    showMessage(accountMsg, '✓ Account deleted. Redirecting...', 'success');
                    setTimeout(() => window.location.href = '/', 2000);
                } else {
                    const data = await res.json();
                    throw new Error(data.message || data.error || 'Deletion failed');
                }
            } catch (err) {
                showMessage(deleteError, err.message, 'error');
            } finally {
                confirmDelete.disabled = false;
                confirmDelete.textContent = origText;
            }
        });
    }

    // Export Data behavior
    const exportDataBtn = document.getElementById('export-data-btn');
    if (exportDataBtn) {
        exportDataBtn.addEventListener('click', (e) => {
            e.preventDefault();
            window.location.href = '/api/expenses/export';
        });
    }

    // Global password toggle behavior
    document.querySelectorAll('.toggle-password').forEach(span => {
        span.style.cursor = 'pointer';
        span.addEventListener('click', (e) => {
            const targetId = e.target.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
            if (targetId) {
                const input = document.getElementById(targetId);
                if (input) {
                    input.type = input.type === 'password' ? 'text' : 'password';
                }
            }
        });
    });
});
