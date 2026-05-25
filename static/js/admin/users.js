// Admin Users Management JavaScript

document.addEventListener('DOMContentLoaded', () => {
    initUsersTable();
    setupUserModals();
    setupUserActions();
});

// Initialize users data table
function initUsersTable() {
    // Initialize DataTable with server-side processing
    const usersTable = AdminUtils.initDataTable('usersTable', {
        processing: true,
        serverSide: true,
        ajax: {
            url: '/admin/api/users',
            type: 'GET',
            error: AdminUtils.handleAjaxError
        },
        columns: [
            { data: 'id' },
            { 
                data: 'name',
                render: function(data, type, row) {
                    return `
                        <div class="d-flex align-items-center">
                            <img src="${row.avatar || '/static/img/default-avatar.png'}" 
                                 class="rounded-circle me-2" 
                                 width="32" 
                                 height="32" 
                                 alt="${data}">
                            <div>
                                <div class="fw-bold">${data}</div>
                                <small class="text-muted">${row.email}</small>
                            </div>
                        </div>
                    `;
                }
            },
            { data: 'role' },
            { 
                data: 'status',
                render: function(data) {
                    const statusClass = data === 'Active' ? 'success' : 'secondary';
                    return `<span class="badge bg-${statusClass}">${data}</span>`;
                }
            },
            { 
                data: 'last_login',
                render: AdminUtils.formatDate
            },
            {
                data: null,
                orderable: false,
                render: function(data, type, row) {
                    return `
                        <div class="btn-group btn-group-sm">
                            <button class="btn btn-outline-primary btn-edit" data-id="${row.id}">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn btn-outline-${row.status === 'Active' ? 'danger' : 'success'} btn-toggle-status" 
                                    data-id="${row.id}" 
                                    data-status="${row.status}">
                                <i class="fas fa-${row.status === 'Active' ? 'user-slash' : 'user-check'}"></i>
                            </button>
                            <button class="btn btn-outline-danger btn-delete" data-id="${row.id}">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    `;
                }
            }
        ]
    });
}

// Setup user modals
function setupUserModals() {
    // Add user modal
    const addUserModal = document.getElementById('addUserModal');
    if (addUserModal) {
        addUserModal.addEventListener('show.bs.modal', function (event) {
            const button = event.relatedTarget;
            const modal = this;
            modal.querySelector('.modal-title').textContent = 'Add New User';
            modal.querySelector('form').reset();
            modal.querySelector('form').setAttribute('action', '/admin/users/add');
        });
    }

    // Edit user modal
    document.addEventListener('click', function(e) {
        if (e.target.closest('.btn-edit')) {
            const userId = e.target.closest('.btn-edit').dataset.id;
            loadUserData(userId);
        }
    });
}

// Load user data for editing
function loadUserData(userId) {
    // Show loading state
    const editUserModal = document.getElementById('editUserModal');
    const modalBody = editUserModal.querySelector('.modal-body');
    const originalContent = modalBody.innerHTML;
    
    AdminUtils.showLoading(modalBody);
    
    // In a real app, this would be an AJAX call to your backend
    setTimeout(() => {
        // Simulated user data - replace with actual API call
        const userData = {
            id: userId,
            name: 'John Doe',
            email: 'john@example.com',
            role: 'user',
            status: 'Active'
        };
        
        // Populate the form
        const form = editUserModal.querySelector('form');
        form.querySelector('input[name="name"]').value = userData.name;
        form.querySelector('input[name="email"]').value = userData.email;
        form.querySelector('select[name="role"]').value = userData.role.toLowerCase();
        form.setAttribute('action', `/admin/users/${userData.id}/update`);
        
        // Show the modal
        const modal = new bootstrap.Modal(editUserModal);
        modal.show();
        
        // Restore original content
        modalBody.innerHTML = originalContent;
    }, 500);
}

// Setup user actions (delete, toggle status, etc.)
function setupUserActions() {
    // Toggle user status
    document.addEventListener('click', function(e) {
        if (e.target.closest('.btn-toggle-status')) {
            const button = e.target.closest('.btn-toggle-status');
            const userId = button.dataset.id;
            const currentStatus = button.dataset.status;
            const newStatus = currentStatus === 'Active' ? 'Inactive' : 'Active';
            
            if (confirm(`Are you sure you want to ${newStatus.toLowerCase()} this user?`)) {
                // In a real app, this would be an AJAX call to your backend
                console.log(`Toggling user ${userId} status to ${newStatus}`);
                
                // Update the button appearance
                button.classList.remove(`btn-outline-${currentStatus === 'Active' ? 'danger' : 'success'}`);
                button.classList.add(`btn-outline-${newStatus === 'Active' ? 'danger' : 'success'}`);
                button.innerHTML = `<i class="fas fa-user-${newStatus === 'Active' ? 'slash' : 'check'}"></i>`;
                button.dataset.status = newStatus;
                
                // Update the status badge in the table
                const statusBadge = button.closest('tr').querySelector('.badge');
                if (statusBadge) {
                    statusBadge.className = `badge bg-${newStatus === 'Active' ? 'success' : 'secondary'}`;
                    statusBadge.textContent = newStatus;
                }
                
                // Show success message
                alert(`User status updated to ${newStatus} successfully!`);
            }
        }
        
        // Delete user
        if (e.target.closest('.btn-delete')) {
            const button = e.target.closest('.btn-delete');
            const userId = button.dataset.id;
            
            if (confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
                // In a real app, this would be an AJAX call to your backend
                console.log(`Deleting user ${userId}`);
                
                // Remove the row from the table
                const row = button.closest('tr');
                row.style.opacity = '0.5';
                
                // Simulate API call
                setTimeout(() => {
                    row.remove();
                    alert('User deleted successfully!');
                }, 500);
            }
        }
    });
}

// Export functions if needed
window.Users = {
    initUsersTable,
    setupUserModals,
    setupUserActions,
    loadUserData
};
