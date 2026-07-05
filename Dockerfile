# ── Stage 1: Build the React frontend ────────────────────────────────────────
FROM node:20-bookworm-slim AS frontend-builder

WORKDIR /build/ui

COPY ui/package*.json ./

RUN npm install --frozen-lockfile 2>&1 || \
    { echo ""; echo "ERROR: npm install failed. Ensure package-lock.json is committed or remove --frozen-lockfile."; exit 1; }

COPY ui/ ./
COPY knowledge/ /build/knowledge/

RUN npm run build 2>&1 || \
    { echo ""; echo "ERROR: Frontend build failed. Check ui/src for TypeScript or build errors."; exit 1; }


# ── Stage 2: Build Python dependencies ───────────────────────────────────────
FROM python:3.13-slim-bookworm AS python-builder

# Build-only system dependencies — compiler + headers needed to build wheels.
# This stage is discarded after the venv is built, so none of this reaches
# the runtime image.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq-dev \
        gcc \
        freetds-dev \
        libev-dev \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /app/venv
ENV PATH="/app/venv/bin:$PATH"

COPY api/requirements.txt /app/requirements.txt

RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r /app/requirements.txt 2>&1 || \
    { echo ""; \
      echo "══════════════════════════════════════════════════════════"; \
      echo "ERROR: pip install failed."; \
      echo "  • Ensure libpq-dev is available (needed for psycopg2)."; \
      echo "  • For MSSQL support, pymssql needs freetds-dev to build from source."; \
      echo "  • Check the error above for the specific package."; \
      echo "══════════════════════════════════════════════════════════"; \
      exit 1; }


# ── Stage 3: Python 3.13 runtime ─────────────────────────────────────────────
FROM python:3.13-slim-bookworm AS runtime

LABEL org.opencontainers.image.title="Pilotbase"
LABEL org.opencontainers.image.description="Open source DB manager with AI — web-based administration and LangGraph AI agent"
LABEL org.opencontainers.image.url="https://github.com/your-org/pilotbase"

# Runtime-only system dependencies — shared libraries, not the compiler
# toolchain used to build them (that lives only in python-builder above)
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
        ca-certificates \
        freetds-bin \
        libev4 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN useradd -m -u 1000 -s /bin/bash pilotbase

WORKDIR /app

ENV PATH="/app/venv/bin:$PATH"
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# Pre-built virtualenv, copied in with correct ownership up front — avoids a
# trailing `chown -R` which would force an overlay2 copy-up and duplicate
# this entire layer in the final image
COPY --from=python-builder --chown=pilotbase:pilotbase /app/venv /app/venv

# Copy API source
COPY --chown=pilotbase:pilotbase api/ ./api/

# Docs bundled into the image so the agent's docs_tools can read them at runtime
COPY --chown=pilotbase:pilotbase docs/ ./docs/
COPY --chown=pilotbase:pilotbase README.md ./README.md

# Copy built frontend into the location FastAPI serves static files from
COPY --from=frontend-builder --chown=pilotbase:pilotbase /build/ui/dist ./api/static/

# Pilotbase-owned backups directory
RUN mkdir -p /app/api/backups && chown pilotbase:pilotbase /app/api/backups

USER pilotbase

WORKDIR /app/api

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8000/api/v1/health || exit 1

CMD ["python", "main.py"]
