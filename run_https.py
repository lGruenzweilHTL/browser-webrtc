import uvicorn
import os

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    print(f"Starting WebRTC Signaling Server securely on HTTPS on port {port}...")
    print(
        "WARNING: Because this uses a self-signed certificate, your browser will warn you."
    )
    print(
        "You MUST click 'Advanced' -> 'Proceed to [IP Address] (unsafe)' to access the site."
    )
    print(
        "However, WebRTC will treat this as a secure context, allowing Camera/Mic access!"
    )

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=port,
        ssl_keyfile="key.pem",
        ssl_certfile="cert.pem",
        reload=False,  # disabled reload for production/docker by default
    )
