import asyncio
import hashlib
import ipaddress
import logging
import os
import socket
from types import SimpleNamespace
from typing import Literal, Optional
from urllib.parse import urlsplit, urlunsplit

import asyncpg
import cv2
from fastapi import APIRouter, Depends, HTTPException, status
from onvif import ONVIFCamera
from pydantic import BaseModel, Field
from zeep.transports import Transport
from wsdiscovery import QName
from wsdiscovery.discovery import ThreadedWSDiscovery as WSDiscovery

from app.db import get_optional_pool
from app.services.onvif_credentials import (
    add_rtsp_credentials,
    delete_credentials,
    load_credentials,
    save_credentials,
    split_rtsp_credentials,
)
from app.store import memory_registry

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/onvif", tags=["2. ONVIF Camera Discovery"])

_CAMERA_IPV4_NETWORKS = (
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("169.254.0.0/16"),
)
_CAMERA_IPV6_NETWORKS = (
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
)


class DiscoveryRequest(BaseModel):
    username: Optional[str] = Field(default=None, max_length=128)
    password: Optional[str] = Field(default=None, max_length=256)
    stream_username: Optional[str] = Field(default=None, max_length=128)
    stream_password: Optional[str] = Field(default=None, max_length=256)
    use_onvif_credentials_for_rtsp: bool = True
    address: Optional[str] = Field(default=None, max_length=64)
    scheme: Literal["http", "https"] = "http"
    port: int = Field(default=80, ge=1, le=65535)
    device_id: Optional[str] = Field(default=None, max_length=64)


class DiscoveredCamera(BaseModel):
    device_id: str
    camera_code: Optional[str] = None
    ip_address: str
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    firmware_version: Optional[str] = None
    status: str
    stream_ready: bool
    detail: str
    connection_address: Optional[str] = None
    connection_scheme: Optional[str] = None
    connection_port: Optional[int] = None


