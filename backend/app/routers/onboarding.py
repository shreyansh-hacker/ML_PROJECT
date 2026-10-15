from fastapi import APIRouter, HTTPException, UploadFile, File, Depends, status
import asyncio
import os
import csv
import io
import json
import hashlib
import logging
import re
from uuid import UUID
from typing import Optional
from app.db import get_optional_pool
from app.schemas.cameras import CameraCreate
from app.store import memory_registry
from app.services.onvif_credentials import delete_credentials
import asyncpg

router = APIRouter(prefix="/api/cameras", tags=["1. Camera Onboarding"])
logger = logging.getLogger(__name__)

@router.post("/manual", status_code=status.HTTP_201_CREATED)
async def create_camera_manual(camera: CameraCreate, db: Optional[asyncpg.Pool] = Depends(get_optional_pool)):
    """Manual Entry & Programmatic API Onboarding"""
    if db is None:
        # Fallback to in-memory store if PostGIS is not yet running
        return memory_registry.add_camera(camera)

    # 1. Resolve Department ID
    dept_id = camera.dept_id
    if not dept_id and camera.department_name:
        dept_row = await db.fetchrow(
            "SELECT id FROM departments WHERE LOWER(dept_name) = LOWER($1)",
            camera.department_name.strip()
        )
        if dept_row:
            dept_id = dept_row["id"]
        else:
            # Auto-create department if it doesn't exist
            new_zone = f"ZONE-{camera.department_name[:3].upper()}"
            dept_row = await db.fetchrow(
                "INSERT INTO departments (dept_name, zone_code) VALUES ($1, $2) RETURNING id",
                camera.department_name.strip(), new_zone
            )
            dept_id = dept_row["id"]

    if not dept_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A valid department_id or department_name must be provided."
        )

    # 2. Insert Camera Record
    query = """
        INSERT INTO cameras (
            dept_id,
            camera_code,
            make_model,
            source_type,
            ip_address,
            rtsp_url,
            location,
            camera_type,
            status,
            ageing
        )
        VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            CASE 
                WHEN $7::float IS NOT NULL AND $8::float IS NOT NULL 
                THEN ST_SetSRID(ST_MakePoint($7, $8), 4326)
                ELSE NULL 
            END,
            $9,
            $10,
            $11
        )
        RETURNING id, camera_code, status;
    """
    try:
        row = await db.fetchrow(
            query,
            dept_id,
            camera.camera_code.strip(),
            camera.make_model,
            camera.source_type,
            camera.ip_address,
            camera.rtsp_url,
            camera.longitude,
            camera.latitude,
            camera.camera_type,
            camera.status,
            camera.ageing
        )
        return {
            "message": "Camera registered successfully",
            "id": str(row["id"]),
            "camera_code": row["camera_code"],
            "status": row["status"]
        }
    except asyncpg.UniqueViolationError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Camera code '{camera.camera_code}' already exists."
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to onboard camera: {str(exc)}"
        )

@router.delete("/{camera_id}", status_code=status.HTTP_200_OK)
async def delete_camera(camera_id: str, db: Optional[asyncpg.Pool] = Depends(get_optional_pool)):
    """Delete a camera from the registry by ID or camera_code"""
    camera = memory_registry.get_camera_by_id(camera_id)
    credential_ids = {
        str(camera.get(key))
        for key in ("credential_id", "onvif_device_id")
        if camera and camera.get(key)
    }

    if db is not None:
        try:
            async with db.acquire() as conn:
                await conn.execute(
                    "DELETE FROM cameras WHERE id::text = $1 OR camera_code = $1",
                    str(camera_id)
                )
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to delete camera from database: {str(exc)}"
            )

    memory_registry.delete_camera(camera_id)
    for credential_id in credential_ids:
        try:
            delete_credentials(credential_id)
        except RuntimeError as exc:
            logger.exception("Failed to remove stored credentials for camera %s.", camera_id)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Camera was removed, but its stored credentials could not be cleaned up.",
            ) from exc

    return {
        "message": f"Camera '{camera_id}' removed successfully.",
        "id": camera_id
    }

@router.get("/template-csv")
async def download_template_csv():
    """Download standard sample CSV template for bulk onboarding"""
    from fastapi.responses import FileResponse
    from app.store import DATA_DIR
    template_path = os.path.join(DATA_DIR, "cameras_sample.csv")
    if os.path.exists(template_path):
        return FileResponse(
            template_path,
            media_type="text/csv",
            filename="cameras_template.csv"
        )
    raise HTTPException(status_code=404, detail="Template CSV file not found.")

