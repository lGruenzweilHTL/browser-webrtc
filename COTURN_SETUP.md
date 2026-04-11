# How to Run Your Own TURN Server on Oracle Cloud

Yes! Oracle Cloud's "Always Free" tier (especially the ARM Ampere A1 instances) is actually **the absolute best place** to host a free TURN server because it includes a massive 10 Terabytes of outbound data transfer per month for free.

To do this, we use the industry-standard open-source server called **Coturn**.

Here is exactly what you need to do on your Oracle Cloud server to set it up.

---

### Step 1: Open Firewalls (The most important step)

Before installing anything, you must open ports. Oracle has **two** firewalls you have to configure:

**1. Oracle Cloud Dashboard (Security Lists):**
Go to your Oracle Cloud Dashboard -> Networking -> Virtual Cloud Networks -> Click your VCN -> Security Lists -> Default Security List.
Add Ingress Rules for:
*   **TCP & UDP:** Port `3478` (Standard STUN/TURN)
*   **TCP & UDP:** Port `5349` (Secure TLS STUN/TURN - good for strict school firewalls)
*   **UDP:** Ports `49152-65535` (These are the dynamic relay ports used to actually send the video data! If you forget these, it will fail).

**2. The OS Firewall (Run on your server via SSH):**
Oracle instances (Ubuntu) use `iptables` by default. Run these commands via SSH to open the ports on the machine itself:

```bash
sudo iptables -I INPUT -p tcp --dport 3478 -j ACCEPT
sudo iptables -I INPUT -p udp --dport 3478 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 5349 -j ACCEPT
sudo iptables -I INPUT -p udp --dport 5349 -j ACCEPT
sudo iptables -I INPUT -p udp --match multiport --dports 49152:65535 -j ACCEPT
# Save rules (on Ubuntu)
sudo netfilter-persistent save
```

---

### Step 2: Install Coturn

SSH into your Oracle Cloud instance (assuming Ubuntu) and run:

```bash
sudo apt update
sudo apt install coturn
```

---

### Step 3: Configure Coturn

We need to tell Coturn to use enterprise-grade "Time-Limited Credentials" (REST API) using a shared secret.

1. Move the default config out of the way:
```bash
sudo mv /etc/turnserver.conf /etc/turnserver.conf.backup
```

2. Create a new simple config file:
```bash
sudo nano /etc/turnserver.conf
```

3. Paste this configuration (Change the ALL_CAPS values to your own):
```text
# /etc/turnserver.conf

# The public IP of your Oracle Server
external-ip=YOUR_ORACLE_PUBLIC_IP

# The ports to listen on
listening-port=3478
tls-listening-port=5349

# Enterprise Authentication (REST API)
use-auth-secret
static-auth-secret=MySuperSecretAuthKey_12345

# Your Domain (e.g., turn.mycoolgame.com)
realm=YOUR_DOMAIN.COM

# Set the relay port range we opened in the firewall
min-port=49152
max-port=65535

# Logs
log-file=/var/log/turnserver/turn.log
verbose
```

4. Enable the Coturn daemon to run on boot:
```bash
sudo nano /etc/default/coturn
```
*Uncomment the line: `TURNSERVER_ENABLED=1`*

5. Restart Coturn to apply the changes:
```bash
sudo systemctl restart coturn
sudo systemctl status coturn
```

---

### Step 4: Configure Your Application (.env)

Back on your local machine, your Python backend is configured to generate secure, expiring passwords for your users on the fly using the exact same `static-auth-secret` you set up in Coturn.

1. Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

2. Edit `.env` with your actual TURN server details:
```env
# Change this to match your Oracle IP or Domain
TURN_URL=turn:YOUR_DOMAIN.COM:3478?transport=tcp
TURN_SECRET=MySuperSecretAuthKey_12345
```

> **Why `?transport=tcp`?** Strict school firewalls often block UDP traffic. Forcing the TURN connection over TCP disguises it as standard web traffic so it bypasses the firewall!

---

### Step 5: Handling Extreme Firewalls (TLS & HTTPS)

If your school has deep-packet inspection and blocks normal TCP on port `3478`, you must use **TLS**:
1. Edit your `.env` file to use `turns:` (with an "s") and port `5349`:
   `TURN_URL=turns:YOUR_DOMAIN.COM:5349?transport=tcp`

**Important Note on WebRTC and HTTPS:**
WebRTC requires a Secure Context. Modern browsers will entirely block camera and microphone access if your website is not running on `https://` (and secure websockets `wss://`). When deploying this to a real server, make sure you configure SSL certificates (using a tool like Let's Encrypt or Nginx reverse proxy) and run your FastAPI app with HTTPS, or the WebRTC initialization will silently fail regardless of your TURN server. You can test HTTPS locally using the included `run_https.py` script.
