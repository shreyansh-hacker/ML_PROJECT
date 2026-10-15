# Backend camera setup

## Add an ONVIF camera

1. Enable ONVIF in the camera or NVR settings and create an ONVIF account. The ONVIF
   account can differ from the RTSP streaming account.
2. Give the backend host network access to the camera. Network scanning uses WS-Discovery
   multicast (UDP 3702), which normally stays on the local LAN/VLAN. For another subnet
   or site, establish a VPN/private route and connect using the camera's private IP.
   Allow the ONVIF TCP port and the camera's RTSP TCP port from the backend.
3. In the app, open **ANPR → Discover ONVIF**. Use **Scan network** for local multicast
   discovery, or enter the camera's private IP, ONVIF protocol, and port and choose
   **Connect by IP**.
4. Enter ONVIF credentials when prompted. If RTSP uses a different account, enter its
   credentials separately. If RTSP is anonymous, disable **Use ONVIF credentials for
   RTSP**. Credentials are encrypted at rest in the backend credential store.
5. **ANPR READY** means the backend decoded a real frame from the ONVIF-provided RTSP
   profile, registered the camera, and selected it as the ANPR source. Choose **Start
   Stream** to begin ANPR processing.

The backend rejects public, loopback, and reserved addresses for manual ONVIF connection.
Do not expose camera or ONVIF ports directly to the public internet.

## Credential encryption key

Set `ONVIF_CREDENTIALS_KEY` in `backend/.env` before connecting cameras that require
credentials. Generate a Fernet key from the backend environment:

```powershell
.\venv\Scripts\python.exe -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Keep the key stable and private. Changing it makes previously stored camera credentials
undecryptable. This key is for encrypting credentials at rest; it is not a camera login.

## Application access

The API is protected by a single administrator password configured as
`ADMIN_PASSWORD` (minimum 16 characters) and a random `SESSION_SIGNING_KEY`
(minimum 32 bytes). The frontend stores neither value; successful login creates an
eight-hour HTTP-only session cookie. Set `CORS_ORIGINS` to an exact comma-separated
allowlist of trusted frontend origins. Mutating requests must include an allowed
`Origin`; wildcard CORS is rejected.

The ANPR start API does not accept a stream URL from the caller. For camera feeds,
it resolves the stream only from the registered camera record. Do not expose camera
ports to the public internet; use a private network or VPN.

For a fresh local setup, copy `.env.example` to `.env` and set strong random values
for `ADMIN_PASSWORD`, `SESSION_SIGNING_KEY`, and `ONVIF_CREDENTIALS_KEY`. Generate
random values from this directory with:

```powershell
.\venv\Scripts\python.exe -c "import secrets; print(secrets.token_urlsafe(32))"
```

Use separate generated values for each setting and keep `.env` private. Do not
reuse a camera password as the administrator password. When rotating the
administrator password, also rotate `SESSION_SIGNING_KEY` to invalidate existing
sessions.
