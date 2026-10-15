import { useState, useEffect, useRef } from "react";
import {
  Search,
  AlertTriangle,
  CheckCircle2,
  Camera,
  Play,
  Square,
  RotateCw,
  Sliders,
  Car,
  Truck,
  Bike,
  Activity,
  Zap,
  Radio,
  FileSpreadsheet,
  Upload,
  Crosshair,
  X,
  Eye,
  Trash2,
  Maximize2,
  Volume2,
  VolumeX,
  Plus,
  AlertOctagon,
  MapPin,
  Compass,
  Wifi,
  KeyRound
} from "lucide-react";
import "./AnprRadar.css";
import { apiFetch, apiUrl } from "../utils/apiConfig";

// Synthesizes a high-urgency alternating police siren sound via Web Audio API
function playSirenSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    if (ctx.state === "suspended") {
      ctx.resume();
    }
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    gain.gain.setValueAtTime(0.18, ctx.currentTime);

    const now = ctx.currentTime;
    osc.frequency.setValueAtTime(650, now);
    osc.frequency.linearRampToValueAtTime(950, now + 0.25);
    osc.frequency.linearRampToValueAtTime(650, now + 0.5);
    osc.frequency.linearRampToValueAtTime(950, now + 0.75);
    osc.frequency.linearRampToValueAtTime(650, now + 1.0);
    gain.gain.linearRampToValueAtTime(0.01, now + 1.25);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 1.25);
  } catch (err) {
    console.warn("AudioContext alert sound error:", err);
  }
}

function AutoRickshawIcon({ size = 15 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "inline-block", verticalAlign: "middle" }}
    >
      <circle cx="5" cy="18" r="3" />
      <circle cx="18" cy="18" r="3" />
      <path d="M5 15l2-8h8l3 5v6" />
      <path d="M7 7l4-4h4" />
      <line x1="12" y1="7" x2="12" y2="15" />
      <line x1="8" y1="18" x2="15" y2="18" />
    </svg>
  );
}

function renderVehicleBadge(vtype) {
  const typeStr = (vtype || "Car").toLowerCase();
  if (typeStr.includes("auto") || typeStr.includes("rickshaw") || typeStr.includes("3-wheeler") || typeStr.includes("three")) {
    return (
      <span className="vbadge vbadge-auto" title="Auto-Rickshaw / 3-Wheeler">
        <AutoRickshawIcon size={14} />
        <span>Auto-rickshaw / 3-wheeler</span>
      </span>
    );
  }
  if (typeStr.includes("motorcycle") || typeStr.includes("bike") || typeStr.includes("scooter")) {
    return (
      <span className="vbadge vbadge-bike" title="Motorcycle / Scooter">
        <Bike size={14} />
        <span>Motorcycle / Scooter</span>
      </span>
    );
  }
  if (typeStr.includes("bus")) {
    return (
      <span className="vbadge vbadge-bus" title="Bus / Transit">
        <Truck size={14} />
        <span>Bus</span>
      </span>
    );
  }
  if (typeStr.includes("truck")) {
    return (
      <span className="vbadge vbadge-truck" title="Commercial Truck">
        <Truck size={14} />
        <span>Truck</span>
      </span>
    );
  }
  if (typeStr.includes("van") || typeStr.includes("suv")) {
    return (
      <span className="vbadge vbadge-van" title="SUV / Van">
        <Car size={14} />
        <span>SUV / Van</span>
      </span>
    );
  }
  if (typeStr.includes("other")) {
    return (
      <span className="vbadge vbadge-other" title="Other Vehicle">
        <Car size={14} />
        <span>Other</span>
      </span>
    );
  }
  return (
    <span className="vbadge vbadge-car" title="Passenger Car">
      <Car size={14} />
      <span>Car</span>
    </span>
  );
}

