document.getElementById("admin-login-form").addEventListener("submit", async (e) => {
  e.preventDefault();

  const username = document.getElementById("admin-username").value.trim();
  const password = document.getElementById("admin-password").value.trim();
  const msg = document.getElementById("login-msg");

  msg.textContent = "";
  msg.style.color = "#ff4d4d";

  const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';

  try {
    const response = await fetch("/admin/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": csrfToken
      },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();

    if (response.ok && data.success) {
      msg.style.color = "#4caf50";
      msg.textContent = "Login successful! Redirecting...";
      setTimeout(() => window.location.href = "/admin/dashboard", 1200);
    } else {
      msg.textContent = data.error || "Invalid credentials.";
    }
  } catch (err) {
    msg.textContent = "Server error. Try again later.";
    console.error(err);
  }
});
