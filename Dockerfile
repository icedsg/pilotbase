# ── Stage 1: Build the React frontend ────────────────────────────────────────
FROM node:20-bookworm-slim AS frontend-builder

WORKDIR /build/ui

COPY ui/package*.json ./

RUN npm install --frozen-lockfile 2>&1 || \
    { echo ""; echo "ERROR: npm install failed. Ensure package-lock.json is committed or remove --frozen-lockfile."; exit 1; }

COPY ui/ ./

RUN npm run build 2>&1 || \
    { echo ""; echo "ERROR: Frontend build failed. Check ui/src for TypeScript or build errors."; exit 1; }


# ── Stage 2: Python 3.13 runtime ─────────────────────────────────────────────
FROM python:3.13-slim-bookworm AS runtime

LABEL org.opencontainers.image.title="Pilotbase"
LABEL org.opencontainers.image.description="Open source DB manager with AI — web-based administration and LangGraph AI agent"
LABEL org.opencontainers.image.url="https://github.com/your-org/pilotbase"

# System dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq-dev \
        gcc \
        curl \
        ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN useradd -m -u 1000 -s /bin/bash pilotbase

WORKDIR /app

# Python venv inside the image (keeps site-packages isolated)
RUN python3 -m venv /app/venv
ENV PATH="/app/venv/bin:$PATH"
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# Install Python dependencies early (cache layer)
COPY api/requirements.txt ./requirements.txt

RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt 2>&1 || \
    { echo ""; \
      echo "══════════════════════════════════════════════════════════"; \
      echo "ERROR: pip install failed."; \
      echo "  • Ensure libpq-dev is available (needed for psycopg2)."; \
      echo "  • For MSSQL support, pyodbc may need extra system libs."; \
      echo "  • Check the error above for the specific package."; \
      echo "══════════════════════════════════════════════════════════"; \
      exit 1; }

# Copy API source
COPY api/ ./api/

# Copy built frontend into the location FastAPI serves static files from
COPY --from=frontend-builder /build/ui/dist ./api/static/

# Pilotbase-owned backups directory
RUN mkdir -p /app/api/backups

RUN chown -R pilotbase:pilotbase /app

USER pilotbase

WORKDIR /app/api

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8000/api/v1/health || exit 1

CMD ["python", "main.py"]
