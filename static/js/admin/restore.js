document.getElementById('restoreBtn').addEventListener('click', async () => {
  const email = document.getElementById('email').value.trim();
  const messageDiv = document.getElementById('message');

  if (!email) {
    messageDiv.textContent = "⚠️ Please enter an email.";
    messageDiv.className = "error";
    return;
  }

  messageDiv.textContent = "⏳ Processing...";
  messageDiv.className = "";

  try {
    const response = await fetch("/api/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });

    const data = await response.json();

    if (response.ok) {
      messageDiv.textContent = data.message;
      messageDiv.className = "success";
    } else {
      messageDiv.textContent = data.error || "An error occurred.";
      messageDiv.className = "error";
    }

  } catch (err) {
    messageDiv.textContent = "❌ Server error: " + err.message;
    messageDiv.className = "error";
  }
});
