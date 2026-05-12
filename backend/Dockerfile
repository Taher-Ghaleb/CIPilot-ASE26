# Python backend Dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies (for actionlint and sqlite3)
RUN apt-get update && apt-get install -y \
  ca-certificates \
  curl \
  tar \
  sqlite3 \
  && rm -rf /var/lib/apt/lists/*

# Install actionlint
RUN curl -sSfL https://github.com/rhysd/actionlint/releases/download/v1.6.26/actionlint_1.6.26_linux_amd64.tar.gz \
  | tar xz -C /usr/local/bin && \
  chmod +x /usr/local/bin/actionlint && \
  actionlint -version

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code to the container 
COPY . .

# Create directory for persistent disk mount (Render will mount here)
RUN mkdir -p /var/data && chmod 777 /var/data

# Expose port
EXPOSE 5200

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:5200/')" || exit 1

# Run the application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "5200"]
