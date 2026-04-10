import uvicorn

if __name__ == "__main__":
    print("Starting WebRTC Signaling Server securely on HTTPS...")
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
        port=8000,
        ssl_keyfile="key.pem",
        ssl_certfile="cert.pem",
        reload=True,
    )