@router.post("/bulk-import", status_code=status.HTTP_201_CREATED)
async def bulk_import_csv(file: UploadFile = File(...), db: Optional[asyncpg.Pool] = Depends(get_optional_pool)):
    """Bulk Import Cameras via CSV Upload (supports dept_name and NETWORK / LOCAL_WEBCAM source types)"""
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are allowed.")
    
    raw_content = await file.read()
    try:
        decoded = raw_content.decode("utf-8-sig")
    except UnicodeDecodeError:
        decoded = raw_content.decode("latin-1")

    reader = csv.DictReader(io.StringIO(decoded))
    
    imported = []
    skipped = []

    for row_idx, row in enumerate(reader, start=2):
        clean_row = {str(k).strip(): str(v).strip() for k, v in row.items() if k is not None}
        code = clean_row.get("camera_code")
        if not code:
            continue

        dept = clean_row.get("dept_name") or clean_row.get("department_name") or clean_row.get("dept_id") or "General"
        
        # Source type normalization
        raw_source = clean_row.get("source_type", "NETWORK_CCTV").upper()
        if "WEBCAM" in raw_source or "LOCAL" in raw_source:
            source_type = "LOCAL_WEBCAM"
        else:
            source_type = "NETWORK_CCTV"

        camera_type = clean_row.get("camera_type", "FIXED").upper()
        if camera_type not in ["PTZ", "BULLET", "DOME", "THERMAL", "FIXED"]:
            camera_type = "FIXED"

        status_val = clean_row.get("status", "ONLINE").upper()
        if status_val not in ["ONLINE", "OFFLINE", "MAINTENANCE"]:
            status_val = "ONLINE"

        make_model = clean_row.get("make_model") or "Generic CCTV"
        ip_addr = clean_row.get("ip_address") or "103.250.160.189"
        rtsp = clean_row.get("rtsp_url") or ""

        try:
            lat = float(clean_row["latitude"]) if clean_row.get("latitude") else 23.0225
            lon = float(clean_row["longitude"]) if clean_row.get("longitude") else 72.5714
        except ValueError:
            lat, lon = 23.0225, 72.5714

        try:
            ageing_val = float(clean_row.get("ageing", 0.0))
        except ValueError:
            ageing_val = 0.0

        from types import SimpleNamespace
        cam_obj = SimpleNamespace(
            dept_id=None,
            department_name=dept,
            camera_code=code,
            make_model=make_model,
            source_type=source_type,
            ip_address=ip_addr,
            rtsp_url=rtsp,
            latitude=lat,
            longitude=lon,
            camera_type=camera_type,
            status=status_val,
            ageing=ageing_val
        )

        try:
            # Upsert: delete existing before adding to avoid duplicate key errors
            memory_registry.delete_camera(code)
            res = memory_registry.add_camera(cam_obj)
            imported.append(code)
        except Exception as e:
            skipped.append(f"{code}: {str(e)}")

        if db is not None:
            try:
                # Resolve or auto-create department in DB
                dept_row = await db.fetchrow(
                    "SELECT id FROM departments WHERE LOWER(dept_name) = LOWER($1)",
                    dept
                )
                if dept_row:
                    db_dept_id = dept_row["id"]
                else:
                    new_zone = f"ZONE-{dept[:3].upper()}"
                    dept_row = await db.fetchrow(
                        "INSERT INTO departments (dept_name, zone_code) VALUES ($1, $2) RETURNING id",
                        dept, new_zone
                    )
                    db_dept_id = dept_row["id"]

                query = """
                    INSERT INTO cameras (
                        dept_id, camera_code, make_model, source_type, ip_address, rtsp_url, 
                        location, camera_type, status, ageing
                    )
                    VALUES (
                        $1, $2, $3, $4, $5, $6,
                        ST_SetSRID(ST_MakePoint($7, $8), 4326),
                        $9, $10, $11
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
                        ageing = EXCLUDED.ageing;
                """
                await db.execute(
                    query,
                    db_dept_id, code, make_model, source_type, ip_addr, rtsp,
                    lon, lat, camera_type, status_val, ageing_val
                )
            except Exception:
                pass

    return {
        "message": f"Successfully imported {len(imported)} cameras.",
        "imported_count": len(imported),
        "imported_codes": imported,
        "skipped": skipped
    }

