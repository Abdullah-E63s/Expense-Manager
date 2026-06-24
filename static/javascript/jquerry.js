// Basic frontend logic for auth and expense CRUD using Fetch API

const API = {
  signup: "/api/auth/signup",
  verify: "/api/auth/verify-email",
  resend: "/api/auth/resend-code",
  login: "/api/auth/login",
  logout: "/api/auth/logout",
  changePassword: "/api/auth/change-password",
  forgot: "/api/auth/forgot-password",
  reset: "/api/auth/reset-password",
  google: "/api/auth/google",
  expenses: "/api/expenses",
  analytics: "/api/expenses/analytics",
};

async function fetch(url, options = {}) {
  const defaultHeaders = { "Content-Type": "application/json" };
  const opts = {
    credentials: "same-origin",
    ...options,
  };
  if (!(opts.body instanceof FormData)) {
    opts.headers = { ...(opts.headers || {}), ...defaultHeaders };
  }
  const res = await fetch(url, opts);
  let data = null;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    data = await res.json();
  } else {
    data = await res.text();
  }
  if (!res.ok) {
    const msg = data && data.error ? data.error : res.statusText;
    throw new Error(msg);
  }
  return data;
}

function $(selector) {
  return document.querySelector(selector);
}

function showMessage(targetSelector, message, type = "info") {
  const el = $(targetSelector);
  if (!el) return;
  el.textContent = message;
  el.className = `msg ${type}`;
}

