// Admin Categories Management JavaScript

document.addEventListener('DOMContentLoaded', () => {
    initCategoriesTable();
    setupCategoryModals();
    setupCategoryActions();
    initCategoryChart();
});

// Initialize categories data table
function initCategoriesTable() {
    // Initialize DataTable with server-side processing
    const categoriesTable = AdminUtils.initDataTable('categoriesTable', {
        processing: true,
        serverSide: true,
        ajax: {
            url: '/admin/api/categories',
            type: 'GET',
            error: AdminUtils.handleAjaxError
        },
        columns: [
            { data: 'name' },
            { 
                data: 'expense_count',
                className: 'text-center',
                render: function(data) {
                    return `<span class="badge bg-primary">${data}</span>`;
                }
            },
            { 
                data: 'total_amount',
                className: 'text-end',
                render: AdminUtils.formatCurrency
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
        ]
    });
}

// Setup category modals
function setupCategoryModals() {
    // Add category modal
    const addCategoryModal = document.getElementById('addCategoryModal');
    if (addCategoryModal) {
        addCategoryModal.addEventListener('show.bs.modal', function (event) {
            const button = event.relatedTarget;
            const modal = this;
            modal.querySelector('.modal-title').textContent = 'Add New Category';
            modal.querySelector('form').reset();
            modal.querySelector('form').setAttribute('action', '/admin/categories/add');
        });
    }

    // Edit category modal
    document.addEventListener('click', function(e) {
        if (e.target.closest('.btn-edit')) {
            const categoryId = e.target.closest('.btn-edit').dataset.id;
            loadCategoryData(categoryId);
        }
    });
    
    // Merge categories modal
    const mergeCategoriesModal = document.getElementById('mergeCategoriesModal');
    if (mergeCategoriesModal) {
        mergeCategoriesModal.addEventListener('show.bs.modal', function() {
            // In a real app, load categories via AJAX
            const categories = [
                { id: 1, name: 'Office', count: 15 },
                { id: 2, name: 'Travel', count: 8 },
                { id: 3, name: 'Supplies', count: 5 }
            ];
            
            const select = mergeCategoriesModal.querySelector('select');
            if (select) {
                select.innerHTML = categories.map(cat => 
                    `<option value="${cat.id}">${cat.name} (${cat.count})</option>`
                ).join('');
            }
        });
    }
}

// Load category data for editing
function loadCategoryData(categoryId) {
    // Show loading state
    const editCategoryModal = document.getElementById('editCategoryModal');
    const modalBody = editCategoryModal.querySelector('.modal-body');
    const originalContent = modalBody.innerHTML;
    
    AdminUtils.showLoading(modalBody);
    
    // In a real app, this would be an AJAX call to your backend
    setTimeout(() => {
        // Simulated category data - replace with actual API call
        const categoryData = {
            id: categoryId,
            name: 'Office Supplies',
            description: 'Office related expenses',
            budget: 1000,
            color: '#4e73df'
        };
        
        // Populate the form
        const form = editCategoryModal.querySelector('form');
        form.querySelector('input[name="name"]').value = categoryData.name;
        form.querySelector('textarea[name="description"]').value = categoryData.description || '';
        form.querySelector('input[name="budget"]').value = categoryData.budget || '';
        form.querySelector('input[name="color"]').value = categoryData.color || '#4e73df';
        form.setAttribute('action', `/admin/categories/${categoryData.id}/update`);
        
        // Show the modal
        const modal = new bootstrap.Modal(editCategoryModal);
        modal.show();
        
        // Restore original content
        modalBody.innerHTML = originalContent;
    }, 500);
}

// Setup category actions (delete, etc.)
function setupCategoryActions() {
    // Delete category
    document.addEventListener('click', function(e) {
        if (e.target.closest('.btn-delete')) {
            const button = e.target.closest('.btn-delete');
            const categoryId = button.dataset.id;
            
            if (confirm('Are you sure you want to delete this category? Any expenses in this category will be moved to "Uncategorized".')) {
                // In a real app, this would be an AJAX call to your backend
                console.log(`Deleting category ${categoryId}`);
                
                // Remove the row from the table
                const row = button.closest('tr');
                row.style.opacity = '0.5';
                
                // Simulate API call
                setTimeout(() => {
                    row.remove();
                    alert('Category deleted successfully!');
                    // Refresh the chart
                    if (window.categoryChart) {
                        window.categoryChart.update();
                    }
                }, 500);
            }
        }
    });
    
    // Handle merge categories form submission
    const mergeForm = document.getElementById('mergeCategoriesForm');
    if (mergeForm) {
        mergeForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            const categoriesToMerge = Array.from(
                mergeForm.querySelectorAll('select[name="categories_to_merge[]"] option:checked')
            ).map(option => option.value);
            
            const targetCategory = mergeForm.querySelector('input[name="target_category"]').value;
            
            if (categoriesToMerge.length < 2) {
                alert('Please select at least two categories to merge.');
                return;
            }
            
            if (!targetCategory) {
                alert('Please enter a target category name.');
                return;
            }
            
            if (confirm(`Are you sure you want to merge ${categoriesToMerge.length} categories into "${targetCategory}"?`)) {
                // In a real app, this would be an AJAX call to your backend
                console.log(`Merging categories: ${categoriesToMerge.join(', ')} into ${targetCategory}`);
                
                // Show loading state
                const mergeButton = mergeForm.querySelector('button[type="submit"]');
                const originalButtonText = mergeButton.innerHTML;
                mergeButton.disabled = true;
                mergeButton.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Merging...';
                
                // Simulate API call
                setTimeout(() => {
                    // Close the modal
                    const modal = bootstrap.Modal.getInstance(mergeForm.closest('.modal'));
                    if (modal) {
                        modal.hide();
                    }
                    
                    // Show success message
                    alert('Categories merged successfully!');
                    
                    // Reset the form
                    mergeForm.reset();
                    mergeButton.disabled = false;
                    mergeButton.innerHTML = originalButtonText;
                    
                    // Refresh the table and chart
                    if (window.categoriesTable) {
                        window.categoriesTable.ajax.reload();
                    }
                    if (window.categoryChart) {
                        window.categoryChart.update();
                    }
                }, 1000);
            }
        });
    }
}

