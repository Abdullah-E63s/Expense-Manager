"""Admin routes for the Expense Manager application."""
from flask import Blueprint, render_template, request, redirect, url_for, flash, jsonify, session, abort
from functools import wraps
from models import User, Expense, execute_query, get_db
from datetime import datetime, timedelta
from decimal import Decimal
import logging
import traceback
from werkzeug.security import generate_password_hash

# Create admin blueprint
admin_bp = Blueprint('admin', __name__, url_prefix='/admin')

def admin_required(f):
    """Decorator to ensure the user is an admin."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            flash('Please log in to access the admin panel.', 'danger')
            return redirect(url_for('admin_login'))
            
        user = User.get_by_id(session['user_id'])
        if not user or not user.is_admin:
            flash('You do not have permission to access this page.', 'danger')
            return redirect(url_for('pages.dashboard'))
            
        return f(*args, **kwargs)
    return decorated_function

@admin_bp.route('/')
@admin_bp.route('/dashboard')  # alias so JS redirect to /admin/dashboard works
@admin_required
def admin_dashboard():
    """Admin dashboard with system overview."""
    try:
        total_expenses_row = execute_query("""
            SELECT COUNT(*) as count, COALESCE(SUM(value), 0) as total 
            FROM expenses WHERE deleted_at IS NULL
        """, fetch_one=True) or {'count': 0, 'total': 0}

        recent_expenses_raw = execute_query("""
            SELECT e.id, e.description, e.value, e.category, e.created_at,
                   u.email, u.first_name, u.last_name
            FROM expenses e
            JOIN users u ON e.user_id = u.id
            WHERE e.deleted_at IS NULL
            ORDER BY e.created_at DESC
            LIMIT 10
        """, fetch_all=True) or []

        # Convert Decimal → float so Jinja2 format filter doesn't choke
        stats = {
            'total_users': execute_query(
                "SELECT COUNT(*) as count FROM users WHERE deleted_at IS NULL",
                fetch_one=True
            )['count'],
            'active_users': execute_query("""
                SELECT COUNT(DISTINCT user_id) as count FROM expenses
                WHERE created_at >= %s
            """, ((datetime.now() - timedelta(days=30)).strftime('%Y-%m-%d %H:%M:%S'),),
                fetch_one=True
            )['count'],
            'total_expenses': {
                'count': int(total_expenses_row['count']),
                'total': float(total_expenses_row['total']),
            },
            'recent_expenses': [
                {**row, 'value': float(row['value']) if row.get('value') is not None else 0.0,
                 'created_at': row['created_at'] if isinstance(row.get('created_at'), datetime)
                               else datetime.now()}
                for row in recent_expenses_raw
            ]
        }

        return render_template('admin/dashboard.html', stats=stats, now=datetime.now())
    except Exception as e:
        logging.error(f"Admin dashboard error: {e}\n{traceback.format_exc()}")
        flash(f'Dashboard error: {e}', 'danger')
        return redirect(url_for('admin_login'))

@admin_bp.route('/users')
@admin_required
def manage_users():
    """View and manage all users — including soft-deleted ones."""
    try:
        users = execute_query("""
            SELECT id, email, first_name, last_name, is_active, is_admin,
                   created_at, last_login_at, deleted_at
            FROM users
            ORDER BY deleted_at IS NULL DESC, created_at DESC
        """, fetch_all=True) or []
        # Pass the logged-in admin's id so the template can guard self-actions
        current_admin_id = session.get('user_id')
        return render_template('admin/users.html', users=users, current_admin_id=current_admin_id)
    except Exception as e:
        logging.error(f"Error fetching users: {e}\n{traceback.format_exc()}")
        flash('An error occurred while fetching users.', 'danger')
        return redirect(url_for('admin.admin_dashboard'))

@admin_bp.route('/users/<int:user_id>/toggle', methods=['POST'])
@admin_required
def toggle_user_status(user_id):
    """Toggle a user's active status."""
    try:
        if user_id == session.get('user_id'):
            flash('You cannot deactivate your own account from here.', 'danger')
            return redirect(url_for('admin.manage_users'))
            
        user = User.get_by_id(user_id)
        if not user:
            flash('User not found.', 'danger')
            return redirect(url_for('admin.manage_users'))
            
        user.is_active = not user.is_active
        user.save()
        
        status = 'activated' if user.is_active else 'deactivated'
        flash(f'User {user.email} has been {status}.', 'success')
        return redirect(url_for('admin.manage_users'))
    except Exception as e:
        logging.error(f"Error toggling user status: {str(e)}")
        flash('An error occurred while updating the user.', 'danger')
        return redirect(url_for('admin.manage_users'))

