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
    PATH=/home/hexa/.local/bin:$PATH

# Non-root user for runtime safety
RUN groupadd -r hexa && useradd -r -g hexa -d /home/hexa -m hexa

# Runtime libs only (libpq for psycopg2-binary, libgomp for xgboost)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    libgomp1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /root/.local /home/hexa/.local
COPY --chown=hexa:hexa hexa_ml /app/hexa_ml
COPY --chown=hexa:hexa pyproject.toml /app/

# Create writable dirs for trained models and exported data
RUN mkdir -p /app/artifacts /app/data && chown -R hexa:hexa /app

USER hexa

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://localhost:8000/health || exit 1

CMD ["uvicorn", "hexa_ml.serve:app", "--host", "0.0.0.0", "--port", "8000"]
