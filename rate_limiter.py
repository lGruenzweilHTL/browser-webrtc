import time
from collections import defaultdict
from threading import Lock
from fastapi import HTTPException, Request


class IPRateLimiter:
    def __init__(self):
        self._lock = Lock()
        self._failed_attempts: dict = defaultdict(lambda: {"count": 0, "first_attempt": 0.0})
        self._bans: dict = {}
        self.max_failures = 5
        self.window_seconds = 600   # 10-min rolling window
        self.ban_duration_seconds = 3600  # 1-hour ban

    def is_banned(self, ip: str) -> bool:
        with self._lock:
            banned_until = self._bans.get(ip)
            if banned_until and time.time() < banned_until:
                return True
            elif banned_until:
                del self._bans[ip]
            return False

    def record_failure(self, ip: str):
        with self._lock:
            now = time.time()
            entry = self._failed_attempts[ip]
            if now - entry["first_attempt"] > self.window_seconds:
                entry["count"] = 0
                entry["first_attempt"] = now
            entry["count"] += 1
            if entry["count"] >= self.max_failures:
                self._bans[ip] = now + self.ban_duration_seconds
                del self._failed_attempts[ip]

    def record_success(self, ip: str):
        with self._lock:
            self._failed_attempts.pop(ip, None)


ip_limiter = IPRateLimiter()


def get_client_ip(request: Request) -> str:
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.client.host


def check_ip(request: Request) -> str:
    ip = get_client_ip(request)
    if ip_limiter.is_banned(ip):
        raise HTTPException(status_code=429, detail="Too many failed attempts. Try again later.")
    return ip
