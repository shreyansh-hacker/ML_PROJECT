-- Enable PostGIS & UUID extensions
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Clean up existing tables (for fresh setup)
DROP TABLE IF EXISTS camera_health_logs CASCADE;
DROP TABLE IF EXISTS cameras CASCADE;
DROP TABLE IF EXISTS departments CASCADE;

-- 1. Departments Table
CREATE TABLE departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dept_name VARCHAR(100) NOT NULL UNIQUE,
    zone_code VARCHAR(50) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Cameras Table (Core Metadata + GIS Coordinates + Flexible Source Types)
CREATE TABLE cameras (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dept_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    camera_code VARCHAR(100) NOT NULL UNIQUE,
    make_model VARCHAR(100),
    source_type VARCHAR(20) DEFAULT 'NETWORK_CCTV' CHECK (source_type IN ('NETWORK_CCTV', 'LOCAL_WEBCAM')),
    ip_address VARCHAR(45),               -- Optional for local webcams
    rtsp_url TEXT,                        -- Optional for local webcams
    location GEOMETRY(Point, 4326),        -- Optional (Longitude, Latitude)
    camera_type VARCHAR(50),              -- Removed strict constraint to support flexible webcam types
    status VARCHAR(20) DEFAULT 'OFFLINE' CHECK (status IN ('ONLINE', 'OFFLINE', 'MAINTENANCE')),
    ageing NUMERIC(4, 1),                -- Camera age in years
    last_ping_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Camera Health Logs (Historical audit trail for uptime reports)
CREATE TABLE camera_health_logs (
    id BIGSERIAL PRIMARY KEY,
    camera_id UUID NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL,
    response_time_ms INT,
    checked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_cameras_location ON cameras USING GIST (location);
CREATE INDEX idx_cameras_dept_id ON cameras(dept_id);
CREATE INDEX idx_cameras_status ON cameras(status);
CREATE INDEX idx_health_logs_camera_id_time ON camera_health_logs(camera_id, checked_at DESC);

-- Seed Departments
INSERT INTO departments (dept_name, zone_code, created_at)
VALUES
('Gujarat Police', 'POL-GJ', '2026-01-05 09:15:00'),
('Ahmedabad Municipal Corporation', 'AMC-AHD', '2026-01-08 10:20:00'),
('Surat Municipal Corporation', 'SMC-SRT', '2026-01-10 11:30:00'),
('Vadodara Municipal Corporation', 'VMC-VAD', '2026-01-12 09:45:00'),
('Rajkot Municipal Corporation', 'RMC-RJK', '2026-01-15 14:10:00'),
('Gujarat State Road Transport', 'GSRTC-GJ', '2026-01-18 12:00:00'),
('Gujarat Traffic Police', 'TRAF-GJ', '2026-01-20 10:35:00'),
('Gujarat Metro Rail', 'METRO-GJ', '2026-01-22 15:20:00'),
('Gandhinagar Municipal Corporation', 'GMC-GND', '2026-01-25 09:30:00'),
('Surat Traffic Police', 'TRAF-SRT', '2026-01-28 13:45:00');

-- Cameras are added through the registry after their stream endpoints are verified.