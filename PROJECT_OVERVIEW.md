# 💰 Expense Manager — Comprehensive System & Features Overview

Welcome to **Expense Manager**, an intelligent, cross-platform expense tracking and budget management ecosystem. This document provides a complete, line-by-line detailed explanation of the application's architecture, backend capabilities, AI/ML features, mobile integration, security implementations, and core user workflows.

---

## 📌 Executive Summary

**Expense Manager** is designed to eliminate manual data entry in personal finance management. By combining traditional web and mobile capabilities with state-of-the-art **Computer Vision (YOLOv9)**, **Optical Character Recognition (EasyOCR)**, and **Large Language Models (Google Gemini AI)**, users can snap a photo of a physical receipt and automatically extract merchant names, line items, transaction totals, payment methods, and dates within seconds.

The project is architected as a hybrid ecosystem:
- **Web App**: Full-featured, responsive web interface built with Flask, HTML5, CSS3, JavaScript, and Jinja2.
- **Mobile App**: Cross-platform mobile app built with React Native and Expo, providing an optimized native WebView container with tailored mobile interactions.
- **AI & ML Engine**: Cloud-ready image processing and multi-stage OCR/NLP pipeline for zero-touch receipt parsing.
- **Admin Dashboard**: System administration portal for managing users, monitoring database metrics, and inspecting system logs.

---

## 🏗️ System Architecture & Infrastructure

The application uses a distributed 3-tier architecture optimized for high performance, reliability, and cost-efficiency:

| Component | Technology | Hosted On / Provider | Responsibility |
| :--- | :--- | :--- | :--- |
| **Backend API & ML Engine** | Python 3, Flask, PyTorch, YOLOv9, EasyOCR, Gemini SDK | **Hugging Face Spaces** (Docker Container) | Core business logic, authentication, ML inference, API endpoints |
| **Database Tier** | MySQL 8.x (SQLAlchemy ORM + PyMySQL) | **Railway / Remote Database** | Relational data persistence, relational modeling, transaction history |
| **Static CDN & Proxy** | Vercel (Edge CDN & Proxy Rewrites) | **Vercel** | Global delivery of static assets (CSS, JS, images) & SSL proxy routing |
| **Mobile Client** | React Native, Expo, React Native WebView | **Expo Go / Native App (Android & iOS)** | Native mobile container, mobile authentication, camera & receipt uploads |

---

## ⚡ Complete Feature Breakdown

### 1. 🔐 User Authentication & Identity Management
Expense Manager features a robust, multi-layered identity framework:

* **Standard Email & Password Registration**:
  * Secure password hashing using **Bcrypt** algorithm.
  * Account activation via **Email Verification Tokens** sent via SMTP (Flask-Mail).
* **Google OAuth 2.0 Integration**:
  * **Web Authorization Code Flow**: Standard web browser login powered by Google Identity Services.
  * **Mobile In-WebView Implicit Flow**: Custom `id_token` verification workflow for mobile devices that bypasses native app-switching while keeping users inside the app environment.
  * User-Agent spoofing in WebView to prevent Google's `disallowed_useragent` blocks.
* **Firebase Authentication Fallback**:
  * Backend incorporates Firebase Admin SDK validation with automatic fallback to direct Google OAuth token verification for high availability.
* **Password Recovery & Account Security**:
  * Self-service **Forgot Password / Password Reset** via secure, time-limited tokenized email links.
  * Mandatory password setup for accounts created via Google OAuth if they wish to enable standalone email/password login later.
  * **reCAPTCHA Enterprise Integration**: Bot prevention on authentication routes (Login, Signup, Password Reset) to safeguard against brute-force attacks.

---

### 2. 🧾 AI Receipt Scanning & Auto-Extraction (The Smart OCR Engine)

The flagship feature of Expense Manager is its multi-tiered automated receipt parser:

```
[ Receipt Upload (JPEG/PNG/HEIC/AVIF) ]
                  │
                  ▼
   [ 1. Image Preprocessing (Pillow) ]
                  │
                  ▼
   [ 2. Object Detection (YOLOv9) ]  ──► (Locates receipt boundaries & crops image)
                  │
                  ▼
   [ 3. Text Extraction (EasyOCR) ]  ──► (Extracts raw textual strings & coordinates)
                  │
                  ▼
 [ 4. Intelligent Parsing (Gemini AI) ] ──► (Extracts merchant, total, date, category)
                  │
                  ▼
   [ 5. RapidFuzz Fallback Matching ] ──► (Resolves OCR typos & missing data)
                  │
                  ▼
[ Auto-Populated Expense Form ready for confirmation ]
```

* **Multi-Format Support**: Native handling for standard formats (PNG, JPEG, WebP) as well as modern mobile camera formats (**HEIC / HEIF**, **AVIF**) via Pillow extension plugins.
* **YOLOv9 Bounding Box Detection**: Uses a custom PyTorch YOLOv9 model trained specifically on receipts to locate the receipt boundaries within noise-filled photos.
* **EasyOCR Engine**: High-accuracy text extraction reading raw characters across complex receipt layouts.
* **Gemini LLM Contextual Analysis**: Raw text is fed into Google Gemini AI to intelligently understand line items, discriminate subtotal vs. tax vs. grand total, identify merchant names, and infer expense categories based on purchase context (e.g., classifying "Starbucks" as *Food & Dining*).
* **Fuzzy String Matching**: Uses `RapidFuzz` algorithm as a fallback to match distorted store names against known merchant patterns when OCR text is degraded.

---

### 3. 📊 Expense Tracking & Analytics Dashboard

The core dashboard (`/dashboard`) gives users instant clarity over their finances:

