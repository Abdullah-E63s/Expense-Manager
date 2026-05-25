// Admin Dashboard JavaScript

document.addEventListener('DOMContentLoaded', () => {
    // Initialize any dashboard-specific functionality
    initDashboardCharts();
    loadRecentActivity();
});

// Initialize dashboard charts
function initDashboardCharts() {
    // Example: Initialize a chart if the element exists
    const ctx = document.getElementById('expenseChart');
    if (ctx) {
        new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
                datasets: [{
                    label: 'Expenses',
                    data: [1200, 1900, 1500, 2000, 1800, 2200],
                    backgroundColor: 'rgba(78, 115, 223, 0.8)',
                    borderColor: 'rgba(78, 115, 223, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true
                    }
                }
            }
        });
    }
}

// Load recent activity
function loadRecentActivity() {
    // This would typically be an AJAX call to your backend
    // For now, we'll simulate it with a timeout
    setTimeout(() => {
        const activityContainer = document.getElementById('recentActivity');
        if (activityContainer) {
            // Simulated data - replace with actual API call
            const activities = [
                { user: 'John Doe', action: 'added a new expense', time: '2 minutes ago' },
                { user: 'Jane Smith', action: 'updated profile', time: '10 minutes ago' },
                { user: 'Admin', action: 'deleted a user', time: '1 hour ago' },
                { user: 'Mike Johnson', action: 'added a new expense', time: '2 hours ago' },
                { user: 'Sarah Williams', action: 'updated profile', time: '5 hours ago' }
            ];

            const activityHtml = activities.map(activity => `
                <div class="activity-item mb-3">
                    <div class="d-flex justify-content-between">
                        <strong>${activity.user}</strong>
                        <small class="text-muted">${activity.time}</small>
                    </div>
                    <div>${activity.action}</div>
                </div>
            `).join('');

            activityContainer.innerHTML = activityHtml;
        }
    }, 500);
}

// Export functions if needed
window.Dashboard = {
    initDashboardCharts,
    loadRecentActivity
};
