# ============================================================
# Expense Manager — Hugging Face Spaces Dockerfile
# SDK: Docker | Port: 7860
# Database: Render MySQL (external)
# ============================================================
# Uses Python 3.11 slim base to keep image size manageable.
# PyTorch CPU-only wheel is installed first (before requirements.txt)
# to avoid pulling the large CUDA variant (~4 GB).
# ============================================================

FROM python:3.11-slim

# ── System dependencies ───────────────────────────────────────────────────────
# libglib2.0-0, libsm6, libxext6, libxrender-dev — required by OpenCV headless
# libgomp1 — required by PyTorch CPU (OpenMP runtime)
# libheif-dev — required by pillow-heif for HEIC image support
# git — required by torch.hub.load() to clone YOLO repo at runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    libheif-dev \
    libffi-dev \
    git \
    && rm -rf /var/lib/apt/lists/*

# ── Create non-root user (Required by Hugging Face Spaces) ──────────────────
RUN useradd -m -u 1000 user

# ── Working directory ─────────────────────────────────────────────────────────
WORKDIR /app

# ── Install PyTorch CPU-only FIRST ───────────────────────────────────────────
# This avoids pip resolving the CUDA variant from requirements.txt and pulling
# an extra ~2 GB of GPU libraries that are unused on HF Spaces free CPU tier.
COPY --chown=user requirements.txt .
USER user
ENV PATH="/home/user/.local/bin:$PATH"

RUN pip install --no-cache-dir \
    torch==2.1.1+cpu \
    torchvision==0.16.1+cpu \
    --index-url https://download.pytorch.org/whl/cpu

# ── Install remaining Python dependencies ─────────────────────────────────────
# torch and torchvision are already installed above; pip will skip re-installing
# them even if requirements.txt lists them (version already satisfied).
RUN pip install --no-cache-dir -r requirements.txt

# ── Copy application source ───────────────────────────────────────────────────
COPY --chown=user . .

# ── HF Spaces runs on port 7860 ───────────────────────────────────────────────
ENV PORT=7860
EXPOSE 7860

# ── Set production environment ────────────────────────────────────────────────
ENV FLASK_ENV=production
ENV MYSQL_PORT=3306
# Use 1 worker on free tier to stay within 512MB RAM limit
ENV GUNICORN_WORKERS=1

# ── Launch via Gunicorn ───────────────────────────────────────────────────────
CMD ["gunicorn", "-c", "gunicorn.conf.py", "app:app"]
