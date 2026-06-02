---
title: Expense Manager
emoji: 💰
colorFrom: blue
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
license: mit
---

# Expense Manager

AI-powered expense tracking web app with receipt OCR (YOLOv9 + Gemini Vision),
Google OAuth, email verification, and an admin dashboard.

## Deployment Architecture

| Tier | Platform | Role |
|------|----------|------|
| Backend + ML | Hugging Face Spaces (this) | Flask API + YOLOv9 OCR |
| Database | Railway | MySQL 8.x |
| Static CDN | Vercel | CSS / JS / Images |

## Required Environment Secrets

Set these in the **Settings → Repository secrets** panel of this Space:

```
SECRET_KEY
MYSQL_HOST
MYSQL_USER
MYSQL_PASSWORD
MYSQL_DATABASE
ADMIN_EMAIL
ADMIN_PASSWORD
MAIL_USERNAME
MAIL_PASSWORD
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI
FIREBASE_CREDENTIALS_BASE64
RECAPTCHA_SITE_KEY
RECAPTCHA_SECRET_KEY
RECAPTCHA_ENTERPRISE_API_KEY
RECAPTCHA_PROJECT_ID
YOLOV9_WEIGHTS
EXTERNAL_BASE_URL
STATIC_CDN_URL
ALLOWED_ORIGINS
```

See `.env.production.example` in the repo for documentation on each variable.
