# Unified surveillance architecture

## Read-only integration

Departmental cameras, recorders, retention policies, and monitoring software remain
the systems of record. Gujarat Sentinel reads each authorized RTSP/HTTP media feed.
For ONVIF onboarding, it reads device information, media profiles, and the RTSP
stream URI; it does not issue camera configuration, PTZ, recording, or deletion
commands. Camera enrollment, credentials, ANPR events, and derived plate crops are
stored by this application, not written back to departmental systems.

The backend needs routed network access to authorized camera subnets and their
ONVIF/RTSP ports. Keep that access private (for example, on the department LAN or
through a VPN); do not expose camera ports to the public internet. Use a dedicated,
read-only camera account where supported. ONVIF credentials are encrypted at rest.

## Media and event flow

```text
Department cameras / recorders
       | read-only RTSP; ONVIF discovery and profile reads
       v
Gujarat Sentinel API
       |-- FFmpeg/OpenCV converts feeds to browser-viewable MJPEG
       |-- ANPR worker runs vehicle/plate detection and OCR
       |-- detection events, timestamps, locations, and plate crops are stored locally
       v
Video wall | searchable metadata dashboard | watchlist alerts
```

The API is a lightweight protocol adapter and inference service, not a replacement
video management system or a central recording server. Camera settings, original
recordings, and existing retention are outside the application's write path. Feed
availability depends on network reachability, camera authorization, and codec
support; ANPR processing can run on the selected source without changing how the
department records it.

## Demonstration feeds

The video wall and ANPR source selector include two distinct bundled clips:
`backend/ANPR/test_video.mp4` (**DEMO-01**) and `backend/ANPR/t.mp4` (**DEMO-02**).
They can be played side by side without camera hardware. Start ANPR from the
**ANPR Intelligence** screen to show live annotated detections from the selected
clip. Registered RTSP/ONVIF cameras appear alongside the demos when available.
The detection dashboard searches recorded ANPR events by plate, camera, date,
vehicle type, watchlist status, and location; watchlist matches generate in-app
alerts while the ANPR worker is running.