// ---------- Auth ----------
async function handleSignup(e) {
  const email = $("#signup-email")?.value?.trim().toLowerCase();
  const password = $("#signup-password")?.value || "";
  const confirmPassword = $("#confirm-password")?.value || "";

  // Client-side validation
  if (password !== confirmPassword) {
    showMessage("#signup-msg", "Passwords do not match.", "error");
    return;
  }

  // Password strength validation
  if (password.length < 10) {
    showMessage("#signup-msg", "Password must be at least 10 characters long.", "error");
    return;
  }

  try {
    await fetch(API.signup, {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    showMessage("#signup-msg", "Check your email for the verification code.", "success");
    $("#verify-section")?.classList?.remove("hidden");
  } catch (err) {
    showMessage("#signup-msg", err.message, "error");
  }
}

async function handleVerify(e) {
  e.preventDefault();
  const email = $("#signup-email")?.value?.trim().toLowerCase();
  const code = $("#verify-code")?.value?.trim();
  try {
    await fetch(API.verify, {
      method: "POST",
      body: JSON.stringify({ email, code }),
    });
    showMessage("#signup-msg", "Email verified. You can log in now.", "success");
  } catch (err) {
    showMessage("#signup-msg", err.message, "error");
  }
}

async function handleResend(e) {
  e.preventDefault();
  const email = $("#signup-email")?.value?.trim().toLowerCase();
  try {
    await fetch(API.resend, { method: "POST", body: JSON.stringify({ email }) });
    showMessage("#signup-msg", "If the email exists, a new code was sent.", "success");
  } catch (err) {
    showMessage("#signup-msg", err.message, "error");
  }
}

async function handleLogin(e) {
  e.preventDefault();

  // Get form elements
  const form = e.target;
  const email = form.querySelector('#login-email')?.value.trim().toLowerCase();
  const password = form.querySelector('#login-password')?.value || '';
  const loginButton = form.querySelector('button[type="submit"]');
  const messageElement = document.getElementById('login-msg');

  // Validate inputs
  if (!email || !password) {
    showMessage(messageElement, 'Please fill in all fields', 'error');
    return;
  }

  // Update UI
  if (loginButton) {
    loginButton.disabled = true;
    loginButton.textContent = 'Logging in...';
  }

  // Clear any previous messages
  if (messageElement) {
    messageElement.textContent = '';
    messageElement.className = 'msg';
  }

  try {
    console.log('Attempting login with:', { email });
    const response = await fetch('/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ email, password }),
      credentials: 'same-origin'
    });

    console.log('Login response status:', response.status);

    // Handle response
    if (response.headers.get('content-type')?.includes('application/json')) {
      const data = await response.json();
      console.log('Login response data:', data);

      if (response.ok) {
        // Successful login
        showMessage(messageElement, 'Login successful! Redirecting...', 'success');
        window.location.href = data.redirect || '/';
      } else {
        // Error response
        showMessage(messageElement, data.error || 'Login failed. Please try again.', 'error');
      }
    } else {
      // Non-JSON response
      const text = await response.text();
      console.error('Non-JSON response:', text);
      showMessage(messageElement, 'Unexpected server response', 'error');
    }
  } catch (error) {
    console.error('Login error:', error);
    showMessage(messageElement, 'An error occurred. Please try again.', 'error');
  } finally {
    // Reset button state
    if (loginButton) {
      loginButton.disabled = false;
      loginButton.textContent = 'Log in';
    }
  }
}

async function handleLogout(e) {
  e?.preventDefault?.();
  try {
    await fetch(API.logout, { method: "POST" });
    window.location.href = "/";
  } catch (err) {
    showMessage("#global-msg", err.message, "error");
  }
}

// Email verification from login page
async function handleLoginVerify(e) {
  e.preventDefault();
  const email = document.querySelector('#verify-email')?.value?.trim().toLowerCase();
  const code = document.querySelector('#verify-code')?.value?.trim();
  try {
    await fetch(API.verify, { method: 'POST', body: JSON.stringify({ email, code }) });
    showMessage('#verify-msg', 'Email verified! You can now log in.', 'success');
    $("#verify-section")?.classList?.add("hidden");
  } catch (err) {
    showMessage('#verify-msg', err.message, 'error');
  }
}

async function handleResendLoginCode(e) {
  e.preventDefault();
  const email = document.querySelector('#verify-email')?.value?.trim().toLowerCase();
  if (!email) {
    showMessage('#verify-msg', 'Please enter your email first.', 'error');
    return;
  }
  try {
    await fetch(API.resend, { method: 'POST', body: JSON.stringify({ email }) });
    showMessage('#verify-msg', 'If the email exists, a new code was sent.', 'success');
  } catch (err) {
    showMessage('#verify-msg', err.message, 'error');
  }
}

// Forgot/Reset flows
async function handleForgot(e) {
  e.preventDefault();
  const email = document.querySelector('#forgot-email')?.value?.trim().toLowerCase();
  try {
    await fetch(API.forgot, { method: 'POST', body: JSON.stringify({ email }) });
    showMessage('#forgot-msg', 'If the email exists, a reset code was sent.', 'success');
  } catch (err) {
    showMessage('#forgot-msg', err.message, 'error');
  }
}

async function handleReset(e) {
  e.preventDefault();
  const email = document.querySelector('#reset-email')?.value?.trim().toLowerCase();
  const code = document.querySelector('#reset-code')?.value?.trim();
  const newPassword = document.querySelector('#reset-password')?.value || '';
  try {
    await fetch(API.reset, { method: 'POST', body: JSON.stringify({ email, code, new_password: newPassword }) });
    showMessage('#reset-msg', 'Password has been reset. You can log in now.', 'success');
  } catch (err) {
    showMessage('#reset-msg', err.message, 'error');
  }
}

// Password strength hint
document.addEventListener('input', (e) => {
  const el = e.target;
  if (!(el instanceof HTMLElement)) return;
  if (el.id === 'signup-password') {
    const hint = document.querySelector('#password-hint');
    if (!hint) return;
    const val = el.value || '';
    const ok = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{10,}$/.test(val);
    hint.textContent = ok ? 'Strong password' : 'Must be 10+ chars with letter, number, symbol';
    hint.className = 'msg ' + (ok ? 'success' : 'error');
  }
});

// Google Sign-in handler
async function handleCredentialResponse(response) {
  console.log("Google Sign-In response received");
  const idToken = response.credential;

  if (!idToken) {
    console.error("No ID token in Google Sign-In response");
    showMessage("#global-msg", "Authentication failed: No token received from Google", "error");
    return;
  }

  try {
    console.log("Sending ID token to backend for verification...");

    const res = await fetch(API.google, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Requested-With': 'XMLHttpRequest'  // Helps identify AJAX requests
      },
      credentials: 'include',  // Important for cookies/session
      body: JSON.stringify({
        idToken: idToken
      }),
    });

    const data = await res.json();
    console.log("Backend response:", data);

    if (res.ok) {
      if (data.success) {
        if (data.needs_password && data.redirect) {
          // If user needs to set a password, redirect to the password setup page
          console.log("Redirecting to set password page...");
          window.location.href = data.redirect;
        } else {
          // Regular successful login
          console.log("Authentication successful, redirecting to dashboard...");
          showMessage("#global-msg", "Login successful!", "success");
          // Small delay to show the success message
          setTimeout(() => {
            window.location.href = '/dashboard';
          }, 1000);
        }
      } else {
        const errorMsg = data.message || 'Authentication failed';
        console.error("Authentication failed:", errorMsg);
        showMessage("#global-msg", `Authentication failed: ${errorMsg}`, "error");
      }
    } else {
      const errorMsg = data && data.message
        ? data.message
        : (data && data.error
          ? data.error
          : `Server error: ${res.status} ${res.statusText}`);

      console.error("Server error:", errorMsg);
      showMessage("#global-msg", `Authentication failed: ${errorMsg}`, "error");
    }
  } catch (error) {
    console.error("Error during Google Sign-In:", error);
    showMessage(
      "#global-msg",
      `An error occurred: ${error.message || 'Please check your connection and try again.'}`,
      "error"
    );
  }
}

