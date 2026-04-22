import os
import time
import hmac
import hashlib
import base64
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from typing import List

# Load environment variables from .env file
load_dotenv()

app = FastAPI()


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


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
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
