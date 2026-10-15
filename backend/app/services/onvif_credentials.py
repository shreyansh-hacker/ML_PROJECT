import json
import os
import tempfile
import threading
from pathlib import Path
from typing import Optional
from urllib.parse import quote, urlsplit, urlunsplit

from cryptography.fernet import Fernet, InvalidToken

from app.config import settings

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
CREDENTIALS_FILE = DATA_DIR / "onvif_credentials.json"
_CREDENTIALS_LOCK = threading.RLock()


def _cipher() -> Fernet:
    key = settings.onvif_credentials_key.strip()
    if not key:
        raise RuntimeError(
            "Set ONVIF_CREDENTIALS_KEY in the backend environment before saving camera credentials."
        )
    try:
        return Fernet(key.encode("ascii"))
    except (ValueError, UnicodeEncodeError) as exc:
        raise RuntimeError("ONVIF_CREDENTIALS_KEY is not a valid Fernet key.") from exc


def _read_records() -> dict[str, dict[str, str]]:
    if not CREDENTIALS_FILE.exists():
        return {}
    try:
        records = json.loads(CREDENTIALS_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError("Could not read the encrypted ONVIF credentials store.") from exc
    if not isinstance(records, dict):
        raise RuntimeError("The encrypted ONVIF credentials store has an invalid format.")
    return records


def _write_records(records: dict[str, dict[str, str]]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=DATA_DIR,
            prefix=".onvif-credentials-",
            suffix=".tmp",
            delete=False,
        ) as temporary_file:
            temporary_path = Path(temporary_file.name)
            json.dump(records, temporary_file, indent=2)
        os.replace(temporary_path, CREDENTIALS_FILE)
        if os.name != "nt":
            CREDENTIALS_FILE.chmod(0o600)
    except OSError as exc:
        if temporary_path:
            temporary_path.unlink(missing_ok=True)
        raise RuntimeError("Could not persist encrypted ONVIF credentials.") from exc


def save_credentials(device_id: str, username: str, password: str) -> None:
    cipher = _cipher()
    payload = json.dumps({"username": username, "password": password}).encode("utf-8")
    with _CREDENTIALS_LOCK:
        if load_credentials(device_id) == {
            "username": username,
            "password": password,
        }:
            return
        records = _read_records()
        records[device_id] = {"token": cipher.encrypt(payload).decode("ascii")}
        _write_records(records)


def load_credentials(device_id: str) -> Optional[dict[str, str]]:
    with _CREDENTIALS_LOCK:
        record = _read_records().get(device_id)
        if record is None:
            return None
        cipher = _cipher()
        try:
            payload = cipher.decrypt(record["token"].encode("ascii"))
            credentials = json.loads(payload)
        except (KeyError, ValueError, UnicodeEncodeError, InvalidToken, json.JSONDecodeError) as exc:
            raise RuntimeError(
                "Could not decrypt ONVIF credentials; verify ONVIF_CREDENTIALS_KEY is unchanged."
            ) from exc
    if not isinstance(credentials, dict) or not isinstance(credentials.get("username"), str) or not isinstance(credentials.get("password"), str):
        raise RuntimeError("The encrypted ONVIF credentials store has an invalid entry.")
    return credentials


def delete_credentials(device_id: str) -> bool:
    with _CREDENTIALS_LOCK:
        records = _read_records()
        if device_id not in records:
            return False
        records.pop(device_id)
        _write_records(records)
        return True


def add_rtsp_credentials(rtsp_url: str, username: str, password: str) -> str:
    parts = urlsplit(rtsp_url)
    if parts.scheme.lower() not in {"rtsp", "rtsps"} or not parts.netloc:
        raise ValueError("The ONVIF device returned an invalid RTSP stream URI.")
    host = parts.netloc.rsplit("@", 1)[-1]
    auth = f"{quote(username, safe='')}:{quote(password, safe='')}@"
    return urlunsplit((parts.scheme, auth + host, parts.path, parts.query, parts.fragment))


def split_rtsp_credentials(rtsp_url: str) -> tuple[str, Optional[str], Optional[str]]:
    """Remove credentials from an RTSP URI and return them separately for encrypted storage."""
    parts = urlsplit(rtsp_url)
    if parts.scheme.lower() not in {"rtsp", "rtsps"} or not parts.netloc:
        raise ValueError("The camera catalogue returned an invalid RTSP stream URL.")
    if "@" not in parts.netloc:
        return rtsp_url, None, None

    user_info, host = parts.netloc.rsplit("@", 1)
    if ":" not in user_info:
        raise ValueError("The camera catalogue returned incomplete RTSP credentials.")
    username, password = user_info.split(":", 1)
    from urllib.parse import unquote

    sanitized_url = urlunsplit(
        (parts.scheme, host, parts.path, parts.query, parts.fragment)
    )
    return sanitized_url, unquote(username), unquote(password)