// ---------- Expenses ----------
async function loadExpenses() {
  try {
    const data = await fetch(API.expenses);
    const list = $("#expenses-list");
    if (!list) return;
    list.innerHTML = "";
    (data.items || []).forEach((exp) => {
      const li = document.createElement("li");
      li.dataset.id = exp.id;
      li.innerHTML = `
        <div class="exp-row">
          <span class="exp-cat">${exp.category || ""}</span>
          <span class="exp-desc">${exp.description || ""}</span>
          <span class="exp-val">$${Number(exp.value).toFixed(2)}</span>
          ${exp.picture_url ? `<img src="${exp.picture_url}" alt="receipt" class="exp-img"/>` : ""}
          <button class="exp-edit" data-id="${exp.id}">Edit</button>
          <button class="exp-del" data-id="${exp.id}">Delete</button>
        </div>
      `;
      list.appendChild(li);
    });
    // Also load analytics after expenses are loaded
    await loadAnalytics();
  } catch (err) {
    showMessage("#global-msg", err.message, "error");
  }
}

// Analytics and Charts
let categoryChart = null;
let monthlyChart = null;

async function loadAnalytics() {
  try {
    const data = await fetch(API.analytics);

    // Update overview stats
    $("#total-amount").textContent = `$${data.total_amount.toFixed(2)}`;
    $("#total-expenses").textContent = data.total_expenses;
    $("#average-expense").textContent = `$${data.average_expense.toFixed(2)}`;

    // Create category chart
    createCategoryChart(data.category_breakdown);

    // Create monthly chart
    createMonthlyChart(data.monthly_breakdown);

  } catch (err) {
    console.error("Failed to load analytics:", err);
  }
}

function createCategoryChart(categoryData) {
  const ctx = document.getElementById("categoryChart");
  if (!ctx) return;

  if (categoryChart) categoryChart.destroy();

  const labels = Object.keys(categoryData);
  const values = Object.values(categoryData);

  // Get the container to calculate max height
  const container = ctx.closest('.panel');

  categoryChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: labels,
      datasets: [{
        data: values,
        backgroundColor: [
          "#3b82f6", "#ef4444", "#22c55e", "#f59e0b",
          "#8b5cf6", "#06b6d4", "#84cc16", "#f97316"
        ],
        borderWidth: 2,
        borderColor: "var(--panel)"
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 1.5,
      layout: {
        padding: 10
      },
      plugins: {
        legend: {
          position: 'right',
          labels: {
            color: "var(--text)",
            padding: 15,
            boxWidth: 12,
            font: {
              size: 12
            }
          }
        }
      }
    }
  });

  // Handle window resize
  const resizeObserver = new ResizeObserver(entries => {
    categoryChart.resize();
  });

  if (container) {
    resizeObserver.observe(container);
  }

  // Cleanup on chart destroy
  ctx._resizeObserver = resizeObserver;
}

