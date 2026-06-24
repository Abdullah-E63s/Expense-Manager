// Dashboard JavaScript
document.addEventListener('DOMContentLoaded', function () {
    // Initialize elements
    const logoutBtn = document.getElementById('logout-btn');
    const expenseForm = document.getElementById('expense-form');
    const globalMsg = document.getElementById('global-msg');

    // Initialize charts
    let categoryChart, monthlyChart;

    // Initialize the dashboard
    async function initDashboard() {
        // Load initial data
        await loadProfileAvatar();
        await loadBudget(); // Load budget first to ensure window.currentBudgetAmount is set
        await loadExpenses();

        // Set up event listeners
        setupEventListeners();
    }

    // Set up event listeners
    function setupEventListeners() {
        // Logout button (guard against double-binding from multiple scripts)
        if (logoutBtn && !logoutBtn.dataset.boundLogout) {
            logoutBtn.addEventListener('click', handleLogout);
            logoutBtn.dataset.boundLogout = '1';
        }

        // Expense form submission
        if (expenseForm) {
            expenseForm.addEventListener('submit', handleExpenseSubmit);
        }

        // Delete all expenses button
        const deleteAllBtn = document.getElementById('delete-all-btn');
        if (deleteAllBtn) {
            deleteAllBtn.addEventListener('click', handleDeleteAllExpenses);
        }
    }

    // Load and set header avatar image
    async function loadProfileAvatar() {
        try {
            const res = await fetch('/api/auth/account/profile', {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
                credentials: 'include'
            });
            if (!res.ok) return;
            const data = await res.json();
            const img = document.getElementById('header-avatar');
            if (img && data && data.profile_picture_url) {
                img.src = data.profile_picture_url || '/static/images/pfp.jpg';
            }
        } catch (e) {
            // ignore
        }
    }

    // Handle logout using API endpoint
    async function handleLogout(e) {
        try {
            e && e.preventDefault && e.preventDefault();
            const response = await fetch('/api/auth/logout', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                credentials: 'include'
            });
            if (!response.ok) throw new Error('Logout failed');
            window.location.href = '/';
        } catch (error) {
            console.error('Logout error:', error);
            showMessage('An error occurred during logout. Please try again.', 'error');
        }
    }

    // Handle expense form submission
    let _expenseSubmitting = false;
    async function handleExpenseSubmit(e) {
        e.preventDefault();
        if (_expenseSubmitting) return; // prevent double-submit
        _expenseSubmitting = true;

        const submitBtn = expenseForm?.querySelector('button[type="submit"]');
        const origText = submitBtn ? submitBtn.textContent : '';
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Adding...'; }

        const formData = new FormData(expenseForm);
        const expenseData = {
            amount: formData.get('amount') || document.getElementById('expense-value')?.value,
            category: formData.get('category') || document.getElementById('expense-category')?.value,
            date: formData.get('date') || document.getElementById('expense-date')?.value,
            description: formData.get('description') || document.getElementById('expense-description')?.value
        };

        try {
            const recaptcha_token = typeof window.getRecaptchaToken === 'function'
                ? await window.getRecaptchaToken('add_expense')
                : null;
            if (recaptcha_token) console.log('[reCAPTCHA] add_expense token acquired');
            else console.warn('[reCAPTCHA] add_expense token missing');

            const response = await fetch('/api/expenses', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                    'X-CSRFToken': getCsrfToken()
                },
                body: JSON.stringify({ ...expenseData, recaptcha_token })
            });

            const data = await response.json();

            if (response.ok) {
                showMessage(globalMsg, 'âœ“ Expense added successfully!', 'success');
                expenseForm.reset();
                await loadExpenses(); // Refresh the data
            } else {
                throw new Error(data.error || data.message || 'Failed to add expense');
            }
        } catch (error) {
            console.error('Error adding expense:', error);
            showMessage(globalMsg, error.message || 'An error occurred. Please try again.', 'error');
        } finally {
            _expenseSubmitting = false;
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = origText; }
        }
    }

    // Load expenses and update the UI
    async function loadExpenses() {
        try {
            const response = await fetch(`/api/expenses?t=${Date.now()}`, {
                headers: {
                    'X-Requested-With': 'XMLHttpRequest'
                },
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error(`Server returned ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            updateDashboard(data);
        } catch (error) {
            console.error('Error loading expenses:', error);
            // Only show message if it's not a transient connection issue
            if (error.message !== 'Failed to fetch') {
                showMessage('Loading your data...', 'info'); // Softer message
            }
        }
    }

    // Listen for expense updates from other scripts (e.g., yolo-handler.js)
    window.addEventListener('expenses:updated', async () => {
        try {
            await loadExpenses();
            await loadBudget();
        } catch (_) { }
        // Fallback minor delay refresh to ensure DOM sync
        setTimeout(async () => {
            try { await loadExpenses(); } catch (_) { }
        }, 400);
    });

    // Update the dashboard with new data
    function updateDashboard(data) {
        if (!data) return;

        try {
            // Fallback for list
            const items = data.items || [];
            const recentExpenses = data.recentExpenses || items;

            // Compute summary if missing or if budget period needs filtering
            let summary = data.summary;
            const period = window.currentBudgetPeriod || 'monthly';

            // Re-calculate summary to respect budget period
            const periodExpenses = filterByPeriod(items, period);
            const total = periodExpenses.reduce((sum, item) => sum + parseFloat(item.value || 0), 0);

            summary = {
                totalAmount: total,
                totalExpenses: periodExpenses.length,
                allTimeTotal: items.reduce((sum, item) => sum + parseFloat(item.value || 0), 0)
            };

            // Compute chart data if missing
            let chartData = data.chartData;
            if (!chartData && items.length > 0) {
                const byCategory = {};
                const byMonth = {};
                items.forEach(item => {
                    const cat = item.category || 'Uncategorized';
                    byCategory[cat] = (byCategory[cat] || 0) + parseFloat(item.value || 0);

                    const date = new Date(item.created_at || item.date);
                    const month = date.toLocaleString('default', { month: 'short' });
                    byMonth[month] = (byMonth[month] || 0) + parseFloat(item.value || 0);
                });

                chartData = {
                    byCategory: Object.entries(byCategory).map(([name, amount]) => ({ name, amount })),
                    byMonth: Object.entries(byMonth).map(([name, amount]) => ({ name, amount }))
                };
            }

            updateSummary(summary);
            updateCharts(chartData);
            updateRecentExpenses(recentExpenses);
            updateReceiptGallery(items);
        } catch (err) {
            console.error('Error updating dashboard UI:', err);
        }
    }

    // Helper to filter items by current period
    function filterByPeriod(items, period) {
        const now = new Date();
        let startOfPeriod;

        if (period === 'weekly') {
            // Start of current week (Sunday)
            startOfPeriod = new Date(now);
            startOfPeriod.setDate(now.getDate() - now.getDay());
            startOfPeriod.setHours(0, 0, 0, 0);
        } else {
            // Start of current month
            startOfPeriod = new Date(now.getFullYear(), now.getMonth(), 1);
            startOfPeriod.setHours(0, 0, 0, 0);
        }

        return items.filter(item => {
            const date = new Date(item.created_at || item.date);
            return date >= startOfPeriod;
        });
    }

    // Update the receipt gallery
    function updateReceiptGallery(expenses) {
        const gallery = document.getElementById('receipts-gallery');
        if (!gallery) return;

        // Filter for expenses that have a picture_url
        const receipts = (expenses || []).filter(e => e.picture_url);

        if (receipts.length === 0) {
            gallery.innerHTML = '<p class="empty-msg">No receipts uploaded yet.</p>';
            return;
        }

        gallery.innerHTML = '';

        // Show last 12 receipts to keep it clean
        receipts.slice(0, 12).forEach(receipt => {
            const item = document.createElement('div');
            item.className = 'receipt-item';

            const date = new Date(receipt.created_at).toLocaleDateString();

            item.innerHTML = `
                <img src="${receipt.picture_url}" alt="Receipt" onerror="this.src='/static/images/logo.png'">
                <div class="receipt-info">
                    <span>${date}</span>
                    <span style="float: right;">$${receipt.value.toFixed(2)}</span>
                </div>
            `;

            // Add click listener to show full image
            item.addEventListener('click', () => {
                window.open(receipt.picture_url, '_blank');
            });

            gallery.appendChild(item);
        });
    }

    // Update the summary cards
    function updateSummary(summary) {
        if (!summary) return;

        const totalAmount = document.getElementById('total-amount');
        const totalExpenses = document.getElementById('total-expenses');
        const averageExpense = document.getElementById('average-expense');
        const remainingBudget = document.getElementById('remaining-budget');

        if (totalAmount) totalAmount.textContent = `$${summary.totalAmount.toFixed(2)}`;
        if (totalExpenses) totalExpenses.textContent = summary.totalExpenses;
        if (averageExpense) {
            const avg = summary.totalExpenses > 0
                ? (summary.totalAmount / summary.totalExpenses).toFixed(2)
                : '0.00';
            averageExpense.textContent = `$${avg}`;
        }

        // Update remaining budget
        if (remainingBudget) {
            // Get budget amount from global variable or fetch it
            const budgetAmount = window.currentBudgetAmount || 0;
            const remaining = budgetAmount - summary.totalAmount;
            remainingBudget.textContent = `$${remaining.toFixed(2)}`;

            // Color code based on remaining amount
            if (remaining < 0) {
                remainingBudget.style.color = '#f44336'; // Red if over budget
            } else if (remaining < budgetAmount * 0.2) {
                remainingBudget.style.color = '#ff9800'; // Orange if less than 20% left
            } else {
                remainingBudget.style.color = '#4CAF50'; // Green if good
            }
        }
    }

    // Update the charts
    function updateCharts(chartData) {
        if (!chartData) return;

        // Update category chart
        updateCategoryChart(chartData.byCategory);

        // Update monthly chart
        updateMonthlyChart(chartData.byMonth);
    }

    // Update the category chart
    function updateCategoryChart(categories) {
        const ctx = document.getElementById('categoryChart')?.getContext('2d');
        if (!ctx) return;

        // Destroy existing chart if it exists
        const existingChartObj = Chart.getChart('categoryChart');
        if (existingChartObj) existingChartObj.destroy();
        if (categoryChart) categoryChart.destroy();

        const labels = categories.map(cat => cat.name);
        const data = categories.map(cat => cat.amount);
        const backgroundColors = generateColors(labels.length);

        categoryChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: backgroundColors,
                    borderWidth: 2,
                    borderColor: '#1a1d24', // match dark theme background
                    hoverOffset: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '65%',
                layout: {
                    padding: 20
                },
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            color: '#a0aabf',
                            font: { family: "'Inter', sans-serif", size: 13, weight: '500' },
                            padding: 20,
                            usePointStyle: true,
                            pointStyle: 'circle'
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(26, 29, 36, 0.95)',
                        titleColor: '#fff',
                        bodyColor: '#e2e8f0',
                        bodyFont: { size: 14, weight: 'bold' },
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderWidth: 1,
                        padding: 12,
                        boxPadding: 6,
                        callbacks: {
                            label: function (context) {
                                return ` $${context.raw.toFixed(2)}`;
                            }
                        }
                    }
                }
            }
        });
    }

    // Update the monthly chart
    function updateMonthlyChart(monthlyData) {
        const ctx = document.getElementById('monthlyChart')?.getContext('2d');
        if (!ctx) return;

        // Destroy existing chart if it exists
        const existingChartObj = Chart.getChart('monthlyChart');
        if (existingChartObj) existingChartObj.destroy();
        if (monthlyChart) monthlyChart.destroy();

        const labels = monthlyData.map(item => item.name || item.month); // Support both structures
        const data = monthlyData.map(item => item.amount);
        const backgroundColors = generateColors(labels.length);

        monthlyChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Monthly Spending',
                    data: data,
                    backgroundColor: 'rgba(100, 255, 218, 0.8)', // Neon teal
                    hoverBackgroundColor: 'rgba(100, 255, 218, 1)',
                    borderRadius: 6,
                    borderSkipped: false,
                    barThickness: 'flex',
                    maxBarThickness: 45
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: {
                    padding: { top: 20, right: 20, bottom: 0, left: 10 }
                },
                scales: {
                    x: {
                        grid: { display: false, drawBorder: false },
                        ticks: { color: '#a0aabf', font: { family: "'Inter', sans-serif", size: 12 } }
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(255, 255, 255, 0.05)', drawBorder: false },
                        border: { display: false },
                        ticks: {
                            color: '#a0aabf',
                            font: { family: "'Inter', sans-serif", size: 12 },
                            padding: 10,
                            callback: function (value) {
                                return '$' + value;
                            }
                        }
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(26, 29, 36, 0.95)',
                        titleColor: '#a0aabf',
                        bodyColor: '#64ffda',
                        titleFont: { size: 13, weight: 'normal' },
                        bodyFont: { size: 16, weight: 'bold' },
                        borderColor: 'rgba(100, 255, 218, 0.3)',
                        borderWidth: 1,
                        padding: 12,
                        displayColors: false,
                        callbacks: {
                            label: function (context) {
                                return '$' + context.raw.toFixed(2);
                            }
                        }
                    }
                }
            }
        });
    }

    // Update recent expenses list
    function updateRecentExpenses(expenses) {
        const list = document.getElementById('expenses-list');
        const noExpenses = document.getElementById('no-expenses');

        if (!list) return;

        list.innerHTML = '';

        if (!expenses || expenses.length === 0) {
            if (noExpenses) noExpenses.style.display = 'block';
            return;
        }

        if (noExpenses) noExpenses.style.display = 'none';

        expenses.forEach(expense => {
            const li = document.createElement('li');
            li.className = 'exp-item';
            li.innerHTML = `
                <div class="exp-details">
                    <div class="exp-cat">${expense.category || 'Uncategorized'}</div>
                    <div class="exp-desc">${expense.description || 'No description'}</div>
                    <div class="exp-date">${new Date(expense.created_at || expense.date).toLocaleDateString()}</div>
                </div>
                </div>
                <div class="exp-amount">$${parseFloat(expense.value || expense.amount).toFixed(2)}</div>
                <div class="exp-actions">
                    <button class="exp-edit" data-id="${expense.id}" title="Edit">âœŽ</button>
                    <button class="exp-del" data-id="${expense.id}" title="Delete">Ã—</button>
                </div>
            `;

            // Add event listeners
            const deleteBtn = li.querySelector('.exp-del');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', () => handleDeleteExpense(expense.id));
            }

            const editBtn = li.querySelector('.exp-edit');
            if (editBtn) {
                editBtn.addEventListener('click', () => handleEditExpense(expense.id));
            }

            list.appendChild(li);
        });
    }

    // Handle expense deletion
    async function handleDeleteExpense(expenseId) {
        if (!confirm('Are you sure you want to delete this expense?')) {
            return;
        }

        try {
            const recaptcha_token = typeof window.getRecaptchaToken === 'function'
                ? await window.getRecaptchaToken('delete_expense')
                : null;

            // Build URL with recaptcha token as query param to avoid body-on-DELETE issues
            const url = `/api/expenses/${expenseId}`;
            const response = await fetch(url, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                    'X-CSRFToken': getCsrfToken()
                }
            });

            if (response.ok) {
                showMessage(globalMsg, 'âœ“ Expense deleted successfully!', 'success');
                await loadExpenses(); // Refresh the data
            } else {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.error || data.message || 'Failed to delete expense');
            }
        } catch (error) {
            console.error('Error deleting expense:', error);
            showMessage(globalMsg, error.message || 'Failed to delete expense. Please try again.', 'error');
        }
    }

    // Handle Edit Expense
    async function handleEditExpense(expenseId) {
        try {
            // Fetch expense details
            const response = await fetch(`/api/expenses/${expenseId}?t=${Date.now()}`);
            if (!response.ok) throw new Error('Failed to fetch expense details');

            const expense = await response.json();

            // Populate modal
            document.getElementById('edit-id').value = expense.id;
            document.getElementById('edit-value').value = expense.value || expense.amount;
            document.getElementById('edit-category').value = expense.category;
            document.getElementById('edit-description').value = expense.description;

            // Show modal
            const modal = document.getElementById('edit-expense-modal');
            if (modal) {
                modal.style.display = 'flex';
                // Focus first input
                setTimeout(() => document.getElementById('edit-value')?.focus(), 100);
            }
        } catch (error) {
            console.error('Error fetching expense details:', error);
            showMessage(globalMsg, 'Failed to load expense for editing', 'error');
        }
    }

    // Close Edit Modal
    function closeEditModal() {
        const modal = document.getElementById('edit-expense-modal');
        if (modal) modal.style.display = 'none';
        document.getElementById('edit-expense-form')?.reset();
    }

    // Init Edit Modal Events
    const editModal = document.getElementById('edit-expense-modal');
    const editForm = document.getElementById('edit-expense-form');
    const editCancelBtn = document.getElementById('edit-cancel-btn');

    if (editCancelBtn) editCancelBtn.addEventListener('click', closeEditModal);

    if (editForm) {
        editForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('edit-id').value;
            const data = {
                value: document.getElementById('edit-value').value,
                category: document.getElementById('edit-category').value,
                description: document.getElementById('edit-description').value
            };

            try {
                const recaptcha_token = typeof window.getRecaptchaToken === 'function'
                    ? await window.getRecaptchaToken('edit_expense')
                    : null;

                const response = await fetch(`/api/expenses/${id}`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCsrfToken()
                    },
                    body: JSON.stringify({ ...data, recaptcha_token })
                });

                if (response.ok) {
                    showMessage(globalMsg, 'Expense updated successfully!', 'success');
                    closeEditModal();
                    await loadExpenses();
                } else {
                    const err = await response.json();
                    throw new Error(err.error || 'Failed to update expense');
                }
            } catch (error) {
                console.error('Update error:', error);
                showMessage(globalMsg, error.message, 'error');
            }
        });
    }

    // Close modal on outside click
    window.addEventListener('click', (e) => {
        if (e.target === editModal) closeEditModal();
    });

    // Handle all expenses deletion
    async function handleDeleteAllExpenses() {
        const count = document.getElementById('expenses-list')?.children?.length || 0;
        if (count === 0) {
            showMessage('No expenses to delete.', 'info');
            return;
        }

        if (!confirm(`Are you sure you want to delete ALL ${count} expenses? This action cannot be undone.`)) {
            return;
        }

        try {
            const recaptcha_token = typeof window.getRecaptchaToken === 'function'
                ? await window.getRecaptchaToken('delete_all_expenses')
                : null;

            const response = await fetch('/api/expenses/all', {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                    'X-CSRFToken': getCsrfToken()
                },
                body: JSON.stringify({ recaptcha_token })
            });

            if (response.ok) {
                showMessage(globalMsg, 'All expenses deleted successfully!', 'success');
                await loadExpenses(); // Refresh the data
            } else {
                const data = await response.json();
                throw new Error(data.error || 'Failed to delete all expenses');
            }
        } catch (error) {
            console.error('Error deleting all expenses:', error);
            showMessage(globalMsg, error.message || 'Failed to delete all expenses. Please try again.', 'error');
        }
    }

    // Local message function is removed - using common.js version

    // Generate premium distinct colors for charts
    function generateColors(count) {
        // High-end UI dashboard palette
        const premiumPalette = [
            '#64ffda', // Neon Teal
            '#8b5cf6', // Vivid Purple
            '#f43f5e', // Rose Red
            '#3b82f6', // Bright Blue
            '#eab308', // Sunflower Gold
            '#10b981', // Emerald Green
            '#ec4899', // Pink
            '#f97316', // Orange
            '#06b6d4', // Cyan
            '#84cc16'  // Lime
        ];

        const colors = [];
        for (let i = 0; i < count; i++) {
            colors.push(premiumPalette[i % premiumPalette.length]);
        }
        return colors;
    }

    // Initialize the dashboard
    initDashboard();

    // Initialize expenses list
    initExpensesList();

    // Set up delete account button if it exists
    const deleteAccountBtn = document.getElementById('delete-account-btn');
    if (deleteAccountBtn) {
        deleteAccountBtn.addEventListener('click', handleDeleteAccount);
    }

    // Expose functions to window for other scripts to access
    window.loadExpenses = loadExpenses;
    window.loadBudget = loadBudget;
    window.showMessage = showMessage;
});

// Handle delete account
async function handleDeleteAccount() {
    // Show confirmation dialog
    const confirmed = confirm(' WARNING: This will permanently delete your account and all associated data. This action cannot be undone.\n\nAre you sure you want to delete your account?');

    if (!confirmed) return;

    try {
        const response = await fetch('/api/auth/account', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCsrfToken()
            },
            body: JSON.stringify({ confirm: true })
        });

        const data = await response.json();

        if (response.ok) {
            alert('Your account has been successfully deleted. You will be redirected to the home page.');
            window.location.href = '/';
        } else {
            throw new Error(data.error || 'Failed to delete account');
        }
    } catch (error) {
        console.error('Error deleting account:', error);
        showMessage(globalMsg, error.message || 'Failed to delete account. Please try again.', 'error');
    }
}

// Initialize expenses list observer
function initExpensesList() {
    const list = document.getElementById('expenses-list');
    const empty = document.getElementById('no-expenses');

    if (list && empty) {
        const observer = new MutationObserver(() => {
            const hasItems = list.children.length > 0;
            empty.style.display = hasItems ? 'none' : 'block';
        });

        observer.observe(list, { childList: true });

        // Initial check
        empty.style.display = list.children.length === 0 ? 'block' : 'none';
    }
}

// Budget functionality
async function loadBudget() {
    try {
        const res = await fetch('/api/expenses/budget', {
            method: 'GET',
            credentials: 'include',
            headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
        });
        const budget = res.ok ? await res.json() : null;

        if (budget && budget.amount != null) {
            // Budget exists
            window.currentBudgetAmount = budget.amount;
            window.currentBudgetPeriod = budget.period;

            const display = document.getElementById('budget-display');
            const controls = document.getElementById('budget-controls');
            const addBtn = document.getElementById('add-budget-btn');
            const removeBtn = document.getElementById('remove-budget-btn');
            if (display) {
                display.innerHTML = `<p>Budget: $${parseFloat(budget.amount).toFixed(2)} (${budget.period})</p>`;
            }
            if (controls) {
                controls.style.display = 'block';
                if (addBtn) addBtn.style.display = 'none';
                if (removeBtn) removeBtn.style.display = 'inline-block';
            }

            // Refresh expenses to update remaining budget display
            if (typeof loadExpenses === 'function') {
                await loadExpenses();
            }
        } else {
            // No budget set
            window.currentBudgetAmount = 0;
            window.currentBudgetPeriod = 'monthly';
            const display = document.getElementById('budget-display');
            const controls = document.getElementById('budget-controls');
            const addBtn = document.getElementById('add-budget-btn');
            const removeBtn = document.getElementById('remove-budget-btn');
            if (display) display.innerHTML = '<p>No budget set</p>';
            if (controls) {
                controls.style.display = 'block';
                if (addBtn) addBtn.style.display = 'inline-block';
                if (removeBtn) removeBtn.style.display = 'none';
            }
        }
    } catch (e) {
        // ignore transient network errors
    }
}

function setupBudgetEvents() {
    const addBtn = document.getElementById('add-budget-btn');
    const removeBtn = document.getElementById('remove-budget-btn');
    const saveBtn = document.getElementById('save-budget-btn');
    const cancelBtn = document.getElementById('cancel-budget-btn');
    const form = document.getElementById('budget-form');
    const amountInput = document.getElementById('budget-amount');
    const periodSelect = document.getElementById('budget-period');
    const msg = document.getElementById('budget-msg');

    if (addBtn) {
        addBtn.addEventListener('click', () => {
            if (form) form.style.display = 'block';
            if (amountInput) amountInput.value = '';
            if (periodSelect) periodSelect.value = 'monthly';
            if (msg) msg.textContent = '';
        });
    }
    if (removeBtn) {
        removeBtn.addEventListener('click', async () => {
            try {
                const res = await fetch('/api/expenses/budget', {
                    method: 'DELETE',
                    credentials: 'include',
                    headers: {
                        'Accept': 'application/json',
                        'X-CSRFToken': getCsrfToken(),
                        'X-Requested-With': 'XMLHttpRequest'
                    }
                });
                const data = await res.json();
                if (res.ok) {
                    if (msg) msg.textContent = 'Budget removed';
                    await loadBudget();
                } else {
                    if (msg) msg.textContent = data.error || 'Failed to remove budget';
                }
            } catch (e) {
                if (msg) msg.textContent = 'Error removing budget';
            }
        });
    }
    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            const amount = parseFloat(amountInput?.value || '');
            const period = periodSelect?.value || 'monthly';
            if (!Number.isFinite(amount) || amount <= 0) {
                if (msg) msg.textContent = 'Enter a valid amount';
                return;
            }
            try {
                const res = await fetch('/api/expenses/budget', {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'X-CSRFToken': getCsrfToken(),
                        'X-Requested-With': 'XMLHttpRequest'
                    },
                    body: JSON.stringify({ amount, period })
                });
                const data = await res.json();
                if (res.ok) {
                    if (msg) msg.textContent = 'Budget saved';
                    if (form) form.style.display = 'none';
                    await loadBudget();
                } else {
                    if (msg) msg.textContent = data.error || 'Failed to save budget';
                }
            } catch (e) {
                if (msg) msg.textContent = 'Error saving budget';
            }
        });
    }
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            if (form) form.style.display = 'none';
            if (msg) msg.textContent = '';
        });
    }
}

// Initialize budget on load
document.addEventListener('DOMContentLoaded', () => {
    loadBudget();
    setupBudgetEvents();
});