// Initialize category distribution chart
function initCategoryChart() {
    const ctx = document.getElementById('categoryChart');
    if (!ctx) return;
    
    // In a real app, this data would come from an API
    const chartData = {
        labels: ['Office', 'Travel', 'Supplies', 'Food', 'Other'],
        datasets: [{
            data: [35, 25, 20, 15, 5],
            backgroundColor: [
                '#4e73df',
                '#1cc88a',
                '#36b9cc',
                '#f6c23e',
                '#e74a3b'
            ],
            hoverBackgroundColor: [
                '#2e59d9',
                '#17a673',
                '#2c9faf',
                '#dda20a',
                '#be2617'
            ],
            hoverBorderColor: 'rgba(234, 236, 244, 1)',
        }]
    };
    
    window.categoryChart = new Chart(ctx, {
        type: 'doughnut',
        data: chartData,
        options: {
            maintainAspectRatio: false,
            plugins: {
                tooltip: {
                    backgroundColor: 'rgb(255,255,255)',
                    bodyColor: '#858796',
                    borderColor: '#dddfeb',
                    borderWidth: 1,
                    xPadding: 15,
                    yPadding: 15,
                    displayColors: false,
                    caretPadding: 10,
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.raw || 0;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = Math.round((value / total) * 100);
                            return `${label}: ${percentage}% (${value})`;
                        }
                    }
                },
                legend: {
                    display: true,
                    position: 'right',
                    labels: {
                        boxWidth: 10,
                        padding: 10
                    }
                }
            },
            cutout: '70%',
        }
    });
}

// Export functions if needed
window.Categories = {
    initCategoriesTable,
    setupCategoryModals,
    setupCategoryActions,
    initCategoryChart,
    loadCategoryData
};
