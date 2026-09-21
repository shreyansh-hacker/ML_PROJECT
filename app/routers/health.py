from fastapi import APIRouter, Depends, HTTPException
from uuid import UUID
from app.db import get_pool
from app.schemas.cameras import HealthPing
import asyncpg

router = APIRouter(prefix="/api/cameras", tags=["3. Health & Maintenance"])

@router.get("/stats")
async def get_camera_stats(db: asyncpg.Pool = Depends(get_pool)):
    """Summary of camera counts broken down by status and department"""
    query = """
        SELECT 
            d.dept_name,
            COUNT(c.id) AS total_cameras,
            COUNT(c.id) FILTER (WHERE c.status = 'ONLINE') AS online_count,
            COUNT(c.id) FILTER (WHERE c.status = 'OFFLINE') AS offline_count,
            COUNT(c.id) FILTER (WHERE c.status = 'MAINTENANCE') AS maintenance_count
        FROM departments d
        LEFT JOIN cameras c ON d.id = c.dept_id
        GROUP BY d.dept_name;
    """
    rows = await db.fetch(query)
    return [dict(row) for row in rows]

@router.post("/{camera_id}/ping")
async def record_health_ping(
    camera_id: UUID,
    ping: HealthPing,
    db: asyncpg.Pool = Depends(get_pool)
):
    """Record health check pings and keep camera status up-to-date"""
    async with db.acquire() as conn:
        async with conn.transaction():
            # Update camera status
            await conn.execute(
                "UPDATE cameras SET status = $1, last_ping_at = NOW() WHERE id = $2",
                ping.status, camera_id
            )
            # Log health audit
            await conn.execute(
                "INSERT INTO camera_health_logs (camera_id, status, response_time_ms) VALUES ($1, $2, $3)",
                camera_id, ping.status, ping.response_time_ms
            )
    return {"status": "success", "camera_id": str(camera_id), "current_status": ping.status}