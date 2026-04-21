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

# Copy all the application files (including static files, main.py, run_https.py)
COPY . .

ENV PORT=8000

# Command to run the application securely
CMD ["uvicorn", "--host", "0.0.0.0", "--port", "$PORT", "main:app"]