@router.get("/csv-template")
async def download_csv_template_alias():
    return await download_template_csv()

@router.post("/validate-csv")
async def validate_csv(file: UploadFile = File(...)):
    """Pre-validate CSV file and return parsed rows with validation flags"""
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are allowed.")
    raw_content = await file.read()
    try:
        decoded = raw_content.decode("utf-8-sig")
    except UnicodeDecodeError:
        decoded = raw_content.decode("latin-1")
    reader = csv.DictReader(io.StringIO(decoded))
    parsed_rows = []
    total = 0
    valid_count = 0
    error_count = 0
    for idx, row in enumerate(reader, start=1):
        clean_row = {str(k).strip(): str(v).strip() for k, v in row.items() if k is not None}
        code = clean_row.get("camera_code", "")
        errors = []
        if not code:
            errors.append("Missing camera_code")
        raw_source = clean_row.get("source_type", "NETWORK_CCTV").upper()
        source_type = "LOCAL_WEBCAM" if ("WEBCAM" in raw_source or "LOCAL" in raw_source) else "NETWORK_CCTV"
        try:
            lat = float(clean_row["latitude"]) if clean_row.get("latitude") else 23.0225
            lon = float(clean_row["longitude"]) if clean_row.get("longitude") else 72.5714
        except (ValueError, KeyError):
            lat, lon = 23.0225, 72.5714
            errors.append("Invalid coordinates")
        try:
            ageing = float(clean_row.get("ageing", 0.0))
        except (ValueError, KeyError):
            ageing = 0.0
        is_valid = len(errors) == 0
        if is_valid:
            valid_count += 1
        else:
            error_count += 1
        total += 1
        parsed_rows.append({
            "row_number": idx,
            "camera_code": code,
            "dept_name": clean_row.get("dept_name") or clean_row.get("department_name") or "General",
            "camera_type": (clean_row.get("camera_type") or "FIXED").upper(),
            "make_model": clean_row.get("make_model") or "Generic CCTV",
            "source_type": source_type,
            "ip_address": clean_row.get("ip_address") or "103.250.160.189",
            "rtsp_url": clean_row.get("rtsp_url") or "",
            "latitude": lat,
            "longitude": lon,
            "status": (clean_row.get("status") or "ONLINE").upper(),
            "ageing": ageing,
            "is_valid": is_valid,
            "errors": errors
        })
    return {
        "valid": error_count == 0,
        "total_records": total,
        "valid_records": valid_count,
        "error_records": error_count,
        "rows": parsed_rows
    }

@router.post("/validate-records")
async def validate_records(payload: dict):
    records = payload.get("records", [])
    valid_count = 0
    error_count = 0
    validated_rows = []
    for idx, r in enumerate(records, start=1):
        errors = []
        code = str(r.get("camera_code", "")).strip()
        if not code:
            errors.append("Missing camera_code")
        try:
            lat = float(r.get("latitude", 23.0225))
            lon = float(r.get("longitude", 72.5714))
        except (ValueError, TypeError):
            lat, lon = 23.0225, 72.5714
            errors.append("Invalid coordinates")
        is_valid = len(errors) == 0
        if is_valid:
            valid_count += 1
        else:
            error_count += 1
        validated_rows.append({
            **r,
            "row_number": idx,
            "camera_code": code,
            "latitude": lat,
            "longitude": lon,
            "is_valid": is_valid,
            "errors": errors
        })
    return {
        "valid": error_count == 0,
        "total_records": len(records),
        "valid_records": valid_count,
        "error_records": error_count,
        "rows": validated_rows
    }

