from fastapi import APIRouter, Depends, Query, Response
from typing import Optional
from app.db import get_pool
import asyncpg
import csv
import io

router = APIRouter(prefix="/api/cameras", tags=["5. Search, Audit & Export"])

@router.get("/export/csv")
async def export_cameras_csv(
    status: Optional[str] = None,
    db: asyncpg.Pool = Depends(get_pool)
):
    """Export camera records as a downloadable CSV file"""
    query = """
        SELECT c.camera_code, d.dept_name, c.make_model, c.ip_address, 
               c.camera_type, c.status, c.ageing,
               ST_Y(c.location::geometry) as latitude,
               ST_X(c.location::geometry) as longitude
        FROM cameras c
        JOIN departments d ON c.dept_id = d.id
        WHERE ($1::text IS NULL OR c.status = $1);
    """
    rows = await db.fetch(query, status)
    
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Camera Code", "Department", "Make Model", "IP Address", "Type", "Status", "Ageing (Yrs)", "Latitude", "Longitude"])
    
    for row in rows:
        writer.writerow(list(row.values()))

    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=cameras_export.csv"}
    )