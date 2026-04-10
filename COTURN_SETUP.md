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

We need to tell Coturn your username, password, and domain.

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

# Use long-term credentials mechanism (standard for WebRTC)
lt-cred-mech

# Create a Username and Password (make up a strong password)
user=myuser:MySuperSecretPassword123!

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

### Step 4: Add it to your WebRTC Code (`app.js`)

Back on your local machine, you will update your WebRTC configuration to point to your new Oracle server. Because strict school firewalls often block UDP, it's a good idea to force the TURN connection over TCP by adding `?transport=tcp`.

```javascript
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        // Your Oracle Cloud STUN server
        { urls: 'stun:YOUR_DOMAIN.COM:3478' },
        // Your Oracle Cloud TURN server (forcing TCP to bypass school firewalls)
        {
            urls: 'turn:YOUR_DOMAIN.COM:3478?transport=tcp',
            username: 'myuser',
            credential: 'MySuperSecretPassword123!'
        }
    ]
};
```