function createMonthlyChart(monthlyData) {
  const ctx = document.getElementById("monthlyChart");
  if (!ctx) return;

  if (monthlyChart) monthlyChart.destroy();

  // Sort months chronologically
  const sortedMonths = Object.keys(monthlyData).sort();
  const values = sortedMonths.map(month => monthlyData[month]);

  // Get the container to calculate max height
  const container = ctx.closest('.panel');

  monthlyChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: sortedMonths,
      datasets: [{
        label: "Monthly Spending",
        data: values,
        backgroundColor: "var(--primary)",
        borderColor: "var(--primary-600)",
        borderWidth: 1,
        barPercentage: 0.7,
        categoryPercentage: 0.8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 1.5,
      layout: {
        padding: {
          top: 10,
          right: 15,
          bottom: 10,
          left: 10
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            color: "var(--text)",
            maxRotation: 0,
            padding: 5
          },
          grid: {
            color: "var(--border)",
            drawBorder: false
          }
        },
        x: {
          ticks: {
            color: "var(--text)",
            maxRotation: 45,
            minRotation: 45,
            padding: 5
          },
          grid: {
            display: false,
            drawBorder: false
          }
        }
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: 'rgba(17, 24, 39, 0.9)',
          titleColor: 'white',
          bodyColor: 'white',
          borderColor: 'var(--border)',
          borderWidth: 1,
          padding: 10,
          displayColors: false
        }
      }
    }
  });

  // Handle window resize
  const resizeObserver = new ResizeObserver(entries => {
    monthlyChart.resize();
  });

  if (container) {
    resizeObserver.observe(container);
  }

  // Cleanup on chart destroy
  ctx._resizeObserver = resizeObserver;
}

async function handleCreateExpense(e) {
  e.preventDefault();
  const form = $("#expense-form");
  if (!form) return;

  const useMultipart = !!$("#expense-image");
  let body;
  let headers;
  if (useMultipart) {
    body = new FormData();
    body.append("value", $("#expense-value")?.value || "");
    body.append("category", $("#expense-category")?.value || "");
    body.append("description", $("#expense-description")?.value || "");
    const file = $("#expense-image")?.files?.[0];
    if (file) body.append("image", file);
  } else {
    headers = { "Content-Type": "application/json" };
    body = JSON.stringify({
      value: $("#expense-value")?.value || "",
      category: $("#expense-category")?.value || "",
      description: $("#expense-description")?.value || "",
    });
  }

  try {
    await fetch(API.expenses, { method: "POST", body, headers });
    form.reset();
    await loadExpenses(); // This will also load analytics
    showMessage("#expense-msg", "Expense added.", "success");
  } catch (err) {
    showMessage("#expense-msg", err.message, "error");
  }
}

async function handleExpenseListClick(e) {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;
  const id = target.getAttribute("data-id");
  if (!id) return;

  if (target.classList.contains("exp-del")) {
    await deleteExpense(id);
  } else if (target.classList.contains("exp-edit")) {
    const row = target.closest(".exp-row");
    const currentVal = row.querySelector(".exp-val").textContent.replace("$", "");
    const currentCat = row.querySelector(".exp-cat").textContent;
    const currentDesc = row.querySelector(".exp-desc").textContent;

    openEditModal(id, currentVal, currentCat, currentDesc);
  }
}

