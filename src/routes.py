import os
import time
import hmac
import hashlib
import base64

from fastapi import (
    APIRouter,
    WebSocket,
    WebSocketDisconnect,
    HTTPException,
    Request,
    status,
)
from fastapi.responses import JSONResponse

from auth import token_manager, device_manager
from rate_limiter import ip_limiter, check_ip
from websocket_manager import manager

router = APIRouter()


def _parse_query_string(scope) -> dict:
    params = {}
    query = scope.get("query_string", b"").decode()
    for param in query.split("&"):
        if "=" in param:
            key, value = param.split("=", 1)
            params[key] = value
    return params


@router.post("/api/auth/register")
async def register_device(data: dict, request: Request):
    ip = check_ip(request)

    pin = data.get("pin", "")
    device_fingerprint = data.get("fingerprint", "")

    if not device_fingerprint:
        raise HTTPException(status_code=400, detail="Device fingerprint required")

    if not token_manager.validate_pin(pin):
        ip_limiter.record_failure(ip)
        raise HTTPException(status_code=401, detail="Invalid PIN")

    ip_limiter.record_success(ip)
    device_name = data.get("name", f"Portal Device {int(time.time())}")
    device_id, token = device_manager.register_device(device_name, device_fingerprint)

    return JSONResponse(
        {
            "device_id": device_id,
            "token": token,
            "expires_in_days": token_manager.token_expiry_days,
        }
    )


@router.post("/api/auth/validate")
async def validate_token(data: dict, request: Request):
    check_ip(request)

    token = data.get("token", "")
    device_fingerprint = data.get("fingerprint", "")

    if not token or not device_fingerprint:
        raise HTTPException(status_code=400, detail="Token and fingerprint required")

    device_id = device_manager.validate_token(token, device_fingerprint)
    if not device_id:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    return JSONResponse({"status": "valid", "device_id": device_id})


@router.get("/api/turn-config")
async def get_turn_config(request: Request):
    params = _parse_query_string(request.scope)
    token = params.get("token")
    device_fingerprint = params.get("fingerprint")

    if not token or not device_fingerprint:
        raise HTTPException(status_code=401, detail="Authentication required")

    device_id = device_manager.validate_token(token, device_fingerprint)
    if not device_id:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    turn_url = os.getenv("TURN_URL", "")
    turn_secret = os.getenv("TURN_SECRET", "")

    if not turn_secret or not turn_url:
        return JSONResponse({"url": "", "username": "", "credential": ""})

    ttl = 86400
    timestamp = int(time.time()) + ttl
    username = f"{timestamp}:user"

    mac = hmac.new(turn_secret.encode("utf-8"), username.encode("utf-8"), hashlib.sha1)
    password = base64.b64encode(mac.digest()).decode("utf-8")

    return JSONResponse({"url": turn_url, "username": username, "credential": password})


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    params = _parse_query_string(websocket.scope)
    token = params.get("token")
    device_fingerprint = params.get("fingerprint")

    if not token or not device_fingerprint:
        await websocket.close(
            code=status.WS_1008_POLICY_VIOLATION, reason="Missing authentication"
        )
        return

    device_id = device_manager.validate_token(token, device_fingerprint)
    if not device_id:
        await websocket.close(
            code=status.WS_1008_POLICY_VIOLATION, reason="Invalid authentication"
        )
        return

    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            await manager.broadcast(data, websocket)
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        await manager.broadcast('{"type": "hangup"}', websocket)
