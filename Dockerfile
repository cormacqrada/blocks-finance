# Backend Docker image — used by Render (and any Docker host).
# Builds the FastAPI app under backend/ and serves via uvicorn on $PORT.
FROM python:3.12-slim

# curl for Render health checks; build-essential for any C-extension wheels.
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend

# Install dependencies first (better Docker layer caching).
COPY backend/requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy the backend source.
COPY backend/ .

# Render injects PORT (default 10000). Bind 0.0.0.0 so the platform can route.
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