export default function AnprRadar({ onNavigateToOnboarding, onTrackOnMap, initialSourceId, onClearInitialSource }) {
  // Sources & Stream State
  const [sources, setSources] = useState([]);
  const [selectedSourceId, setSelectedSourceId] = useState("demo_video");
  const [isRunning, setIsRunning] = useState(false);
  const [streamStatus, setStreamStatus] = useState("STOPPED");
  const [streamError, setStreamError] = useState("");
  const [streamUrl, setStreamUrl] = useState(() => apiUrl("/api/anpr/stream"));
  const [fps, setFps] = useState(0);
  const [showOnvifDiscovery, setShowOnvifDiscovery] = useState(false);
  const [onvifUsername, setOnvifUsername] = useState("");
  const [onvifPassword, setOnvifPassword] = useState("");
  const [onvifStreamUsername, setOnvifStreamUsername] = useState("");
  const [onvifStreamPassword, setOnvifStreamPassword] = useState("");
  const [onvifUseCredentialsForRtsp, setOnvifUseCredentialsForRtsp] = useState(true);
  const [onvifAddress, setOnvifAddress] = useState("");
  const [onvifScheme, setOnvifScheme] = useState("http");
  const [onvifPort, setOnvifPort] = useState("80");
  const [onvifNotice, setOnvifNotice] = useState(null);
  const [discoveredCameras, setDiscoveredCameras] = useState([]);
  const [cameraCredentials, setCameraCredentials] = useState({});
  const [isDiscovering, setIsDiscovering] = useState(false);

  // Search & Target Interception State
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [activeTarget, setActiveTarget] = useState(null); // { plate, status: "CATCHED"|"NOT_SEEN_YET", event?: ... }
  const [searchNotice, setSearchNotice] = useState(null); // { type: "info"|"warning"|"error", message: string }
  const [uploadedPreview, setUploadedPreview] = useState(null);

  // Watchlist / Suspect Vehicles State
  const [activeTab, setActiveTab] = useState("SEARCH"); // "SEARCH" | "WATCHLIST"
  const [watchlist, setWatchlist] = useState([]);
  const [newPlate, setNewPlate] = useState("");
  const [newReason, setNewReason] = useState("Stolen");
  const [newNotes, setNewNotes] = useState("");
  const [isAddingWatchlist, setIsAddingWatchlist] = useState(false);
  const [watchlistNotice, setWatchlistNotice] = useState(null);

  // Active Real-Time RED ALERT State
  const [activeAlert, setActiveAlert] = useState(null); // { alert_id, plate, reason, notes, camera_id, camera_name, dept_name, timestamp, crop_url, vehicle_type }
  const dismissedAlertIds = useRef(new Set());
  const [isMuted, setIsMuted] = useState(false);

  // Real Detection Logs State
  const [events, setEvents] = useState([]);
  const [logFilter, setLogFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL"); // "ALL" | "CATCHED" | "NORMAL"
  const [previewCrop, setPreviewCrop] = useState(null); // Modal crop view

  const fileInputRef = useRef(null);

  const handleOnvifDiscovery = async (deviceId = null, address = null) => {
    const credentials = deviceId ? cameraCredentials[deviceId] : null;
    const discoveredDevice = deviceId
      ? discoveredCameras.find((camera) => camera.device_id === deviceId)
      : null;
    const username = deviceId ? credentials?.username : onvifUsername;
    const password = deviceId ? credentials?.password : onvifPassword;
    const streamUsername = deviceId ? credentials?.streamUsername : onvifStreamUsername;
    const streamPassword = deviceId ? credentials?.streamPassword : onvifStreamPassword;
    const useOnvifCredentialsForRtsp = deviceId
      ? credentials?.useOnvifCredentialsForRtsp !== false
      : onvifUseCredentialsForRtsp;
    const needsOnvifCredentials = !deviceId || [
      "NEEDS_CREDENTIALS",
      "AUTHENTICATION_FAILED"
    ].includes(discoveredDevice?.status);

    if (deviceId && needsOnvifCredentials && (!username?.trim() || !password)) {
      setOnvifNotice({ type: "error", message: "Enter this camera's ONVIF username and password." });
      return;
    }
    if ((!deviceId && Boolean(username?.trim()) !== Boolean(password)) ||
        Boolean(streamUsername?.trim()) !== Boolean(streamPassword)) {
      setOnvifNotice({
        type: "error",
        message: "Enter both values for each credential pair, or leave the pair blank."
      });
      return;
    }
    if (address && (!Number.isInteger(Number(onvifPort)) ||
        Number(onvifPort) < 1 || Number(onvifPort) > 65535)) {
      setOnvifNotice({ type: "error", message: "Enter an ONVIF port from 1 to 65535." });
      return;
    }

    setIsDiscovering(true);
    setOnvifNotice(null);
    try {
      const credentialsBody = username?.trim() && password
        ? { username: username.trim(), password }
        : {};
      const streamCredentialsBody = streamUsername?.trim() && streamPassword
        ? { stream_username: streamUsername.trim(), stream_password: streamPassword }
        : {};
      const body = deviceId
        ? {
            device_id: deviceId,
            ...(discoveredDevice?.connection_address
              ? {
                  address: discoveredDevice.connection_address,
                  scheme: discoveredDevice.connection_scheme || "http",
                  port: discoveredDevice.connection_port || 80
                }
              : {}),
            ...credentialsBody,
            ...streamCredentialsBody,
            use_onvif_credentials_for_rtsp: useOnvifCredentialsForRtsp
          }
        : {
            ...credentialsBody,
            ...streamCredentialsBody,
            use_onvif_credentials_for_rtsp: useOnvifCredentialsForRtsp,
            ...(address
              ? { address, scheme: onvifScheme, port: Number(onvifPort) }
              : {})
          };
      const response = await apiFetch(apiUrl("/api/onvif/discover"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.detail || "ONVIF discovery failed.");
      }

      setDiscoveredCameras((previous) => {
        if (!deviceId && !address) return result;
        if (address) {
          const returnedIds = new Set(result.map((camera) => camera.device_id));
          return [
            ...previous.filter((camera) => !returnedIds.has(camera.device_id)),
            ...result
          ];
        }
        return previous.map((camera) =>
          camera.device_id === deviceId ? result[0] || camera : camera
        );
      });
      setOnvifNotice(
        result.length
          ? {
              type: result.some((camera) => camera.stream_ready) ? "success" : "error",
              message: deviceId
                ? result[0]?.detail || "Camera discovery finished."
                : `${result.filter((camera) => camera.stream_ready).length} of ${result.length} discovered camera(s) now have a working ONVIF RTSP profile.`
            }
          : {
              type: "info",
              code: address ? "MANUAL_DEVICE_NOT_FOUND" : "NO_DEVICES_FOUND",
              message: address
                ? "No ONVIF device responded at that IP and port. Check the address, ONVIF settings, credentials, and backend network access."
                : "No ONVIF cameras were found in the latest network scan."
            }
      );
      if (deviceId && result[0]?.stream_ready) {
        setCameraCredentials((previous) => ({
          ...previous,
          [deviceId]: {
            ...previous[deviceId],
            password: "",
            streamPassword: ""
          }
        }));
      }

      const sourcesResponse = await apiFetch(apiUrl("/api/anpr/sources"));
      if (!sourcesResponse.ok) {
        throw new Error("Cameras were discovered, but the ANPR source list could not be refreshed.");
      }
      const availableSources = await sourcesResponse.json();
      setSources(availableSources);
      const readyCamera = result.find((camera) => camera.stream_ready);
      const cameraToSelect = deviceId ? result[0] : readyCamera;
      if (cameraToSelect?.camera_code) {
        const registeredSource = availableSources.find(
          (source) => source.camera_code === cameraToSelect.camera_code
        );
        if (registeredSource) setSelectedSourceId(registeredSource.id);
      }
    } catch (err) {
      setOnvifNotice({ type: "error", message: err.message || "Unable to contact ONVIF discovery." });
    } finally {
      if (!deviceId) {
        setOnvifPassword("");
        setOnvifStreamPassword("");
      } else {
        setCameraCredentials((previous) => ({
          ...previous,
          [deviceId]: {
            ...previous[deviceId],
            password: "",
            streamPassword: ""
          }
        }));
      }
      setIsDiscovering(false);
    }
  };

  // Load Suspect Vehicles Watchlist
  const loadWatchlist = async () => {
    try {
      const res = await apiFetch(apiUrl("/api/anpr/watchlist"));
      if (res.ok) {
        const data = await res.json();
        setWatchlist(data);
      }
    } catch (err) {
      console.error("Failed to load suspect watchlist:", err);
    }
  };

  // Add Plate to Watchlist
  const handleAddWatchlist = async (e) => {
    e.preventDefault();
    const clean = newPlate.trim().toUpperCase();
    if (!clean) return;

    setIsAddingWatchlist(true);
    setWatchlistNotice(null);

    try {
      const res = await apiFetch(apiUrl("/api/anpr/watchlist"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plate_number: clean,
          reason: newReason,
          notes: newNotes.trim()
        })
      });
      const data = await res.json();
      if (res.ok) {
        setWatchlistNotice({
          type: "success",
          message: data.message || `Plate ${clean} added to suspect watchlist.`
        });
        setNewPlate("");
        setNewNotes("");
        loadWatchlist();
      } else {
        setWatchlistNotice({
          type: "error",
          message: data.detail || "Failed to add plate to watchlist."
        });
      }
    } catch (err) {
      console.error("Add watchlist error:", err);
      setWatchlistNotice({ type: "error", message: "Error contacting watchlist service." });
    } finally {
      setIsAddingWatchlist(false);
    }
  };

  // Delete Plate from Watchlist
  const handleDeleteWatchlist = async (id, plateStr) => {
    if (!window.confirm(`Remove ${plateStr || "vehicle"} from suspect watchlist?`)) return;
    try {
      const res = await apiFetch(apiUrl(`/api/anpr/watchlist/${encodeURIComponent(id)}`), { method: "DELETE" });
      if (res.ok) {
        loadWatchlist();
      }
    } catch (err) {
      console.error("Delete watchlist error:", err);
    }
  };

  // Dismiss / Acknowledge Active Red Alert
  const handleAcknowledgeAlert = async () => {
    if (activeAlert?.alert_id) {
      dismissedAlertIds.current.add(activeAlert.alert_id);
    }
    setActiveAlert(null);
    try {
      await apiFetch(apiUrl("/api/anpr/alert/acknowledge"), { method: "POST" });
    } catch (err) {
      console.warn("Acknowledge alert error:", err);
    }
  };

  // 1. Fetch available sources on mount
  useEffect(() => {
    async function loadSources() {
      try {
        const res = await apiFetch(apiUrl("/api/anpr/sources"));
        if (res.ok) {
          const data = await res.json();
          setSources(data);
          if (data.length > 0 && !selectedSourceId) {
            setSelectedSourceId(data[0].id);
          }
        }
      } catch (err) {
        console.error("Failed to fetch ANPR sources:", err);
      }
    }

    async function checkStatus() {
      try {
        const res = await apiFetch(apiUrl("/api/anpr/status"));
        if (res.ok) {
          const data = await res.json();
          setIsRunning(data.is_running);
          setStreamStatus(
            data.stream_status ||
              (data.fps > 0 ? "LIVE" : data.is_running ? "CONNECTING" : "STOPPED")
          );
          setFps(data.fps || 0);
          if (data.source_id) {
            setSelectedSourceId(data.source_id);
          }
          if (data.target_plate) {
            setActiveTarget({
              plate: data.target_plate,
              status: data.is_target_catched ? "CATCHED" : "NOT_SEEN_YET",
              event: data.catched_event
            });
          }
          if (data.active_alert && !dismissedAlertIds.current.has(data.active_alert.alert_id)) {
            setActiveAlert(data.active_alert);
          }
        }
      } catch (err) {
        console.error("Failed to check ANPR status:", err);
      }
    }

    loadSources();
    loadWatchlist();
    checkStatus();
  }, []);

  // 2. Fetch Detection Events (camera-specific)
  const loadEvents = async (camId) => {
    const targetCamId = camId !== undefined ? camId : selectedSourceId;
    try {
      const url = targetCamId
        ? `/api/anpr/events?camera_id=${encodeURIComponent(targetCamId)}&limit=100`
        : `/api/anpr/events?limit=100`;
      const res = await apiFetch(apiUrl(url));
      if (res.ok) {
        const data = await res.json();
        setEvents(data);
      }
    } catch (err) {
      console.error("Failed to fetch ANPR events:", err);
    }
  };

  // 3. Periodic Polling for Telemetry & Events when running
  useEffect(() => {
    // Initial fetch for the active camera
    loadEvents(selectedSourceId);

    let interval = null;
    if (isRunning) {
      interval = setInterval(async () => {
        try {
          const res = await apiFetch(apiUrl("/api/anpr/status"));
          if (res.ok) {
            const data = await res.json();
            setFps(data.fps || 0);
            setIsRunning(data.is_running);
            setStreamStatus(
              data.stream_status ||
                (data.fps > 0 ? "LIVE" : data.is_running ? "CONNECTING" : "STOPPED")
            );

            if (data.target_plate) {
              if (data.is_target_catched && data.catched_event) {
                setActiveTarget((prev) => ({
                  ...prev,
                  plate: data.target_plate,
                  status: "CATCHED",
                  event: data.catched_event
                }));
              }
            }

            // Real-Time Suspect Watchlist Alert
            if (data.active_alert && !dismissedAlertIds.current.has(data.active_alert.alert_id)) {
              setActiveAlert(data.active_alert);
              if (!isMuted) {
                playSirenSound();
              }
            }
          }
          loadEvents(selectedSourceId);
        } catch (err) {
          console.warn("Polling error:", err);
        }
      }, 2500);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRunning, selectedSourceId, isMuted]);

  // 4. Start / Stop Stream
  const handleToggleStream = async () => {
    if (isRunning) {
      try {
        await apiFetch(apiUrl("/api/anpr/stop"), { method: "POST" });
        setIsRunning(false);
        setStreamStatus("STOPPED");
        setStreamError("");
      } catch (err) {
        console.error("Failed to stop stream:", err);
      }
    } else {
      const curSource = sources.find((s) => s.id === selectedSourceId) || sources[0];
      try {
        const res = await apiFetch(apiUrl("/api/anpr/start"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source_type: curSource?.source_type || "DEMO_VIDEO",
            source_id: curSource?.id || "demo_video",
            source_name: curSource?.name || "Demo Highway Video",
            rtsp_url: curSource?.rtsp_url || ""
          })
        });
        if (res.ok) {
          setStreamError("");
          setIsRunning(true);
          setStreamStatus("CONNECTING");
          setStreamUrl(apiUrl(`/api/anpr/stream?t=${Date.now()}`));
          loadEvents(curSource?.id);
        } else {
          const data = await res.json();
          setStreamError(data.detail || "The stream could not be started.");
        }
      } catch (err) {
        console.error("Failed to start stream:", err);
        setStreamError("Could not reach the ANPR service. Check that the backend is running.");
      }
    }
  };

  // 5. Change Selected Source (Instant Camera Switch)
  const handleSelectSource = async (sourceId) => {
    setSelectedSourceId(sourceId);
    setStreamError("");
    setStreamStatus("CONNECTING");
    // Immediately stop displaying logs from the previously selected camera
    setEvents([]);

    const targetSource = sources.find((s) => s.id === sourceId);
    if (!targetSource) return;

    try {
      const res = await apiFetch(apiUrl("/api/anpr/start"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_type: targetSource.source_type,
          source_id: targetSource.id,
          source_name: targetSource.name,
          rtsp_url: targetSource.rtsp_url || ""
        })
      });
      if (res.ok) {
        setIsRunning(true);
        setStreamStatus("CONNECTING");
        setStreamUrl(apiUrl(`/api/anpr/stream?t=${Date.now()}`));
      } else {
        const data = await res.json();
        setStreamError(data.detail || "The selected stream could not be started.");
      }
      loadEvents(sourceId);
    } catch (err) {
      console.error("Failed to switch source:", err);
      setStreamError("Could not reach the ANPR service. Check that the backend is running.");
    }
  };

  // Auto-switch to camera when selected from Video Wall or Investigation
  useEffect(() => {
    if (initialSourceId && sources.length > 0) {
      const match = sources.find(
        (s) =>
          String(s.id).toLowerCase() === String(initialSourceId).toLowerCase() ||
          String(s.camera_code).toLowerCase() === String(initialSourceId).toLowerCase()
      );
      if (match && match.id !== selectedSourceId) {
        handleSelectSource(match.id);
        if (onClearInitialSource) onClearInitialSource();
      }
    }
  }, [initialSourceId, sources]);

  // 6. Search by Number Plate Text
  const handleSearchText = async (e) => {
    e.preventDefault();
    const clean = searchQuery.trim().toUpperCase();
    if (!clean) return;

    setIsSearching(true);
    setSearchNotice(null);

    try {
      const res = await apiFetch(apiUrl("/api/anpr/search"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plate_number: clean })
      });
      const data = await res.json();

      if (data.status === "CATCHED") {
        setActiveTarget({
          plate: clean,
          status: "CATCHED",
          event: data.event
        });
        setSearchNotice({
          type: "success",
          message: data.message || "ðŸš¨ TARGET CATCHED! Vehicle intercepted in camera logs."
        });
      } else {
        setActiveTarget({
          plate: clean,
          status: "NOT_SEEN_YET"
        });
        setSearchNotice({
          type: "info",
          message: `â„¹ï¸ Not seen yet. Target ${clean} is locked! Actively scanning video streams across cameras...`
        });
      }
      loadEvents();
    } catch (err) {
      console.error("Search error:", err);
      setSearchNotice({ type: "error", message: "Error contacting ANPR search service." });
    } finally {
      setIsSearching(false);
    }
  };

  // 7. Search by Image Upload (Vehicle / Plate Photo)
  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsSearching(true);
    setSearchNotice(null);

    // Show local preview
    const previewReader = new FileReader();
    previewReader.onload = () => setUploadedPreview(previewReader.result);
    previewReader.readAsDataURL(file);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await apiFetch(apiUrl("/api/anpr/search-image"), {
        method: "POST",
        body: formData
      });
      const data = await res.json();

      if (data.status === "NOT_RECOGNIZED") {
        setSearchNotice({
          type: "warning",
          message: "âš ï¸ Could not recognize a number plate in the uploaded image. Please try a clearer photo or enter plate text manually."
        });
      } else if (data.status === "CATCHED") {
        setActiveTarget({
          plate: data.extracted_plate || data.target_plate,
          status: "CATCHED",
          event: data.event
        });
        setSearchNotice({
          type: "success",
          message: `ðŸš¨ TARGET CATCHED! Plate recognized: ${data.extracted_plate}. Vehicle was intercepted on ${data.event?.dept_name || "Camera"}!`
        });
      } else if (data.status === "NOT_SEEN_YET") {
        setActiveTarget({
          plate: data.extracted_plate || data.target_plate,
          status: "NOT_SEEN_YET"
        });
        setSearchNotice({
          type: "info",
          message: `â„¹ï¸ Plate recognized: ${data.extracted_plate}. Status: Not seen yet. Target locked and actively scanning video streams...`
        });
      }
      loadEvents();
    } catch (err) {
      console.error("Image upload error:", err);
      setSearchNotice({ type: "error", message: "Failed to process vehicle image." });
    } finally {
      setIsSearching(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // 8. Clear Active Target Search
  const handleClearTarget = async () => {
    try {
      await apiFetch(apiUrl("/api/anpr/clear-target"), { method: "POST" });
    } catch (err) {
      console.warn("Clear target error:", err);
    }
    setActiveTarget(null);
    setSearchNotice(null);
    setSearchQuery("");
    setUploadedPreview(null);
  };

  // 9. Clear Detection Logs for Selected Camera
  const handleClearLogs = async () => {
    if (!window.confirm(`Clear detections for ${activeSource?.name || "this camera"}?`)) return;
    try {
      await apiFetch(apiUrl(`/api/anpr/events?camera_id=${encodeURIComponent(selectedSourceId)}`), { method: "DELETE" });
      setEvents([]);
    } catch (err) {
      console.error("Failed to clear logs:", err);
    }
  };

  // 10. Export Logs to CSV
  const handleExportCsv = () => {
    if (filteredEvents.length === 0) return;
    const headers = "event_id,timestamp,camera_id,camera_code,camera,vehicle_type,plate_number,confidence,status\n";
    const rows = filteredEvents
      .map(
        (e) =>
          `"${e.event_id}","${e.timestamp}","${e.camera_id || ""}","${e.camera_code || ""}","${e.dept_name || e.camera_name || ""}","${e.vehicle?.type || "Car"}","${e.plate?.number || ""}","${e.plate?.confidence || 0.9}","${e.status || "NORMAL"}"`
      )
      .join("\n");
    const blob = new Blob([headers + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `anpr_${selectedSourceId}_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Filtered Events (strictly scoped to selected camera)
  const filteredEvents = events.filter((ev) => {
    // 1. Strict camera filter
    if (selectedSourceId && ev.camera_id) {
      const isMatch =
        ev.camera_id === selectedSourceId ||
        (selectedSourceId === "demo_video" && (ev.camera_id === "demo_video" || ev.camera_id === "demo_highway"));
      if (!isMatch) return false;
    }
    // 2. Plate search filter
    const plateText = (ev.plate?.number || ev.plate?.raw_number || "").toLowerCase();
    if (logFilter && !plateText.includes(logFilter.toLowerCase())) {
      return false;
    }
    // 3. Status filter
    const isAlert = ev.is_target_catched || ev.status === "TARGET_CATCHED" || ev.is_watchlist_alert || ev.status === "WATCHLIST_ALERT";
    if (statusFilter === "CATCHED" && !isAlert) {
      return false;
    }
    if (statusFilter === "NORMAL" && isAlert) {
      return false;
    }
    return true;
  });

  const activeSource = sources.find((s) => s.id === selectedSourceId) || sources[0];

  return (
    <div className="anpr-radar-container">
      {/* 1. TOP HEADER & TELEMETRY */}
      <div className="anpr-header">
        <div className="anpr-title-group">
          <div className="anpr-badge">
            <Radio size={14} className="radar-pulse-icon" />
            <span>GUJARAT SENTINEL ANPR INTELLIGENCE</span>
          </div>
          <h2>Automated Number Plate Recognition (ANPR) & Interception</h2>
          <p>Real-time vehicle detection, HSRP optical character recognition, and suspect vehicle matching.</p>
        </div>

        {/* CONTROLS: SOURCE SELECTOR & STREAM TOGGLE */}
        <div className="anpr-quick-controls">
          <div className="select-cam-wrap">
            <Sliders size={14} className="select-icon" />
            <select
              value={selectedSourceId}
              onChange={(e) => handleSelectSource(e.target.value)}
              className="anpr-select"
            >
              <optgroup label="Core Video & Local Feeds">
                {sources.filter(s => s.source_type !== "CAMERA").map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Registered Gujarat Sentinel CCTV Grid">
                {sources.filter(s => s.source_type === "CAMERA").map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>

          <button
            type="button"
            className="anpr-action-btn onvif-discovery-toggle"
            onClick={() => setShowOnvifDiscovery((visible) => !visible)}
            aria-expanded={showOnvifDiscovery}
          >
            <Wifi size={14} />
            <span>Discover ONVIF</span>
          </button>

          <button
            type="button"
            className={`anpr-action-btn btn-scan ${isRunning ? "btn-active" : ""}`}
            onClick={handleToggleStream}
          >
            {isRunning ? (
              <>
                <Square size={14} fill="currentColor" />
                <span>Stop Stream</span>
              </>
            ) : (
              <>
                <Play size={14} fill="currentColor" />
                <span>Start Stream</span>
              </>
            )}
          </button>
        </div>
      </div>

      {(streamError || streamStatus === "OFFLINE") && (
        <div className="anpr-feed-notice" role="status">
          <div>
            <strong>{streamError ? "ANPR stream could not start" : "Camera stream is offline"}</strong>
            <span>
              {streamError ||
                "The selected camera is not sending video to the backend. Check its RTSP URL, stream port, and backend network/VPN access, then start the stream again."}
            </span>
          </div>
        </div>
      )}

      {showOnvifDiscovery && (
        <section className="onvif-discovery-panel" aria-label="ONVIF camera discovery">
          <div className="onvif-discovery-heading">
            <div>
              <h3>Network camera discovery</h3>
              <p>
                Discovery uses local network multicast: keep the camera and backend on the same
                LAN/VLAN and allow ONVIF discovery through the firewall. Remote sites need a VPN.
                The app verifies a live RTSP frame before registering a camera; ONVIF and RTSP
                credentials may differ and are encrypted on the backend.
              </p>
              <ol className="onvif-setup-steps">
                <li>Camera/NVR: enable ONVIF and create an ONVIF user; the RTSP login may be different.</li>
                <li>Network: allow UDP 3702 discovery and the camera&apos;s ONVIF/RTSP TCP ports from the backend.</li>
                <li>Scan this LAN, or use the private IP, protocol, and ONVIF port below for a routed/VPN camera.</li>
                <li>ANPR READY confirms a live RTSP frame; the camera is registered and selected as the ANPR source.</li>
              </ol>
            </div>
            <button
              type="button"
              className="onvif-scan-button"
              onClick={() => handleOnvifDiscovery()}
              disabled={isDiscovering}
            >
              <RotateCw size={15} className={isDiscovering ? "onvif-spin" : ""} />
              {isDiscovering ? "Scanning..." : "Scan network"}
            </button>
          </div>

          <div className="onvif-credentials-row">
            <label>
              <span>ONVIF username</span>
              <input
                type="text"
                autoComplete="username"
                value={onvifUsername}
                onChange={(event) => setOnvifUsername(event.target.value)}
                placeholder="Optional if cameras allow guest access"
              />
            </label>
            <label>
              <span>ONVIF password</span>
              <input
                type="password"
                autoComplete="current-password"
                value={onvifPassword}
                onChange={(event) => setOnvifPassword(event.target.value)}
                placeholder="Used to query discovered cameras"
              />
            </label>
            <label>
              <span>RTSP username (if different)</span>
              <input
                type="text"
                autoComplete="username"
                value={onvifStreamUsername}
                onChange={(event) => setOnvifStreamUsername(event.target.value)}
                placeholder="Optional; defaults to ONVIF user"
              />
            </label>
            <label>
              <span>RTSP password (if different)</span>
              <input
                type="password"
                autoComplete="current-password"
                value={onvifStreamPassword}
                onChange={(event) => setOnvifStreamPassword(event.target.value)}
                placeholder="Only needed if RTSP is separately protected"
              />
            </label>
          </div>
          <label className="onvif-rtsp-credential-toggle">
            <input
              type="checkbox"
              checked={onvifUseCredentialsForRtsp}
              onChange={(event) => setOnvifUseCredentialsForRtsp(event.target.checked)}
            />
            <span>Use ONVIF credentials for RTSP when separate RTSP credentials are not entered</span>
          </label>
          <div className="onvif-manual-connect">
            <label>
              <span>Connect by private camera IP</span>
              <input
                type="text"
                inputMode="decimal"
                value={onvifAddress}
                onChange={(event) => setOnvifAddress(event.target.value)}
                placeholder="Example: 192.168.1.50 (same LAN or reachable VPN)"
              />
            </label>
            <label>
              <span>ONVIF port</span>
              <input
                type="number"
                min="1"
                max="65535"
                value={onvifPort}
                onChange={(event) => setOnvifPort(event.target.value)}
              />
            </label>
            <label>
              <span>Protocol</span>
              <select
                value={onvifScheme}
                onChange={(event) => {
                  const nextScheme = event.target.value;
                  if (
                    (onvifScheme === "http" && onvifPort === "80") ||
                    (onvifScheme === "https" && onvifPort === "443")
                  ) {
                    setOnvifPort(nextScheme === "https" ? "443" : "80");
                  }
                  setOnvifScheme(nextScheme);
                }}
              >
                <option value="http">HTTP</option>
                <option value="https">HTTPS</option>
              </select>
            </label>
            <button
              type="button"
              className="onvif-scan-button"
              onClick={() => handleOnvifDiscovery(null, onvifAddress.trim())}
              disabled={isDiscovering || !onvifAddress.trim()}
            >
              {isDiscovering ? "Connecting..." : "Connect by IP"}
            </button>
          </div>

          {onvifNotice?.code === "NO_DEVICES_FOUND" ? (
            <div className="onvif-notice onvif-empty-state" role="status">
              <strong>No ONVIF cameras found in the latest scan</strong>
              <p>
                The scan found 0 devices, so a physical camera has not yet been verified as
                ANPR READY. This result alone does not establish whether a camera is configured
                or reachable.
              </p>
              <ol>
                <li>Enable ONVIF on the camera or NVR and obtain its ONVIF username and password.</li>
                <li>Enter those credentials above; enter separate RTSP credentials if the stream uses a different account.</li>
                <li>Make sure the backend can reach the camera. Local discovery needs the same LAN/VLAN and UDP 3702; routed cameras need a reachable private IP, with ONVIF and RTSP TCP ports allowed.</li>
                <li>Scan again, or use the private-IP connection below. ANPR READY appears only after a live RTSP frame is verified.</li>
              </ol>
            </div>
          ) : onvifNotice && (
            <p className={`onvif-notice onvif-notice-${onvifNotice.type}`} role="status">
              {onvifNotice.message}
            </p>
          )}

          {discoveredCameras.length > 0 && (
            <div className="onvif-device-list">
              {discoveredCameras.map((camera) => (
                <article className="onvif-device-card" key={camera.device_id}>
                  <div className="onvif-device-summary">
                    <div>
                      <strong>{camera.make_model || [camera.manufacturer, camera.model].filter(Boolean).join(" ") || "ONVIF camera"}</strong>
                      <span>{camera.ip_address} Â· {camera.camera_code || camera.status}</span>
                      <small>{camera.detail}</small>
                    </div>
                    <span className={`onvif-device-status ${camera.stream_ready ? "is-ready" : "needs-auth"}`}>
                      {camera.status === "ANPR_RECONNECT_FAILED"
                        ? "RECONNECT NEEDED"
                        : camera.stream_ready
                          ? "ANPR READY"
                          : camera.status.replaceAll("_", " ")}
                    </span>
                  </div>
                  {!camera.stream_ready && ["NEEDS_CREDENTIALS", "AUTHENTICATION_FAILED", "RTSP_UNAVAILABLE"].includes(camera.status) && (
                    <div className="onvif-device-auth">
                      <KeyRound size={15} />
                      {["NEEDS_CREDENTIALS", "AUTHENTICATION_FAILED"].includes(camera.status) && (
                        <>
                          <input
                            type="text"
                            aria-label={`ONVIF username for ${camera.ip_address}`}
                            autoComplete="username"
                            placeholder="ONVIF username"
                            value={cameraCredentials[camera.device_id]?.username || ""}
                            onChange={(event) =>
                              setCameraCredentials((previous) => ({
                                ...previous,
                                [camera.device_id]: {
                                  ...previous[camera.device_id],
                                  username: event.target.value
                                }
                              }))
                            }
                          />
                          <input
                            type="password"
                            aria-label={`ONVIF password for ${camera.ip_address}`}
                            autoComplete="current-password"
                            placeholder="ONVIF password"
                            value={cameraCredentials[camera.device_id]?.password || ""}
                            onChange={(event) =>
                              setCameraCredentials((previous) => ({
                                ...previous,
                                [camera.device_id]: {
                                  ...previous[camera.device_id],
                                  password: event.target.value
                                }
                              }))
                            }
                          />
                        </>
                      )}
                      <input
                        type="text"
                        aria-label={`RTSP username for ${camera.ip_address}`}
                        autoComplete="username"
                        placeholder="RTSP username (if different)"
                        value={cameraCredentials[camera.device_id]?.streamUsername || ""}
                        onChange={(event) =>
                          setCameraCredentials((previous) => ({
                            ...previous,
                            [camera.device_id]: {
                              ...previous[camera.device_id],
                              streamUsername: event.target.value
                            }
                          }))
                        }
                      />
                      <input
                        type="password"
                        aria-label={`RTSP password for ${camera.ip_address}`}
                        autoComplete="current-password"
                        placeholder="RTSP password (if different)"
                        value={cameraCredentials[camera.device_id]?.streamPassword || ""}
                        onChange={(event) =>
                          setCameraCredentials((previous) => ({
                            ...previous,
                            [camera.device_id]: {
                              ...previous[camera.device_id],
                              streamPassword: event.target.value
                            }
                          }))
                        }
                      />
                      <label className="onvif-rtsp-credential-toggle">
                        <input
                          type="checkbox"
                          checked={cameraCredentials[camera.device_id]?.useOnvifCredentialsForRtsp !== false}
                          onChange={(event) =>
                            setCameraCredentials((previous) => ({
                              ...previous,
                              [camera.device_id]: {
                                ...previous[camera.device_id],
                                useOnvifCredentialsForRtsp: event.target.checked
                              }
                            }))
                          }
                        />
                        <span>Use ONVIF credentials for RTSP if separate RTSP credentials are blank</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => handleOnvifDiscovery(camera.device_id)}
                        disabled={isDiscovering}
                      >
                        Connect camera
                      </button>
                    </div>
                  )}
                  {!camera.stream_ready && camera.status === "DEVICE_UNREACHABLE" && (
                    <div className="onvif-device-auth">
                      <button
                        type="button"
                        onClick={() => handleOnvifDiscovery(camera.device_id)}
                        disabled={isDiscovering}
                      >
                        Retry connection
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {/* 2. REAL-TIME RED ALERT BANNER: SUSPECT VEHICLE INTERCEPTED */}
      {activeAlert && (
        <div className="anpr-red-alert-banner">
          <div className="red-alert-pulse-ring">
            <AlertTriangle size={30} className="red-alert-icon" />
          </div>
          <div className="red-alert-content">
            <div className="red-alert-badge-row">
              <span className="red-alert-title-tag">ðŸš¨ RED ALERT: SUSPECT VEHICLE INTERCEPTED!</span>
              <span className={`reason-pill reason-${(activeAlert.reason || "suspect").toLowerCase()}`}>
                {activeAlert.reason?.toUpperCase() || "SUSPECT"}
              </span>
              <span className="live-intercept-pulse">LIVE INTERCEPTION</span>
            </div>

            <div className="red-alert-main-row">
              <div className="hsrp-plate-wrap hsrp-plate-alert">
                <div className="hsrp-blue-band"><span className="hsrp-ind">IND</span></div>
                <span className="hsrp-number">{activeAlert.plate}</span>
              </div>

              <div className="red-alert-details">
                <div>ðŸ“ Camera / Grid: <strong>{activeAlert.dept_name || activeAlert.camera_name || "Surveillance Grid"}</strong> <span className="alert-code-tag">[{activeAlert.camera_code || activeAlert.camera_id || "CAM"}]</span></div>
                <div>ðŸ•’ Intercepted at: <strong>{new Date(activeAlert.timestamp || Date.now()).toLocaleTimeString()}</strong></div>
                <div>ðŸš— Vehicle Class: <strong>{activeAlert.vehicle_type || "Vehicle"}</strong></div>
              </div>

              {activeAlert.crop_url && (
                <div
                  className="red-alert-crop-box"
                  onClick={() => setPreviewCrop(activeAlert.crop_url)}
                  title="Click to enlarge detected suspect crop"
                >
                  <img src={apiUrl(activeAlert.crop_url)} alt="Suspect Plate Crop" />
                  <span className="crop-tag-alert">LIVE CROP</span>
                </div>
              )}
            </div>

            {activeAlert.notes && (
              <div className="red-alert-notes">
                <strong>Suspect Profile / Notes:</strong> {activeAlert.notes}
              </div>
            )}
          </div>

          <div className="red-alert-actions">
            <button
              type="button"
              className="red-alert-ack-btn"
              onClick={handleAcknowledgeAlert}
            >
              <CheckCircle2 size={16} />
              <span>Acknowledge &amp; Dismiss Alert</span>
            </button>
          </div>
        </div>
      )}

      {/* 3. SECTION NAVIGATION TABS & SIREN CONTROLS */}
      <div className="anpr-nav-tabs-bar">
        <div className="anpr-tab-btn-group">
          <button
            type="button"
            className={`anpr-tab-btn ${activeTab === "SEARCH" ? "active" : ""}`}
            onClick={() => setActiveTab("SEARCH")}
          >
            <Crosshair size={15} />
            <span>Target Search &amp; Interception</span>
          </button>

          <button
            type="button"
            className={`anpr-tab-btn ${activeTab === "WATCHLIST" ? "active" : ""}`}
            onClick={() => setActiveTab("WATCHLIST")}
          >
            <AlertOctagon size={15} />
            <span>Watchlist / Suspect Vehicles</span>
            <span className="tab-count-badge">{watchlist.length}</span>
          </button>
        </div>

        {/* SIREN AUDIO MUTE / UNMUTE BUTTON */}
        <button
          type="button"
          className={`siren-mute-btn ${isMuted ? "muted" : "active"}`}
          onClick={() => setIsMuted(!isMuted)}
          title={isMuted ? "Click to enable audio siren on suspect detection" : "Audio siren active on suspect detection"}
        >
          {isMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
          <span>{isMuted ? "Siren Muted" : "Siren Alert Armed"}</span>
        </button>
      </div>

      {/* 4. TAB 1: DUAL-MODE TARGET SEARCH (TEXT + PHOTO) */}
      {activeTab === "SEARCH" && (
        <div className="anpr-search-card">
          <div className="search-card-header">
            <div className="search-card-header-left">
              <Crosshair size={18} className="search-header-icon" />
              <strong className="search-card-title">
                TARGET VEHICLE SEARCH &amp; INTERCEPTION
              </strong>
            </div>
            <span className="search-card-subtitle">
              Enter number plate text OR upload a car photo to lock and track.
            </span>
          </div>

          <div className="search-form-row">
            {/* TEXT SEARCH FORM */}
            <form onSubmit={handleSearchText} className="plate-search-form">
              <div className="plate-input-wrap">
                <Search size={15} className="search-icon" />
                <input
                  type="text"
                  placeholder="Enter plate number (e.g. 16J921, GJ01AB1234)..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="plate-search-input"
                />
              </div>
              <button
                type="submit"
                disabled={isSearching || !searchQuery.trim()}
                className="search-track-btn"
              >
                <Search size={14} />
                <span>{isSearching ? "Searching..." : "Search & Track"}</span>
              </button>
            </form>

            {/* DIVIDER */}
            <span className="search-divider">OR</span>

            {/* IMAGE UPLOAD BUTTON */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={handleImageUpload}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isSearching}
              className="upload-photo-btn"
            >
              <Upload size={14} />
              <span>Upload Vehicle / Plate Photo</span>
            </button>

            {/* CLEAR TARGET BUTTON IF ACTIVE */}
            {activeTarget && (
              <button
                type="button"
                onClick={handleClearTarget}
                className="clear-target-btn"
              >
                <X size={13} />
                <span>Clear Target</span>
              </button>
            )}
          </div>

          {/* SEARCH NOTIFICATION BANNER */}
          {searchNotice && (
            <div
              style={{
                marginTop: "12px",
                padding: "10px 14px",
                borderRadius: "8px",
                fontSize: "13px",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: "10px",
                background:
                  searchNotice.type === "success"
                    ? "rgba(16, 185, 129, 0.15)"
                    : searchNotice.type === "warning"
                    ? "rgba(234, 179, 8, 0.15)"
                    : searchNotice.type === "error"
                    ? "rgba(239, 68, 68, 0.15)"
                    : "rgba(56, 189, 248, 0.15)",
                border:
                  searchNotice.type === "success"
                    ? "1px solid rgba(16, 185, 129, 0.4)"
                    : searchNotice.type === "warning"
                    ? "1px solid rgba(234, 179, 8, 0.4)"
                    : searchNotice.type === "error"
                    ? "1px solid rgba(239, 68, 68, 0.4)"
                    : "1px solid rgba(56, 189, 248, 0.4)",
                color:
                  searchNotice.type === "success"
                    ? "#34d399"
                    : searchNotice.type === "warning"
                    ? "#facc15"
                    : searchNotice.type === "error"
                    ? "#f87171"
                    : "#38bdf8"
              }}
            >
              {searchNotice.type === "success" ? (
                <CheckCircle2 size={16} />
              ) : searchNotice.type === "warning" ? (
                <AlertTriangle size={16} />
              ) : (
                <Activity size={16} />
              )}
              <span>{searchNotice.message}</span>
            </div>
          )}
        </div>
      )}

      {/* 5. TAB 2: SUSPECT VEHICLE WATCHLIST MANAGEMENT */}
      {activeTab === "WATCHLIST" && (
        <div className="anpr-watchlist-card">
          <div className="search-card-header">
            <div className="search-card-header-left">
              <AlertOctagon size={18} className="search-header-icon" style={{ color: "#ef4444" }} />
              <strong className="search-card-title">
                SUSPECT VEHICLE WATCHLIST &amp; HOTLIST
              </strong>
            </div>
            <span className="search-card-subtitle">
              Register stolen, wanted, or suspect vehicle plates for automated real-time alerts.
            </span>
          </div>

          {/* ADD SUSPECT VEHICLE FORM */}
          <form onSubmit={handleAddWatchlist} className="watchlist-add-form">
            <div className="watchlist-form-inputs">
              <div className="plate-input-wrap watchlist-input-plate">
                <input
                  type="text"
                  placeholder="Plate number (e.g. GJ01AB1234, GJ22H4546)..."
                  value={newPlate}
                  onChange={(e) => setNewPlate(e.target.value)}
                  className="plate-search-input"
                  required
                />
              </div>

              <div className="watchlist-select-wrap">
                <select
                  value={newReason}
                  onChange={(e) => setNewReason(e.target.value)}
                  className="watchlist-reason-select"
                >
                  <option value="Stolen">ðŸš¨ Stolen</option>
                  <option value="Wanted">âš ï¸ Wanted</option>
                  <option value="Suspect">ðŸ‘ï¸ Suspect</option>
                  <option value="Other">ðŸ“‹ Other</option>
                </select>
              </div>

              <div className="plate-input-wrap watchlist-input-notes">
                <input
                  type="text"
                  placeholder="Optional Notes / Reason (e.g. White Scorpio stolen from Navrangpura)..."
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  className="plate-search-input"
                />
              </div>

              <button
                type="submit"
                disabled={isAddingWatchlist || !newPlate.trim()}
                className="watchlist-add-btn"
              >
                <Plus size={15} />
                <span>{isAddingWatchlist ? "Adding..." : "Add to Watchlist"}</span>
              </button>
            </div>
          </form>

          {/* WATCHLIST NOTICE */}
          {watchlistNotice && (
            <div className={`watchlist-notice-banner notice-${watchlistNotice.type}`}>
              {watchlistNotice.type === "success" ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
              <span>{watchlistNotice.message}</span>
            </div>
          )}

          {/* WATCHLIST TABLE */}
          <div className="watchlist-table-scroll">
            <table className="watchlist-table">
              <thead>
                <tr>
                  <th>Suspect Plate</th>
                  <th>Reason</th>
                  <th>Notes / Investigation Details</th>
                  <th>Date Added</th>
                  <th style={{ textAlign: "right" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {watchlist.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="hsrp-plate-wrap hsrp-plate-sm">
                        <div className="hsrp-blue-band"><span className="hsrp-ind">IND</span></div>
                        <span className="hsrp-number">{item.formatted_plate || item.plate_number}</span>
                      </div>
                    </td>
                    <td>
                      <span className={`reason-pill reason-${(item.reason || "suspect").toLowerCase()}`}>
                        {item.reason}
                      </span>
                    </td>
                    <td className="watchlist-notes-cell">
                      {item.notes || item.description || <span className="no-notes">â€”</span>}
                    </td>
                    <td className="watchlist-date-cell">
                      {item.created_at ? new Date(item.created_at).toLocaleDateString() : "â€”"}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: "6px", alignItems: "center" }}>
                        <button
                          type="button"
                          className="watchlist-track-btn"
                          onClick={() => onTrackOnMap && onTrackOnMap(item.formatted_plate || item.plate_number)}
                          title="Track route of this suspect vehicle on GIS Map"
                        >
                          <MapPin size={12} />
                          <span>Track</span>
                        </button>
                        <button
                          type="button"
                          className="watchlist-del-btn"
                          onClick={() => handleDeleteWatchlist(item.id, item.formatted_plate || item.plate_number)}
                          title="Remove from suspect watchlist"
                        >
                          <Trash2 size={13} />
                          <span>Remove</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}

                {watchlist.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", padding: "24px", color: "#94a3b8" }}>
                      No suspect vehicles in watchlist. Add a license plate above to activate automated alerting.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3. TARGET STATUS BANNER: "CATCHED" vs "NOT SEEN YET" */}
      {activeTarget && (
        activeTarget.status === "CATCHED" ? (
          /* CATCHED BANNER */
          <div className="anpr-target-intercepted-banner">
            <div className="intercept-icon-wrap" style={{ background: "#ef4444" }}>
              <AlertTriangle size={24} />
            </div>
            <div className="intercept-content">
              <h4 style={{ color: "#fee2e2" }}>ðŸš¨ TARGET VEHICLE CATCHED!</h4>
              <p>
                Suspect vehicle matching target plate{" "}
                <span className="highlight-plate">{activeTarget.plate}</span> was intercepted on the surveillance grid!
              </p>
              <div className="intercept-meta-row">
                <span>ðŸ“ Camera: <strong>{activeTarget.event?.dept_name || activeTarget.event?.camera_name || "Surveillance Grid"}</strong></span>
                <span>ðŸ•’ Intercepted at: <strong>{new Date(activeTarget.event?.timestamp || Date.now()).toLocaleTimeString()}</strong></span>
                <span>ðŸš— Vehicle Class: <strong>{activeTarget.event?.vehicle?.type || "Car"}</strong></span>
                {activeTarget.event?.crop_url && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                    ðŸ“· Plate Snapshot:
                    <img
                      src={apiUrl(activeTarget.event.crop_url)}
                      alt="Crop"
                      style={{ height: "24px", borderRadius: "3px", border: "1px solid #10b981", verticalAlign: "middle", cursor: "pointer" }}
                      onClick={() => setPreviewCrop(activeTarget.event.crop_url)}
                    />
                  </span>
                )}
              </div>
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <button
                type="button"
                className="intercept-route-btn"
                onClick={() => onTrackOnMap && onTrackOnMap(activeTarget.plate)}
                title="Plot breadcrumb trail and travel checkpoints on GIS Map"
              >
                <Compass size={14} />
                <span>Track on Map</span>
              </button>
              <button
                type="button"
                className="intercept-ack-btn"
                onClick={handleClearTarget}
              >
                Dismiss Alert
              </button>
            </div>
          </div>
        ) : (
          /* NOT SEEN YET BANNER */
          <div className="anpr-target-hunt-bar">
            <div className="hunt-left">
              <div className="hunt-badge">
                <Crosshair size={13} />
                <span>SEARCH TARGET ACTIVE</span>
              </div>
              <div className="hunt-plate">
                <span className="hunt-ind">IND</span>
                <strong>{activeTarget.plate}</strong>
              </div>
              <div className="hunt-status status-hunting">
                <span className="pulsar-dot"></span>
                <span>Status: <strong>Not seen yet</strong> &bull; Actively scanning video stream...</span>
              </div>
            </div>
            <button
              type="button"
              className="clear-target-btn"
              onClick={handleClearTarget}
            >
              <X size={13} />
              <span>Cancel Search</span>
            </button>
          </div>
        )
      )}

      {/* 4. MAIN WORKSPACE: LEFT LIVE STREAM + RIGHT DETECTION LOGS */}
      <div className="anpr-main-grid">
        {/* LEFT: LIVE MJPEG STREAM */}
        <div className="anpr-video-card">
          <div className="video-card-header">
            <div className="cam-title-info">
              <Camera size={16} className="cam-icon" />
              <div>
                <strong className="cam-name">{activeSource?.name || "Active Source"}</strong>
                <span className="cam-loc-tag">{activeSource?.location || "Gujarat Surveillance"}</span>
              </div>
            </div>

            <div className="stream-badge-group">
              <span className={`live-feed-pill ${streamStatus === "LIVE" ? "status-online" : "status-offline"}`}>
                <span className="live-dot"></span>
                {streamStatus === "LIVE"
                  ? "LIVE AI INFERENCE"
                  : streamStatus === "OFFLINE"
                    ? "CAMERA OFFLINE"
                    : streamStatus === "CONNECTING"
                      ? "CONNECTING"
                      : "STREAM PAUSED"}
              </span>
              {isRunning && <span className="fps-counter">{fps} FPS</span>}
            </div>
          </div>

          <div className="video-screen-wrapper">
            {isRunning ? (
              <img
                crossOrigin="use-credentials"
                src={streamUrl}
                alt="Live ANPR Stream"
                className="anpr-video-element"
                style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                onError={() => {
                  console.warn("MJPEG stream disconnected, retrying connection...");
                  setTimeout(() => {
                    setStreamUrl(apiUrl(`/api/anpr/stream?t=${Date.now()}`));
                  }, 2000);
                }}
              />
            ) : (
              <div className="stream-offline-overlay">
                <Camera size={44} className="offline-cam-icon" />
                <p>AI STREAM PAUSED</p>
                <span>Select source and click &quot;Start Stream&quot; to begin real-time vehicle and plate tracking</span>
                <button
                  type="button"
                  className="anpr-action-btn btn-scan"
                  style={{ marginTop: "14px" }}
                  onClick={handleToggleStream}
                >
                  <Play size={14} fill="currentColor" />
                  <span>Start Stream</span>
                </button>
              </div>
            )}

            {/* RADAR TARGETING RETICLE OVERLAY WHEN SEARCHING */}
            {activeTarget && activeTarget.status === "NOT_SEEN_YET" && isRunning && (
              <div className="anpr-target-scanner-crosshair">
                <div className="reticle-line-scan"></div>
                <div className="reticle-text">
                  <Crosshair size={12} />
                  <span>FINDING: {activeTarget.plate}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: REAL-TIME DETECTION LOG TABLE */}
        <div className="anpr-log-card">
          <div className="log-card-header">
            <div className="log-header-left">
              <Activity size={16} />
              <h4>Live Vehicle Detection Logs</h4>
              <span className="log-count">{filteredEvents.length} passed vehicles</span>
            </div>

            <div style={{ display: "flex", gap: "8px" }}>
              {events.length > 0 && (
                <button
                  type="button"
                  className="export-log-btn"
                  onClick={handleClearLogs}
                  title="Clear history"
                  style={{ color: "#f87171" }}
                >
                  <Trash2 size={13} />
                  <span>Clear</span>
                </button>
              )}

              <button
                type="button"
                className="export-log-btn"
                onClick={handleExportCsv}
                title="Download CSV"
              >
                <FileSpreadsheet size={13} />
                <span>Export CSV</span>
              </button>
            </div>
          </div>

          {/* SEARCH & FILTER BAR */}
          <div className="anpr-search-bar">
            <div className="search-input-wrap">
              <Search size={14} className="search-icon" />
              <input
                type="text"
                placeholder="Filter passed cars by plate..."
                value={logFilter}
                onChange={(e) => setLogFilter(e.target.value)}
              />
            </div>

            <div className="filter-pill-group">
              <button
                type="button"
                className={`filter-pill ${statusFilter === "ALL" ? "active" : ""}`}
                onClick={() => setStatusFilter("ALL")}
              >
                All
              </button>
              <button
                type="button"
                className={`filter-pill ${statusFilter === "CATCHED" ? "active" : ""}`}
                onClick={() => setStatusFilter("CATCHED")}
              >
                Catched
              </button>
              <button
                type="button"
                className={`filter-pill ${statusFilter === "NORMAL" ? "active" : ""}`}
                onClick={() => setStatusFilter("NORMAL")}
              >
                Normal
              </button>
            </div>
          </div>

          {/* EVENT TABLE */}
          <div className="anpr-table-scroll">
            <table className="anpr-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Captured Plate (Crop & HSRP)</th>
                  <th>Vehicle Class</th>
                  <th>Location / Camera</th>
                  <th>Status</th>
                  <th style={{ textAlign: "center" }}>Route</th>
                </tr>
              </thead>
              <tbody>
                {filteredEvents.map((log) => {
                  const isCatched = log.is_target_catched || log.status === "TARGET_CATCHED";
                  const isWatchlistAlert = log.is_watchlist_alert || log.status === "WATCHLIST_ALERT";
                  const isAlert = isCatched || isWatchlistAlert;
                  return (
                    <tr
                      key={log.event_id}
                      className={
                        isWatchlistAlert
                          ? "row-alert row-watchlist-hit"
                          : isCatched
                          ? "row-alert row-target-intercepted"
                          : ""
                      }
                    >
                      <td className="time-cell">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </td>

                      {/* PHYSICAL CAPTURED PLATE CROP + HSRP NUMBER */}
                      <td>
                        <div className="plate-showcase-cell">
                          {log.crop_url ? (
                            <div
                              className="plate-crop-preview-box"
                              onClick={() => setPreviewCrop(log.crop_url)}
                              title="Physical plate crop from camera - Click to enlarge"
                            >
                              <img
                                src={apiUrl(log.crop_url)}
                                alt={log.plate?.number}
                                className="plate-crop-img"
                              />
                              <span className="crop-tag">LIVE CROP</span>
                            </div>
                          ) : null}

                          <div className="hsrp-plate-wrap">
                            <div className="hsrp-blue-band">
                              <span className="hsrp-ind">IND</span>
                            </div>
                            <span className="hsrp-number">
                              {log.plate?.number || log.plate?.raw_number}
                            </span>
                          </div>

                          {typeof log.plate?.confidence === "number" && log.plate.confidence > 0 && !log.plate?.number?.startsWith("IN-TRANSIT") && (
                            <span
                              className={`ocr-conf-badge ${
                                (log.plate.confidence <= 1 ? log.plate.confidence * 100 : log.plate.confidence) >= 70
                                  ? "conf-high"
                                  : (log.plate.confidence <= 1 ? log.plate.confidence * 100 : log.plate.confidence) >= 40
                                  ? "conf-med"
                                  : "conf-low"
                              }`}
                              title={`Optical Character Recognition Confidence: ${Math.round(log.plate.confidence <= 1 ? log.plate.confidence * 100 : log.plate.confidence)}%`}
                            >
                              {Math.round(log.plate.confidence <= 1 ? log.plate.confidence * 100 : log.plate.confidence)}%
                            </span>
                          )}
                        </div>
                      </td>

                      {/* INTELLIGENT VEHICLE CLASSIFICATION */}
                      <td>
                        {renderVehicleBadge(log.vehicle?.type)}
                      </td>

                      <td>
                        <div className="location-cell">
                          <span className="location-name">
                            {log.dept_name || log.camera_name || log.camera_id}
                          </span>
                          <span className="camera-code-tag">
                            ðŸ“· {log.camera_code || "CAM"}
                          </span>
                        </div>
                      </td>

                      <td>
                        <span
                          className={`status-pill ${
                            isWatchlistAlert
                              ? "status-watchlist-alert"
                              : isCatched
                              ? "status-target"
                              : "status-normal"
                          }`}
                        >
                          {isWatchlistAlert
                            ? `ðŸš¨ ${log.watchlist_match?.reason?.toUpperCase() || "SUSPECT"}`
                            : isCatched
                            ? "ðŸŽ¯ CATCHED"
                            : "PASSED"}
                        </span>
                      </td>

                      {/* ROUTE TRACKING ACTION */}
                      <td style={{ textAlign: "center" }}>
                        <button
                          type="button"
                          className="track-map-btn"
                          title="Track vehicle route & checkpoints on GIS Map"
                          onClick={() => onTrackOnMap && onTrackOnMap(log.plate?.number || log.plate?.raw_number)}
                        >
                          <MapPin size={12} />
                          <span>Route</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}

                {filteredEvents.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center", padding: "40px 20px", color: "#94a3b8" }}>
                      <Camera size={28} style={{ margin: "0 auto 10px", opacity: 0.4, display: "block" }} />
                      <p style={{ margin: 0, fontWeight: 600 }}>No vehicle detections yet.</p>
                      <span style={{ fontSize: "11px", color: "#64748b" }}>
                        {isRunning
                          ? `Actively monitoring ${activeSource?.name || "selected camera"}. Detections will appear here in real-time.`
                          : `Start stream to monitor ${activeSource?.name || "selected camera"} for passing vehicles.`}
                      </span>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 5. CROP PREVIEW MODAL */}
      {previewCrop && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            background: "rgba(0, 0, 0, 0.8)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999
          }}
          onClick={() => setPreviewCrop(null)}
        >
          <div
            style={{
              background: "#0f172a",
              padding: "20px",
              borderRadius: "12px",
              border: "1px solid #334155",
              maxWidth: "500px",
              textAlign: "center"
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
              <h4 style={{ margin: 0, color: "#f8fafc" }}>Captured Plate Snapshot</h4>
              <button
                type="button"
                onClick={() => setPreviewCrop(null)}
                style={{ background: "transparent", border: "none", color: "#94a3b8", cursor: "pointer" }}
              >
                <X size={18} />
              </button>
            </div>
            <img
              src={apiUrl(previewCrop)}
              alt="Plate Crop"
              style={{ width: "100%", maxHeight: "300px", objectFit: "contain", borderRadius: "8px", border: "2px solid #0284c7" }}
            />
            <p style={{ margin: "12px 0 0", fontSize: "12px", color: "#94a3b8" }}>
              High-resolution optical crop verified by YOLOv8-plate and EasyOCR.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
