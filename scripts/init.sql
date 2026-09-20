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

-- 2. Cameras Table (Core Metadata + GIS Coordinates)
CREATE TABLE cameras (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dept_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    camera_code VARCHAR(100) NOT NULL UNIQUE,
    make_model VARCHAR(100),
    ip_address VARCHAR(45) NOT NULL,
    rtsp_url TEXT NOT NULL,
    location GEOMETRY(Point, 4326) NOT NULL, -- WGS 84 (Longitude, Latitude)
    camera_type VARCHAR(20) CHECK (camera_type IN ('PTZ', 'BULLET', 'DOME', 'THERMAL', 'FIXED')),
    status VARCHAR(20) DEFAULT 'OFFLINE' CHECK (status IN ('ONLINE', 'OFFLINE', 'MAINTENANCE')),
    ageing NUMERIC(4, 1), -- Camera age in years
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

-- Optimized Seed Cameras using CTE mapping
WITH dept_map AS (
    SELECT id, dept_name FROM departments
)
INSERT INTO cameras (
    dept_id,
    camera_code,
    make_model,
    ip_address,
    rtsp_url,
    location,
    camera_type,
    status,
    ageing,
    last_ping_at,
    created_at
)
VALUES
( (SELECT id FROM dept_map WHERE dept_name = 'Gujarat Police'), 'CAM-GJ-0001', 'Hikvision DS-2CD2143', '10.10.1.11', 'rtsp://10.10.1.11:554/stream1', ST_SetSRID(ST_MakePoint(72.5714, 23.0225), 4326), 'BULLET', 'ONLINE', 1.2, '2026-09-20 22:55:10', '2026-02-10 10:20:00' ),
( (SELECT id FROM dept_map WHERE dept_name = 'Gujarat Police'), 'CAM-GJ-0002', 'Dahua IPC-HDW2431', '10.10.1.12', 'rtsp://10.10.1.12:554/stream1', ST_SetSRID(ST_MakePoint(72.5748, 23.0241), 4326), 'PTZ', 'ONLINE', 1.1, '2026-09-20 22:55:05', '2026-02-11 11:10:00' ),
( (SELECT id FROM dept_map WHERE dept_name = 'Gujarat Police'), 'CAM-GJ-0003', 'Axis M2026-LE', '10.10.1.13', 'rtsp://10.10.1.13:554/stream1', ST_SetSRID(ST_MakePoint(72.5682, 23.0198), 4326), 'BULLET', 'OFFLINE', 1.1, '2026-09-20 21:30:00', '2026-02-12 09:45:00' ),
( (SELECT id FROM dept_map WHERE dept_name = 'Gujarat Police'), 'CAM-GJ-0004', 'Bosch FLEXIDOME', '10.10.1.14', 'rtsp://10.10.1.14:554/stream1', ST_SetSRID(ST_MakePoint(72.5801, 23.0282), 4326), 'DOME', 'ONLINE', 0.9, '2026-09-20 22:54:55', '2026-02-13 12:30:00' ),
( (SELECT id FROM dept_map WHERE dept_name = 'Gujarat Police'), 'CAM-GJ-0005', 'CP Plus CP-UNC', '10.10.1.15', 'rtsp://10.10.1.15:554/stream1', ST_SetSRID(ST_MakePoint(72.5624, 23.0175), 4326), 'BULLET', 'MAINTENANCE', 1.5, '2026-09-20 18:20:00', '2026-02-14 14:15:00' ),
( (SELECT id FROM dept_map WHERE dept_name = 'Ahmedabad Municipal Corporation'), 'CAM-AMC-0001', 'Hikvision DS-2CD2043', '10.20.1.11', 'rtsp://10.20.1.11:554/stream1', ST_SetSRID(ST_MakePoint(72.5710, 23.0330), 4326), 'BULLET', 'ONLINE', 0.8, '2026-09-20 22:54:40', '2026-02-15 10:00:00' ),
( (SELECT id FROM dept_map WHERE dept_name = 'Ahmedabad Municipal Corporation'), 'CAM-AMC-0002', 'Dahua IPC-HFW', '10.20.1.12', 'rtsp://10.20.1.12:554/stream1', ST_SetSRID(ST_MakePoint(72.5665, 23.0362), 4326), 'PTZ', 'ONLINE', 0.7, '2026-09-20 22:54:20', '2026-02-16 11:30:00' ),
( (SELECT id FROM dept_map WHERE dept_name = 'Ahmedabad Municipal Corporation'), 'CAM-AMC-0003', 'Axis P1448-LE', '10.20.1.13', 'rtsp://10.20.1.13:554/stream1', ST_SetSRID(ST_MakePoint(72.5792, 23.0314), 4326), 'BULLET', 'OFFLINE', 2.0, '2026-09-20 20:15:00', '2026-02-17 13:00:00' ),
( (SELECT id FROM dept_map WHERE dept_name = 'Surat Municipal Corporation'), 'CAM-SMC-0001', 'Hikvision DS-2CD', '10.30.1.11', 'rtsp://10.30.1.11:554/stream1', ST_SetSRID(ST_MakePoint(72.8311, 21.1702), 4326), 'BULLET', 'ONLINE', 1.0, '2026-09-20 22:53:50', '2026-02-18 09:20:00' ),
( (SELECT id FROM dept_map WHERE dept_name = 'Surat Municipal Corporation'), 'CAM-SMC-0002', 'Dahua IPC-HFW', '10.30.1.12', 'rtsp://10.30.1.12:554/stream1', ST_SetSRID(ST_MakePoint(72.8254, 21.1756), 4326), 'PTZ', 'ONLINE', 1.3, '2026-09-20 22:53:40', '2026-02-19 10:45:00' ),
( (SELECT id FROM dept_map WHERE dept_name = 'Surat Municipal Corporation'), 'CAM-SMC-0003', 'CP Plus CP-UNC', '10.30.1.13', 'rtsp://10.30.1.13:554/stream1', ST_SetSRID(ST_MakePoint(72.8398, 21.1812), 4326), 'BULLET', 'MAINTENANCE', 2.1, '2026-09-20 19:45:00', '2026-02-20 14:30:00' ),
( (SELECT id FROM dept_map WHERE dept_name = 'Vadodara Municipal Corporation'), 'CAM-VMC-0001', 'Bosch AUTODOME', '10.40.1.11', 'rtsp://10.40.1.11:554/stream1', ST_SetSRID(ST_MakePoint(73.1812, 22.3072), 4326), 'PTZ', 'ONLINE', 0.5, '2026-09-20 22:53:30', '2026-02-21 09:15:00' ),
( (SELECT id FROM dept_map WHERE dept_name = 'Vadodara Municipal Corporation'), 'CAM-VMC-0002', 'Hikvision DS-2CD', '10.40.1.12', 'rtsp://10.40.1.12:554/stream1', ST_SetSRID(ST_MakePoint(73.1764, 22.3108), 4326), 'BULLET', 'ONLINE', 1.4, '2026-09-20 22:53:20', '2026-02-22 10:40:00' ),
( (SELECT id FROM dept_map WHERE dept_name = 'Vadodara Municipal Corporation'), 'CAM-VMC-0003', 'Axis M2026', '10.40.1.13', 'rtsp://10.40.1.13:554/stream1', ST_SetSRID(ST_MakePoint(73.1871, 22.3035), 4326), 'BULLET', 'OFFLINE', 3.1, '2026-09-20 20:05:00', '2026-02-23 12:10:00' ),
( (SELECT id FROM dept_map WHERE dept_name = 'Rajkot Municipal Corporation'), 'CAM-RMC-0001', 'Dahua IPC-HDW', '10.50.1.11', 'rtsp://10.50.1.11:554/stream1', ST_SetSRID(ST_MakePoint(70.8022, 22.3039), 4326), 'BULLET', 'ONLINE', 0.9, '2026-09-20 22:52:50', '2026-02-24 09:50:00' ),
( (SELECT id FROM dept_map WHERE dept_name = 'Rajkot Municipal Corporation'), 'CAM-RMC-0002', 'CP Plus CP-UNC', '10.50.1.12', 'rtsp://10.50.1.12:554/stream1', ST_SetSRID(ST_MakePoint(70.8104, 22.3087), 4326), 'PTZ', 'ONLINE', 1.8, '2026-09-20 22:52:40', '2026-02-25 11:20:00' ),
( (SELECT id FROM dept_map WHERE dept_name = 'Gujarat State Road Transport'), 'CAM-GSRTC-0001', 'Hikvision DS-2CD', '10.60.1.11', 'rtsp://10.60.1.11:554/stream1', ST_SetSRID(ST_MakePoint(72.5718, 23.0264), 4326), 'BULLET', 'ONLINE', 2.3, '2026-09-20 22:52:30', '2026-02-26 13:00:00' ),
( (SELECT id FROM dept_map WHERE dept_name = 'Gujarat State Road Transport'), 'CAM-GSRTC-0002', 'Dahua IPC-HFW', '10.60.1.12', 'rtsp://10.60.1.12:554/stream1', ST_SetSRID(ST_MakePoint(72.5752, 23.0291), 4326), 'BULLET', 'OFFLINE', 0.4, '2026-09-20 19:30:00', '2026-02-27 10:15:00' ),
( (SELECT id FROM dept_map WHERE dept_name = 'Gujarat Traffic Police'), 'CAM-TRAF-0001', 'Axis Q6075-E', '10.70.1.11', 'rtsp://10.70.1.11:554/stream1', ST_SetSRID(ST_MakePoint(72.5689, 23.0218), 4326), 'PTZ', 'ONLINE', 1.0, '2026-09-20 22:52:20', '2026-02-28 09:30:00' ),
( (SELECT id FROM dept_map WHERE dept_name = 'Gujarat Traffic Police'), 'CAM-TRAF-0002', 'Bosch AUTODOME', '10.70.1.12', 'rtsp://10.70.1.12:554/stream1', ST_SetSRID(ST_MakePoint(72.5632, 23.0186), 4326), 'PTZ', 'ONLINE', 0.6, '2026-09-20 22:52:10', '2026-03-01 11:45:00' ),
( (SELECT id FROM dept_map WHERE dept_name = 'Gujarat Metro Rail'), 'CAM-METRO-0001', 'Hikvision DS-2CD', '10.80.1.11', 'rtsp://10.80.1.11:554/stream1', ST_SetSRID(ST_MakePoint(72.5321, 23.0274), 4326), 'BULLET', 'ONLINE', 1.1, '2026-09-20 22:51:50', '2026-03-02 10:00:00' ),
( (SELECT id FROM dept_map WHERE dept_name = 'Gujarat Metro Rail'), 'CAM-METRO-0002', 'Axis P3248', '10.80.1.12', 'rtsp://10.80.1.12:554/stream1', ST_SetSRID(ST_MakePoint(72.5384, 23.0312), 4326), 'DOME', 'ONLINE', 0.3, '2026-09-20 22:51:40', '2026-03-03 14:20:00' ),
( (SELECT id FROM dept_map WHERE dept_name = 'Gandhinagar Municipal Corporation'), 'CAM-GMC-0001', 'Dahua IPC-HFW', '10.90.1.11', 'rtsp://10.90.1.11:554/stream1', ST_SetSRID(ST_MakePoint(72.6369, 23.2156), 4326), 'BULLET', 'OFFLINE', 1.7, '2026-09-20 20:45:00', '2026-03-04 09:40:00' ),
( (SELECT id FROM dept_map WHERE dept_name = 'Gandhinagar Municipal Corporation'), 'CAM-GMC-0002', 'Hikvision DS-2CD', '10.90.1.12', 'rtsp://10.90.1.12:554/stream1', ST_SetSRID(ST_MakePoint(72.6421, 23.2192), 4326), 'PTZ', 'ONLINE', 2.5, '2026-09-20 22:51:20', '2026-03-05 12:15:00' ),
( (SELECT id FROM dept_map WHERE dept_name = 'Surat Traffic Police'), 'CAM-TRAF-SRT-0001', 'Axis Q6075-E', '10.100.1.11', 'rtsp://10.100.1.11:554/stream1', ST_SetSRID(ST_MakePoint(72.8231, 21.1652), 4326), 'PTZ', 'ONLINE', 0.2, '2026-09-20 22:51:10', '2026-03-06 10:30:00' ),
( (SELECT id FROM dept_map WHERE dept_name = 'Surat Traffic Police'), 'CAM-TRAF-SRT-0002', 'Bosch AUTODOME', '10.100.1.12', 'rtsp://10.100.1.12:554/stream1', ST_SetSRID(ST_MakePoint(72.8284, 21.1698), 4326), 'PTZ', 'MAINTENANCE', 1.9, '2026-09-20 17:30:00', '2026-03-07 13:45:00' ),
( (SELECT id FROM dept_map WHERE dept_name = 'Gujarat Police'), 'CAM-GJ-0006', 'Hikvision DS-2CD', '10.10.1.16', 'rtsp://10.10.1.16:554/stream1', ST_SetSRID(ST_MakePoint(72.5881, 23.0342), 4326), 'BULLET', 'ONLINE', 0.6, '2026-09-20 22:50:50', '2026-03-08 09:25:00' ),
( (SELECT id FROM dept_map WHERE dept_name = 'Ahmedabad Municipal Corporation'), 'CAM-AMC-0004', 'CP Plus CP-UNC', '10.20.1.14', 'rtsp://10.20.1.14:554/stream1', ST_SetSRID(ST_MakePoint(72.5532, 23.0411), 4326), 'BULLET', 'ONLINE', 1.1, '2026-09-20 22:50:40', '2026-03-09 11:10:00' ),
( (SELECT id FROM dept_map WHERE dept_name = 'Surat Municipal Corporation'), 'CAM-SMC-0004', 'Axis M2026', '10.30.1.14', 'rtsp://10.30.1.14:554/stream1', ST_SetSRID(ST_MakePoint(72.8451, 21.1872), 4326), 'BULLET', 'OFFLINE', 2.8, '2026-09-20 19:15:00', '2026-03-10 15:00:00' ),
( (SELECT id FROM dept_map WHERE dept_name = 'Gujarat Police'), 'CAM-GJ-0007', 'Dahua IPC-HDW', '10.10.1.17', 'rtsp://10.10.1.17:554/stream1', ST_SetSRID(ST_MakePoint(72.5923, 23.0298), 4326), 'PTZ', 'ONLINE', 0.4, '2026-09-20 22:50:20', '2026-03-11 10:45:00' );