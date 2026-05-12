import os
import time
import hmac
import hashlib
import base64
import sqlite3
import uuid
import json
from datetime import datetime, timedelta
from urllib.parse import unquote
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, status, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional
from cryptography.fernet import Fernet

# Load environment variables from .env file
load_dotenv()

app = FastAPI()

# Add CORS middleware for auth requests from browser
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ======================
# Database Initialization
# ======================

DB_PATH = "portal_devices.db"

def init_db():
    """Initialize SQLite database for device storage."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS authorized_devices (
            device_id TEXT PRIMARY KEY,
            device_name TEXT NOT NULL,
            encrypted_token_hash TEXT NOT NULL,
            device_fingerprint TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            token_expires_at TIMESTAMP NOT NULL
        )
    ''')
    conn.commit()
    conn.close()

init_db()

# ======================
# Encryption & Token Management
# ======================

class TokenManager:
    def __init__(self):
        self.master_key = os.getenv("AUTH_MASTER_KEY", "").encode()
        if len(self.master_key) != 32:
            raise ValueError("AUTH_MASTER_KEY must be exactly 32 characters")
        self.cipher = Fernet(base64.urlsafe_b64encode(self.master_key))
        self.auth_pin = os.getenv("AUTH_PIN", "123456")
        self.token_expiry_days = int(os.getenv("AUTH_TOKEN_EXPIRY_DAYS", "90"))
    
    def encrypt_token(self, token: str) -> str:
        """Encrypt a token for storage."""
        return self.cipher.encrypt(token.encode()).decode()
    
    def decrypt_token(self, encrypted_token: str) -> Optional[str]:
        """Decrypt a stored token."""
        try:
            return self.cipher.decrypt(encrypted_token.encode()).decode()
        except Exception:
            return None
    
    def generate_device_token(self, device_id: str) -> str:
        """Generate a unique device token."""
        return f"{device_id}:{int(time.time())}:{uuid.uuid4().hex[:16]}"
    
    def validate_pin(self, pin: str) -> bool:
        """Validate the provided PIN."""
        return pin == self.auth_pin

token_manager = TokenManager()

# ======================
# Device Management
# ======================

class DeviceManager:
    def register_device(self, device_name: str, device_fingerprint: str) -> tuple[str, str]:
        """Register a new device and return device_id and encrypted token."""
        device_id = str(uuid.uuid4())
        token = token_manager.generate_device_token(device_id)
        encrypted_token = token_manager.encrypt_token(token)
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        
        expires_at = datetime.utcnow() + timedelta(days=token_manager.token_expiry_days)
        
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO authorized_devices 
            (device_id, device_name, encrypted_token_hash, device_fingerprint, token_expires_at)
            VALUES (?, ?, ?, ?, ?)
        ''', (device_id, device_name, token_hash, device_fingerprint, expires_at.isoformat()))
        conn.commit()
        conn.close()
        
        return device_id, encrypted_token
    
    def validate_token(self, token: str, device_fingerprint: str) -> Optional[str]:
        """Validate a token and return device_id if valid."""
        try:
            # Token received from client is encrypted - decrypt it first
            decrypted_token = token_manager.decrypt_token(token)
            if not decrypted_token:
                print(f"Failed to decrypt token")
                return None
            
            # Hash the decrypted token to compare with stored hash
            token_hash = hashlib.sha256(decrypted_token.encode()).hexdigest()
            
            conn = sqlite3.connect(DB_PATH)
            cursor = conn.cursor()
            cursor.execute('''
                SELECT device_id, device_fingerprint, token_expires_at 
                FROM authorized_devices 
                WHERE encrypted_token_hash = ?
            ''', (token_hash,))
            result = cursor.fetchone()
            
            if not result:
                conn.close()
                print(f"Token hash not found in database")
                return None
            
            device_id, stored_fingerprint, expires_at_str = result
            
            # Verify device fingerprint matches
            if stored_fingerprint != device_fingerprint:
                conn.close()
                print(f"Fingerprint mismatch: stored={stored_fingerprint[:20]}, provided={device_fingerprint[:20]}")
                return None
            
            # Check expiration
            expires_at = datetime.fromisoformat(expires_at_str)
            if datetime.utcnow() > expires_at:
                conn.close()
                print(f"Token expired at {expires_at}")
                return None
            
            # Update last accessed
            cursor.execute('''
                UPDATE authorized_devices 
                SET last_accessed_at = ? 
                WHERE device_id = ?
            ''', (datetime.utcnow().isoformat(), device_id))
            conn.commit()
            conn.close()
            
            return device_id
        except Exception as e:
            print(f"Token validation error: {e}")
            return None

device_manager = DeviceManager()


# ======================
# WebSocket Connection Manager
# ======================

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: str, sender: WebSocket):
        for connection in self.active_connections:
            if connection != sender:
                await connection.send_text(message)


manager = ConnectionManager()


# ======================
# Authentication Endpoints
# ======================

@app.post("/api/auth/register")
async def register_device(data: dict):
    """
    Register a new device with PIN and device fingerprint.
    Returns encrypted token for device.
    """
    pin = data.get("pin", "")
    device_fingerprint = data.get("fingerprint", "")
    
    if not device_fingerprint:
        raise HTTPException(status_code=400, detail="Device fingerprint required")
    
    if not token_manager.validate_pin(pin):
        raise HTTPException(status_code=401, detail="Invalid PIN")
    
    device_name = data.get("name", f"Portal Device {int(time.time())}")
    device_id, encrypted_token = device_manager.register_device(device_name, device_fingerprint)
    
    return JSONResponse({
        "device_id": device_id,
        "token": encrypted_token,
        "expires_in_days": token_manager.token_expiry_days
    })


@app.post("/api/auth/validate")
async def validate_token(data: dict):
    """
    Validate an existing device token.
    Returns success status.
    """
    token = data.get("token", "")
    device_fingerprint = data.get("fingerprint", "")
    
    if not token or not device_fingerprint:
        raise HTTPException(status_code=400, detail="Token and fingerprint required")
    
    device_id = device_manager.validate_token(token, device_fingerprint)
    
    if not device_id:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    return JSONResponse({
        "status": "valid",
        "device_id": device_id
    })


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = None):
    """
    WebSocket endpoint for WebRTC signaling.
    Requires valid authentication token in query parameter.
    """
    # Extract token from query parameters
    query_params = websocket.scope.get("query_string", b"").decode()
    token = None
    device_fingerprint = None
    
    for param in query_params.split("&"):
        if "=" in param:
            key, value = param.split("=", 1)
            # URL decode the parameters
            if key == "token":
                token = unquote(value)
            elif key == "fingerprint":
                device_fingerprint = unquote(value)
    
    print(f"WebSocket auth attempt - Token length: {len(token) if token else 0}, Fingerprint: {device_fingerprint[:20] if device_fingerprint else 'None'}")
    
    # Validate authentication
    if not token or not device_fingerprint:
        print(f"Missing auth parameters: token={bool(token)}, fingerprint={bool(device_fingerprint)}")
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Missing authentication")
        return
    
    device_id = device_manager.validate_token(token, device_fingerprint)
    if not device_id:
        print(f"Token validation failed for fingerprint: {device_fingerprint[:20]}")
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid authentication")
        return
    
    print(f"WebSocket authenticated for device: {device_id}")
    
    # Connection authenticated, proceed with signaling
    await manager.connect(websocket)
    try:
        while True:
            # Receive text data (JSON string containing WebRTC signaling data)
            data = await websocket.receive_text()
            # Broadcast the signaling message to other peers
            await manager.broadcast(data, websocket)
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        # Notify remaining peers that a user has disconnected (so they can close their portal)
        await manager.broadcast('{"type": "hangup"}', websocket)


@app.get("/api/turn-config")
async def get_turn_config():
    """
    Returns time-limited, ephemeral TURN credentials generated securely using a shared secret.
    This is the enterprise standard for WebRTC (TURN REST API).
    """
    turn_url = os.getenv("TURN_URL", "")
    turn_secret = os.getenv("TURN_SECRET", "")
    
    if not turn_secret or not turn_url:
        return JSONResponse({"url": "", "username": "", "credential": ""})

    # The credential is valid for 24 hours (86400 seconds)
    ttl = 86400
    timestamp = int(time.time()) + ttl
    username = f"{timestamp}:user"
    
    # Generate HMAC-SHA1 signature using the secret and the username
    mac = hmac.new(
        turn_secret.encode('utf-8'),
        username.encode('utf-8'),
        hashlib.sha1
    )
    password = base64.b64encode(mac.digest()).decode('utf-8')

    return JSONResponse({
        "url": turn_url,
        "username": username,
        "credential": password
    })

# Serve static files (HTML, JS, CSS)
app.mount("/", StaticFiles(directory="static", html=True), name="static")
