from fastapi import APIRouter, HTTPException, UploadFile, File, Depends
import csv
import io
from uuid import UUID
from app.db import get_pool
from app.schemas.cameras import CameraCreate
import asyncpg

router = APIRouter(prefix="/api/cameras", tags=["1. Camera Onboarding"])

@router.post("/manual", status_code=21)
async def create_camera_manual(camera: CameraCreate, db: asyncpg.Pool = Depends(get_pool)):
    """Manual Entry & Programmatic API Onboarding"""
    query = """
        INSERT INTO cameras (dept_id, camera_code, make_model, ip_address, rtsp_url, location, camera_type, status, ageing)
        VALUES ($1, $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($6, $7), 4326), $8, $9, $10)
        RETURNING id, camera_code;
    """
    try:
        row = await db.fetchrow(
            query, camera.dept_id, camera.camera_code, camera.make_model,
            camera.ip_address, camera.rtsp_url, camera.longitude, camera.latitude,
            camera.camera_type, camera.status, camera.ageing
        )
        return {"message": "Camera created successfully", "id": str(row["id"]), "camera_code": row["camera_code"]}
    except asyncpg.UniqueViolationError:
        raise HTTPException(status_code=400, detail="Camera code or IP address already exists.")

@router.post("/bulk-import")
async def bulk_import_csv(file: UploadFile = File(...), db: asyncpg.Pool = Depends(get_pool)):
    """Bulk Import Cameras via CSV Upload"""
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are allowed.")
    
    content = await file.read()
    reader = csv.DictReader(io.StringIO(content.decode("utf-8")))
    
    records = []
    for row in reader:
        records.append((
            UUID(row["dept_id"]),
            row["camera_code"],
            row.get("make_model"),
            row["ip_address"],
            row["rtsp_url"],
            float(row["longitude"]),
            float(row["latitude"]),
            row["camera_type"],
            row.get("status", "OFFLINE"),
            float(row.get("ageing", 0.0))
        ))

    query = """
        INSERT INTO cameras (dept_id, camera_code, make_model, ip_address, rtsp_url, location, camera_type, status, ageing)
        VALUES ($1, $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($6, $7), 4326), $8, $9, $10)
        ON CONFLICT (camera_code) DO NOTHING;
    """
    async with db.acquire() as conn:
        await conn.executemany(query, records)

    return {"message": f"Processed {len(records)} cameras successfully."}