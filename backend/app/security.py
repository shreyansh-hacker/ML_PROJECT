import base64
import binascii
import hashlib
import hmac
import json
import secrets
import threading
import time
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from starlette.types import ASGIApp, Receive, Scope, Send

from app.config import settings

SESSION_COOKIE = "sentinel_session"
SESSION_LIFETIME_SECONDS = 8 * 60 * 60
LOGIN_FAILURE_LIMIT = 5
LOGIN_FAILURE_WINDOW_SECONDS = 15 * 60

router = APIRouter(prefix="/api/auth", tags=["Authentication"])
_login_failures: dict[str, tuple[int, float]] = {}
_login_lock = threading.Lock()


class LoginRequest(BaseModel):
    password: str = Field(min_length=1, max_length=1024)


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _b64decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def create_session_token(now: int | None = None) -> str:
    expires_at = (int(time.time()) if now is None else now) + SESSION_LIFETIME_SECONDS
    payload = _b64encode(
        json.dumps(
            {"exp": expires_at, "nonce": secrets.token_urlsafe(16)},
            separators=(",", ":"),
        ).encode("utf-8")
    )
    signature = hmac.new(
        settings.session_signing_key.encode("utf-8"),
        payload.encode("ascii"),
        hashlib.sha256,
    ).digest()
    return f"{payload}.{_b64encode(signature)}"


def is_valid_session(token: str | None, now: int | None = None) -> bool:
    if not token or "." not in token:
        return False
    payload, provided_signature = token.rsplit(".", 1)
    expected_signature = _b64encode(
        hmac.new(
            settings.session_signing_key.encode("utf-8"),
            payload.encode("ascii"),
            hashlib.sha256,
        ).digest()
    )
    if not hmac.compare_digest(provided_signature, expected_signature):
        return False
    try:
        claims = json.loads(_b64decode(payload))
        expires_at = claims["exp"]
    except (ValueError, TypeError, KeyError, json.JSONDecodeError, binascii.Error):
        return False
    current_time = int(time.time()) if now is None else now
    return isinstance(expires_at, int) and expires_at > current_time


def _origin_allowed(origin: str) -> bool:
    try:
        parsed = urlsplit(origin)
        normalized = f"{parsed.scheme}://{parsed.netloc}"
    except ValueError:
        return False
    return normalized == origin.rstrip("/") and normalized in settings.allowed_cors_origins


class SecurityMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        method = scope.get("method", "GET").upper()
        headers = {key.lower(): value for key, value in scope.get("headers", [])}
        public_paths = {"/", "/health", "/api/auth/login", "/api/auth/session"}
        fetch_site = headers.get(b"sec-fetch-site", b"").decode("latin-1").lower()
        origin = headers.get(b"origin", b"").decode("latin-1")

        if method == "OPTIONS":
            await self.app(scope, receive, send)
            return

        if path not in public_paths and fetch_site == "cross-site" and not _origin_allowed(origin):
            await self._reject(scope, receive, send, 403, "Cross-site requests are not allowed.")
            return

        if method not in {"GET", "HEAD"}:
            if not _origin_allowed(origin):
                await self._reject(scope, receive, send, 403, "Untrusted request origin.")
                return

        if path not in public_paths:
            cookie_header = headers.get(b"cookie", b"").decode("latin-1")
            cookies = {}
            for part in cookie_header.split(";"):
                name, separator, value = part.strip().partition("=")
                if separator:
                    cookies[name] = value
            if not is_valid_session(cookies.get(SESSION_COOKIE)):
                await self._reject(scope, receive, send, 401, "Authentication required.")
                return

        async def send_with_security_headers(message):
            if message["type"] == "http.response.start":
                message.setdefault("headers", []).extend(
                    [
                        (b"x-content-type-options", b"nosniff"),
                        (b"x-frame-options", b"DENY"),
                        (b"referrer-policy", b"strict-origin-when-cross-origin"),
                        (b"cache-control", b"no-store"),
                    ]
                )
            await send(message)

        await self.app(scope, receive, send_with_security_headers)

    @staticmethod
    async def _reject(
        scope: Scope, receive: Receive, send: Send, code: int, detail: str
    ) -> None:
        from starlette.responses import JSONResponse

        response = JSONResponse({"detail": detail}, status_code=code)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Cache-Control"] = "no-store"
        await response(scope, receive, send)


def _is_rate_limited(client_ip: str, now: float) -> bool:
    with _login_lock:
        expired = [
            ip for ip, (_, timestamp) in _login_failures.items()
            if now - timestamp >= LOGIN_FAILURE_WINDOW_SECONDS
        ]
        for ip in expired:
            _login_failures.pop(ip, None)
        count, timestamp = _login_failures.get(client_ip, (0, now))
        return count >= LOGIN_FAILURE_LIMIT and now - timestamp < LOGIN_FAILURE_WINDOW_SECONDS


def _record_login_failure(client_ip: str, now: float) -> None:
    with _login_lock:
        count, timestamp = _login_failures.get(client_ip, (0, now))
        if now - timestamp >= LOGIN_FAILURE_WINDOW_SECONDS:
            count, timestamp = 0, now
        _login_failures[client_ip] = (count + 1, timestamp)


@router.get("/session")
async def get_session(request: Request):
    return {
        "authenticated": is_valid_session(request.cookies.get(SESSION_COOKIE))
    }


@router.post("/login")
async def login(request: Request, credentials: LoginRequest, response: Response):
    client_ip = request.client.host if request.client else "unknown"
    now = time.time()
    if _is_rate_limited(client_ip, now):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed login attempts. Try again in 15 minutes.",
        )
    if not hmac.compare_digest(
        credentials.password.encode("utf-8"),
        settings.admin_password.encode("utf-8"),
    ):
        _record_login_failure(client_ip, now)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid password.",
        )

    with _login_lock:
        _login_failures.pop(client_ip, None)
    response.set_cookie(
        key=SESSION_COOKIE,
        value=create_session_token(),
        max_age=SESSION_LIFETIME_SECONDS,
        httponly=True,
        secure=settings.environment.lower() == "production",
        samesite="none" if settings.environment.lower() == "production" else "strict",
        path="/",
    )
    return {"authenticated": True}


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie(
        key=SESSION_COOKIE,
        httponly=True,
        secure=settings.environment.lower() == "production",
        samesite="none" if settings.environment.lower() == "production" else "strict",
        path="/",
    )
    return {"authenticated": False}


def validate_security_configuration() -> None:
    if len(settings.admin_password) < 16:
        raise RuntimeError("ADMIN_PASSWORD must be configured with at least 16 characters.")
    if len(settings.session_signing_key.encode("utf-8")) < 32:
        raise RuntimeError("SESSION_SIGNING_KEY must contain at least 32 bytes.")
    if not settings.allowed_cors_origins or "*" in settings.allowed_cors_origins:
        raise RuntimeError("CORS_ORIGINS must contain explicit trusted origins only.")
    for origin in settings.allowed_cors_origins:
        parsed = urlsplit(origin)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.netloc
            or parsed.path
            or parsed.query
            or parsed.fragment
            or parsed.username
            or parsed.password
        ):
            raise RuntimeError("CORS_ORIGINS entries must be exact HTTP(S) origins.")
        if settings.environment.lower() == "production" and parsed.scheme != "https":
            raise RuntimeError("Production CORS_ORIGINS must use HTTPS.")
