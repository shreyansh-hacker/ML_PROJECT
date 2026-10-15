import { useEffect, useRef, useState } from "react";
import {
  X,
  Video,
  Camera,
  Maximize2,
  Minimize2,
  Radio,
  Clock,
  Wifi,
  Shield,
  Volume2,
  VolumeX,
  Compass,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  RefreshCw
} from "lucide-react";
import MediaMTXWebRTCReader from "../utils/mediamtxReader";
import { apiUrl } from "../utils/apiConfig";

function parseRtspUrl(rtspUrl) {
  if (!rtspUrl || !rtspUrl.startsWith("rtsp://")) return null;
  try {
    const raw = rtspUrl.slice(7);
    const atIndex = raw.lastIndexOf("@");
    let auth = "";
    let hostAndPath = raw;
    if (atIndex !== -1) {
      auth = raw.slice(0, atIndex);
      hostAndPath = raw.slice(atIndex + 1);
    }
    const colonInAuth = auth.indexOf(":");
    let user = "";
    let pass = "";
    if (colonInAuth !== -1) {
      user = decodeURIComponent(auth.slice(0, colonInAuth));
      pass = decodeURIComponent(auth.slice(colonInAuth + 1));
    }
    const slashIndex = hostAndPath.indexOf("/");
    const hostPort = slashIndex !== -1 ? hostAndPath.slice(0, slashIndex) : hostAndPath;
    const path = slashIndex !== -1 ? hostAndPath.slice(slashIndex) : "";
    const host = hostPort.split(":")[0];

    return {
      host,
      path,
      user,
      pass,
      whepUrl: `http://${host}:8889${path}/whep`,
    };
  } catch {
    return null;
  }
}

