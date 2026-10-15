import os
import re
import cv2
import json
import time
import base64
import logging
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any

import io
import csv
import math
import numpy as np
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Body, status
from fastapi.responses import StreamingResponse, FileResponse, Response
from pydantic import BaseModel, Field

import asyncpg
from app.db import get_optional_pool
from app.services.anpr_engine import (
    anpr_engine,
    CROPS_DIR,
    format_plate_text,
    get_demo_video_source,
)
from app.services.camera_sources import get_registered_camera, list_database_cameras

router = APIRouter(prefix="/api/anpr", tags=["ANPR Intelligence & Surveillance"])
logger = logging.getLogger("uvicorn.error")


class StartEngineRequest(BaseModel):
    source_type: str = Field("DEMO_VIDEO", description="DEMO_VIDEO | LOCAL_WEBCAM | CAMERA")
    source_id: Optional[str] = "demo_video"
    source_name: Optional[str] = "Demo Highway Traffic"


class SearchPlateRequest(BaseModel):
    plate_number: str


class WatchlistEntryRequest(BaseModel):
    plate_number: str
    reason: str = Field("Suspect", description="Stolen | Wanted | Suspect | Other")
    notes: Optional[str] = ""


class FrameDetectionRequest(BaseModel):
    image_base64: str
    camera_id: Optional[str] = "CAM-LOCAL-WEBCAM"
    camera_code: Optional[str] = "003"
    dept_name: Optional[str] = "Surat Traffic Police - Laptop Webcam"
    target_plate: Optional[str] = None


@router.get("/sources")
async def get_sources(db: Optional[asyncpg.Pool] = Depends(get_optional_pool)):
    """List all available sources: Demo Video, Laptop Webcam, and Registered CCTV Cameras."""
    sources = anpr_engine.get_sources()
    if db is None:
        return sources

    sources_by_code = {
        str(source.get("camera_code", "")).lower(): source
        for source in sources
        if source.get("camera_code")
    }
    for camera in await list_database_cameras(db):
        camera_code = str(camera["camera_code"])
        source_type = (
            "LOCAL_WEBCAM"
            if str(camera["source_type"]).upper() == "LOCAL_WEBCAM"
            else "CAMERA"
        )
        source = sources_by_code.get(camera_code.lower())
        if source:
            source.update(
                {
                    "id": camera["id"],
                    "source_type": source_type,
                    "location": camera["dept_name"],
                    "status": camera["status"],
                }
            )
            continue

        source = {
            "id": camera["id"],
            "name": f"{camera_code} - {camera['dept_name']}",
            "source_type": source_type,
            "location": camera["dept_name"],
            "camera_code": camera_code,
            "rtsp_url": "",
            "stream_auth_managed": "@" in str(camera["rtsp_url"] or "").partition("://")[2],
            "status": camera["status"],
        }
        sources.append(source)
        sources_by_code[camera_code.lower()] = source
    return sources


@router.post("/start")
async def start_stream(
    req: StartEngineRequest,
    db: Optional[asyncpg.Pool] = Depends(get_optional_pool),
):
    """Start ANPR processing on the selected camera/video source."""
    if req.source_type == "DEMO_VIDEO" and get_demo_video_source(req.source_id or "demo_video") is None:
        raise HTTPException(status_code=400, detail="Unknown demo video source.")
    camera_metadata = None
    rtsp_url = ""
    if req.source_type == "CAMERA":
        camera_metadata = await get_registered_camera(req.source_id or "", db)
        if camera_metadata is None:
            raise HTTPException(status_code=404, detail="Registered camera not found.")
        from app.routers.stream import _camera_stream_input

        rtsp_url = _camera_stream_input(camera_metadata)
        if not rtsp_url:
            raise HTTPException(
                status_code=400,
                detail="This camera does not have an active RTSP or HTTP stream URL.",
            )
    status_info = anpr_engine.start(
        source_type=req.source_type,
        source_id=req.source_id or "source",
        source_name=req.source_name or "Active Source",
        rtsp_url=rtsp_url,
        camera_metadata=camera_metadata,
    )
    return status_info


