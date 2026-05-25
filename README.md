# AI Expense Manager 

A modern, highly optimized, and AI-powered web application for tracking personal expenses. This application replaces manual data entry with intelligent automation, leveraging cutting-edge machine learning and vision models to instantly parse financial receipts and seamlessly manage budget limits.

### ✨ Key Features
* **AI Receipt Processor:** Features a custom OCR engine (`GodModeOCR`) powered by Google's Gemini Flash 2.5 and YOLOv9. Users can drag and drop receipts, and the AI automatically extracts the total amount, category, and date—significantly reducing manual entry.
* **Smart Budget Management:** Set monthly, weekly, or yearly budgets. The app tracks your spending in real-time and provides visual warnings when you are approaching or exceeding your limits.
* **Advanced Analytics Dashboard:** Fully responsive frontend using Chart.js to visualize spending breakdowns by category and chronological monthly trends.
* **Secure Authentication & Admin Controls:** Features Google Sign-In, Email/Password authentication (with email verification and password recovery), and a dedicated Admin Panel (`/admin`) for managing users and system health.
* **Enterprise-Grade Security:** Fully protected against CSRF attacks across all API endpoints via Flask-WTF, equipped with Google reCAPTCHA v3/Enterprise for bot protection, and follows strict rate-limiting and security header best practices.

### 🛠️ Tech Stack
* **Backend Framework:** Python 3.x, Flask, Werkzeug
* **Database:** MySQL (managed via custom `PyMySQL` queries optimized for low-resource environments, eliminating heavy ORM overhead).
* **Machine Learning & AI:** 
  * `PyTorch` (lazy-loaded to save RAM)
  * `YOLOv9` (for object detection & receipt bounding boxes)
  * `Gemini Flash 2.5` (for state-of-the-art OCR parsing)
* **Frontend:** Vanilla HTML/CSS/JS (Lightweight, fully responsive, and asset-optimized without requiring a heavy JS framework). Chart.js for data visualization.
* **Integrations:** Firebase Admin SDK, Google OAuth 2.0, SendGrid / SMTP for transactional emails.

### 🚀 Optimization Highlights
Built specifically to run smoothly in low-resource deployment environments:
* **Lazy Loading:** PyTorch and heavy ML models are only loaded into memory when a receipt is actually being processed, saving ~300MB of baseline RAM.
* **File System Efficiency:** Uploaded receipts are processed entirely in-memory using byte streams and discarded securely, preventing disk bloat.
* **Lean Dependencies:** Stripped of heavy libraries (like SQLAlchemy, EasyOCR, and excessive OpenCV usages) in favor of lightweight, direct API calls and efficient standard libraries.