def _private_address(host: str) -> str:
    def is_camera_network_address(address: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
        if address.is_loopback or address.is_multicast or address.is_unspecified:
            return False
        networks = (
            _CAMERA_IPV4_NETWORKS
            if isinstance(address, ipaddress.IPv4Address)
            else _CAMERA_IPV6_NETWORKS
        )
        return any(address in network for network in networks)

    try:
        addresses = {ipaddress.ip_address(host)}
    except ValueError:
        try:
            addresses = {
                ipaddress.ip_address(result[4][0])
                for result in socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
            }
        except socket.gaierror as exc:
            raise ValueError("Device address could not be resolved.") from exc
    camera_addresses = [
        address for address in addresses if is_camera_network_address(address)
    ]
    if not camera_addresses:
        raise ValueError("ONVIF discovery only accepts devices on private or link-local networks.")
    return str(camera_addresses[0])


def _onvif_failure_status(exc: Exception, has_credentials: bool) -> str:
    error_text = str(exc).lower()
    if any(
        marker in error_text
        for marker in (
            "unauthorized",
            "not authorized",
            "notauthorized",
            "authentication",
            "invalid credential",
            "invalid username",
            "401",
        )
    ):
        return "AUTHENTICATION_FAILED"
    if any(
        marker in error_text
        for marker in (
            "timed out",
            "timeout",
            "connection refused",
            "failed to establish a new connection",
            "max retries exceeded",
            "name or service not known",
            "no route to host",
            "network is unreachable",
        )
    ) or isinstance(exc, (ConnectionError, TimeoutError, socket.timeout, OSError)):
        return "DEVICE_UNREACHABLE"
    return "DEVICE_UNREACHABLE" if has_credentials else "NEEDS_CREDENTIALS"


def _discover_services() -> list[tuple[str, str, str, int, str]]:
    discovery = WSDiscovery()
    discovery.start()
    try:
        services = discovery.searchServices(
            types=[QName("http://www.onvif.org/ver10/network/wsdl", "NetworkVideoTransmitter")],
            timeout=6,
        )
    finally:
        discovery.stop()

    devices = {}
    for service in services:
        endpoint = str(service.getEPR() or "")
        for xaddr in service.getXAddrs() or []:
            try:
                parsed = urlsplit(xaddr)
                if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
                    continue
                address = _private_address(parsed.hostname)
                port = parsed.port or (443 if parsed.scheme.lower() == "https" else 80)
                stable_identity = endpoint or f"{parsed.scheme.lower()}://{address}:{port}"
                device_id = hashlib.sha256(stable_identity.encode("utf-8")).hexdigest()[:32]
                devices[device_id] = (
                    parsed.scheme.lower(),
                    address,
                    port,
                    endpoint,
                )
            except (ValueError, OSError):
                logger.warning("Ignoring invalid or non-local ONVIF discovery address.")
    return [
        (device_id, scheme, address, port, endpoint)
        for device_id, (scheme, address, port, endpoint) in devices.items()
    ]


def _read_camera(scheme: str, host: str, port: int, username: str, password: str) -> dict:
    formatted_host = f"[{host}]" if ":" in host else host
    camera = ONVIFCamera(
        f"{scheme}://{formatted_host}",
        port,
        username,
        password,
        no_cache=True,
        transport=Transport(timeout=5, operation_timeout=8),
    )
    info = camera.devicemgmt.GetDeviceInformation()
    media = camera.create_media_service()
    profiles = media.GetProfiles()
    if not profiles:
        raise ValueError("The camera did not provide an ONVIF media profile.")

    def profile_resolution(profile):
        resolution = getattr(
            getattr(profile, "VideoEncoderConfiguration", None),
            "Resolution",
            None,
        )
        return (getattr(resolution, "Width", 0) or 0) * (
            getattr(resolution, "Height", 0) or 0
        )

    profile = max(profiles, key=profile_resolution)
    profile_token = getattr(profile, "token", None)
    if not profile_token:
        raise ValueError("The camera's ONVIF media profile has no token.")
    stream = media.GetStreamUri(
        {
            "StreamSetup": {
                "Stream": "RTP-Unicast",
                "Transport": {"Protocol": "RTSP"},
            },
            "ProfileToken": profile_token,
        }
    )
    stream_uri = str(getattr(stream, "Uri", "") or "").strip()
    parsed_uri = urlsplit(stream_uri)
    if parsed_uri.scheme.lower() not in {"rtsp", "rtsps"} or not parsed_uri.hostname:
        raise ValueError("The camera did not return a valid RTSP stream URI.")

    clean_uri, stream_username, stream_password = split_rtsp_credentials(stream_uri)
    clean_parts = urlsplit(clean_uri)
    stream_host = _private_address(clean_parts.hostname or "")
    formatted_stream_host = f"[{stream_host}]" if ":" in stream_host else stream_host
    stream_netloc = (
        f"{formatted_stream_host}:{clean_parts.port}"
        if clean_parts.port
        else formatted_stream_host
    )
    clean_uri = urlunsplit(
        (
            clean_parts.scheme,
            stream_netloc,
            clean_parts.path,
            clean_parts.query,
            clean_parts.fragment,
        )
    )
    return {
        "manufacturer": str(getattr(info, "Manufacturer", "") or "").strip(),
        "model": str(getattr(info, "Model", "") or "").strip(),
        "firmware_version": str(getattr(info, "FirmwareVersion", "") or "").strip(),
        "rtsp_url": clean_uri,
        "stream_username": stream_username,
        "stream_password": stream_password,
    }


def _verify_rtsp_stream(rtsp_url: str, username: str, password: str) -> bool:
    """Confirm the backend can open the RTSP profile and decode an actual frame."""
    stream_url = (
        add_rtsp_credentials(rtsp_url, username, password)
        if username or password
        else rtsp_url
    )
    capture = None
    try:
        os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"
        capture = cv2.VideoCapture(
            stream_url,
            cv2.CAP_FFMPEG,
            [
                cv2.CAP_PROP_OPEN_TIMEOUT_MSEC,
                8000,
                cv2.CAP_PROP_READ_TIMEOUT_MSEC,
                8000,
            ],
        )
        if not capture.isOpened():
            return False
        success, frame = capture.read()
        return bool(success and frame is not None and frame.size)
    except (cv2.error, ValueError):
        return False
    finally:
        if capture is not None:
            capture.release()


async def _persist_camera_to_database(
    db: Optional[asyncpg.Pool],
    camera,
) -> None:
    if db is None or not hasattr(db, "acquire"):
        return
    department_name = camera.department_name
    zone_code = (
        f"ONVIF-{hashlib.sha256(department_name.lower().encode()).hexdigest()[:12].upper()}"
    )
    async with db.acquire() as connection:
        async with connection.transaction():
            department_id = await connection.fetchval(
                """
                INSERT INTO departments (dept_name, zone_code)
                VALUES ($1, $2)
                ON CONFLICT (dept_name) DO UPDATE SET zone_code = EXCLUDED.zone_code
                RETURNING id
                """,
                department_name,
                zone_code,
            )
            await connection.execute(
                """
                INSERT INTO cameras (
                    dept_id, camera_code, make_model, source_type, ip_address,
                    rtsp_url, location, camera_type, status, ageing
                )
                VALUES (
                    $1, $2, $3, 'NETWORK_CCTV', $4, $5,
                    ST_SetSRID(ST_MakePoint($6, $7), 4326),
                    $8, 'ONLINE', 0
                )
                ON CONFLICT (camera_code) DO UPDATE SET
                    dept_id = EXCLUDED.dept_id,
                    make_model = EXCLUDED.make_model,
                    source_type = EXCLUDED.source_type,
                    ip_address = EXCLUDED.ip_address,
                    rtsp_url = EXCLUDED.rtsp_url,
                    location = EXCLUDED.location,
                    camera_type = EXCLUDED.camera_type,
                    status = EXCLUDED.status,
                    ageing = EXCLUDED.ageing,
                    updated_at = CURRENT_TIMESTAMP
                """,
                department_id,
                camera.camera_code,
                camera.make_model,
                camera.ip_address,
                camera.rtsp_url,
                camera.longitude,
                camera.latitude,
                camera.camera_type,
            )


@router.post("/discover", response_model=list[DiscoveredCamera])
async def discover_onvif_cameras(
    request: DiscoveryRequest,
    db: Optional[asyncpg.Pool] = Depends(get_optional_pool),
):
    """Discover local ONVIF devices, resolve authenticated RTSP profiles, and update the registry."""
    if bool(request.username) != bool(request.password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide both the camera username and password, or leave both blank.",
        )
    if bool(request.stream_username) != bool(request.stream_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide both the RTSP stream username and password, or leave both blank.",
        )

    if request.address:
        try:
            address = str(ipaddress.ip_address(request.address.strip()))
            address = _private_address(address)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Enter a valid private or link-local camera IP address.",
            ) from exc
        device_id = hashlib.sha256(
            f"manual|{request.scheme}|{address}|{request.port}".encode("utf-8")
        ).hexdigest()[:32]
        discovered = [(device_id, request.scheme, address, request.port, "")]
    else:
        try:
            discovered = await asyncio.to_thread(_discover_services)
        except Exception as exc:
            logger.error("ONVIF WS-Discovery failed: %s", type(exc).__name__)
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=(
                    "ONVIF discovery failed. Confirm the backend is running on the "
                    "camera network and WS-Discovery is allowed."
                ),
            ) from exc
    if request.device_id:
        discovered = [device for device in discovered if device[0] == request.device_id]
        if not discovered:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="That camera was not found in the current WS-Discovery scan.",
            )

    semaphore = asyncio.Semaphore(8)

    async def inspect_device(device):
        device_id, scheme, host, port = device[0], device[1], device[2], device[3]
        username = request.username or ""
        password = request.password or ""
        try:
            if request.username is None:
                saved_credentials = await asyncio.to_thread(load_credentials, device_id)
                if saved_credentials:
                    username = saved_credentials["username"]
                    password = saved_credentials["password"]
        except RuntimeError:
            logger.exception("Unable to load encrypted ONVIF credentials for device %s", device_id)
            return device_id, host, username, password, None, "CREDENTIAL_STORE_ERROR"

        try:
            async with semaphore:
                details = await asyncio.to_thread(
                    _read_camera, scheme, host, port, username, password
                )
            return device_id, host, username, password, details, "ONLINE"
        except Exception as exc:
            logger.warning("ONVIF query failed for %s (%s)", device_id, type(exc).__name__)
            state = _onvif_failure_status(exc, bool(username))
            return device_id, host, username, password, None, state

    inspected = await asyncio.gather(*(inspect_device(device) for device in discovered))

    async def verify_stream(device, inspected_result):
        device_id = device[0]
        _, _, username, password, details, _ = inspected_result
        if details is None:
            return (*inspected_result, "", "", False, None)
        try:
            if username or password:
                await asyncio.to_thread(save_credentials, device_id, username, password)
            saved_stream_credentials = None
            if request.stream_username is None and not (
                details.get("stream_username") or details.get("stream_password")
            ):
                saved_stream_credentials = await asyncio.to_thread(
                    load_credentials, f"{device_id}:rtsp"
                )
            stream_username = (
                request.stream_username
                if request.stream_username is not None
                else details.get("stream_username")
                or (saved_stream_credentials or {}).get("username")
                or (username if request.use_onvif_credentials_for_rtsp else "")
            )
            stream_password = (
                request.stream_password
                if request.stream_password is not None
                else details.get("stream_password")
                or (saved_stream_credentials or {}).get("password")
                or (password if request.use_onvif_credentials_for_rtsp else "")
            )
            async with semaphore:
                stream_ready = await asyncio.to_thread(
                    _verify_rtsp_stream,
                    details["rtsp_url"],
                    stream_username,
                    stream_password,
                )
            return (
                *inspected_result,
                stream_username,
                stream_password,
                stream_ready,
                None,
            )
        except RuntimeError:
            logger.exception(
                "Unable to access encrypted credentials for ONVIF device %s",
                device_id,
            )
            return (
                *inspected_result,
                "",
                "",
                False,
                "CREDENTIAL_STORE_ERROR",
            )

    verified = await asyncio.gather(
        *(verify_stream(device, result) for device, result in zip(discovered, inspected))
    )
    results = []
    changed_device_ids = set()
    for device, verified_result in zip(discovered, verified):
        device_id = device[0]
        host = device[2]
        (
            _,
            _,
            username,
            password,
            details,
            state,
            stream_username,
            stream_password,
            stream_ready,
            verification_error,
        ) = verified_result
        camera_code = f"ONVIF-{device_id[:10].upper()}"
        if details is None:
            results.append(
                DiscoveredCamera(
                    device_id=device_id,
                    camera_code=None,
                    ip_address=host,
                    status=state,
                    stream_ready=False,
                    connection_address=request.address,
                    connection_scheme=request.scheme if request.address else None,
                    connection_port=request.port if request.address else None,
                    detail=(
                        "Check that ONVIF_CREDENTIALS_KEY is set and unchanged, and that "
                        "the encrypted credential store is readable."
                        if state == "CREDENTIAL_STORE_ERROR"
                        else (
                            "Enter valid ONVIF camera credentials and scan again."
                            if state in {"NEEDS_CREDENTIALS", "AUTHENTICATION_FAILED"}
                            else (
                                "Check that the backend can reach the camera's ONVIF "
                                "port over the LAN or VPN, then retry."
                                if state == "DEVICE_UNREACHABLE"
                                else "Could not read this camera's ONVIF services."
                            )
                        )
                    ),
                )
            )
            continue

        if verification_error:
            results.append(
                DiscoveredCamera(
                    device_id=device_id,
                    ip_address=host,
                    manufacturer=details["manufacturer"] or None,
                    model=details["model"] or None,
                    firmware_version=details["firmware_version"] or None,
                    status=verification_error,
                    stream_ready=False,
                    connection_address=request.address,
                    connection_scheme=request.scheme if request.address else None,
                    connection_port=request.port if request.address else None,
                    detail=(
                        "Could not securely load or save camera credentials. "
                        "Check ONVIF_CREDENTIALS_KEY and the encrypted credential store."
                    ),
                )
            )
            continue

        if not stream_ready:
            results.append(
                DiscoveredCamera(
                    device_id=device_id,
                    camera_code=None,
                    ip_address=host,
                    manufacturer=details["manufacturer"] or None,
                    model=details["model"] or None,
                    firmware_version=details["firmware_version"] or None,
                    status="RTSP_UNAVAILABLE",
                    stream_ready=False,
                    connection_address=request.address,
                    connection_scheme=request.scheme if request.address else None,
                    connection_port=request.port if request.address else None,
                    detail=(
                        "ONVIF worked, but RTSP did not return a live frame. Check the "
                        "RTSP service and port, try the separate RTSP credentials, or "
                        "disable ONVIF credentials for RTSP if the feed is anonymous."
                    ),
                )
            )
            continue

        try:
            stream_credential_id = None
            if stream_username or stream_password:
                if username and username == stream_username and password == stream_password:
                    stream_credential_id = device_id
                else:
                    stream_credential_id = f"{device_id}:rtsp"
                    await asyncio.to_thread(
                        save_credentials,
                        stream_credential_id,
                        stream_username,
                        stream_password,
                    )
            camera = SimpleNamespace(
                dept_id=None,
                department_name="ONVIF Auto-Discovery",
                camera_code=camera_code,
                onvif_device_id=device_id,
                credential_id=stream_credential_id,
                make_model=" ".join(
                    part for part in (details["manufacturer"], details["model"]) if part
                )
                or "ONVIF Camera",
                source_type="NETWORK_CCTV",
                ip_address=host,
                rtsp_url=details["rtsp_url"],
                latitude=None,
                longitude=None,
                camera_type="FIXED",
                status="ONLINE",
                ageing=0.0,
            )
            existing_camera = memory_registry.get_camera_by_id(camera_code)
            if existing_camera and (
                existing_camera.get("ip_address") != host
                or existing_camera.get("rtsp_url") != details["rtsp_url"]
            ):
                changed_device_ids.add(device_id)
            await _persist_camera_to_database(db, camera)
            registered = memory_registry.upsert_camera(camera)
        except RuntimeError as exc:
            logger.error("Unable to store ONVIF camera credentials: %s", str(exc))
            results.append(
                DiscoveredCamera(
                    device_id=device_id,
                    ip_address=host,
                    status="CREDENTIAL_STORE_ERROR",
                    stream_ready=False,
                    connection_address=request.address,
                    connection_scheme=request.scheme if request.address else None,
                    connection_port=request.port if request.address else None,
                    detail=str(exc),
                )
            )
            continue
        except Exception as exc:
            logger.exception("Unable to register ONVIF camera %s", device_id)
            results.append(
                DiscoveredCamera(
                    device_id=device_id,
                    ip_address=host,
                    status="REGISTRATION_ERROR",
                    stream_ready=False,
                    connection_address=request.address,
                    connection_scheme=request.scheme if request.address else None,
                    connection_port=request.port if request.address else None,
                    detail="Camera feed was resolved but could not be registered.",
                )
            )
            continue

        results.append(
            DiscoveredCamera(
                device_id=device_id,
                camera_code=camera_code,
                ip_address=host,
                manufacturer=details["manufacturer"] or None,
                model=details["model"] or None,
                firmware_version=details["firmware_version"] or None,
                status="ONLINE",
                stream_ready=True,
                connection_address=request.address,
                connection_scheme=request.scheme if request.address else None,
                connection_port=request.port if request.address else None,
                detail=f"RTSP profile resolved and registered as {registered['camera_code']}.",
            )
        )

    if changed_device_ids:
        from app.services.anpr_engine import anpr_engine

        if anpr_engine.is_running and anpr_engine.source_type == "CAMERA":
            active_camera = memory_registry.get_camera_by_id(anpr_engine.source_id)
            active_device_id = active_camera.get("onvif_device_id") if active_camera else None
            if active_device_id in changed_device_ids:
                try:
                    anpr_engine.start(
                        "CAMERA",
                        anpr_engine.source_id,
                        anpr_engine.source_name,
                    )
                except Exception:
                    logger.exception("Unable to reconnect active ANPR feed after ONVIF refresh.")
                    for result in results:
                        if result.camera_code == active_camera.get("camera_code"):
                            result.status = "ANPR_RECONNECT_FAILED"
                            result.detail = (
                                "The camera feed was refreshed, but the active ANPR stream "
                                "could not reconnect. Restart ANPR for this camera."
                            )
                            break

    return results


@router.delete("/{device_id}/credentials")
async def remove_camera_credentials(device_id: str):
    try:
        removed_onvif = await asyncio.to_thread(delete_credentials, device_id)
        removed_stream = await asyncio.to_thread(
            delete_credentials, f"{device_id}:rtsp"
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {
        "removed": removed_onvif or removed_stream,
        "device_id": device_id,
    }