@admin_bp.route('/users/<int:user_id>/delete', methods=['POST'])
@admin_required
def delete_user(user_id):
    """Soft delete a user."""
    try:
        if user_id == session.get('user_id'):
            flash('You cannot delete your own account from here.', 'danger')
            return redirect(url_for('admin.manage_users'))
            
        user = User.get_by_id(user_id)
        if not user:
            flash('User not found.', 'danger')
            return redirect(url_for('admin.manage_users'))
            
        user.delete()
        flash(f'User {user.email} has been deleted.', 'success')
        return redirect(url_for('admin.manage_users'))
    except Exception as e:
        logging.error(f"Error deleting user: {str(e)}")
        flash('An error occurred while deleting the user.', 'danger')
        return redirect(url_for('admin.manage_users'))

@admin_bp.route('/users/<int:user_id>/restore', methods=['POST'])
@admin_required
def restore_user(user_id):
    """Restore a soft-deleted user."""
    try:
        user = User.get_by_id(user_id)
        if not user:
            flash('User not found.', 'danger')
            return redirect(url_for('admin.manage_users'))
            
        if user.deleted_at is None:
            flash('User is not deleted.', 'warning')
            return redirect(url_for('admin.manage_users'))
            
        user.restore()
        flash(f'User {user.email} has been restored.', 'success')
        return redirect(url_for('admin.manage_users'))
    except Exception as e:
        logging.error(f"Error restoring user: {str(e)}")
        flash('An error occurred while restoring the user.', 'danger')
        return redirect(url_for('admin.manage_users'))

