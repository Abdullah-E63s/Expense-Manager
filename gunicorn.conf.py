# Gunicorn production configuration for Expense Manager
# Usage: gunicorn -c gunicorn.conf.py app:app

import multiprocessing
import os

# ── Workers ──────────────────────────────────────────────────────────────────
# For low-memory hosting: 2 workers.
# For higher-memory servers you can increase to: (2 * cpu_count) + 1
workers = int(os.environ.get("GUNICORN_WORKERS", 2))
worker_class = "sync"          # sync is best for CPU-bound OCR/YOLO workloads
threads = 1                    # sync workers are single-threaded by nature
worker_connections = 100

# ── Timeouts ─────────────────────────────────────────────────────────────────
# Increased for YOLO inference + Gemini API (can take 10-40s)
timeout = 120
graceful_timeout = 30
keepalive = 5

# ── Memory management ────────────────────────────────────────────────────────
# Restart workers periodically to avoid memory leaks from PyTorch / PIL
max_requests = 500
max_requests_jitter = 50

# ── Performance ──────────────────────────────────────────────────────────────
# preload_app = False keeps PyTorch weights out of the master process memory.
# Each worker lazy-loads the model on first receipt scan request.
preload_app = False

# ── Binding ──────────────────────────────────────────────────────────────────
bind = os.environ.get("GUNICORN_BIND", "0.0.0.0:5000")

# ── Logging ──────────────────────────────────────────────────────────────────
accesslog = os.environ.get("GUNICORN_ACCESS_LOG", "-")   # stdout
errorlog  = os.environ.get("GUNICORN_ERROR_LOG", "-")    # stderr
loglevel  = os.environ.get("GUNICORN_LOG_LEVEL", "info")
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s %(D)sµs'