function openEditModal(id, value, category, description) {
  const modal = $("#edit-expense-modal");
  if (!modal) return;

  $("#edit-id").value = id;
  $("#edit-value").value = value;
  $("#edit-category").value = category;
  $("#edit-description").value = description;

  modal.style.display = "flex";

  // Clean up any previous listeners to avoid duplicates
  const form = $("#edit-expense-form");
  const cancelBtn = $("#edit-cancel-btn");

  // Clone nodes to remove listeners is a quick hack, but better is to define the handler outside
  // For now, we'll just handle it by setting onclick properties which overrides previous ones
  // or by a dedicated init function. Let's stick to a robust pattern.
}

function closeEditModal() {
  const modal = $("#edit-expense-modal");
  if (modal) modal.style.display = "none";
}

async function handleEditSubmit(e) {
  e.preventDefault();
  const id = $("#edit-id").value;
  const value = $("#edit-value").value;
  const category = $("#edit-category").value;
  const description = $("#edit-description").value;

  await updateExpense(id, value, category, description);
  closeEditModal();
}

// Add these to the DOMContentLoaded listener block below
// For now, I'll export them or just let them be global scope helpers
window.closeEditModal = closeEditModal;

async function updateExpense(id, value, category, description) {
  const payload = {};
  if (value) payload.value = value;
  if (category) payload.category = category;
  if (description) payload.description = description;
  try {
    await fetch(`${API.expenses}/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    await loadExpenses(); // This will also refresh analytics
  } catch (err) {
    showMessage("#global-msg", err.message, "error");
  }
}

async function deleteExpense(id) {
  try {
    const res = await fetch(`${API.expenses}/${id}`, { method: "DELETE", credentials: "same-origin" });
    if (!res.ok && res.status !== 204) {
      const txt = await res.text();
      throw new Error(txt || res.statusText);
    }
    await loadExpenses(); // This will also refresh analytics
  } catch (err) {
    showMessage("#global-msg", err.message, "error");
  }
}

// ---------- Wire up on DOM ready ----------
document.addEventListener("DOMContentLoaded", () => {
  // Only attach event listeners if the elements exist
  const signupForm = $("#signup-form");
  if (signupForm) signupForm.addEventListener("submit", handleSignup);

  const verifyForm = $("#verify-form");
  if (verifyForm) verifyForm.addEventListener("submit", handleVerify);

  const resendCode = $("#resend-code");
  if (resendCode) resendCode.addEventListener("click", handleResend);

  const loginForm = $("#login-form");
  if (loginForm) loginForm.addEventListener("submit", handleLogin);

  const logoutBtn = $("#logout-btn");
  if (logoutBtn && !logoutBtn.dataset.boundLogout) {
    logoutBtn.addEventListener("click", handleLogout);
    logoutBtn.dataset.boundLogout = '1';
  }

  const changePwdForm = $("#change-password-form");
  if (changePwdForm) changePwdForm.addEventListener("submit", handleChangePassword);

  const forgotForm = $("#forgot-form");
  if (forgotForm) forgotForm.addEventListener("submit", handleForgot);

  const resetForm = $("#reset-form");
  if (resetForm) resetForm.addEventListener("submit", handleReset);

  // Google Sign-In button is now handled in the module

  // Load expenses if on dashboard and the expenses list element exists
  if (window.location.pathname === "/dashboard" && $("#expenses-list")) {
    loadExpenses();
  }

  // Handle expense list click events if the element exists
  const expensesList = $("#expenses-list");
  if (expensesList) {
    expensesList.addEventListener("click", handleExpenseListClick);
  }

  // Handle expense form submission if the form exists
  const expenseForm = $("#expense-form");
  if (expenseForm) {
    expenseForm.addEventListener("submit", handleCreateExpense);
  }

  // Edit Expense Modal Listeners
  const editForm = $("#edit-expense-form");
  if (editForm) {
    editForm.addEventListener("submit", handleEditSubmit);
  }
  const editCancelBtn = $("#edit-cancel-btn");
  if (editCancelBtn) {
    editCancelBtn.addEventListener("click", closeEditModal);
  }
  // Close modal when clicking outside
  const editModal = $("#edit-expense-modal");
  if (editModal) {
    editModal.addEventListener("click", (e) => {
      if (e.target === editModal) closeEditModal();
    });
  }
});


