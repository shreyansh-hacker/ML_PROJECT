import { useState, useEffect, useRef } from "react";
import {
  Grid,
  Maximize2,
  Minimize2,
  Camera,
  Play,
  Volume2,
  VolumeX,
  RefreshCw,
  AlertTriangle,
  Sliders,
  Radio,
  Layers,
  Sparkles,
  Shield,
  Eye,
  ExternalLink,
  Wifi,
  WifiOff
} from "lucide-react";
import "./SurveillanceMatrix.css";
import { apiFetch, apiUrl } from "../utils/apiConfig";

export default function SurveillanceMatrix({ onOpenDetailedView, onNavigateToOnboarding }) {
  const [cameras, setCameras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [layout, setLayout] = useState("2x2"); // "2x2" | "3x3" | "1+3"
  const [selectedSlots, setSelectedSlots] = useState({}); // slotIndex -> camera object
  const [streamErrors, setStreamErrors] = useState({}); // slotIndex -> boolean
  const [streamRetryTokens, setStreamRetryTokens] = useState({});
  const [currentTime, setCurrentTime] = useState(new Date().toUTCString());
  const [fullscreenTile, setFullscreenTile] = useState(null); // slotIndex | null
  const localVideoRefs = useRef({});
  const streamImgRefs = useRef({});

  // 1. Fetch Registered Cameras & ANPR Sources
  useEffect(() => {
    async function loadCameras() {
      setLoading(true);
      try {
        // Fetch both registered cameras and anpr sources for complete fleet
        const [camsRes, sourcesRes] = await Promise.all([
          apiFetch(apiUrl("/api/cameras")).catch(() => null),
          apiFetch(apiUrl("/api/anpr/sources")).catch(() => null),
        ]);

        let combined = [];
        const seenIds = new Set();

        // Add ANPR sources first (Demo Video, Webcam, etc.)
        if (sourcesRes && sourcesRes.ok) {
          const sData = await sourcesRes.json();
          if (Array.isArray(sData)) {
            sData.forEach((s) => {
              const uid = String(s.id || s.camera_code);
              const cameraCode = String(s.camera_code || "");
              if (!seenIds.has(uid) && (!cameraCode || !seenIds.has(cameraCode))) {
                seenIds.add(uid);
                if (cameraCode) seenIds.add(cameraCode);
                combined.push({
                  id: s.id,
                  camera_code: s.camera_code || "DEMO",
                  dept_name: s.location || s.name || "Surveillance Feed",
                  location: s.location || "Gujarat",
                  source_type: s.source_type,
                  status: s.status || "ONLINE",
                  camera_type: "ANPR",
                  rtsp_url: s.rtsp_url || "",
                });
              }
            });
          }
        }

        // Add registered cameras
        if (camsRes && camsRes.ok) {
          const cData = await camsRes.json();
          const camList = Array.isArray(cData)
            ? cData
            : Array.isArray(cData.cameras)
            ? cData.cameras
            : Array.isArray(cData.features)
            ? cData.features.map((feature) => ({
                ...feature.properties,
                latitude: feature.geometry?.coordinates?.[1],
                longitude: feature.geometry?.coordinates?.[0],
              }))
            : [];
          camList.forEach((c) => {
            const uid = String(c.id || c.camera_code);
            const cameraCode = String(c.camera_code || "");
            if (!seenIds.has(uid) && (!cameraCode || !seenIds.has(cameraCode))) {
              seenIds.add(uid);
              if (cameraCode) seenIds.add(cameraCode);
              combined.push({
                ...c,
                id: c.id || c.camera_code,
                dept_name: c.dept_name || "Gujarat CCTV",
                source_type: c.source_type || "NETWORK_CCTV",
                status: c.status || "ONLINE",
              });
            }
          });
        }

        setCameras(combined);

        // Auto-populate initial 4 slots with unique available feeds
        const initialSlots = {};
        combined.slice(0, 4).forEach((cam, idx) => {
          initialSlots[idx] = cam;
        });
        setSelectedSlots(initialSlots);
      } catch (err) {
        console.error("Error fetching cameras for matrix:", err);
      } finally {
        setLoading(false);
      }
    }

    loadCameras();
  }, []);

  // 2. Real-time Surveillance Clock
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setCurrentTime(
        `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
          now.getDate()
        ).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(
          now.getMinutes()
        ).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")} IST`
      );
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // 3. Local Webcam Management with proper cleanup
  useEffect(() => {
    const activeStreams = [];
    Object.entries(selectedSlots).forEach(([slotIdx, cam]) => {
      if (cam?.source_type === "LOCAL_WEBCAM") {
        const videoEl = localVideoRefs.current[slotIdx];
        if (videoEl && navigator.mediaDevices?.getUserMedia) {
          navigator.mediaDevices
            .getUserMedia({ video: true, audio: false })
            .then((stream) => {
              videoEl.srcObject = stream;
              videoEl.play().catch(() => {});
              activeStreams.push(stream);
            })
            .catch((err) => {
              console.warn("Could not start local webcam stream:", err);
              setStreamErrors((prev) => ({ ...prev, [slotIdx]: true }));
            });
        }
      }
    });

    return () => {
      activeStreams.forEach((s) => {
        try {
          s.getTracks().forEach((t) => t.stop());
        } catch (_) {}
      });
    };
  }, [selectedSlots]);

  // A stream response can stay open even when its camera never emits a frame.
  useEffect(() => {
    const timers = Object.entries(selectedSlots)
      .filter(([, cam]) => cam && cam.source_type !== "LOCAL_WEBCAM")
      .map(([slotIdx]) =>
        setTimeout(() => {
          const image = streamImgRefs.current[slotIdx];
          if (image && image.naturalWidth === 0) {
            setStreamErrors((previous) => ({ ...previous, [slotIdx]: true }));
          }
        }, 15000)
      );

    return () => timers.forEach(clearTimeout);
  }, [selectedSlots, streamRetryTokens]);

  // Cleanup image connections on unmount
  useEffect(() => {
    return () => {
      Object.values(streamImgRefs.current).forEach((img) => {
        if (img) {
          img.src = "";
        }
      });
    };
  }, []);

  const getSlotCount = () => {
    if (layout === "3x3") return 9;
    if (layout === "1+3") return 4;
    return 4; // 2x2
  };

  const slotCount = getSlotCount();
  const slotsArray = Array.from({ length: slotCount }, (_, i) => i);

  // Quick Action: Tile all ANPR Cameras
  const handleTileAnpr = () => {
    const anprCams = cameras.filter((c) => (c.camera_type || "").toUpperCase() === "ANPR");
    const newSlots = {};
    slotsArray.forEach((slotIdx) => {
      if (anprCams[slotIdx]) {
        newSlots[slotIdx] = anprCams[slotIdx];
      }
    });
    setStreamErrors({});
    setSelectedSlots(newSlots);
  };

  // Quick Action: Tile Online Cameras
  const handleTileOnline = () => {
    const onlineCams = cameras.filter((c) => (c.status || "ONLINE").toUpperCase() === "ONLINE");
    const newSlots = {};
    slotsArray.forEach((slotIdx) => {
      if (onlineCams[slotIdx]) {
        newSlots[slotIdx] = onlineCams[slotIdx];
      }
    });
    setStreamErrors({});
    setSelectedSlots(newSlots);
  };

  // Clear Matrix with cleanup
  const handleClearMatrix = () => {
    Object.values(streamImgRefs.current).forEach((img) => {
      if (img) img.src = "";
    });
    setStreamErrors({});
    setSelectedSlots({});
  };

  // Assign Camera to Slot (prevents duplicate streams across tiles)
  const handleAssignCamera = (slotIdx, camId) => {
    // If clearing slot
    if (!camId) {
      if (streamImgRefs.current[slotIdx]) {
        streamImgRefs.current[slotIdx].src = "";
      }
      const next = { ...selectedSlots };
      delete next[slotIdx];
      setSelectedSlots(next);
      setStreamErrors((prev) => {
        const copy = { ...prev };
        delete copy[slotIdx];
        return copy;
      });
      return;
    }

    const found = cameras.find((c) => String(c.id || c.camera_code) === String(camId));
    if (!found) return;

    // Check if camera is already assigned to another slot; if so, swap or unassign old slot
    const updated = { ...selectedSlots };
    Object.entries(updated).forEach(([sIdx, c]) => {
      if (String(sIdx) !== String(slotIdx) && String(c.id || c.camera_code) === String(camId)) {
        if (streamImgRefs.current[sIdx]) {
          streamImgRefs.current[sIdx].src = "";
        }
        delete updated[sIdx];
      }
    });

    updated[slotIdx] = found;
    setSelectedSlots(updated);
    setStreamErrors((prev) => ({ ...prev, [slotIdx]: false }));
  };

  const handleRetryStream = (slotIdx) => {
    setStreamErrors((prev) => ({ ...prev, [slotIdx]: false }));
    setStreamRetryTokens((previous) => ({
      ...previous,
      [slotIdx]: (previous[slotIdx] || 0) + 1,
    }));
  };

  // Clicking a camera opens detailed view in ANPR
  const handleOpenDetailed = (cam) => {
    if (!cam) return;
    if (typeof onOpenDetailedView === "function") {
      onOpenDetailedView(cam);
    }
  };

  // Set of camera IDs currently active in matrix (for duplicate prevention)
  const activeCameraIds = new Set(
    Object.values(selectedSlots)
      .filter(Boolean)
      .map((c) => String(c.id || c.camera_code))
  );

  return (
    <div className="surveillance-matrix-container">
      {/* MATRIX CONTROL HEADER */}
      <div className="matrix-control-bar">
        <div className="matrix-title-group">
          <div className="live-pulsing-badge">
            <Radio size={14} className="pulse-icon" />
            <span>COMMAND MATRIX LIVE</span>
          </div>
          <h3>Surveillance Video Wall</h3>
          <span className="live-clock">{currentTime}</span>
        </div>

        {/* CONTROLS */}
        <div className="matrix-actions-group">
          <button
            type="button"
            className="matrix-preset-btn"
            onClick={handleTileAnpr}
            title="Auto-fill video wall with all registered ANPR cameras"
          >
            <Shield size={14} />
            <span>Tile ANPR Feeds</span>
          </button>

          <button
            type="button"
            className="matrix-preset-btn"
            onClick={handleTileOnline}
            title="Fill tiles with active online cameras"
          >
            <Sparkles size={14} />
            <span>Tile Online</span>
          </button>

          <button
            type="button"
            className="matrix-preset-btn text-muted"
            onClick={handleClearMatrix}
          >
            Clear Wall
          </button>

          {/* Layout Selector */}
          <div className="layout-switcher">
            <button
              type="button"
              className={`layout-btn ${layout === "2x2" ? "active" : ""}`}
              onClick={() => setLayout("2x2")}
              title="2x2 Grid (4 Feeds)"
            >
              2x2
            </button>
            <button
              type="button"
              className={`layout-btn ${layout === "3x3" ? "active" : ""}`}
              onClick={() => setLayout("3x3")}
              title="3x3 Grid (9 Feeds)"
            >
              3x3
            </button>
            <button
              type="button"
              className={`layout-btn ${layout === "1+3" ? "active" : ""}`}
              onClick={() => setLayout("1+3")}
              title="1 Large + 3 Side Feeds"
            >
              1+3
            </button>
          </div>
        </div>
      </div>

      {/* MATRIX EMPTY STATE */}
      {cameras.length === 0 && !loading && (
        <div className="matrix-no-cams-card">
          <Camera size={44} />
          <h4>No Registered Cameras Available</h4>
          <p>
            You haven't registered any CCTV cameras yet. Onboard your first camera or upload via CSV to monitor multiple feeds on this video wall.
          </p>
          {onNavigateToOnboarding && (
            <button
              type="button"
              className="primary-button"
              onClick={onNavigateToOnboarding}
            >
              Onboard Cameras Now
            </button>
          )}
        </div>
      )}

      {/* VIDEO WALL GRID */}
      {cameras.length > 0 && (
        <div className={`matrix-grid layout-${layout} ${fullscreenTile !== null ? "has-fullscreen" : ""}`}>
          {slotsArray.map((slotIdx) => {
            const cam = selectedSlots[slotIdx];
            const isFullscreen = fullscreenTile === slotIdx;
            const isAnpr = (cam?.camera_type || "").toUpperCase() === "ANPR";
            const isLocal = cam?.source_type === "LOCAL_WEBCAM";
            const isOffline = (cam?.status || "").toUpperCase() === "OFFLINE";
            const hasError = Boolean(streamErrors[slotIdx]) || isOffline;

            if (fullscreenTile !== null && !isFullscreen) return null;

            return (
              <div
                key={slotIdx}
                className={`matrix-tile ${isFullscreen ? "fullscreen-tile" : ""} ${
                  layout === "1+3" && slotIdx === 0 ? "focus-tile" : ""
                }`}
              >
                {/* TILE HEADER */}
                <div className="tile-top-bar">
                  <div className="tile-cam-info">
                    {cam ? (
                      <>
                        <span className={`status-badge-mini ${isOffline ? "offline" : "online"}`}>
                          <span className="status-dot-mini"></span>
                          <span>{isOffline ? "OFFLINE" : "LIVE"}</span>
                        </span>
                        <strong className="tile-code">{cam.camera_code || "CAM"}</strong>
                        {isAnpr && <span className="anpr-tile-pill">ANPR</span>}
                        <span className="tile-dept" title={cam.dept_name || cam.location}>
                          {cam.dept_name || cam.location}
                        </span>
                      </>
                    ) : (
                      <span className="empty-slot-label">Slot #{slotIdx + 1} â€” Standby</span>
                    )}
                  </div>

                  <div className="tile-actions">
                    {/* CAMERA SELECTOR WITH DUPLICATE PREVENTION */}
                    <select
                      className="tile-cam-select"
                      value={cam ? (cam.id || cam.camera_code) : ""}
                      onChange={(e) => handleAssignCamera(slotIdx, e.target.value)}
                    >
                      <option value="">-- Choose Camera --</option>
                      {cameras.map((c) => {
                        const cid = String(c.id || c.camera_code);
                        const isAssignedElsewhere = activeCameraIds.has(cid) && (!cam || String(cam.id || cam.camera_code) !== cid);
                        return (
                          <option key={cid} value={cid}>
                            {c.camera_code} ({c.camera_type || "CCTV"}) - {c.dept_name || c.location}
                            {isAssignedElsewhere ? " [In Use]" : ""}
                          </option>
                        );
                      })}
                    </select>

                    {cam && (
                      <>
                        {/* OPEN IN ANPR BUTTON */}
                        <button
                          type="button"
                          className="tile-inspect-btn"
                          onClick={() => handleOpenDetailed(cam)}
                          title="Open detailed ANPR intelligence view for this camera"
                        >
                          <Eye size={12} />
                          <span>ANPR</span>
                        </button>

                        {/* FULLSCREEN TOGGLE */}
                        <button
                          type="button"
                          className="tile-tool-btn"
                          onClick={() => setFullscreenTile(isFullscreen ? null : slotIdx)}
                          title={isFullscreen ? "Exit Fullscreen" : "Fullscreen Feed"}
                        >
                          {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* TILE VIEWPORT */}
                <div
                  className="tile-video-viewport"
                  onClick={() => cam && handleOpenDetailed(cam)}
                  title={cam ? "Click to open detailed ANPR view" : "Select a camera to start stream"}
                >
                  {cam ? (
                    <>
                      {/* STREAM DISPLAY */}
                      {hasError ? (
                        <div className="tile-offline-state" onClick={(e) => e.stopPropagation()}>
                          <WifiOff size={32} color="#f87171" />
                          <h5>Feed Unavailable / Offline</h5>
                          <p>{cam.camera_code} ({cam.dept_name || cam.location})</p>
                          <button
                            type="button"
                            className="tile-retry-btn"
                            onClick={() => handleRetryStream(slotIdx)}
                          >
                            <RefreshCw size={12} />
                            <span>Retry Connection</span>
                          </button>
                        </div>
                      ) : isLocal ? (
                        <video
                          ref={(el) => (localVideoRefs.current[slotIdx] = el)}
                          className="tile-video-element"
                          autoPlay
                          playsInline
                          muted
                        />
                      ) : (
                        <img
                          ref={(el) => (streamImgRefs.current[slotIdx] = el)}
                          crossOrigin="use-credentials"
                          src={apiUrl(
                            `/api/cameras/${encodeURIComponent(cam.id || cam.camera_code)}/stream?retry=${streamRetryTokens[slotIdx] || 0}`
                          )}
                          alt={cam.camera_code}
                          className="tile-stream-img"
                          onLoad={() => {
                            setStreamErrors((previous) =>
                              previous[slotIdx]
                                ? { ...previous, [slotIdx]: false }
                                : previous
                            );
                          }}
                          onError={() => {
                            setStreamErrors((prev) => ({ ...prev, [slotIdx]: true }));
                          }}
                        />
                      )}

                      {/* TILE OSD OVERLAYS */}
                      <div className="tile-osd-top-left">
                        <span>{currentTime}</span>
                      </div>
                      <div className="tile-osd-top-right">
                        <span>CH-0{slotIdx + 1} | 1080P</span>
                      </div>
                      <div className="tile-osd-bottom-left">
                        <span>{cam.location || cam.dept_name || "Surveillance"}</span>
                      </div>

                      {/* HOVER QUICK ACTION */}
                      <div className="tile-hover-overlay">
                        <span>
                          <ExternalLink size={13} />
                          Open in ANPR Detailed View
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="empty-tile-prompt" onClick={(e) => e.stopPropagation()}>
                      <Camera size={30} />
                      <p>Tile #{slotIdx + 1} Ready</p>
                      <span>Select camera from dropdown above</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
