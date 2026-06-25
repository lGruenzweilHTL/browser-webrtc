import os
import time
import uuid
import hashlib
from datetime import datetime, timedelta
from typing import Optional

from .database import get_conn


class TokenManager:
    def __init__(self):
        self.auth_pin = os.getenv("AUTH_PIN", "123456")
        self.token_expiry_days = int(os.getenv("AUTH_TOKEN_EXPIRY_DAYS", "90"))

    def validate_pin(self, pin: str) -> bool:
        return pin == self.auth_pin

    def generate_device_token(self, device_id: str) -> str:
        return f"{device_id}:{int(time.time())}:{uuid.uuid4().hex[:16]}"


class DeviceManager:
    def __init__(self, token_manager: TokenManager):
        self.token_manager = token_manager

    def register_device(self, device_name: str, device_fingerprint: str) -> tuple[str, str]:
        device_id = str(uuid.uuid4())
        token = self.token_manager.generate_device_token(device_id)
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        expires_at = datetime.utcnow() + timedelta(days=self.token_manager.token_expiry_days)

        conn = get_conn()
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO authorized_devices
            (device_id, device_name, token_hash, device_fingerprint, token_expires_at)
            VALUES (?, ?, ?, ?, ?)
        ''', (device_id, device_name, token_hash, device_fingerprint, expires_at.isoformat()))
        conn.commit()
        conn.close()

        # Raw token returned to client once — never stored plaintext server-side
        return device_id, token

    def validate_token(self, token: str, device_fingerprint: str) -> Optional[str]:
        try:
            token_hash = hashlib.sha256(token.encode()).hexdigest()

            conn = get_conn()
            cursor = conn.cursor()
            cursor.execute('''
                SELECT device_id, device_fingerprint, token_expires_at
                FROM authorized_devices
                WHERE token_hash = ?
            ''', (token_hash,))
            result = cursor.fetchone()

            if not result:
                conn.close()
                return None

            device_id, stored_fingerprint, expires_at_str = result

            if stored_fingerprint != device_fingerprint:
                conn.close()
                return None

            if datetime.utcnow() > datetime.fromisoformat(expires_at_str):
                conn.close()
                return None

            cursor.execute(
                'UPDATE authorized_devices SET last_accessed_at = ? WHERE device_id = ?',
                (datetime.utcnow().isoformat(), device_id)
            )
            conn.commit()
            conn.close()
            return device_id
        except Exception as e:
            print(f"Token validation error: {e}")
            return None


token_manager = TokenManager()
device_manager = DeviceManager(token_manager)