@router.post("/bulk-import-json", status_code=status.HTTP_201_CREATED)
async def bulk_import_json(payload: dict, db: Optional[asyncpg.Pool] = Depends(get_optional_pool)):
    cameras = payload.get("cameras", [])
    imported = []
    from types import SimpleNamespace
    for r in cameras:
        code = str(r.get("camera_code", "")).strip()
        if not code:
            continue
        dept = str(r.get("dept_name") or r.get("department_name") or "General").strip()
        raw_source = str(r.get("source_type", "NETWORK_CCTV")).upper()
        source_type = "LOCAL_WEBCAM" if ("WEBCAM" in raw_source or "LOCAL" in raw_source) else "NETWORK_CCTV"
        try:
            lat = float(r.get("latitude", 23.0225))
            lon = float(r.get("longitude", 72.5714))
        except (ValueError, TypeError):
            lat, lon = 23.0225, 72.5714
        try:
            ageing = float(r.get("ageing", 0.0))
        except (ValueError, TypeError):
            ageing = 0.0
        cam_obj = SimpleNamespace(
            dept_id=None,
            department_name=dept,
            camera_code=code,
            make_model=r.get("make_model") or "Generic CCTV",
            source_type=source_type,
            ip_address=r.get("ip_address") or "103.250.160.189",
            rtsp_url=r.get("rtsp_url") or "",
            latitude=lat,
            longitude=lon,
            camera_type=(r.get("camera_type") or "FIXED").upper(),
            status=(r.get("status") or "ONLINE").upper(),
            ageing=ageing
        )
        try:
            memory_registry.delete_camera(code)
            memory_registry.add_camera(cam_obj)
            imported.append(code)
        except Exception:
            pass
    return {
        "message": f"Successfully imported {len(imported)} cameras into registry.",
        "imported_count": len(imported),
        "imported_codes": imported
    }