* **Key Performance Metrics**:
  * **Total Spent**: Aggregate financial expenditure within the selected period.
  * **Total Expenses**: Count of recorded transactions.
  * **Average Per Expense**: Mean value calculated across all recorded transactions.
  * **Remaining Budget**: Real-time gauge of available funds against user-defined spending caps.
* **Interactive Data Visualization**:
  * Dynamic charts powered by **Chart.js**.
  * Expense breakdown by category (Pie/Doughnut charts).
  * Monthly spending trend graphs.
* **Advanced Filtering & Search**:
  * Search by merchant name or keyword.
  * Filter by **Category** (Food & Dining, Transportation, Utilities, Shopping, Entertainment, Health, Business, Education, Miscellaneous).
  * Filter by **Payment Method** (Cash, Credit Card, Debit Card, Bank Transfer, Online Wallet).
  * Date range selector (Today, This Week, This Month, Custom Date Range).
  * Min/Max amount sliders.
  * Tag-based filtering.
* **Receipt Image Viewer**:
  * View high-resolution stored images of attached physical receipts directly within a modal dialog.

---

### 4. 🎯 Budget Management

* **Monthly Spending Limits**: Set customizable overall monthly budget limits.
* **Live Progress Indicators**: Color-coded progress bars indicating safe spending, warning thresholds (80%+ budget used), and budget overrun alerts.
* **Automated Calculations**: Instant updates on every new transaction added, modified, or removed.

---

### 5. 🛠️ Administrative Portal (`/admin`)

System administrators have access to an isolated, privileged administration engine (`admin_routes.py`):

* **User Management**:
  * View complete user list with account status, email verification flags, and creation timestamps.
  * Enable/Disable user accounts.
  * Promote users to Administrator or revoke admin privileges.
  * Safely delete user accounts along with cascade deletion of user expense records.
* **System Health & Logs**:
  * Monitor real-time stdout application logs.
  * Inspect database connection pool health and active queries.
  * View application error traces and diagnostic health metrics.

---

### 6. 📱 Mobile Application (React Native + Expo)

The Expense Manager mobile experience (`mobile app/`) is built using **React Native** and **Expo**:

* **Hybrid Native-WebView Container**: Uses `react-native-webview` to render the backend interface seamlessly while maintaining native navigation performance.
* **Embedded Mobile OAuth**: Custom Google OAuth flow engineered to work inside native mobile webviews without triggering Google's `disallowed_useragent` block.
* **Native Touch & Scroll Optimization**:
  * Enforces `bounces={false}` on iOS and `overScrollMode="never"` on Android.
  * Includes `overscroll-behavior-y: none` in global CSS.
  * Eliminates rubber-banding, loose page dragging, and black-screen remount flashes during navigation.
* **Responsive Viewport Controls**: Automatic viewport meta tag injection for mobile screens preventing accidental double-tap zoom or horizontal shifts.

---

## 🛠️ Technology Stack Reference

### **Backend Framework & Server**
- **Language**: Python 3.11+
- **Web Framework**: Flask 3.0.0, Werkzeug 3.0.1
- **WSGI Production Server**: Gunicorn 21.2.0 (with ProxyFix middleware)
- **Database ORM**: SQLAlchemy 2.0.23, Flask-SQLAlchemy 3.1.1, Flask-Migrate 4.0.5

### **Machine Learning & OCR Pipeline**
- **LLM / Generative AI**: Google Generative AI (Gemini Flash / Pro API)
- **Object Detection**: YOLOv9 (`ultralytics`, `torch`, `torchvision`)
- **OCR Engine**: EasyOCR, OpenCV (`opencv-python-headless`)
- **String Matching**: RapidFuzz
- **Image Processing**: Pillow, `pillow-heif` (HEIC format support)

### **Frontend & UI**
- **Template Engine**: Jinja2
- **Core Languages**: Vanilla HTML5, Vanilla CSS3 (Custom Design System with Dark Mode), Vanilla JavaScript
- **Libraries**: Chart.js (Analytics), jQuery (DOM Helpers)

### **Mobile Framework**
- **Environment**: React Native, Expo SDK
- **Component**: `react-native-webview`
- **Build & Distribution**: EAS Build (Expo Application Services)

### **Security & Utilities**
- **Authentication**: Flask-Login, Google OAuth2, Firebase Admin SDK, Bcrypt
- **Bot Protection**: Google reCAPTCHA Enterprise
- **CSRF Protection**: Flask-WTF CSRFProtect
- **WSGI Middleware**: Custom `_SanitizeOriginMiddleware` (strips malicious scanner headers)
- **Email Delivery**: Flask-Mail via Gmail SMTP

---

## 🛡️ Security & Performance Highlights

1. **WSGI-Level Header Sanitization**:
   Custom WSGI middleware (`_SanitizeOriginMiddleware`) wraps the app *before* Flask routing occurs. This strips newline characters (`\r\n`) from incoming HTTP `Origin` headers sent by external security bots, preventing `flask_cors` header reflection crashes on 404 routes.
2. **Vercel Edge Cache Invalidation**:
   All static script imports in HTML templates utilize Flask's `url_for('static', filename=...)` cache-busting syntax (`?v=timestamp`), ensuring edge proxies never serve stale JS/CSS code.
3. **No-Cache Dynamic Auth Callbacks**:
   Explicit `Cache-Control: no-cache, no-store, must-revalidate` headers are returned on OAuth callbacks to prevent edge proxy caching.
4. **Database Connection Pooling**:
   Configured with SQLAlchemy pool pre-ping and recycling to maintain stable connections to remote MySQL instances across server restarts.

---

## 🚀 Summary

Expense Manager bridges modern web performance, native mobile convenience, and cutting-edge artificial intelligence into a single unified financial management platform. Whether capturing expenses manually or scanning receipts on the go, users enjoy a smooth, secure, and automated experience.
