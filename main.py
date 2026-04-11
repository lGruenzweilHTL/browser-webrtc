import os
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


@app.get("/api/turn-config")
async def get_turn_config():
    """
    Returns the TURN server configuration dynamically to avoid hardcoding credentials in the frontend.
    """
    return JSONResponse({
        "url": os.getenv("TURN_URL", ""),
        "username": os.getenv("TURN_USERNAME", ""),
        "credential": os.getenv("TURN_PASSWORD", "")
    })

# Serve static files (HTML, JS, CSS)
app.mount("/", StaticFiles(directory="static", html=True), name="static")