@router.post("/stop")
async def stop_stream():
    """Stop active ANPR processing."""
    return anpr_engine.stop()


@router.get("/status")
async def get_engine_status():
    """Get active engine telemetry (FPS, running state, active target, detections)."""
    return anpr_engine.get_status()


@router.get("/stream")
async def get_stream():
    """Live MJPEG stream of annotated AI video with bounding boxes and HUD overlays."""
    if not anpr_engine.is_running:
        # If user has already chosen a camera or webcam, resume that source
        if anpr_engine.source_id and anpr_engine.source_type and anpr_engine.source_id != "demo_video":
            anpr_engine.start(
                anpr_engine.source_type,
                anpr_engine.source_id,
                anpr_engine.source_name,
                anpr_engine.rtsp_url,
                camera_metadata=anpr_engine.camera_metadata,
            )
        else:
            anpr_engine.start("DEMO_VIDEO", "demo_video", "Demo Highway Video (test_video.mp4)")

    return StreamingResponse(
        anpr_engine.generate_mjpeg_stream(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
            "Connection": "keep-alive"
        }
    )


@router.get("/events")
async def get_events(camera_id: Optional[str] = None, camera_code: Optional[str] = None, limit: int = 100):
    """
    Returns real vehicle passing logs.
    If camera_id or camera_code is provided, strictly filters detections for that camera.
    """
    events = anpr_engine.load_events()
    target_id = camera_id or camera_code
    if target_id:
        target_str = str(target_id).strip().lower()
        target_identifiers = {target_str}

        if target_str in ["demo_video", "demo_highway", "demo-01"]:
            target_identifiers.update(["demo_video", "demo_highway", "demo-01"])
        elif target_str in ["local_webcam", "webcam", "webcam-01"]:
            target_identifiers.update(["local_webcam", "webcam", "webcam-01"])

        from app.services.anpr_engine import CAMERAS_FILE
        if CAMERAS_FILE.exists():
            try:
                with open(CAMERAS_FILE, "r", encoding="utf-8") as f:
                    cams = json.load(f)
                    for c in cams:
                        c_id = str(c.get("id", "")).strip().lower()
                        c_code = str(c.get("camera_code", "")).strip().lower()
                        if c_id in target_identifiers or c_code in target_identifiers:
                            if c_id:
                                target_identifiers.add(c_id)
                            if c_code:
                                target_identifiers.add(c_code)
            except Exception:
                pass

        def match_cam(e):
            e_cam = str(e.get("camera_id", "")).strip().lower()
            e_code = str(e.get("camera_code", "")).strip().lower()
            return e_cam in target_identifiers or e_code in target_identifiers

        events = [e for e in events if match_cam(e)]
    return events[:limit]