export default function CameraFeedModal({ camera, onClose }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const readerRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentTime, setCurrentTime] = useState("");
  const [webcamActive, setWebcamActive] = useState(false);
  const [webcamError, setWebcamError] = useState("");
  const [networkStreamError, setNetworkStreamError] = useState("");
  const [streamKey, setStreamKey] = useState(Date.now());
  const [ptzAction, setPtzAction] = useState("");
  const [snapshotTaken, setSnapshotTaken] = useState(false);
  const [nightVision, setNightVision] = useState(false);

  const isLocalWebcam = camera?.source_type === "LOCAL_WEBCAM";
  const hasServerManagedCredentials = Boolean(camera?.stream_auth_managed);
  const [streamMode, setStreamMode] = useState(isLocalWebcam ? "LOCAL_WEBCAM" : "WEBRTC");
  const [isConnecting, setIsConnecting] = useState(!isLocalWebcam);

  // Sentinel HTTP Direct Stream Fallback (/stream/<id>)
  const parsed = parseRtspUrl(camera?.rtsp_url);
  const sentinelHttpUrl = camera?.http_stream_url || (parsed?.host && parsed?.path ? `http://${parsed.host}${parsed.path}` : null);

  // Reconnection with Exponential Backoff (2s -> 4s -> 8s -> ... max 30s)
  const [reconnectCountdown, setReconnectCountdown] = useState(0);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  const triggerAutoReconnect = () => {
    const nextAttempt = reconnectAttempt + 1;
    const delaySec = Math.min(Math.pow(2, nextAttempt), 30);
    setReconnectAttempt(nextAttempt);
    setReconnectCountdown(delaySec);
  };

  useEffect(() => {
    if (reconnectCountdown <= 0) return;
    const timer = setTimeout(() => {
      if (reconnectCountdown === 1) {
        setNetworkStreamError("");
        setStreamKey(Date.now());
        setReconnectCountdown(0);
      } else {
        setReconnectCountdown(reconnectCountdown - 1);
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [reconnectCountdown]);

  // 1. Live Running CCTV Clock (updates every second)
  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
      setCurrentTime(`${dateStr} ${timeStr}`);
    };

    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  // 2. Stream Initializer: WebRTC (Webcam or Network CCTV WHEP)
  useEffect(() => {
    let isCancelled = false;

    if (isLocalWebcam) {
      async function startCamera() {
        try {
          setWebcamError("");
          if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            setWebcamError("Webcam access not supported in this browser.");
            return;
          }

          const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false,
          });

          if (!isCancelled) {
            streamRef.current = stream;
            if (videoRef.current) {
              videoRef.current.srcObject = stream;
              videoRef.current.play().catch(() => {});
            }
            setWebcamActive(true);
            setIsConnecting(false);
          }
        } catch (err) {
          if (!isCancelled) {
            console.error("Camera access error:", err);
            setWebcamError("Could not access laptop webcam. Please grant camera permission.");
            setIsConnecting(false);
          }
        }
      }

      startCamera();

      return () => {
        isCancelled = true;
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
        }
      };
    } else {
      if (hasServerManagedCredentials) {
        setStreamMode("BACKEND_MJPEG");
        setIsConnecting(false);
        setNetworkStreamError("");
        return () => {
          isCancelled = true;
          if (readerRef.current) {
            readerRef.current.close();
            readerRef.current = null;
          }
        };
      }

      // Network CCTV WebRTC Connection
      const parsed = parseRtspUrl(camera?.rtsp_url);
      if (parsed) {
        setIsConnecting(true);
        setNetworkStreamError("");
        setStreamMode("WEBRTC");

        try {
          const reader = new MediaMTXWebRTCReader({
            url: parsed.whepUrl,
            user: parsed.user,
            pass: parsed.pass,
            onError: (err) => {
              if (!isCancelled) {
                console.warn("MediaMTX WebRTC issue, falling back to backend stream:", err);
                setStreamMode("BACKEND_MJPEG");
                setIsConnecting(false);
              }
            },
            onTrack: (evt) => {
              if (!isCancelled) {
                console.log("MediaMTX WebRTC track received:", evt);
                if (videoRef.current) {
                  videoRef.current.srcObject = evt.streams[0];
                  videoRef.current.play().catch(() => {});
                }
                setWebcamActive(true);
                setIsConnecting(false);
              }
            },
          });
          readerRef.current = reader;
        } catch (err) {
          if (!isCancelled) {
            setStreamMode("BACKEND_MJPEG");
            setIsConnecting(false);
          }
        }
      } else {
        setStreamMode("BACKEND_MJPEG");
        setIsConnecting(false);
      }

      return () => {
        isCancelled = true;
        if (readerRef.current) {
          readerRef.current.close();
          readerRef.current = null;
        }
      };
    }
  }, [camera?.rtsp_url, camera?.stream_auth_managed, hasServerManagedCredentials, isLocalWebcam]);

  // 3. PTZ Simulated Action Trigger
  const triggerPtz = (action) => {
    setPtzAction(action);
    setTimeout(() => {
      setPtzAction("");
    }, 1200);
  };

  // 4. Capture Frame Snapshot
  const takeSnapshot = () => {
    setSnapshotTaken(true);
    try {
      if (videoRef.current && videoRef.current.videoWidth > 0) {
        const canvas = document.createElement("canvas");
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        const link = document.createElement("a");
        link.download = `snapshot_${camera.camera_code || "CAM"}_${Date.now()}.jpg`;
        link.href = canvas.toDataURL("image/jpeg", 0.95);
        link.click();
      } else if (!isLocalWebcam && camera) {
        const a = document.createElement("a");
        a.href = apiUrl(`/api/cameras/${camera.camera_code || camera.id}/snapshot?t=${Date.now()}`);
        a.download = `snapshot_${camera.camera_code || "CAM"}_${Date.now()}.jpg`;
        a.target = "_blank";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } catch (err) {
      console.warn("Snapshot fallback:", err);
    }
    setTimeout(() => {
      setSnapshotTaken(false);
    }, 2000);
  };

  // 5. Fullscreen Toggle
  const toggleFullscreen = () => {
    const el = document.getElementById("cctv-monitor-screen");
    if (!el) return;

    if (!document.fullscreenElement) {
      el.requestFullscreen?.();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.();
      setIsFullscreen(false);
    }
  };

  return (
    <div className="cctv-modal-overlay">
      <div className="cctv-modal-container" id="cctv-monitor-screen">
        {/* MODAL HEADER */}
        <div className="cctv-modal-header">
          <div className="cctv-header-left">
            <div className="cctv-brand-icon">
              <Video size={18} />
            </div>
            <div>
              <div className="cctv-title-row">
                <h4>{camera.camera_code || "CAM-LIVE"}</h4>
                <span className="cctv-live-tag">
                  <span className="live-pulsar"></span>
                  LIVE FEED
                </span>
                <span className="cctv-type-tag">
                  {isLocalWebcam ? "LOCAL WEBCAM" : camera.camera_type || "CCTV"}
                </span>
                <span
                  className="cctv-type-tag"
                  style={{
                    background: (camera.codec || "").toUpperCase() === "H.265" ? "#7c3aed" : "#2563eb",
                    color: "#ffffff",
                    fontWeight: 700
                  }}
                >
                  {camera.codec || "H.264"}
                </span>
              </div>
              <p className="cctv-subtext">
                {camera.dept_name || "State Security Dept"} • {camera.make_model || "Surveillance Unit"}
              </p>
            </div>
          </div>

          <div className="cctv-header-actions">
            {/* PROTOCOL SELECTOR PILLS */}
            {!isLocalWebcam && !hasServerManagedCredentials && (
              <div className="stream-protocol-pill-group">
                <button
                  type="button"
                  className={`protocol-pill ${streamMode === "WEBRTC" ? "active" : ""}`}
                  onClick={() => {
                    setStreamMode("WEBRTC");
                    setNetworkStreamError("");
                    setReconnectCountdown(0);
                  }}
                  title="Low-Latency WebRTC WHEP"
                >
                  WebRTC
                </button>
                <button
                  type="button"
                  className={`protocol-pill ${streamMode === "BACKEND_MJPEG" ? "active" : ""}`}
                  onClick={() => {
                    setStreamMode("BACKEND_MJPEG");
                    setNetworkStreamError("");
                    setReconnectCountdown(0);
                  }}
                  title="FFmpeg TCP Stream (Firewall Proof)"
                >
                  FFmpeg TCP
                </button>
                {sentinelHttpUrl && (
                  <button
                    type="button"
                    className={`protocol-pill ${streamMode === "SENTINEL_HTTP" ? "active" : ""}`}
                    onClick={() => {
                      setStreamMode("SENTINEL_HTTP");
                      setNetworkStreamError("");
                      setReconnectCountdown(0);
                    }}
                    title="Sentinel Browser HTTP Fallback (/stream/<id>)"
                  >
                    Sentinel HTTP
                  </button>
                )}
              </div>
            )}

            <button
              type="button"
              className="cctv-icon-btn"
              onClick={() => setNightVision(!nightVision)}
              title="Toggle Night Vision Mode"
            >
              <Shield size={16} />
              <span>{nightVision ? "IR Mode ON" : "Normal Mode"}</span>
            </button>

            <button
              type="button"
              className="cctv-icon-btn"
              onClick={toggleFullscreen}
              title="Toggle Fullscreen"
            >
              {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>

            <button
              type="button"
              className="cctv-close-btn"
              onClick={onClose}
              title="Close Stream"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* CCTV MONITOR VIEWPORT */}
        <div className={`cctv-viewport ${nightVision ? "night-vision" : ""}`}>
          {isLocalWebcam || streamMode === "WEBRTC" ? (
            <div className="video-stream-box">
              <video
                ref={videoRef}
                className="live-video-element"
                autoPlay
                playsInline
                muted
              />
              {isConnecting && (
                <div className="stream-error-overlay" style={{ background: "rgba(15, 23, 42, 0.85)" }}>
                  <RefreshCw size={36} style={{ color: "#38bdf8", animation: "spin 1.5s linear infinite" }} />
                  <h5 style={{ margin: "12px 0 4px", color: "#f8fafc", fontSize: "15px" }}>
                    Connecting Live WebRTC Stream...
                  </h5>
                  <p style={{ margin: 0, fontSize: "12px", color: "#94a3b8" }}>
                    Negotiating {camera.codec || "H.264"} video feed for {camera.camera_code || "Camera"}
                  </p>
                </div>
              )}
              {webcamError && (
                <div className="stream-error-overlay">
                  <AlertCircle size={32} />
                  <p>{webcamError}</p>
                </div>
              )}
            </div>
          ) : streamMode === "SENTINEL_HTTP" ? (
            /* Direct Sentinel HTTP Range Player (/stream/<id>) */
            <div className="video-stream-box">
              <video
                key={streamKey}
                className="live-video-element"
                controls
                autoPlay
                playsInline
                muted
                src={sentinelHttpUrl}
                onError={() => {
                  setNetworkStreamError(
                    "Direct Sentinel HTTP range stream (/stream/<id>) interrupted. Reconnecting with backoff..."
                  );
                  triggerAutoReconnect();
                }}
              />
              {reconnectCountdown > 0 && (
                <div className="stream-error-overlay" style={{ background: "rgba(15, 23, 42, 0.9)" }}>
                  <RefreshCw size={36} style={{ color: "#38bdf8", animation: "spin 1.5s linear infinite" }} />
                  <h5 style={{ margin: "10px 0 4px", color: "#f8fafc", fontSize: "15px" }}>
                    Feed Restarting or Looping
                  </h5>
                  <p style={{ margin: "0 0 12px", fontSize: "12px", color: "#94a3b8" }}>
                    Auto-reconnecting in <strong style={{ color: "#38bdf8" }}>{reconnectCountdown}s</strong> (Attempt #{reconnectAttempt})
                  </p>
                  <button
                    type="button"
                    className="cctv-tool-btn"
                    onClick={() => {
                      setReconnectCountdown(0);
                      setNetworkStreamError("");
                      setStreamKey(Date.now());
                    }}
                  >
                    <RefreshCw size={14} />
                    <span>Reconnect Now</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* Backend MJPEG Stream Viewport (TCP FFMPEG) */
            <div className="video-stream-box">
              {reconnectCountdown > 0 ? (
                <div className="stream-error-overlay" style={{ background: "rgba(15, 23, 42, 0.9)" }}>
                  <RefreshCw size={36} style={{ color: "#38bdf8", animation: "spin 1.5s linear infinite" }} />
                  <h5 style={{ margin: "10px 0 4px", color: "#f8fafc", fontSize: "15px" }}>
                    Stream Interrupted or Loop Restart
                  </h5>
                  <p style={{ margin: "0 0 12px", fontSize: "12px", color: "#cbd5e1", maxWidth: "420px" }}>
                    Feed restarting at loop boundary. Reconnecting in{" "}
                    <strong style={{ color: "#38bdf8" }}>{reconnectCountdown}s</strong> (Attempt #{reconnectAttempt}).
                  </p>
                  <button
                    type="button"
                    className="cctv-tool-btn"
                    onClick={() => {
                      setReconnectCountdown(0);
                      setNetworkStreamError("");
                      setStreamKey(Date.now());
                    }}
                  >
                    <RefreshCw size={14} />
                    <span>Reconnect Now</span>
                  </button>
                </div>
              ) : networkStreamError ? (
                <div className="stream-error-overlay">
                  <AlertCircle size={36} style={{ color: "#f87171" }} />
                  <h5 style={{ margin: "6px 0 2px", color: "#f8fafc", fontSize: "15px" }}>
                    Camera Stream Offline or Unavailable
                  </h5>
                  <p style={{ margin: "0 0 14px", fontSize: "12px", color: "#cbd5e1", maxWidth: "420px" }}>
                    {networkStreamError}
                  </p>
                  <button
                    type="button"
                    className="cctv-tool-btn"
                    onClick={() => {
                      setNetworkStreamError("");
                      setStreamKey(Date.now());
                    }}
                  >
                    <RefreshCw size={14} />
                    <span>Retry RTSP Stream</span>
                  </button>
                </div>
              ) : (
                <img
                  key={streamKey}
                  crossOrigin="use-credentials"
                  src={apiUrl(`/api/cameras/${camera.camera_code || camera.id}/stream`)}
                  className="live-video-element"
                  alt={`Live Feed - ${camera.camera_code}`}
                  onError={() => {
                    setNetworkStreamError(
                      "RTSP connection interrupted. Feed may be looping or restarting."
                    );
                    triggerAutoReconnect();
                  }}
                />
              )}
            </div>
          )}

          {/* CCTV ON-SCREEN DISPLAY (OSD) OVERLAYS */}
          <div className="cctv-osd-top-left">
            <span className="osd-rec-badge">
              <span className="rec-dot"></span> REC
            </span>
            <span className="osd-channel">CH-01</span>
          </div>

          <div className="cctv-osd-top-right">
            <span className="osd-clock">
              <Clock size={13} />
              {currentTime}
            </span>
          </div>

          <div className="cctv-osd-bottom-left">
            <span className="osd-text">ID: {camera.camera_code}</span>
            <span className="osd-text">IP: {camera.ip_address || "LOCAL_DEV"}</span>
            <span className="osd-text">DEPT: {camera.dept_name || "N/A"}</span>
          </div>

          <div className="cctv-osd-bottom-right">
            <span className="osd-text">1080P HD • 30 FPS</span>
            <span className="osd-text">H.264 • 4096 KBPS</span>
            <span className="osd-text status-active">ONLINE</span>
          </div>

          {/* PTZ Trigger Action Toast */}
          {ptzAction && (
            <div className="ptz-action-toast">
              <Compass size={16} />
              <span>PTZ COMMAND: {ptzAction}</span>
            </div>
          )}

          {/* Snapshot Notification Toast */}
          {snapshotTaken && (
            <div className="snapshot-toast">
              <CheckCircle2 size={18} />
              <span>Frame Snapshot Captured (1080p Saved)</span>
            </div>
          )}
        </div>

        {/* MONITOR FOOTER & PTZ CONTROLS */}
        <div className="cctv-modal-footer">
          {/* METADATA INFO */}
          <div className="cctv-footer-info">
            <div className="footer-meta-item">
              <span>Source Type</span>
              <strong>{isLocalWebcam ? "Laptop Webcam (WebRTC)" : "Network CCTV (RTSP)"}</strong>
            </div>

            <div className="footer-meta-item">
              <span>RTSP Stream URL</span>
              <code>
                {hasServerManagedCredentials
                  ? "Managed securely by the backend"
                  : camera.rtsp_url || "webrtc://local-device/webcam"}
              </code>
            </div>

            {camera.latitude && camera.longitude && (
              <div className="footer-meta-item">
                <span>GIS Coordinates</span>
                <strong>
                  {Number(camera.latitude).toFixed(4)}, {Number(camera.longitude).toFixed(4)}
                </strong>
              </div>
            )}
          </div>

          {/* PTZ & TOOL CONTROLS */}
          <div className="cctv-controls-deck">
            <button
              type="button"
              className="cctv-tool-btn"
              onClick={takeSnapshot}
              title="Capture Frame Snapshot"
            >
              <Camera size={15} />
              <span>Snapshot</span>
            </button>

            {/* PTZ JOYSTICK CONTROLS */}
            <div className="ptz-joystick-box">
              <span className="ptz-label">PTZ Control</span>

              <div className="ptz-pad">
                <button
                  type="button"
                  className="ptz-btn up"
                  onClick={() => triggerPtz("TILT UP +5°")}
                  title="Tilt Up"
                >
                  <ArrowUp size={14} />
                </button>
                <div className="ptz-mid-row">
                  <button
                    type="button"
                    className="ptz-btn left"
                    onClick={() => triggerPtz("PAN LEFT -10°")}
                    title="Pan Left"
                  >
                    <ArrowLeft size={14} />
                  </button>
                  <button
                    type="button"
                    className="ptz-btn center"
                    onClick={() => triggerPtz("HOME POSITION")}
                    title="Center / Home"
                  >
                    <RotateCcw size={12} />
                  </button>
                  <button
                    type="button"
                    className="ptz-btn right"
                    onClick={() => triggerPtz("PAN RIGHT +10°")}
                    title="Pan Right"
                  >
                    <ArrowRight size={14} />
                  </button>
                </div>
                <button
                  type="button"
                  className="ptz-btn down"
                  onClick={() => triggerPtz("TILT DOWN -5°")}
                  title="Tilt Down"
                >
                  <ArrowDown size={14} />
                </button>
              </div>

              <div className="ptz-zoom-group">
                <button
                  type="button"
                  className="zoom-btn"
                  onClick={() => triggerPtz("ZOOM IN 2X")}
                  title="Zoom In"
                >
                  <ZoomIn size={13} />
                </button>
                <button
                  type="button"
                  className="zoom-btn"
                  onClick={() => triggerPtz("ZOOM OUT 1X")}
                  title="Zoom Out"
                >
                  <ZoomOut size={13} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