@admin_bp.route('/expenses')
@admin_required
def manage_expenses():
    """View and manage all expenses."""
    try:
        page = request.args.get('page', 1, type=int)
        per_page = 20
        offset = (page - 1) * per_page

        total_expenses = execute_query("""
            SELECT COUNT(*) as count FROM expenses WHERE deleted_at IS NULL
        """, fetch_one=True)['count']

        expenses_raw = execute_query("""
            SELECT e.id, e.description, e.value, e.category, e.created_at,
                   e.picture_url, u.email, u.first_name, u.last_name
            FROM expenses e JOIN users u ON e.user_id = u.id
            WHERE e.deleted_at IS NULL
            ORDER BY e.created_at DESC
            LIMIT %s OFFSET %s
        """, [per_page, offset], fetch_all=True) or []

        # Convert Decimal/None safely
        expenses = [
            {**row,
             'value': float(row['value']) if row.get('value') is not None else 0.0,
             'created_at': row['created_at'] if isinstance(row.get('created_at'), datetime) else None}
            for row in expenses_raw
        ]

        total_pages = max(1, (total_expenses + per_page - 1) // per_page)

        # For filters
        users = execute_query(
            "SELECT id, email FROM users WHERE deleted_at IS NULL ORDER BY email",
            fetch_all=True) or []
        categories = [r['category'] for r in (execute_query(
            "SELECT DISTINCT category FROM expenses WHERE category IS NOT NULL AND deleted_at IS NULL ORDER BY category",
            fetch_all=True) or [])]

        return render_template('admin/expenses.html',
                               expenses=expenses,
                               page=page,
                               total_pages=total_pages,
                               users=users,
                               categories=categories,
                               now=datetime.now())
    except Exception as e:
        logging.error(f"Error fetching expenses: {e}\n{traceback.format_exc()}")
        flash('An error occurred while fetching expenses.', 'danger')
        return redirect(url_for('admin.admin_dashboard'))

@admin_bp.route('/expenses/<int:expense_id>/delete', methods=['POST'])
@admin_required
def delete_expense(expense_id):
    """Delete an expense."""
    try:
        expense = execute_query("""
            SELECT e.*, u.email 
            FROM expenses e
            JOIN users u ON e.user_id = u.id
            WHERE e.id = %s AND e.deleted_at IS NULL
        """, [expense_id], fetch_one=True)
        if not expense:
            flash('Expense not found or already deleted.', 'warning')
            return redirect(url_for('admin.manage_expenses'))
        execute_query("""
            UPDATE expenses SET deleted_at = NOW() WHERE id = %s
        """, [expense_id], commit=True)
        flash(f'Expense #{expense_id} has been deleted.', 'success')
        return redirect(url_for('admin.manage_expenses'))
    except Exception as e:
        logging.error(f"Error deleting expense: {str(e)}")
        flash('An error occurred while deleting the expense.', 'danger')
        return redirect(url_for('admin.manage_expenses'))

@admin_bp.route('/expenses/<int:expense_id>/update', methods=['GET', 'POST'])
@admin_required
def update_expense(expense_id):
    """View/edit a specific expense."""
    try:
        expense = execute_query("""
            SELECT e.*, u.email, u.first_name, u.last_name
            FROM expenses e JOIN users u ON e.user_id = u.id
            WHERE e.id = %s AND e.deleted_at IS NULL
        """, [expense_id], fetch_one=True)
        if not expense:
            flash('Expense not found.', 'warning')
            return redirect(url_for('admin.manage_expenses'))
        if request.method == 'POST':
            description = request.form.get('description', '').strip()
            value = request.form.get('value', 0)
            category = request.form.get('category', '').strip()
            execute_query("""
                UPDATE expenses SET description=%s, value=%s, category=%s, updated_at=NOW()
                WHERE id=%s
            """, [description, value, category or None, expense_id], commit=True)
            flash(f'Expense #{expense_id} updated.', 'success')
            return redirect(url_for('admin.manage_expenses'))
        return render_template('admin/edit_expense.html', expense=expense)
    except Exception as e:
        logging.error(f"Error updating expense: {e}")
        flash('An error occurred.', 'danger')
        return redirect(url_for('admin.manage_expenses'))

@admin_bp.route('/expenses/add', methods=['POST'])
@admin_required
def add_expense():
    """Admin adds an expense on behalf of a user."""
    try:
        user_id   = request.form.get('user_id')
        description = request.form.get('description', '').strip()
        value     = request.form.get('value', 0)
        category  = request.form.get('category', '').strip() or None
        created_at = request.form.get('created_at') or datetime.now().strftime('%Y-%m-%d')
        if not user_id or not value:
            flash('User and amount are required.', 'danger')
            return redirect(url_for('admin.manage_expenses'))
        execute_query("""
            INSERT INTO expenses (user_id, description, value, category, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, NOW())
        """, [user_id, description, value, category, created_at], commit=True)
        flash('Expense added successfully.', 'success')
        return redirect(url_for('admin.manage_expenses'))
    except Exception as e:
        logging.error(f"Error adding expense: {e}")
        flash('An error occurred while adding the expense.', 'danger')
        return redirect(url_for('admin.manage_expenses'))

@admin_bp.route('/categories')
@admin_required
def manage_categories():
    """View and manage expense categories."""
    try:
        # Get all categories with count of expenses
        categories = execute_query("""
            SELECT category, COUNT(*) as count
            FROM expenses
            WHERE category IS NOT NULL AND deleted_at IS NULL
            GROUP BY category
            ORDER BY count DESC
        """, fetch_all=True) or []
        
        return render_template('admin/categories.html', categories=categories)
    except Exception as e:
        logging.error(f"Error fetching categories: {str(e)}")
        flash('An error occurred while fetching categories.', 'danger')
        return redirect(url_for('admin.admin_dashboard'))

@admin_bp.route('/categories/update', methods=['POST'])
@admin_required
def update_category():
    """Update a category name."""
    try:
        old_name = request.form.get('old_name')
        new_name = request.form.get('new_name')
        
        if not old_name or not new_name:
            flash('Both old and new category names are required.', 'danger')
            return redirect(url_for('admin.manage_categories'))
            
        if old_name == new_name:
            flash('New category name is the same as the old one.', 'warning')
            return redirect(url_for('admin.manage_categories'))
            
        # Update all expenses with the old category name
        execute_query("""
            UPDATE expenses 
            SET category = %s 
            WHERE category = %s AND deleted_at IS NULL
        """, [new_name, old_name], commit=True)
        
        flash(f'Category "{old_name}" has been updated to "{new_name}".', 'success')
        return redirect(url_for('admin.manage_categories'))
    except Exception as e:
        logging.error(f"Error updating category: {str(e)}")
        flash('An error occurred while updating the category.', 'danger')
        return redirect(url_for('admin.manage_categories'))

@admin_bp.route('/categories/delete', methods=['POST'])
@admin_required
def delete_category():
    """Delete a category and remove it from expenses."""
    try:
        category = request.form.get('category')
        if not category:
            flash('Category name is required.', 'danger')
            return redirect(url_for('admin.manage_categories'))
        execute_query("""
            UPDATE expenses 
            SET category = NULL 
            WHERE category = %s AND deleted_at IS NULL
        """, [category], commit=True)
        flash(f'Category "{category}" has been deleted.', 'success')
        return redirect(url_for('admin.manage_categories'))
    except Exception as e:
        logging.error(f"Error deleting category: {str(e)}")
        flash('An error occurred while deleting the category.', 'danger')
        return redirect(url_for('admin.manage_categories'))

@admin_bp.route('/categories/add', methods=['POST'])
@admin_required
def add_category():
    """Add a new category by assigning it to uncategorized expenses (or just acknowledge)."""
    flash('Categories are created automatically when you assign them to expenses.', 'info')
    return redirect(url_for('admin.manage_categories'))

@admin_bp.route('/categories/merge', methods=['POST'])
@admin_required
def merge_categories():
    """Merge multiple categories into one target category."""
    try:
        categories_to_merge = request.form.getlist('categories_to_merge')
        target_category = request.form.get('target_category', '').strip()
        if not categories_to_merge or not target_category:
            flash('Select categories and enter a target name.', 'danger')
            return redirect(url_for('admin.manage_categories'))
        for cat in categories_to_merge:
            execute_query("""
                UPDATE expenses SET category = %s
                WHERE category = %s AND deleted_at IS NULL
            """, [target_category, cat], commit=True)
        flash(f'Merged {len(categories_to_merge)} categories into "{target_category}".', 'success')
        return redirect(url_for('admin.manage_categories'))
    except Exception as e:
        logging.error(f"Error merging categories: {e}")
        flash('An error occurred while merging categories.', 'danger')
        return redirect(url_for('admin.manage_categories'))


def create_admin_user():
    """Create the initial admin user if it doesn't exist."""
    try:
        admin_email = "abdullahjalalg@gmail.com"
        admin_password = "musa4200"
        
        # Check if admin user already exists
        existing_admin = execute_query(
            "SELECT id FROM users WHERE email = %s AND is_admin = TRUE", 
            [admin_email],
            fetch_one=True
        )
        
        if not existing_admin:
            # Create admin user
            password_hash = generate_password_hash(admin_password)
            execute_query("""
                INSERT INTO users 
                (email, password_hash, first_name, last_name, is_active, is_admin, is_verified)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, [
                admin_email,
                password_hash,
                "Admin",
                "User",
                True,  # is_active
                True,  # is_admin
                True   # is_verified
            ], commit=True)
            
            print("✅ Admin user created successfully!")
            print(f"Email: {admin_email}")
            print(f"Password: {admin_password}")
        else:
            print("ℹ️ Admin user already exists.")
            
    except Exception as e:
        print(f"❌ Error creating admin user: {str(e)}")
        raise