def _filter_investigation_events(
    events: List[Dict[str, Any]],
    plate: Optional[str] = None,
    camera_id: Optional[str] = None,
    camera_code: Optional[str] = None,
    vehicle_type: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    watchlist_status: Optional[str] = "all",
    location: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Helper to apply search and audit filters across detection records."""
    # 1. Parse Date Bounds
    from_dt = None
    if from_date:
        try:
            fd_clean = str(from_date).strip().replace("Z", "+00:00")
            if len(fd_clean) == 10:  # YYYY-MM-DD
                from_dt = datetime.fromisoformat(fd_clean).replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=timezone.utc)
            else:
                from_dt = datetime.fromisoformat(fd_clean)
                if from_dt.tzinfo is None:
                    from_dt = from_dt.replace(tzinfo=timezone.utc)
        except Exception:
            from_dt = None

    to_dt = None
    if to_date:
        try:
            td_clean = str(to_date).strip().replace("Z", "+00:00")
            if len(td_clean) == 10:  # YYYY-MM-DD
                to_dt = datetime.fromisoformat(td_clean).replace(hour=23, minute=59, second=59, microsecond=999999, tzinfo=timezone.utc)
            else:
                to_dt = datetime.fromisoformat(td_clean)
                if to_dt.tzinfo is None:
                    to_dt = to_dt.replace(tzinfo=timezone.utc)
        except Exception:
            to_dt = None

    # 2. Normalize Plate Query
    norm_query = re.sub(r"[^A-Z0-9]", "", str(plate).upper()) if plate else ""
    raw_query_lower = str(plate).strip().lower() if plate else ""

    # 3. Camera Identifier Matching & Aliases
    target_cam = str(camera_id or camera_code or "").strip().lower()
    cam_identifiers = set()
    if target_cam and target_cam != "all":
        cam_identifiers.add(target_cam)
        if target_cam in ["demo_video", "demo_highway", "demo-01"]:
            cam_identifiers.update(["demo_video", "demo_highway", "demo-01"])
        elif target_cam in ["local_webcam", "webcam", "webcam-01"]:
            cam_identifiers.update(["local_webcam", "webcam", "webcam-01"])

        from app.services.anpr_engine import CAMERAS_FILE
        if CAMERAS_FILE.exists():
            try:
                with open(CAMERAS_FILE, "r", encoding="utf-8") as f:
                    cams = json.load(f)
                    for c in cams:
                        c_id = str(c.get("id", "")).strip().lower()
                        c_code = str(c.get("camera_code", "")).strip().lower()
                        if c_id in cam_identifiers or c_code in cam_identifiers:
                            if c_id:
                                cam_identifiers.add(c_id)
                            if c_code:
                                cam_identifiers.add(c_code)
            except Exception:
                pass

    # 4. Vehicle Type Filter
    vt_filter = vehicle_type.strip().lower() if vehicle_type and vehicle_type.strip().lower() != "all" else None

    # 5. Location Search
    loc_filter = location.strip().lower() if location and location.strip() else None

    filtered = []
    for e in events:
        # Date filtering
        ts_str = str(e.get("timestamp") or "").strip()
        if (from_dt or to_dt) and ts_str:
            try:
                clean_ts = ts_str.replace("Z", "+00:00")
                e_dt = datetime.fromisoformat(clean_ts)
                if e_dt.tzinfo is None:
                    e_dt = e_dt.replace(tzinfo=timezone.utc)
                if from_dt and e_dt < from_dt:
                    continue
                if to_dt and e_dt > to_dt:
                    continue
            except Exception:
                pass

        # Camera filtering
        if cam_identifiers:
            e_cam = str(e.get("camera_id") or "").strip().lower()
            e_code = str(e.get("camera_code") or "").strip().lower()
            if e_cam not in cam_identifiers and e_code not in cam_identifiers:
                continue

        # Plate filtering
        if norm_query or raw_query_lower:
            p_val = str(e.get("plate", {}).get("number") or e.get("plate_number") or "").upper()
            raw_val = str(e.get("plate", {}).get("raw_number") or "").upper()
            clean_p = re.sub(r"[^A-Z0-9]", "", p_val)
            clean_raw = re.sub(r"[^A-Z0-9]", "", raw_val)

            match_found = False
            if norm_query and (norm_query in clean_p or norm_query in clean_raw):
                match_found = True
            elif raw_query_lower and (raw_query_lower in p_val.lower() or raw_query_lower in raw_val.lower()):
                match_found = True

            if not match_found:
                continue

        # Vehicle Type filtering
        if vt_filter:
            e_vt = str(e.get("vehicle", {}).get("type") or e.get("vehicle_type") or "").strip().lower()
            if vt_filter not in e_vt and e_vt not in vt_filter:
                continue

        # Watchlist filtering
        is_wl = bool(e.get("is_watchlist_alert") or str(e.get("status") or "").upper() == "WATCHLIST_ALERT")
        if watchlist_status == "watchlist_only" and not is_wl:
            continue
        if watchlist_status == "non_watchlist" and is_wl:
            continue

        # Location filtering
        if loc_filter:
            dept = str(e.get("dept_name") or "").lower()
            cam_name = str(e.get("camera_name") or "").lower()
            loc_data = e.get("location")
            loc_text = ""
            if isinstance(loc_data, dict):
                loc_text = str(loc_data.get("name") or "").lower()
            elif isinstance(loc_data, str):
                loc_text = loc_data.lower()

            if loc_filter not in dept and loc_filter not in cam_name and loc_filter not in loc_text:
                continue

        filtered.append(e)

    return filtered


@router.get("/investigation/search")
async def search_detection_metadata(
    plate: Optional[str] = None,
    camera_id: Optional[str] = None,
    camera_code: Optional[str] = None,
    vehicle_type: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    watchlist_status: Optional[str] = "all",
    location: Optional[str] = None,
    page: int = 1,
    page_size: int = 25,
    db: Optional[asyncpg.Pool] = Depends(get_optional_pool),
):
    """
    Search and filter ANPR detection metadata with server-side pagination.
    Performs fast in-memory indexing on stored detection events without expensive re-inference.
    """
    events = anpr_engine.load_events()
    filtered = _filter_investigation_events(
        events=events,
        plate=plate,
        camera_id=camera_id,
        camera_code=camera_code,
        vehicle_type=vehicle_type,
        from_date=from_date,
        to_date=to_date,
        watchlist_status=watchlist_status,
        location=location,
    )

    page = max(1, page)
    page_size = max(5, min(page_size, 100))
    total = len(filtered)
    total_pages = max(1, math.ceil(total / page_size))
    start = (page - 1) * page_size
    end = start + page_size
    sliced = filtered[start:end]

    # Format items for clean presentation
    items = []
    for e in sliced:
        loc_val = e.get("dept_name") or ""
        loc_obj = e.get("location")
        lat = e.get("latitude")
        lon = e.get("longitude")
        if isinstance(loc_obj, dict):
            loc_val = loc_obj.get("name") or loc_val
            lat = lat or loc_obj.get("latitude")
            lon = lon or loc_obj.get("longitude")
        elif isinstance(loc_obj, str) and loc_obj:
            loc_val = loc_obj

        p_num = e.get("plate", {}).get("number") or e.get("plate_number") or ""
        raw_num = e.get("plate", {}).get("raw_number") or ""
        v_type = e.get("vehicle", {}).get("type") or e.get("vehicle_type") or "Car"
        conf = float(e.get("plate", {}).get("confidence") or 0.0)
        is_wl = bool(e.get("is_watchlist_alert") or str(e.get("status") or "").upper() == "WATCHLIST_ALERT")
        wl_reason = e.get("watchlist_reason") or ("SUSPECT VEHICLE" if is_wl else None)

        items.append({
            "event_id": e.get("event_id"),
            "timestamp": e.get("timestamp"),
            "camera_id": e.get("camera_id"),
            "camera_code": e.get("camera_code"),
            "camera_name": e.get("camera_name"),
            "dept_name": e.get("dept_name"),
            "location": loc_val,
            "latitude": lat,
            "longitude": lon,
            "plate_number": p_num,
            "raw_plate": raw_num,
            "vehicle_type": v_type,
            "ocr_confidence": round(conf, 2),
            "is_watchlist_alert": is_wl,
            "watchlist_reason": wl_reason,
            "status": e.get("status", "NORMAL"),
            "crop_url": e.get("crop_url"),
            "speed": e.get("speed", 0),
        })

    # Available cameras summary for filter dropdown
    available_cams = []
    sources = await get_sources(db)
    for s in sources:
        available_cams.append({
            "id": s.get("id"),
            "code": s.get("camera_code"),
            "name": s.get("name"),
            "location": s.get("location"),
        })

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
        "available_cameras": available_cams,
        "available_vehicle_types": [
            "Car",
            "SUV / Van",
            "Motorcycle / Scooter",
            "Auto-rickshaw / 3-wheeler",
            "Bus",
            "Truck",
            "Other"
        ]
    }


@router.get("/investigation/export-csv")
async def export_investigation_csv(
    plate: Optional[str] = None,
    camera_id: Optional[str] = None,
    camera_code: Optional[str] = None,
    vehicle_type: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    watchlist_status: Optional[str] = "all",
    location: Optional[str] = None,
):
    """
    Exports ONLY the currently filtered detection records to a standard CSV file.
    Columns: Timestamp, Camera ID, Camera Code, Location, Number Plate, Vehicle Type, OCR Confidence, Watchlist Status
    """
    events = anpr_engine.load_events()
    filtered = _filter_investigation_events(
        events=events,
        plate=plate,
        camera_id=camera_id,
        camera_code=camera_code,
        vehicle_type=vehicle_type,
        from_date=from_date,
        to_date=to_date,
        watchlist_status=watchlist_status,
        location=location,
    )

    output = io.StringIO()
    writer = csv.writer(output, quoting=csv.QUOTE_MINIMAL)
    writer.writerow([
        "Timestamp",
        "Camera ID",
        "Camera Code",
        "Location",
        "Number Plate",
        "Vehicle Type",
        "OCR Confidence",
        "Watchlist Status"
    ])

    for e in filtered:
        ts = str(e.get("timestamp") or "")
        cam_id = str(e.get("camera_id") or "")
        cam_code = str(e.get("camera_code") or "")

        loc_val = e.get("dept_name") or ""
        loc_obj = e.get("location")
        if isinstance(loc_obj, dict):
            loc_val = loc_obj.get("name") or loc_val
        elif isinstance(loc_obj, str) and loc_obj:
            loc_val = loc_obj

        p_num = str(e.get("plate", {}).get("number") or e.get("plate_number") or "")
        v_type = str(e.get("vehicle", {}).get("type") or e.get("vehicle_type") or "Car")
        conf = float(e.get("plate", {}).get("confidence") or 0.0)

        is_wl = bool(e.get("is_watchlist_alert") or str(e.get("status") or "").upper() == "WATCHLIST_ALERT")
        wl_str = f"ALERT ({e.get('watchlist_reason', 'Suspect')})" if is_wl else "NORMAL"

        writer.writerow([
            ts,
            cam_id,
            cam_code,
            loc_val,
            p_num,
            v_type,
            f"{conf:.2f}",
            wl_str
        ])

    csv_data = output.getvalue()
    timestamp_tag = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"sentinel_investigation_export_{timestamp_tag}.csv"

    return Response(
        content=csv_data,
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-cache",
        }
    )


@router.delete("/events")
async def clear_events(camera_id: Optional[str] = None):
    """Clears all stored events or only those for the specified camera."""
    try:
        from app.services.anpr_engine import EVENTS_FILE
        if not camera_id:
            with open(EVENTS_FILE, "w", encoding="utf-8") as f:
                json.dump([], f)
        else:
            all_events = anpr_engine.load_events()
            remaining = [
                e for e in all_events
                if str(e.get("camera_id")) != str(camera_id)
                and not (camera_id in ["demo_video", "demo_highway"] and str(e.get("camera_id")) in ["demo_video", "demo_highway"])
            ]
            with open(EVENTS_FILE, "w", encoding="utf-8") as f:
                json.dump(remaining, f, indent=2)
        return {"status": "cleared", "message": "ANPR detection logs cleared."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/search")
async def search_plate(req: SearchPlateRequest):
    """
    Search for a number plate by text.
    If matching vehicle is found in detection records, returns 'CATCHED'.
    Otherwise locks target plate and returns 'NOT_SEEN_YET'.
    """
    res = anpr_engine.set_target_plate(req.plate_number)
    return res


@router.post("/search-image")
async def search_by_image(file: UploadFile = File(...)):
    """
    Upload vehicle or license plate photo.
    AI extracts the number plate automatically, locks it as target,
    and returns 'CATCHED' or 'NOT_SEEN_YET'.
    """
    try:
        contents = await file.read()
        res = anpr_engine.search_by_image(contents)
        return res
    except Exception as e:
        logger.error(f"Error in search-image: {e}")
        raise HTTPException(status_code=500, detail=f"Image processing error: {str(e)}")


@router.post("/clear-target")
async def clear_target():
    """Reset the current target search."""
    return anpr_engine.clear_target()


@router.get("/crops/{filename}")
async def get_plate_crop(filename: str):
    """Serves the actual cropped plate snapshot image."""
    crop_path = CROPS_DIR / filename
    if crop_path.exists():
        return FileResponse(str(crop_path), media_type="image/jpeg")
    raise HTTPException(status_code=404, detail="Crop image not found")


@router.get("/watchlist")
async def get_watchlist():
    """Returns registered hotlist/suspect vehicles watchlist."""
    return anpr_engine.load_watchlist()


@router.post("/watchlist")
async def add_watchlist_entry(req: WatchlistEntryRequest):
    """Add a suspect vehicle plate to the watchlist."""
    try:
        entry = anpr_engine.add_watchlist_entry(req.plate_number, req.reason, req.notes or "")
        return {"status": "SUCCESS", "entry": entry, "message": f"Plate {entry['formatted_plate']} added to watchlist."}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/watchlist/{entry_id}")
async def delete_watchlist_entry(entry_id: str):
    """Remove a vehicle plate from the watchlist."""
    success = anpr_engine.delete_watchlist_entry(entry_id)
    if success:
        return {"status": "SUCCESS", "message": "Vehicle removed from suspect watchlist."}
    raise HTTPException(status_code=404, detail="Vehicle entry not found in watchlist.")


@router.post("/alert/acknowledge")
async def acknowledge_alert():
    """Acknowledge / dismiss active suspect vehicle alert."""
    return anpr_engine.acknowledge_alert()


@router.get("/routes")
async def get_vehicle_routes(plate: Optional[str] = None):
    """
    Returns GIS vehicle route tracking and breadcrumb trail.
    Groups detections by normalized plate, connects camera locations chronologically,
    and returns travel checkpoints.
    """
    return anpr_engine.get_vehicle_routes(plate)


@router.post("/detect-frame")
async def detect_frame(req: FrameDetectionRequest):
    """Auxiliary frame detector for browser webcam frames."""
    raw_b64 = req.image_base64
    if "," in raw_b64:
        raw_b64 = raw_b64.split(",", 1)[1]

    try:
        img_bytes = base64.b64decode(raw_b64)
        nparr = np.frombuffer(img_bytes, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if frame is None:
            raise ValueError("Could not decode image frame.")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image data: {str(e)}")

    h, w = frame.shape[:2]
    anpr_engine._load_models()

    best_plate_str = ""
    best_conf = 0.0
    plate_bbox = [0, 0, 0, 0]

    if anpr_engine.plate_model:
        results = anpr_engine.plate_model(frame, verbose=False, conf=0.25)[0]
        if results.boxes is not None and len(results.boxes) > 0:
            for box in results.boxes:
                px1, py1, px2, py2 = map(int, box.xyxy[0].tolist())
                px1 = max(0, min(px1, w))
                px2 = max(0, min(px2, w))
                py1 = max(0, min(py1, h))
                py2 = max(0, min(py2, h))

                if px2 <= px1 or py2 <= py1:
                    continue

                crop = frame[py1:py2, px1:px2]
                text, conf = anpr_engine._run_crop_ocr(crop)
                if conf > best_conf and len(text) >= 3:
                    best_conf = conf
                    best_plate_str = text
                    plate_bbox = [px1, py1, px2 - px1, py2 - py1]

    if not best_plate_str:
        return {
            "detected": False,
            "message": "No license plate recognized in this frame.",
            "frame_dimensions": [w, h]
        }

    formatted_plate = format_plate_text(best_plate_str)
    from app.services.anpr_engine import are_plates_similar
    target_match = False
    if req.target_plate:
        target_match = are_plates_similar(best_plate_str, req.target_plate)

    event = {
        "event_id": f"EVT_{int(time.time() * 1000)}",
        "camera_id": req.camera_id,
        "camera_code": req.camera_code,
        "dept_name": req.dept_name,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "vehicle": {"type": "Car", "confidence": 0.95},
        "plate": {
            "number": formatted_plate,
            "raw_number": best_plate_str,
            "confidence": round(best_conf, 2),
            "bounding_box": plate_bbox
        },
        "is_target_catched": bool(target_match),
        "status": "TARGET_CATCHED" if target_match else "NORMAL",
        "speed": 50
    }

    anpr_engine.save_event(event)

    return {
        "detected": True,
        "plate": formatted_plate,
        "raw_plate": best_plate_str,
        "confidence": round(best_conf * 100, 1),
        "bounding_box": plate_bbox,
        "frame_dimensions": [w, h],
        "is_target_catched": bool(target_match),
        "event": event
    }
