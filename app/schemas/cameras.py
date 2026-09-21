from pydantic import BaseModel, Field
from typing import Optional
from uuid import UUID
from datetime import datetime

class CameraBase(BaseModel):
    dept_id: UUID
    camera_code: str
    make_model: Optional[str] = None
    ip_address: str
    rtsp_url: str
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    camera_type: str = Field(..., pattern="^(PTZ|BULLET|DOME|THERMAL|FIXED)$")
    status: Optional[str] = "OFFLINE"
    ageing: Optional[float] = 0.0

class CameraCreate(CameraBase):
    pass

class CameraResponse(CameraBase):
    id: UUID
    last_ping_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True

class HealthPing(BaseModel):
    status: str = Field(..., pattern="^(ONLINE|OFFLINE|MAINTENANCE)$")
    response_time_ms: Optional[int] = None