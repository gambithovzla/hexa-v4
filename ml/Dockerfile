# H.E.X.A. ML sidecar — Python 3.11 multi-stage build
# Stage 1: builder installs deps; stage 2 runtime ships only what's needed.

# ───────────────────────────────────────────────────────────────────────────
# Stage 1 — builder
# ───────────────────────────────────────────────────────────────────────────
FROM python:3.11-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# System deps for psycopg2-binary build, xgboost, numpy
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --user --no-cache-dir -r requirements.txt

# ───────────────────────────────────────────────────────────────────────────
# Stage 2 — runtime
# ───────────────────────────────────────────────────────────────────────────
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH=/root/.local/bin:$PATH

# Runtime libs only (libpq for psycopg2-binary, libgomp for xgboost)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    libgomp1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /root/.local /root/.local
COPY hexa_ml /app/hexa_ml
COPY pyproject.toml /app/

# Create default artifacts/data dirs (used when no Railway Volume is mounted)
RUN mkdir -p /app/artifacts /app/data

# Intentionally run as root so Railway Volume mounts (owned by root) are
# writable at startup. This service is internal-only (HEXA_ML_INTERNAL_TOKEN).
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://localhost:8000/health || exit 1

CMD ["uvicorn", "hexa_ml.serve:app", "--host", "0.0.0.0", "--port", "8000"]
