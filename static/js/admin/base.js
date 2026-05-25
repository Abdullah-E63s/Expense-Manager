// Admin Base JavaScript

// Toggle sidebar
const menuToggle = document.getElementById('menu-toggle');
if (menuToggle) {
    menuToggle.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('wrapper').classList.toggle('toggled');
    });
}

// Initialize tooltips
const initTooltips = () => {
    const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    tooltipTriggerList.map(function (tooltipTriggerEl) {
        return new bootstrap.Tooltip(tooltipTriggerEl);
    });
};

// Initialize popovers
const initPopovers = () => {
    const popoverTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="popover"]'));
    popoverTriggerList.map(function (popoverTriggerEl) {
        return new bootstrap.Popover(popoverTriggerEl);
    });
};

// Initialize data tables with common options
const initDataTable = (tableId, options = {}) => {
    const defaultOptions = {
        responsive: true,
        pageLength: 10,
        lengthMenu: [5, 10, 25, 50, 100],
        language: {
            search: "",
            searchPlaceholder: "Search...",
            lengthMenu: "Show _MENU_ entries",
            info: "Showing _START_ to _END_ of _TOTAL_ entries",
            infoEmpty: "No entries found",
            infoFiltered: "(filtered from _MAX_ total entries)",
            paginate: {
                first: "First",
                last: "Last",
                next: "Next",
                previous: "Previous"
            }
        },
        dom: "<'row'<'col-sm-12 col-md-6'l><'col-sm-12 col-md-6'f>>" +
             "<'row'<'col-sm-12'tr>>" +
             "<'row'<'col-sm-12 col-md-5'i><'col-sm-12 col-md-7'p>>"
    };

    return $(`#${tableId}`).DataTable({
        ...defaultOptions,
        ...options
    });
};

// Format date for display
const formatDate = (dateString) => {
    if (!dateString) return '';
    const options = { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    };
    return new Date(dateString).toLocaleDateString(undefined, options);
};

// Format currency
const formatCurrency = (amount) => {
    if (amount === null || amount === undefined) return '$0.00';
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(amount);
};

// Show loading state
const showLoading = (element) => {
    const loadingHtml = `
        <div class="d-flex justify-content-center align-items-center" style="min-height: 200px;">
            <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">Loading...</span>
            </div>
        </div>
    `;
    if (typeof element === 'string') {
        document.querySelector(element).innerHTML = loadingHtml;
    } else if (element) {
        element.innerHTML = loadingHtml;
    }
};

// Handle AJAX errors
const handleAjaxError = (error) => {
    console.error('AJAX Error:', error);
    // You can implement a toast notification here
    alert('An error occurred. Please try again.');
};

// Document ready
document.addEventListener('DOMContentLoaded', () => {
    initTooltips();
    initPopovers();
});

// Export functions for use in other files
window.AdminUtils = {
    initTooltips,
    initPopovers,
    initDataTable,
    formatDate,
    formatCurrency,
    showLoading,
    handleAjaxError
};
