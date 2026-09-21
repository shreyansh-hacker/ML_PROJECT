from fastapi import APIRouter, Query, Depends, HTTPException
from typing import Optional
from uuid import UUID
import json
from app.db import get_pool
import asyncpg

router = APIRouter(prefix="/api/cameras", tags=["2. GIS Map & Spatial Layers"])

@router.get("")
async def get_cameras_geojson(
    dept_id: Optional[UUID] = None,
    camera_type: Optional[str] = None,
    status: Optional[str] = None,
    db: asyncpg.Pool = Depends(get_pool)
):
    """Returns camera list as a GeoJSON FeatureCollection for Map rendering"""
    query = """
        SELECT json_build_object(
            'type', 'FeatureCollection',
            'features', COALESCE(json_agg(
                json_build_object(
                    'type', 'Feature',
                    'geometry', ST_AsGeoJSON(c.location)::json,
                    'properties', json_build_object(
                        'id', c.id,
                        'camera_code', c.camera_code,
                        'make_model', c.make_model,
                        'ip_address', c.ip_address,
                        'camera_type', c.camera_type,
                        'status', c.status,
                        'ageing', c.ageing,
                        'dept_name', d.dept_name,
                        'last_ping_at', c.last_ping_at
                    )
                )
            ), '[]'::json)
        ) AS geojson
        FROM cameras c
        JOIN departments d ON c.dept_id = d.id
        WHERE ($1::uuid IS NULL OR c.dept_id = $1)
          AND ($2::text IS NULL OR c.camera_type = $2)
          AND ($3::text IS NULL OR c.status = $3);
    """
    row = await db.fetchrow(query, dept_id, camera_type, status)
    return json.loads(row["geojson"])

@router.get("/nearby")
async def get_nearby_cameras(
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
    radius: float = Query(5000.0, description="Radius in meters"),
    db: asyncpg.Pool = Depends(get_pool)
):
    """Spatial Proximity Search using PostGIS ST_DWithin"""
    query = """
        SELECT 
            c.id, c.camera_code, c.camera_type, c.status, d.dept_name,
            ST_Y(c.location::geometry) as latitude,
            ST_X(c.location::geometry) as longitude,
            ST_Distance(c.location::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) as distance_meters
        FROM cameras c
        JOIN departments d ON c.dept_id = d.id
        WHERE ST_DWithin(
            c.location::geography,
            ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
            $3
        )
        ORDER BY distance_meters ASC;
    """
    rows = await db.fetch(query, lng, lat, radius)
    return [dict(row) for row in rows]