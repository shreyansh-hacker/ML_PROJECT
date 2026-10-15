from typing import Any, Dict, List, Optional

import asyncpg

from app.store import memory_registry


async def list_database_cameras(db: asyncpg.Pool) -> List[asyncpg.Record]:
    return await db.fetch(
        """
        SELECT
            c.id::text AS id,
            c.camera_code,
            c.make_model,
            c.source_type,
            c.status,
            c.rtsp_url,
            d.dept_name,
            ST_Y(c.location::geometry) AS latitude,
            ST_X(c.location::geometry) AS longitude
        FROM cameras c
        JOIN departments d ON d.id = c.dept_id
        ORDER BY c.camera_code
        """
    )


async def get_registered_camera(
    camera_id: str,
    db: Optional[asyncpg.Pool] = None,
) -> Optional[Dict[str, Any]]:
    identifier = str(camera_id).strip().lower()
    for stored_camera in memory_registry.get_all_cameras():
        if (
            str(stored_camera.get("id", "")).lower() == identifier
            or str(stored_camera.get("camera_code", "")).lower() == identifier
        ):
            return dict(stored_camera)

    if db is None:
        return None

    row = await db.fetchrow(
        """
        SELECT
            c.id::text AS id,
            c.camera_code,
            c.make_model,
            c.source_type,
            c.status,
            c.rtsp_url,
            d.dept_name,
            ST_Y(c.location::geometry) AS latitude,
            ST_X(c.location::geometry) AS longitude
        FROM cameras c
        JOIN departments d ON d.id = c.dept_id
        WHERE c.id::text = $1 OR LOWER(c.camera_code) = $2
        """,
        str(camera_id),
        identifier,
    )
    if row is None:
        return None

    camera = dict(row)
    camera_code = str(camera.get("camera_code", "")).lower()
    for stored_camera in memory_registry.get_all_cameras():
        if str(stored_camera.get("camera_code", "")).lower() == camera_code:
            for key in (
                "credential_id",
                "onvif_device_id",
                "http_stream_url",
            ):
                if stored_camera.get(key):
                    camera[key] = stored_camera[key]
            if stored_camera.get("rtsp_url"):
                camera["rtsp_url"] = stored_camera["rtsp_url"]
            break
    return camera
