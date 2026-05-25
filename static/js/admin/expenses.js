// Admin Expenses Management JavaScript

document.addEventListener('DOMContentLoaded', () => {
    initExpensesTable();
    setupExpenseModals();
    setupExpenseFilters();
    setupExpenseActions();
});

// Initialize expenses data table
function initExpensesTable() {
    // Initialize DataTable with server-side processing
    const expensesTable = AdminUtils.initDataTable('expensesTable', {
        processing: true,
        serverSide: true,
        ajax: {
            url: '/admin/api/expenses',
            type: 'GET',
            error: AdminUtils.handleAjaxError,
            data: function(d) {
                // Add any additional filter parameters
                d.start_date = document.getElementById('startDate')?.value || '';
                d.end_date = document.getElementById('endDate')?.value || '';
                d.user_id = document.getElementById('userFilter')?.value || '';
                d.category = document.getElementById('categoryFilter')?.value || '';
            }
        },
        columns: [
            { 
                data: 'date',
                render: AdminUtils.formatDate
            },
            { 
                data: 'user',
                render: function(data) {
                    return data?.name || 'N/A';
                }
            },
            { data: 'description' },
            { 
                data: 'category',
                render: function(data) {
                    return `<span class="badge bg-primary">${data}</span>`;
                }
            },
            { 
                data: 'amount',
                className: 'text-end',
                render: function(data) {
                    return AdminUtils.formatCurrency(data);
                }
            },
            {
                data: null,
                orderable: false,
                className: 'text-center',
                render: function(data, type, row) {
                    return `
                        <div class="btn-group btn-group-sm">
                            <button class="btn btn-outline-primary btn-edit" data-id="${row.id}">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn btn-outline-danger btn-delete" data-id="${row.id}">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    `;
                }
            }
        ],
        order: [[0, 'desc']] // Sort by date descending by default
    });

    // Store the table reference for later use
    window.expensesTable = expensesTable;
}

// Setup expense modals
function setupExpenseModals() {
    // Add expense modal
    const addExpenseModal = document.getElementById('addExpenseModal');
    if (addExpenseModal) {
        addExpenseModal.addEventListener('show.bs.modal', function (event) {
            const button = event.relatedTarget;
            const modal = this;
            modal.querySelector('.modal-title').textContent = 'Add New Expense';
            modal.querySelector('form').reset();
            modal.querySelector('form').setAttribute('action', '/admin/expenses/add');
            
            // Set default date to today
            const today = new Date().toISOString().split('T')[0];
            modal.querySelector('input[name="date"]').value = today;
        });
    }

    // Edit expense modal
    document.addEventListener('click', function(e) {
        if (e.target.closest('.btn-edit')) {
            const expenseId = e.target.closest('.btn-edit').dataset.id;
            loadExpenseData(expenseId);
        }
    });
}

// Load expense data for editing
function loadExpenseData(expenseId) {
    // Show loading state
    const editExpenseModal = document.getElementById('editExpenseModal');
    const modalBody = editExpenseModal.querySelector('.modal-body');
    const originalContent = modalBody.innerHTML;
    
    AdminUtils.showLoading(modalBody);
    
    // In a real app, this would be an AJAX call to your backend
    setTimeout(() => {
        // Simulated expense data - replace with actual API call
        const expenseData = {
            id: expenseId,
            date: '2023-05-15',
            description: 'Office supplies',
            amount: '125.75',
            category: 'Office',
            user_id: '1',
            notes: 'Purchased stationery items'
        };
        
        // Populate the form
        const form = editExpenseModal.querySelector('form');
        form.querySelector('input[name="date"]').value = expenseData.date;
        form.querySelector('input[name="description"]').value = expenseData.description;
        form.querySelector('input[name="amount"]').value = expenseData.amount;
        form.querySelector('select[name="category"]').value = expenseData.category;
        form.querySelector('select[name="user_id"]').value = expenseData.user_id;
        form.querySelector('textarea[name="notes"]').value = expenseData.notes || '';
        form.setAttribute('action', `/admin/expenses/${expenseData.id}/update`);
        
        // Show the modal
        const modal = new bootstrap.Modal(editExpenseModal);
        modal.show();
        
        // Restore original content
        modalBody.innerHTML = originalContent;
    }, 500);
}

// Setup expense filters
function setupExpenseFilters() {
    // Date range filter
    const dateFilterForm = document.getElementById('dateFilterForm');
    if (dateFilterForm) {
        dateFilterForm.addEventListener('submit', function(e) {
            e.preventDefault();
            if (window.expensesTable) {
                window.expensesTable.ajax.reload();
            }
        });
        
        // Reset filters
        const resetFiltersBtn = document.getElementById('resetFilters');
        if (resetFiltersBtn) {
            resetFiltersBtn.addEventListener('click', function() {
                dateFilterForm.reset();
                if (window.expensesTable) {
                    window.expensesTable.ajax.reload();
                }
            });
        }
    }
}

// Setup expense actions (delete, etc.)
function setupExpenseActions() {
    // Delete expense
    document.addEventListener('click', function(e) {
        if (e.target.closest('.btn-delete')) {
            const button = e.target.closest('.btn-delete');
            const expenseId = button.dataset.id;
            
            if (confirm('Are you sure you want to delete this expense? This action cannot be undone.')) {
                // In a real app, this would be an AJAX call to your backend
                console.log(`Deleting expense ${expenseId}`);
                
                // Remove the row from the table
                const row = button.closest('tr');
                row.style.opacity = '0.5';
                
                // Simulate API call
                setTimeout(() => {
                    row.remove();
                    alert('Expense deleted successfully!');
                }, 500);
            }
        }
    });
    
    // Export to CSV
    const exportBtn = document.getElementById('exportExpenses');
    if (exportBtn) {
        exportBtn.addEventListener('click', function() {
            // In a real app, this would trigger a file download
            alert('Exporting expenses to CSV...');
            // window.location.href = '/admin/expenses/export';
        });
    }
}

// Export functions if needed
window.Expenses = {
    initExpensesTable,
    setupExpenseModals,
    setupExpenseFilters,
    setupExpenseActions,
    loadExpenseData
};
