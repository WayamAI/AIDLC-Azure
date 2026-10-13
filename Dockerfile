# Chakram unified image: React SPA + FastAPI (Azure Container Apps)
FROM node:20-bookworm AS frontend
WORKDIR /fe
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --prefer-offline
COPY frontend/ ./
ENV VITE_API_URL=/api
RUN npm run build

FROM python:3.12-slim-bookworm AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    GIT_PYTHON_REFRESH=quiet

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates git tini \
    && rm -rf /var/lib/apt/lists/*

# The app runs as this user. Browsers are installed root-owned (readable and executable
# by everyone), so there is no second copy of them in an ownership-change layer.
RUN useradd -m -u 10001 aidlc

COPY backend/requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt \
    && playwright install --with-deps chromium \
    && chmod -R a+rX /ms-playwright

COPY --chown=aidlc:aidlc backend/app ./app
COPY --chown=aidlc:aidlc backend/main.py .
COPY --chown=aidlc:aidlc --from=frontend /fe/dist ./static
RUN chown aidlc:aidlc /app
USER aidlc

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=50s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/health || exit 1

# tini reaps the browser and driver child processes. One worker: run state is per process.
# The platform terminates TLS, so trust its forwarded headers to see the request as https.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", \
     "--proxy-headers", "--forwarded-allow-ips", "*", "--timeout-graceful-shutdown", "30"]
