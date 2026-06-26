import sqlite3
import os

DB_PATH = os.getenv("DB_PATH", "portal_devices.db")


def get_conn() -> sqlite3.Connection:
    return sqlite3.connect(DB_PATH)


def init_db():
    conn = get_conn()
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS authorized_devices (
            device_id TEXT PRIMARY KEY,
            device_name TEXT NOT NULL,
            token_hash TEXT NOT NULL,
            device_fingerprint TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            token_expires_at TIMESTAMP NOT NULL
        )
    ''')
    conn.commit()
    conn.close()
