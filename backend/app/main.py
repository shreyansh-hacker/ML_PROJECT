import os
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from app.config import settings
from app.db import init_db, close_db
from app.security import SecurityMiddleware, router as auth_router, validate_security_configuration
from app.routers import departments, onboarding, map, health, reports, metadata, validation, stream, anpr, onvif

@asynccontextmanager
async def lifespan(app: FastAPI):
    validate_security_configuration()
    # Startup: Connect to PostGIS DB Pool
    await init_db()
    yield
    # Shutdown: Close Pool
    await close_db()

app = FastAPI(
    title="Camera Surveillance & GIS Management API",
    description="Statewide CCTV registry and GIS Foundation for Gujarat Departments",
    version="1.0.0",
    lifespan=lifespan
)

# Enable CORS for React GIS Map Frontend & Cloud Deployment
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type"],
)

app.add_middleware(SecurityMiddleware)

# Attach Routers
app.include_router(auth_router)
app.include_router(departments.router)
app.include_router(onboarding.router)
app.include_router(map.router)
app.include_router(health.router)
app.include_router(reports.router)
app.include_router(metadata.router)
app.include_router(validation.router)
app.include_router(stream.router)
app.include_router(anpr.router)
app.include_router(onvif.router)

@app.get("/")
async def root():
    return {
        "system": "Gujarat Sentinel - Camera Surveillance & GIS Management API",
        "status": "online",
        "docs": "/docs"
    }

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "sentinel-api",
        "version": "1.0.0"
    }

if __name__ == "__main__":
    port = int(os.environ.get("PORT", settings.port))
    host = os.environ.get("HOST", settings.host)
    uvicorn.run("app.main:app", host=host, port=port, reload=False)