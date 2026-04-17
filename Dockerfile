FROM python:3.11-slim

# Set the working directory inside the container
WORKDIR /app

# Install system dependencies (e.g., openssl if we want to generate certs dynamically, though we use existing ones here)
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy all the application files (including static files, main.py, run_https.py, and cert/key files if they exist)
COPY . .

# Generate a self-signed cert inside the container just in case it wasn't copied
RUN if [ ! -f "cert.pem" ] || [ ! -f "key.pem" ]; then \
        echo "Generating fallback self-signed certificates..." && \
        openssl req -x509 -newkey rsa:4096 -nodes -out cert.pem -keyout key.pem -days 365 -subj "/CN=localhost"; \
    fi

ENV PORT=8000
EXPOSE 8000

# Command to run the application securely
CMD ["python", "run_https.py"]