@router.post("/sync-sentinel", status_code=status.HTTP_200_OK)
async def sync_sentinel_grid(payload: Optional[dict] = None, db: Optional[asyncpg.Pool] = Depends(get_optional_pool)):
    """
    Connects to the Sentinel Sandbox Gateway Catalogue (GET /api/ingest)
    as specified in the Gujarat Police Innovation Challenge 2026 Integrator's Guide.
    Fetches all live camera endpoints, coordinates, codecs (H.264/H.265), and stream URLs,
    and synchronizes them into the statewide GIS Registry foundation.
    """
    import httpx
    from types import SimpleNamespace
    from urllib.parse import urlsplit
    from app.config import settings
    from app.services.onvif_credentials import save_credentials, split_rtsp_credentials

    payload = payload or {}
    raw_gateway = str(payload.get("gateway_url") or settings.sentinel_catalogue_url).strip()
    dept_name = str(payload.get("dept_name") or "Gujarat Police - Sentinel Grid").strip()

    remote_cameras = []
    fetch_source = "LIVE_CATALOGUE"
    catalogue_errors = []
    if not raw_gateway.startswith(("http://", "https://")):
        raw_gateway = f"https://{raw_gateway}"
    gateway_parts = urlsplit(raw_gateway)
    if gateway_parts.scheme not in {"http", "https"} or not gateway_parts.hostname:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Catalogue URL must be an HTTP or HTTPS URL.",
        )
    allowed_catalogue_hosts = {
        urlsplit(settings.sentinel_catalogue_url).hostname,
        settings.sentinel_stream_host,
    }
    if gateway_parts.hostname.lower() not in {
        host.lower() for host in allowed_catalogue_hosts if host
    }:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Catalogue host is not in the configured Sentinel camera service allowlist.",
        )
    if gateway_parts.username or gateway_parts.password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Do not put credentials in the catalogue URL.",
        )

    if gateway_parts.path.rstrip("/").endswith((".json", "/api/ingest")):
        catalogue_urls = [raw_gateway.rstrip("/")]
        base_url = f"{gateway_parts.scheme}://{gateway_parts.netloc}"
        if gateway_parts.path.rstrip("/").endswith(".json"):
            catalogue_urls.append(f"{base_url}/api/ingest")
        else:
            catalogue_urls.insert(0, f"{base_url}/cameras.json")
    else:
        base_url = raw_gateway.rstrip("/")
        catalogue_urls = [f"{base_url}/cameras.json", f"{base_url}/api/ingest"]

    # Query the judges' published camera catalogue before using the bundled camera feed list.
    async with httpx.AsyncClient(timeout=8.0, follow_redirects=False) as client:
        for catalogue_url in dict.fromkeys(catalogue_urls):
            try:
                response = await client.get(catalogue_url)
                if response.status_code != 200:
                    catalogue_errors.append(
                        f"{catalogue_url}: HTTP {response.status_code}"
                    )
                    continue
                data = response.json()
                if isinstance(data, list):
                    remote_cameras = data
                elif isinstance(data, dict):
                    remote_cameras = (
                        data.get("cameras") or data.get("data") or data.get("items") or []
                    )
                if isinstance(remote_cameras, list) and remote_cameras:
                    fetch_source = f"LIVE_CATALOGUE:{catalogue_url}"
                    break
                remote_cameras = []
                catalogue_errors.append(f"{catalogue_url}: empty camera list")
            except (httpx.HTTPError, ValueError) as exc:
                catalogue_errors.append(
                    f"{catalogue_url}: {type(exc).__name__}"
                )

    # Use the judge-provided camera list when the catalogue requires a login or is unavailable.
    if not remote_cameras:
        fetch_source = "SANDBOX_CATALOGUE_FALLBACK"
        try:
            stream_credentials = json.loads(
                settings.sentinel_stream_credentials_json or "{}"
            )
        except json.JSONDecodeError as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="SENTINEL_STREAM_CREDENTIALS_JSON must be a valid JSON object.",
            ) from exc
        if not isinstance(stream_credentials, dict):
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="SENTINEL_STREAM_CREDENTIALS_JSON must be a JSON object keyed by camera ID.",
            )
        sample_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data", "cameras_sample.csv")
        if os.path.exists(sample_path):
            with open(sample_path, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    cam_id = row.get("camera_code", "")
                    codec = row.get("codec") or "H.264"
                    rtsp = row.get("rtsp_url") or ""
                    host_ip = settings.sentinel_stream_host
                    row_credentials = stream_credentials.get(cam_id) or stream_credentials.get(
                        cam_id.lower(), {}
                    )
                    if not isinstance(row_credentials, dict):
                        row_credentials = {}
                    remote_cameras.append({
                        "id": cam_id,
                        "camera_code": cam_id,
                        "location": {
                            "lat": float(row.get("latitude", 23.0)),
                            "lng": float(row.get("longitude", 72.5))
                        },
                        "codec": codec,
                        "live_status": row.get("status", "ONLINE"),
                        "camera_type": row.get("camera_type", "PTZ"),
                        "make_model": row.get("make_model", f"Sentinel {codec} Unit"),
                        "dept_name": f"Gujarat Police - {row.get('dept_name', 'State Grid')}",
                        "rtsp_url": rtsp,
                        "username": row_credentials.get("username"),
                        "password": row_credentials.get("password"),
                        "hls_url": f"https://cctv.corp8.cloud/{cam_id.lower()}/index.m3u8",
                        "whep_url": f"http://{host_ip}:8889/stream/{cam_id.lower()}/whep",
                        "ip_address": host_ip
                    })

    if not remote_cameras:
        detail = "No camera catalogue was available and the bundled camera list is empty."
        if catalogue_errors:
            detail = f"{detail} Catalogue errors: {'; '.join(catalogue_errors)}"
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=detail)

    # Synchronize endpoints while keeping camera credentials encrypted and server-side.
    synced_cameras = []
    h264_count = 0
    h265_count = 0
    skipped_cameras = []

    for cam in remote_cameras:
        if not isinstance(cam, dict):
            skipped_cameras.append("Catalogue entry was not an object.")
            continue
        cam_code = str(cam.get("camera_code") or cam.get("id") or "").strip()
        if not cam_code or not re.fullmatch(r"[A-Za-z0-9_-]+", cam_code):
            skipped_cameras.append("Catalogue camera entry had no ID.")
            continue

        loc = cam.get("location") or {}
        if isinstance(loc, dict):
            lat = float(loc.get("lat") or loc.get("latitude") or 23.0225)
            lon = float(loc.get("lng") or loc.get("lon") or loc.get("longitude") or 72.5714)
        elif isinstance(loc, (list, tuple)) and len(loc) >= 2:
            lat, lon = float(loc[0]), float(loc[1])
        else:
            lat = float(cam.get("latitude") or 23.0225)
            lon = float(cam.get("longitude") or 72.5714)

        raw_codec = str(cam.get("codec") or "H.264").upper()
        if "265" in raw_codec or "HEVC" in raw_codec:
            h265_count += 1
            codec = "H.265"
        else:
            h264_count += 1
            codec = "H.264"

        rtsp = cam.get("rtsp_url") or cam.get("rtsp") or ""
        camera_id = str(cam.get("id") or cam_code).strip().lower()
        if not re.fullmatch(r"[a-z0-9_-]+", camera_id):
            skipped_cameras.append(f"{cam_code}: catalogue camera ID is invalid.")
            continue
        host_ip = settings.sentinel_stream_host.strip()
        if not rtsp:
            rtsp = f"rtsp://{host_ip}:8554/stream/{camera_id}"
        hls = f"https://cctv.corp8.cloud/{camera_id}/index.m3u8"
        whep = f"http://{host_ip}:8889/stream/{camera_id}/whep"
        try:
            rtsp, uri_username, uri_password = split_rtsp_credentials(rtsp)
        except ValueError as exc:
            skipped_cameras.append(f"{cam_code}: {exc}")
            continue
        rtsp_parts = urlsplit(rtsp)
        if (
            rtsp_parts.scheme not in {"rtsp", "rtsps"}
            or not rtsp_parts.hostname
            or rtsp_parts.hostname.lower() != host_ip.lower()
        ):
            skipped_cameras.append(
                f"{cam_code}: RTSP URL must point to its declared catalogue camera host."
            )
            continue
        username = str(cam.get("username") or uri_username or "")
        password = str(cam.get("password") or uri_password or "")
        credential_id = f"sentinel:{cam_code}"
        if username or password:
            if not username or not password:
                skipped_cameras.append(f"{cam_code}: incomplete stream credentials.")
                continue
            try:
                await asyncio.to_thread(
                    save_credentials, credential_id, username, password
                )
            except RuntimeError as exc:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail=f"Could not securely save credentials for camera {cam_code}: {exc}",
                ) from exc

        cam_dept = cam.get("dept_name") or dept_name
        raw_status = str(cam.get("live_status") or cam.get("status") or "ONLINE").upper()
        cam_status = raw_status if raw_status in {"ONLINE", "OFFLINE", "MAINTENANCE"} else "ONLINE"

        cam_obj = SimpleNamespace(
            dept_id=None,
            department_name=cam_dept,
            camera_code=cam_code,
            make_model=cam.get("make_model") or f"Sentinel {codec} Camera",
            source_type="NETWORK_CCTV",
            ip_address=host_ip,
            rtsp_url=rtsp,
            hls_url=hls,
            http_stream_url="",
            whep_url=whep,
            credential_id=credential_id if username and password else None,
            codec=codec,
            latitude=lat,
            longitude=lon,
            camera_type=(cam.get("camera_type") or "PTZ").upper(),
            status=cam_status,
            ageing=0.5
        )

        try:
            existing_camera = memory_registry.get_camera_by_id(cam_code)
            if existing_camera:
                memory_registry.upsert_camera(cam_obj)
            else:
                memory_registry.add_camera(cam_obj)

            if db is not None:
                department_id = await db.fetchval(
                    """
                    INSERT INTO departments (dept_name, zone_code)
                    VALUES ($1, $2)
                    ON CONFLICT (dept_name) DO UPDATE SET zone_code = EXCLUDED.zone_code
                    RETURNING id
                    """,
                    cam_dept,
                    f"SENTINEL-{hashlib.sha256(cam_dept.lower().encode()).hexdigest()[:12].upper()}",
                )
                await db.execute(
                    """
                    INSERT INTO cameras (
                        dept_id, camera_code, make_model, source_type, ip_address,
                        rtsp_url, location, camera_type, status, ageing
                    )
                    VALUES (
                        $1, $2, $3, 'NETWORK_CCTV', $4, $5,
                        ST_SetSRID(ST_MakePoint($6, $7), 4326),
                        $8, $9, $10
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
                    cam_code,
                    cam_obj.make_model,
                    host_ip,
                    rtsp,
                    lon,
                    lat,
                    cam_obj.camera_type,
                    cam_status,
                    cam_obj.ageing,
                )
            synced_cameras.append(cam_code)
        except Exception as exc:
            logger.exception("Failed to synchronize judge camera %s", cam_code)
            skipped_cameras.append(f"{cam_code}: registry synchronization failed ({type(exc).__name__}).")

    return {
        "success": True,
        "message": f"Successfully synchronized {len(synced_cameras)} cameras from Sentinel Catalogue.",
        "catalogue_endpoint": catalogue_urls[0],
        "source": fetch_source,
        "synced_count": len(synced_cameras),
        "skipped": skipped_cameras,
        "catalogue_warnings": catalogue_errors,
        "codecs_summary": {
            "H264": h264_count,
            "H265": h265_count
        },
        "synced_codes": synced_cameras
    }