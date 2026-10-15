import { useEffect, useRef, useState, useMemo } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Layers,
  RefreshCw,
  Search,
  Radio,
  Crosshair,
  Compass,
  AlertTriangle,
  Video,
  Plus,
  Play,
  Trash2,
  UploadCloud,
  MapPin,
  Navigation,
  Milestone,
  X,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Car
} from "lucide-react";
import CameraFeedModal from "./CameraFeedModal";
import { apiFetch, apiUrl } from "../utils/apiConfig";

// Fix default Leaflet icon paths in Vite
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// Custom colored SVG pin markers for CCTV cameras
const createCustomMarkerIcon = (status) => {
  const colorMap = {
    ONLINE: { bg: "#10b981", border: "#065f46", text: "ON" },
    OFFLINE: { bg: "#ef4444", border: "#991b1b", text: "OFF" },
    MAINTENANCE: { bg: "#f59e0b", border: "#92400e", text: "MNT" },
  };

  const c = colorMap[status] || colorMap.OFFLINE;

  return L.divIcon({
    className: "custom-gis-pin",
    html: `
      <div style="
        position: relative;
        width: 34px;
        height: 34px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: ${c.bg};
        border: 2px solid #ffffff;
        border-radius: 50%;
        box-shadow: 0 4px 10px rgba(0,0,0,0.35);
        color: white;
        font-weight: 800;
        font-size: 10px;
        cursor: pointer;
      ">
        <span style="letter-spacing: -0.5px;">${c.text}</span>
        ${status === "ONLINE" ? `<span style="position: absolute; width: 100%; height: 100%; border-radius: 50%; border: 2px solid ${c.bg}; opacity: 0.7; animation: radarPing 1.8s infinite ease-out;"></span>` : ""}
      </div>
    `,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -18],
  });
};

// Chronological breadcrumb trail marker pins (1, 2, 3... or ðŸ“)
const createBreadcrumbMarkerIcon = (point, isFirst, isLast, isSingle) => {
  let bg = "#0284c7"; // Transit checkpoint blue
  let label = String(point.order || 1);
  let pulse = "";

  if (isSingle) {
    bg = "#10b981"; // Emerald green
    label = "ðŸ“";
  } else if (isFirst) {
    bg = "#10b981"; // Origin green
    label = "1";
  } else if (isLast) {
    bg = "#ef4444"; // Latest position crimson
    pulse = `<span style="position: absolute; width: 100%; height: 100%; border-radius: 50%; border: 3px solid #ef4444; opacity: 0.85; animation: radarPing 1.5s infinite ease-out;"></span>`;
  }

  return L.divIcon({
    className: "custom-breadcrumb-pin",
    html: `
      <div style="
        position: relative;
        width: 38px;
        height: 38px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: ${bg};
        border: 3px solid #ffffff;
        border-radius: 50%;
        box-shadow: 0 4px 14px rgba(0,0,0,0.45);
        color: white;
        font-weight: 900;
        font-size: ${isSingle ? "16px" : "13px"};
        cursor: pointer;
        transition: transform 0.15s ease;
      ">
        <span>${label}</span>
        ${pulse}
      </div>
    `,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
    popupAnchor: [0, -20],
  });
};

// Checkpoint Popup Content
const createCheckpointPopupHtml = (point, route) => {
  const isSingle = !route.points || route.points.length <= 1;
  const isFirst = point.order === 1;
  const isLast = route.points && point.order === route.points.length;
  const stage = isSingle
    ? { text: "SINGLE DETECTION", bg: "#dcfce7", color: "#15803d" }
    : isFirst
    ? { text: "ORIGIN (STOP 1)", bg: "#dcfce7", color: "#15803d" }
    : isLast
    ? { text: `LATEST (STOP ${point.order})`, bg: "#fee2e2", color: "#b91c1c" }
    : { text: `TRANSIT (STOP ${point.order})`, bg: "#e0f2fe", color: "#0369a1" };

  const timeFormatted = point.timestamp
    ? new Date(point.timestamp).toLocaleString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        month: "short",
        day: "numeric",
      })
    : "N/A";

  return `
    <div style="font-family: inherit; font-size: 13px; line-height: 1.4; min-width: 250px; padding: 4px;">
      <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-bottom: 8px;">
        <span style="
          padding: 2px 8px;
          border-radius: 999px;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.5px;
          background: ${stage.bg};
          color: ${stage.color};
        ">${stage.text}</span>
        <span style="font-size: 11px; color: #64748b; font-weight: 600;">
          ${timeFormatted}
        </span>
      </div>

      <!-- HSRP PLATE NUMBER -->
      <div style="margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between;">
        <div style="
          display: inline-flex;
          align-items: center;
          background: #ffffff;
          border: 2px solid #0f172a;
          border-radius: 4px;
          overflow: hidden;
          font-family: monospace;
          font-weight: 900;
          letter-spacing: 1px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        ">
          <span style="background: #1e3a8a; color: #fff; font-size: 9px; padding: 2px 4px;">IND</span>
          <span style="padding: 2px 8px; font-size: 13px; color: #0f172a;">${point.plate_number || route.plate_number}</span>
        </div>
        ${point.is_watchlist ? '<span style="background: #fee2e2; color: #dc2626; font-size: 10px; font-weight: 800; padding: 2px 6px; border-radius: 4px; border: 1px solid #f87171;">ðŸš¨ SUSPECT</span>' : ''}
      </div>

      <!-- VEHICLE CLASS -->
      <div style="margin-bottom: 6px;">
        <span style="color: #64748b; font-size: 11px;">Vehicle Class:</span><br/>
        <strong style="color: #0f172a; font-size: 13px;">${point.vehicle_type || route.vehicle_type || "Vehicle"}</strong>
      </div>

      <!-- CAMERA INFO -->
      <div style="margin-bottom: 6px;">
        <span style="color: #64748b; font-size: 11px;">Surveillance Camera:</span><br/>
        <strong style="color: #0f172a;">${point.camera_code || point.camera_id}</strong> &bull; <span style="font-size: 12px; color: #475569;">${point.camera_name || "CCTV Unit"}</span>
      </div>

      <!-- LOCATION -->
      <div style="margin-bottom: 6px;">
        <span style="color: #64748b; font-size: 11px;">Location:</span><br/>
        <span style="color: #0f172a; font-weight: 600;">ðŸ“ ${point.location_name || `${point.latitude.toFixed(4)}, ${point.longitude.toFixed(4)}`}</span>
      </div>

      ${point.distance_from_prev_km ? `
        <div style="margin-top: 6px; padding: 4px 8px; background: #f0fdf4; border-radius: 6px; border: 1px solid #bbf7d0; font-size: 11px; color: #166534; font-weight: 600;">
          +${point.distance_from_prev_km} km from previous checkpoint
        </div>
      ` : ''}

      ${point.crop_url ? `
        <div style="margin-top: 8px;">
          <img crossorigin="use-credentials" src="${point.crop_url}" alt="Plate Crop" style="width: 100%; max-height: 48px; object-fit: contain; border-radius: 4px; border: 1px solid #cbd5e1; background: #000;" />
        </div>
      ` : ''}
    </div>
  `;
};

// Calculate distance between two coordinates in km (Haversine formula)
function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export default function GisMap({
  onSwitchToOnboarding,
  onSwitchToBulkCsv,
  initialTrackPlate,
  onClearTrackPlate
}) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersLayerRef = useRef(null);
  const routesLayerRef = useRef(null);
  const proximityCircleRef = useRef(null);
  const proximityMarkerRef = useRef(null);

  const [cameras, setCameras] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Route Tracking & Breadcrumb Trail State
  const [routeTrackingActive, setRouteTrackingActive] = useState(Boolean(initialTrackPlate));
  const [trackedRoutes, setTrackedRoutes] = useState([]);
  const [selectedRoutePlate, setSelectedRoutePlate] = useState(initialTrackPlate || "");
  const [routesLoading, setRoutesLoading] = useState(false);

  // Left-Side Panels Collapse State
  const [liveFeedsCollapsed, setLiveFeedsCollapsed] = useState(false);
  const [routeHudCollapsed, setRouteHudCollapsed] = useState(false);

  // Auto-collapse live feeds when entering route tracking to avoid overlapping
  useEffect(() => {
    if (routeTrackingActive) {
      setLiveFeedsCollapsed(true);
      setRouteHudCollapsed(false);
    }
  }, [routeTrackingActive]);

  // Live Camera Feed Modal state
  const [activeFeedCamera, setActiveFeedCamera] = useState(null);

  // Camera Removal / Deletion State
  const [cameraToDelete, setCameraToDelete] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteSuccessMsg, setDeleteSuccessMsg] = useState("");

  // Confirm and execute camera deletion
  const confirmDeleteCamera = async () => {
    if (!cameraToDelete) return;
    setDeleteLoading(true);
    try {
      const targetId = cameraToDelete.id || cameraToDelete.code;
      const res = await apiFetch(apiUrl(`/api/cameras/${encodeURIComponent(targetId)}`), {
        method: "DELETE",
      });

      if (res.ok) {
        setCameras((prev) =>
          prev.filter((c) => {
            const p = c.properties || {};
            return (
              p.id !== cameraToDelete.id &&
              p.camera_code !== cameraToDelete.id &&
              p.camera_code !== cameraToDelete.code
            );
          })
        );
        if (mapInstanceRef.current) {
          mapInstanceRef.current.closePopup();
        }
        setDeleteSuccessMsg(`Camera ${cameraToDelete.code} successfully removed.`);
        setTimeout(() => setDeleteSuccessMsg(""), 4000);
        setCameraToDelete(null);
      } else {
        const data = await res.json().catch(() => ({}));
        alert(`Failed to remove camera: ${data.detail || "Server error"}`);
      }
    } catch {
      alert("Error communicating with server to remove camera.");
    } finally {
      setDeleteLoading(false);
    }
  };

  // Sentinel Grid 1-Click Sync
  const [syncingSentinel, setSyncingSentinel] = useState(false);

  const handleQuickSyncSentinel = async () => {
    setSyncingSentinel(true);
    try {
      const res = await apiFetch(apiUrl("/api/cameras/sync-sentinel"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gateway_url: "http://103.250.160.189" })
      });
      if (res.ok) {
        const data = await res.json();
        setDeleteSuccessMsg(`Synced ${data.synced_count} cameras from Sentinel Catalogue (${data.codecs_summary?.H264 || 0} H.264, ${data.codecs_summary?.H265 || 0} H.265)`);
        setTimeout(() => setDeleteSuccessMsg(""), 4500);
        await refreshData();
      }
    } catch {
      alert("Failed to connect to Sentinel gateway.");
    } finally {
      setSyncingSentinel(false);
    }
  };

  // Filters
  const [selectedDept, setSelectedDept] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  // Proximity Search State
  const [proximityActive, setProximityActive] = useState(false);
  const [radiusKm, setRadiusKm] = useState(15);
  const [proximityCenter, setProximityCenter] = useState(null);

  // 1. Fetch Cameras GeoJSON & Departments
  useEffect(() => {
    let isCancelled = false;

    async function loadData() {
      setLoading(true);
      setError("");
      try {
        const [camsRes, deptsRes] = await Promise.all([
          apiFetch(apiUrl("/api/cameras")),
          apiFetch(apiUrl("/api/departments")),
        ]);

        if (!isCancelled) {
          if (camsRes.ok) {
            const geojson = await camsRes.json();
            const features = geojson.features || [];
            setCameras(features);
          } else {
            setError("Failed to load camera locations from backend.");
          }

          if (deptsRes.ok) {
            const depts = await deptsRes.json();
            setDepartments(depts);
          }
        }
      } catch {
        if (!isCancelled) {
          setError("Connecting to backend server... Auto-retrying in a few seconds.");
          setTimeout(() => {
            if (!isCancelled) loadData();
          }, 4000);
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    }

    loadData();

    return () => {
      isCancelled = true;
    };
  }, []);

  const refreshData = async () => {
    setLoading(true);
    setError("");
    try {
      const [camsRes, deptsRes] = await Promise.all([
        apiFetch(apiUrl("/api/cameras")),
        apiFetch(apiUrl("/api/departments")),
      ]);

      if (camsRes.ok) {
        const geojson = await camsRes.json();
        const features = geojson.features || [];
        setCameras(features);
      } else {
        setError("Failed to load camera locations from backend.");
      }

      if (deptsRes.ok) {
        const depts = await deptsRes.json();
        setDepartments(depts);
      }
    } catch {
      setError("Cannot reach backend server to load GIS map data.");
    } finally {
      setLoading(false);
    }
  };

  // Fetch Vehicle Routes & Breadcrumb Trails
  const loadRoutes = async (plateToSelect = null) => {
    setRoutesLoading(true);
    try {
      const res = await apiFetch(apiUrl("/api/anpr/routes"));
      if (res.ok) {
        const routesData = await res.json();
        setTrackedRoutes(routesData);
        if (plateToSelect) {
          const cleanTarget = plateToSelect.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
          const match = routesData.find(
            (r) =>
              r.raw_plate.toUpperCase() === cleanTarget ||
              r.plate_number.replace(/\s+/g, "").toUpperCase() === cleanTarget
          );
          if (match) {
            setSelectedRoutePlate(match.raw_plate);
          } else if (routesData.length > 0) {
            setSelectedRoutePlate(routesData[0].raw_plate);
          }
        } else if (!selectedRoutePlate && routesData.length > 0) {
          const multi = routesData.find((r) => r.points.length >= 2) || routesData[0];
          setSelectedRoutePlate(multi.raw_plate);
        }
      }
    } catch (err) {
      console.error("Failed to load vehicle routes:", err);
    } finally {
      setRoutesLoading(false);
    }
  };

  // React to initialTrackPlate prop changes
  useEffect(() => {
    if (initialTrackPlate) {
      setRouteTrackingActive(true);
      loadRoutes(initialTrackPlate);
    }
  }, [initialTrackPlate]);

  // 2. Initialize Leaflet Map (Centered on Gujarat)
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapInstanceRef.current) return;

    // Centered on Gujarat
    const map = L.map(mapContainerRef.current, {
      center: [22.8, 71.8],
      zoom: 7.5,
      minZoom: 6,
      maxZoom: 18,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> | Gujarat Sentinel GIS',
      maxZoom: 19,
    }).addTo(map);

    const markersLayer = L.layerGroup().addTo(map);
    markersLayerRef.current = markersLayer;

    const routesLayer = L.layerGroup().addTo(map);
    routesLayerRef.current = routesLayer;

    mapInstanceRef.current = map;

    // Handle "Watch Live Feed" and "Remove Camera" clicks inside Leaflet Popups
    map.on("popupopen", (e) => {
      const popupEl = e.popup.getElement();
      if (!popupEl) return;

      const feedBtn = popupEl.querySelector(".watch-feed-btn");
      if (feedBtn) {
        feedBtn.onclick = () => {
          const rawData = feedBtn.getAttribute("data-cam");
          if (rawData) {
            try {
              const camObj = JSON.parse(decodeURIComponent(rawData));
              setActiveFeedCamera(camObj);
            } catch (err) {
              console.error("Error opening feed:", err);
            }
          }
        };
      }

      const deleteBtn = popupEl.querySelector(".delete-cam-btn");
      if (deleteBtn) {
        deleteBtn.onclick = () => {
          const camId = deleteBtn.getAttribute("data-id");
          const camCode = deleteBtn.getAttribute("data-code");
          if (camId || camCode) {
            setCameraToDelete({ id: camId || camCode, code: camCode || camId });
          }
        };
      }
    });

    // Map click for Proximity Search
    map.on("click", (e) => {
      const { lat, lng } = e.latlng;
      setProximityCenter({ lat, lng });
    });

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // 3. Filtered Cameras Memo
  const filteredCameras = useMemo(() => {
    return cameras.filter((f) => {
      const p = f.properties || {};
      const status = (p.status || "").toUpperCase();
      const dept = p.dept_name || "";
      const type = (p.camera_type || "").toUpperCase();
      const code = (p.camera_code || "").toLowerCase();
      const query = searchQuery.toLowerCase().trim();

      if (selectedDept !== "ALL" && dept !== selectedDept) return false;
      if (statusFilter !== "ALL" && status !== statusFilter) return false;
      if (typeFilter !== "ALL" && type !== typeFilter) return false;
      if (
        query &&
        !code.includes(query) &&
        !dept.toLowerCase().includes(query) &&
        !(p.ip_address || "").includes(query)
      ) {
        return false;
      }

      // If proximity mode active and center chosen, filter by radius
      if (proximityActive && proximityCenter && f.geometry?.coordinates) {
        const [lng, lat] = f.geometry.coordinates;
        const dist = getDistanceFromLatLonInKm(
          proximityCenter.lat,
          proximityCenter.lng,
          lat,
          lng
        );
        if (dist > radiusKm) return false;
      }

      return true;
    });
  }, [
    cameras,
    selectedDept,
    statusFilter,
    typeFilter,
    searchQuery,
    proximityActive,
    proximityCenter,
    radiusKm,
  ]);

  // Compute nearby cameras using useMemo
  const nearbyCameras = useMemo(() => {
    if (!proximityActive || !proximityCenter) return [];

    return cameras
      .filter((f) => f.geometry?.coordinates)
      .map((f) => {
        const [lng, lat] = f.geometry.coordinates;
        const dist = getDistanceFromLatLonInKm(
          proximityCenter.lat,
          proximityCenter.lng,
          lat,
          lng
        );
        return { ...f, distanceKm: Math.round(dist * 10) / 10 };
      })
      .filter((f) => f.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);
  }, [proximityActive, proximityCenter, radiusKm, cameras]);

  // 4. Render Markers and Proximity Circle on Leaflet Map
  useEffect(() => {
    const map = mapInstanceRef.current;
    const markersLayer = markersLayerRef.current;
    if (!map || !markersLayer) return;

    markersLayer.clearLayers();

    // Render Proximity Circle
    if (proximityCircleRef.current) {
      map.removeLayer(proximityCircleRef.current);
      proximityCircleRef.current = null;
    }
    if (proximityMarkerRef.current) {
      map.removeLayer(proximityMarkerRef.current);
      proximityMarkerRef.current = null;
    }

    if (proximityActive && proximityCenter) {
      const circle = L.circle([proximityCenter.lat, proximityCenter.lng], {
        radius: radiusKm * 1000,
        color: "#3b82f6",
        fillColor: "#3b82f6",
        fillOpacity: 0.12,
        weight: 2,
        dashArray: "6, 6",
      }).addTo(map);
      proximityCircleRef.current = circle;

      const centerMarker = L.marker([proximityCenter.lat, proximityCenter.lng], {
        icon: L.divIcon({
          className: "proximity-pin",
          html: `
            <div style="
              width: 24px;
              height: 24px;
              background: #2563eb;
              border: 3px solid #ffffff;
              border-radius: 50%;
              box-shadow: 0 0 12px rgba(37,99,235,0.7);
            "></div>
          `,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        }),
      }).addTo(map);
      centerMarker.bindPopup(`<strong>Proximity Center</strong><br/>Radius: ${radiusKm} km`);
      proximityMarkerRef.current = centerMarker;
    }

    // Render Camera Markers
    filteredCameras.forEach((feature) => {
      const coords = feature.geometry?.coordinates;
      if (!coords || coords.length < 2) return;
      const [lng, lat] = coords;
      const p = feature.properties || {};
      const status = (p.status || "OFFLINE").toUpperCase();

      const marker = L.marker([lat, lng], {
        icon: createCustomMarkerIcon(status),
      });

      const camDataEncoded = encodeURIComponent(JSON.stringify({ ...p, latitude: lat, longitude: lng }));

      const popupHtml = `
        <div style="font-family: inherit; font-size: 13px; line-height: 1.4; min-width: 240px; padding: 2px;">
          <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-bottom: 8px;">
            <strong style="font-size: 14px; color: #0f172a;">${p.camera_code || "Unnamed"}</strong>
            <span style="
              padding: 2px 7px;
              border-radius: 999px;
              font-size: 11px;
              font-weight: 700;
              background: ${status === "ONLINE" ? "#dcfce7" : status === "OFFLINE" ? "#fee2e2" : "#fef3c7"};
              color: ${status === "ONLINE" ? "#16a34a" : status === "OFFLINE" ? "#dc2626" : "#d97706"};
            ">${status}</span>
          </div>

          <div style="margin-bottom: 4px;">
            <span style="color: #64748b; font-size: 11px;">Department:</span><br/>
            <strong>${p.dept_name || "N/A"}</strong>
          </div>

          <div style="margin-bottom: 4px;">
            <span style="color: #64748b; font-size: 11px;">Type & Source:</span><br/>
            <span>${p.make_model || "Camera"} (${p.source_type === "LOCAL_WEBCAM" ? "Laptop Webcam" : p.camera_type || "CCTV"})</span>
          </div>

          <div style="margin-bottom: 4px;">
            <span style="color: #64748b; font-size: 11px;">Network IP:</span><br/>
            <code style="background: #f1f5f9; padding: 2px 5px; border-radius: 4px; font-size: 11px;">${p.ip_address || "Local Device"}</code>
          </div>

          <div style="margin-bottom: 4px; display: flex; align-items: center; justify-content: space-between;">
            <span style="color: #64748b; font-size: 11px;">Stream Codec:</span>
            <span style="
              font-size: 10px;
              font-weight: 700;
              padding: 1px 6px;
              border-radius: 4px;
              background: ${p.codec === "H.265" ? "#ede9fe" : "#dbeafe"};
              color: ${p.codec === "H.265" ? "#7c3aed" : "#2563eb"};
            ">${p.codec || "H.264"}</span>
          </div>

          <div style="margin-bottom: 10px;">
            <span style="color: #64748b; font-size: 11px;">Stream URL:</span><br/>
            <code style="word-break: break-all; font-size: 10px; color: #2563eb;">${p.rtsp_url || "webrtc://live"}</code>
          </div>

          <!-- ACTION BUTTONS: WATCH LIVE FEED & REMOVE CAMERA -->
          <div style="display: flex; gap: 8px; margin-top: 8px;">
            <button
              type="button"
              class="watch-feed-btn"
              data-cam="${camDataEncoded}"
              style="
                flex: 1;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                background: #0f172a;
                color: #ffffff;
                border: none;
                padding: 8px 10px;
                border-radius: 6px;
                font-size: 11px;
                font-weight: 700;
                cursor: pointer;
                transition: all 0.15s ease;
              "
            >
              â–¶ Watch Feed
            </button>
            <button
              type="button"
              class="delete-cam-btn"
              data-id="${p.id || p.camera_code}"
              data-code="${p.camera_code || "Camera"}"
              title="Remove camera from GIS registry"
              style="
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 4px;
                background: #fee2e2;
                color: #dc2626;
                border: 1px solid #fca5a5;
                padding: 8px 10px;
                border-radius: 6px;
                font-size: 11px;
                font-weight: 700;
                cursor: pointer;
                transition: all 0.15s ease;
              "
            >
              ðŸ—‘ï¸ Remove
            </button>
          </div>
        </div>
      `;

      marker.bindPopup(popupHtml);
      markersLayer.addLayer(marker);
    });

    // Auto-fit bounds if cameras exist and not currently tracking route
    if (!routeTrackingActive && filteredCameras.length > 0) {
      const bounds = L.latLngBounds(
        filteredCameras.map((f) => [f.geometry.coordinates[1], f.geometry.coordinates[0]])
      );
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    }
  }, [filteredCameras, proximityActive, proximityCenter, radiusKm, routeTrackingActive]);

  // Active selected route object
  const activeRoute = useMemo(() => {
    if (!routeTrackingActive || !selectedRoutePlate) return null;
    const cleanTarget = selectedRoutePlate.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    return (
      trackedRoutes.find(
        (r) =>
          r.raw_plate.toUpperCase() === cleanTarget ||
          r.plate_number.replace(/\s+/g, "").toUpperCase() === cleanTarget
      ) || null
    );
  }, [routeTrackingActive, selectedRoutePlate, trackedRoutes]);

  // 5. Render Route Trail (Breadcrumb pins and polyline)
  useEffect(() => {
    const map = mapInstanceRef.current;
    const routesLayer = routesLayerRef.current;
    if (!map || !routesLayer) return;

    routesLayer.clearLayers();

    if (!routeTrackingActive || !activeRoute) return;

    const points = activeRoute.points || [];
    if (points.length === 0) return;

    const isSingle = points.length === 1;
    const latlngs = [];

    // Map through checkpoints and create numbered markers
    points.forEach((pt, idx) => {
      const isFirst = idx === 0;
      const isLast = idx === points.length - 1;
      const latlng = [pt.latitude, pt.longitude];
      latlngs.push(latlng);

      const marker = L.marker(latlng, {
        icon: createBreadcrumbMarkerIcon(pt, isFirst, isLast, isSingle),
        zIndexOffset: isLast ? 1200 : isFirst ? 1100 : 1000 + idx,
      });

      marker.bindPopup(createCheckpointPopupHtml(pt, activeRoute), {
        maxWidth: 340,
        className: "custom-route-popup",
      });

      routesLayer.addLayer(marker);
    });

    // Connect detections in chronological order ONLY IF >= 2 points
    if (!isSingle && latlngs.length >= 2) {
      // Glow polyline underlay
      const glowLine = L.polyline(latlngs, {
        color: "#38bdf8",
        weight: 9,
        opacity: 0.45,
        lineCap: "round",
        lineJoin: "round",
      });
      routesLayer.addLayer(glowLine);

      // Main dashed polyline
      const mainLine = L.polyline(latlngs, {
        color: "#0284c7",
        weight: 4.5,
        opacity: 0.95,
        dashArray: "10, 8",
        lineCap: "round",
        lineJoin: "round",
      });
      routesLayer.addLayer(mainLine);

      // Fit map bounds to show the entire breadcrumb trail
      map.fitBounds(L.latLngBounds(latlngs), { padding: [80, 80], maxZoom: 14 });
    } else if (isSingle && latlngs.length === 1) {
      // Single detection: center map on point without drawing polyline
      map.flyTo(latlngs[0], 13);
    }
  }, [routeTrackingActive, activeRoute]);

  // Overall Statistics
  const stats = useMemo(() => {
    let online = 0;
    let offline = 0;
    let maintenance = 0;
    cameras.forEach((f) => {
      const s = (f.properties?.status || "").toUpperCase();
      if (s === "ONLINE") online++;
      else if (s === "OFFLINE") offline++;
      else if (s === "MAINTENANCE") maintenance++;
    });
    return {
      total: cameras.length,
      online,
      offline,
      maintenance,
    };
  }, [cameras]);

  const resetAllFilters = () => {
    setSelectedDept("ALL");
    setStatusFilter("ALL");
    setTypeFilter("ALL");
    setSearchQuery("");
    setProximityActive(false);
    setProximityCenter(null);
  };

  const focusGujaratCenter = () => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.flyTo([22.8, 71.8], 7.5);
    }
  };

  return (
    <div className="gis-map-view">
      {/* GIS TOP TOOLBAR */}
      <div className="gis-toolbar">
        <div className="toolbar-row-top">
          <div className="toolbar-title">
            <Layers size={22} className="text-primary" />
            <div>
              <h3>Gujarat Statewide GIS Camera Map</h3>
              <p>Live spatial monitoring & surveillance feed center</p>
            </div>
          </div>

          <div className="stats-badges-cluster">
            <div className="stat-pill total">
              <span>Fed Cameras:</span>
              <strong>{filteredCameras.length} registered</strong>
            </div>
            <div className="stat-pill online">
              <span className="dot online"></span>
              <span>Online: <strong>{stats.online}</strong></span>
            </div>
            <div className="stat-pill offline">
              <span className="dot offline"></span>
              <span>Offline: <strong>{stats.offline}</strong></span>
            </div>
            <div className="stat-pill maintenance">
              <span className="dot maintenance"></span>
              <span>MNT: <strong>{stats.maintenance}</strong></span>
            </div>
          </div>
        </div>

        {/* CONTROLS ROW */}
        <div className="toolbar-controls">
          {/* SEARCH INPUT */}
          <div className="search-box">
            <Search size={16} />
            <input
              type="text"
              placeholder="Search camera code, department, IP..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                className="clear-search"
                onClick={() => setSearchQuery("")}
              >
                âœ•
              </button>
            )}
          </div>

          {/* DEPARTMENT SELECT */}
          <div className="filter-item">
            <select
              value={selectedDept}
              onChange={(e) => setSelectedDept(e.target.value)}
            >
              <option value="ALL">All Departments ({departments.length})</option>
              {departments.map((d) => (
                <option key={d.id || d.dept_name} value={d.dept_name}>
                  {d.dept_name}
                </option>
              ))}
            </select>
          </div>

          {/* STATUS PILL BUTTONS */}
          <div className="status-toggle-group">
            <button
              type="button"
              className={`status-btn ${statusFilter === "ALL" ? "active" : ""}`}
              onClick={() => setStatusFilter("ALL")}
            >
              All
            </button>
            <button
              type="button"
              className={`status-btn online ${statusFilter === "ONLINE" ? "active" : ""}`}
              onClick={() => setStatusFilter("ONLINE")}
            >
              Online
            </button>
            <button
              type="button"
              className={`status-btn offline ${statusFilter === "OFFLINE" ? "active" : ""}`}
              onClick={() => setStatusFilter("OFFLINE")}
            >
              Offline
            </button>
            <button
              type="button"
              className={`status-btn maintenance ${statusFilter === "MAINTENANCE" ? "active" : ""}`}
              onClick={() => setStatusFilter("MAINTENANCE")}
            >
              MNT
            </button>
          </div>

          {/* CAMERA TYPE SELECT */}
          <div className="filter-item">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              <option value="ALL">All Types</option>
              <option value="BULLET">Bullet</option>
              <option value="PTZ">PTZ</option>
              <option value="DOME">Dome</option>
              <option value="FIXED">Fixed</option>
            </select>
          </div>

          {/* PROXIMITY TOOL TOGGLE */}
          <button
            type="button"
            className={`proximity-toggle-btn ${proximityActive ? "active" : ""}`}
            onClick={() => {
              setProximityActive(!proximityActive);
              if (!proximityActive && !proximityCenter) {
                setProximityCenter({ lat: 23.0225, lng: 72.5714 });
              }
            }}
          >
            <Crosshair size={16} />
            <span>Proximity Radius</span>
          </button>

          {/* VEHICLE ROUTE TRAIL TOGGLE */}
          <button
            type="button"
            className={`route-tracking-toggle-btn ${routeTrackingActive ? "active" : ""}`}
            onClick={() => {
              if (!routeTrackingActive) {
                setRouteTrackingActive(true);
                loadRoutes(selectedRoutePlate);
              } else {
                setRouteTrackingActive(false);
                onClearTrackPlate?.();
              }
            }}
            title="Toggle Vehicle Route Tracking & Breadcrumb Trail"
          >
            <Navigation size={16} />
            <span>Route Trail</span>
            {trackedRoutes.length > 0 && (
              <span className="route-count-badge">{trackedRoutes.length}</span>
            )}
          </button>

          {/* RESET BUTTON */}
          <button
            type="button"
            className="reset-filters-btn"
            onClick={resetAllFilters}
            title="Reset Filters"
          >
            <RefreshCw size={15} />
            <span>Reset</span>
          </button>
        </div>

        {/* PROXIMITY EXPANDED DRAWER */}
        {proximityActive && (
          <div className="proximity-drawer">
            <div className="proximity-info">
              <Compass size={18} className="text-primary" />
              <span>
                <strong>Spatial Proximity Search Active:</strong> Click anywhere on the map to drop center pin.
              </span>
            </div>

            <div className="radius-selector">
              <label>Radius:</label>
              {[5, 10, 15, 25, 50].map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`radius-chip ${radiusKm === r ? "selected" : ""}`}
                  onClick={() => setRadiusKm(r)}
                >
                  {r} km
                </button>
              ))}
            </div>

            <div className="nearby-count-pill">
              Found <strong>{nearbyCameras.length}</strong> cameras within {radiusKm} km
            </div>
          </div>
        )}

        {/* VEHICLE ROUTE TRACKING EXPANDED DRAWER */}
        {routeTrackingActive && (
          <div className="route-tracking-drawer">
            <div className="route-drawer-left">
              <Navigation size={18} className="text-primary" />
              <div>
                <strong>GIS Breadcrumb Route Tracker:</strong>
                <p>
                  Tracing vehicle journey checkpoints chronologically across highway surveillance cameras.
                </p>
              </div>
            </div>

            <div className="route-drawer-center">
              <label>Track Vehicle:</label>
              <select
                value={selectedRoutePlate}
                onChange={(e) => setSelectedRoutePlate(e.target.value)}
                className="route-select-dropdown"
              >
                {trackedRoutes.length === 0 && (
                  <option value="">No vehicle routes recorded</option>
                )}
                {trackedRoutes.map((r) => (
                  <option key={r.raw_plate} value={r.raw_plate}>
                    {r.plate_number} &bull; {r.vehicle_type} ({r.total_checkpoints} {r.total_checkpoints === 1 ? "Stop" : "Stops"}{r.total_distance_km > 0 ? `, ${r.total_distance_km} km` : ""})
                  </option>
                ))}
              </select>

              <button
                type="button"
                className="route-refresh-btn"
                onClick={() => loadRoutes(selectedRoutePlate)}
                title="Refresh routes from detection database"
              >
                <RefreshCw size={13} className={routesLoading ? "animate-spin" : ""} />
              </button>
            </div>

            <button
              type="button"
              className="exit-route-btn"
              onClick={() => {
                setRouteTrackingActive(false);
                onClearTrackPlate?.();
              }}
              title="Close route tracking"
            >
              <X size={14} />
              <span>Exit Route</span>
            </button>
          </div>
        )}
      </div>

      {/* MAP VIEW CONTAINER */}
      <div className="map-view-wrapper">
        <div ref={mapContainerRef} className="leaflet-gis-map-canvas" />

        {/* FLOATING ROUTE JOURNEY HUD CARD */}
        {routeTrackingActive && activeRoute && (
          routeHudCollapsed ? (
            <div
              className="map-route-collapsed-pill"
              onClick={() => setRouteHudCollapsed(false)}
              title="Click to expand vehicle route trail timeline"
            >
              <Navigation size={14} style={{ color: "#38bdf8" }} />
              <span style={{ color: "#38bdf8", fontWeight: 700 }}>{activeRoute.plate_number}</span>
              <span style={{ color: "#cbd5e1", fontSize: "11px" }}>
                {activeRoute.vehicle_type || "Vehicle"} &bull; {activeRoute.total_checkpoints} {activeRoute.total_checkpoints === 1 ? "Stop" : "Stops"}
              </span>
              <ChevronDown size={14} style={{ color: "#94a3b8" }} />
              <button
                type="button"
                className="route-collapsed-close"
                onClick={(e) => {
                  e.stopPropagation();
                  setRouteTrackingActive(false);
                  onClearTrackPlate?.();
                }}
                title="Exit route tracking"
              >
                âœ•
              </button>
            </div>
          ) : (
            <div className="map-route-hud-card">
              <div className="route-hud-header">
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Navigation size={15} style={{ color: "#38bdf8" }} />
                  <span className="route-hud-title">VEHICLE ROUTE TRAIL</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <button
                    type="button"
                    className="route-hud-close"
                    onClick={() => setRouteHudCollapsed(true)}
                    title="Collapse route HUD"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <button
                    type="button"
                    className="route-hud-close"
                    onClick={() => {
                      setRouteTrackingActive(false);
                      onClearTrackPlate?.();
                    }}
                    title="Exit route tracking"
                  >
                    âœ•
                  </button>
                </div>
              </div>

            <div className="route-hud-body">
              {/* PLATE + VEHICLE CLASS */}
              <div className="route-plate-badge-row">
                <div className="hsrp-plate-display">
                  <div className="hsrp-blue-band"><span className="hsrp-ind">IND</span></div>
                  <span className="hsrp-plate-text">{activeRoute.plate_number}</span>
                </div>
                <span className="route-vehicle-tag">{activeRoute.vehicle_type || "Vehicle"}</span>
              </div>

              {/* STATS STRIP */}
              <div className="route-metrics-strip">
                <div className="metric-box">
                  <span className="metric-lbl">Checkpoints</span>
                  <strong className="metric-val">{activeRoute.total_checkpoints}</strong>
                </div>
                <div className="metric-box">
                  <span className="metric-lbl">Total Distance</span>
                  <strong className="metric-val">{activeRoute.total_distance_km} km</strong>
                </div>
                <div className="metric-box">
                  <span className="metric-lbl">Mode</span>
                  <strong className="metric-val" style={{ color: activeRoute.points.length > 1 ? "#38bdf8" : "#10b981" }}>
                    {activeRoute.points.length > 1 ? "Multi-Cam" : "Single Spot"}
                  </strong>
                </div>
              </div>

              {/* CHECKPOINTS TIMELINE */}
              <div className="route-timeline-wrap">
                <div className="timeline-header">Travel Sequence:</div>
                <div className="timeline-scroll">
                  {activeRoute.points.map((pt, idx) => {
                    const isFirst = idx === 0;
                    const isLast = idx === activeRoute.points.length - 1;
                    const isSingle = activeRoute.points.length === 1;
                    return (
                      <div
                        key={pt.event_id || idx}
                        className="timeline-item"
                        onClick={() => {
                          if (mapInstanceRef.current) {
                            mapInstanceRef.current.flyTo([pt.latitude, pt.longitude], 15);
                          }
                        }}
                        title="Click to fly to checkpoint"
                      >
                        <div className={`timeline-pin ${isSingle ? "single" : isFirst ? "first" : isLast ? "last" : "transit"}`}>
                          {isSingle ? "ðŸ“" : pt.order}
                        </div>
                        <div className="timeline-content">
                          <div className="timeline-top">
                            <strong className="timeline-cam">{pt.camera_code || pt.camera_id}</strong>
                            <span className="timeline-time">
                              {pt.timestamp ? new Date(pt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : "N/A"}
                            </span>
                          </div>
                          <p className="timeline-loc">{pt.location_name || pt.camera_name}</p>
                          {pt.distance_from_prev_km ? (
                            <span className="timeline-dist-tag">+{pt.distance_from_prev_km} km</span>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )
      )}

        {/* FLOATING MAP CONTROLS OVERLAY */}
        <div className="map-floating-overlay">
          <button
            type="button"
            className="floating-map-btn"
            onClick={focusGujaratCenter}
            title="Reset View to Gujarat"
          >
            <Radio size={16} />
            Gujarat Overview
          </button>

          <button
            type="button"
            className="floating-map-btn"
            onClick={refreshData}
            title="Refresh Camera Data"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>

          <button
            type="button"
            className="floating-map-btn"
            disabled={syncingSentinel}
            onClick={handleQuickSyncSentinel}
            title="Synchronize Live Cameras from Sentinel Catalogue (/api/ingest)"
            style={{ color: "#0284c7", fontWeight: 700 }}
          >
            <RefreshCw size={16} className={syncingSentinel ? "animate-spin" : ""} />
            {syncingSentinel ? "Syncing..." : "Sync Sentinel"}
          </button>
        </div>

        {/* EMPTY STATE BANNER (When user hasn't registered cameras yet) */}
        {!loading && cameras.length === 0 && (
          <div className="map-empty-state-card">
            <div className="empty-icon-circle">
              <Video size={36} />
            </div>
            <h4>No Cameras Registered Yet</h4>
            <p>
              Your GIS Map displays only the real cameras you feed into the registry. Add your laptop webcam, a Network CCTV, or import via CSV to see them live on the map!
            </p>
            <div style={{ display: "flex", gap: "10px", justifyContent: "center" }}>
              <button
                type="button"
                className="primary-button"
                onClick={onSwitchToOnboarding}
              >
                <Plus size={18} />
                Feed Camera
              </button>
              {onSwitchToBulkCsv && (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={onSwitchToBulkCsv}
                  style={{ display: "flex", alignItems: "center", gap: "6px" }}
                >
                  <UploadCloud size={18} />
                  Bulk CSV Import
                </button>
              )}
            </div>
          </div>
        )}

        {/* QUICK LIVE FEED LIST SIDEBAR (When cameras exist) */}
        {cameras.length > 0 && (
          liveFeedsCollapsed ? (
            <button
              type="button"
              className="map-collapsed-pill"
              style={{
                left: routeTrackingActive && activeRoute
                  ? (routeHudCollapsed ? "308px" : "348px")
                  : "16px"
              }}
              onClick={() => setLiveFeedsCollapsed(false)}
              title="Expand Live Feeds list"
            >
              <Video size={14} style={{ color: "#38bdf8" }} />
              <span>Live Feeds ({cameras.length})</span>
              <ChevronRight size={14} />
            </button>
          ) : (
            <div
              className="map-feed-quick-sidebar"
              style={{
                left: routeTrackingActive && activeRoute
                  ? (routeHudCollapsed ? "308px" : "348px")
                  : "16px"
              }}
            >
              <div className="sidebar-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Video size={16} />
                  <span>Live Feeds ({cameras.length})</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  {onSwitchToBulkCsv && (
                    <button
                      type="button"
                      onClick={onSwitchToBulkCsv}
                      title="Import more cameras via CSV"
                      style={{
                        background: "rgba(255,255,255,0.15)",
                        border: "none",
                        color: "#fff",
                        borderRadius: "4px",
                        padding: "2px 6px",
                        fontSize: "11px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "4px"
                      }}
                    >
                      <UploadCloud size={12} /> +CSV
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setLiveFeedsCollapsed(true)}
                    title="Collapse Live Feeds list"
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#94a3b8",
                      cursor: "pointer",
                      padding: "2px 4px",
                      borderRadius: "4px",
                      display: "flex",
                      alignItems: "center"
                    }}
                  >
                    <ChevronLeft size={16} />
                  </button>
                </div>
              </div>
            <div className="sidebar-feed-list">
              {cameras.map((f) => {
                const p = f.properties || {};
                const isOnline = (p.status || "").toUpperCase() === "ONLINE";
                return (
                  <div
                    key={p.id || p.camera_code}
                    className="quick-feed-card"
                    style={{ position: "relative" }}
                  >
                    <div
                      className="quick-feed-title"
                      style={{ cursor: "pointer" }}
                      onClick={() =>
                        setActiveFeedCamera({
                          ...p,
                          latitude: f.geometry?.coordinates?.[1],
                          longitude: f.geometry?.coordinates?.[0],
                        })
                      }
                    >
                      <strong>{p.camera_code}</strong>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span className={`status-dot ${isOnline ? "online" : "offline"}`}></span>
                        <button
                          type="button"
                          className="quick-feed-delete-btn"
                          title={`Remove ${p.camera_code}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setCameraToDelete({
                              id: p.id || p.camera_code,
                              code: p.camera_code || "Camera",
                            });
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                    <p
                      className="quick-feed-dept"
                      style={{ cursor: "pointer" }}
                      onClick={() =>
                        setActiveFeedCamera({
                          ...p,
                          latitude: f.geometry?.coordinates?.[1],
                          longitude: f.geometry?.coordinates?.[0],
                        })
                      }
                    >
                      {p.dept_name}
                    </p>
                    <div
                      className="quick-feed-footer"
                      style={{ cursor: "pointer" }}
                      onClick={() =>
                        setActiveFeedCamera({
                          ...p,
                          latitude: f.geometry?.coordinates?.[1],
                          longitude: f.geometry?.coordinates?.[0],
                        })
                      }
                    >
                      <span>{p.source_type === "LOCAL_WEBCAM" ? "Webcam" : p.camera_type || "CCTV"}</span>
                      <span className="watch-link">
                        <Play size={11} /> Watch
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )
      )}

        {/* ERROR NOTIFICATION OVERLAY */}
        {error && (
          <div className="map-error-banner">
            <AlertTriangle size={18} />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* DELETE CAMERA CONFIRMATION MODAL */}
      {cameraToDelete && (
        <div className="cctv-modal-overlay">
          <div
            style={{
              background: "#ffffff",
              borderRadius: "12px",
              padding: "24px",
              maxWidth: "440px",
              width: "100%",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.25)",
              animation: "fadeIn 0.15s ease-out",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "14px" }}>
              <div
                style={{
                  width: "42px",
                  height: "42px",
                  borderRadius: "50%",
                  background: "#fee2e2",
                  color: "#dc2626",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Trash2 size={20} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#0f172a" }}>
                  Remove Camera from GIS Map?
                </h3>
                <p style={{ margin: "3px 0 0", fontSize: "13px", color: "#64748b" }}>
                  Camera Code: <strong style={{ color: "#0f172a" }}>{cameraToDelete.code}</strong>
                </p>
              </div>
            </div>
            <p style={{ fontSize: "13px", color: "#475569", lineHeight: 1.5, marginBottom: "20px" }}>
              Are you sure you want to remove this camera? It will be deleted from the statewide GIS registry database and live surveillance feeds.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                type="button"
                disabled={deleteLoading}
                onClick={() => setCameraToDelete(null)}
                style={{
                  padding: "8px 16px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                  color: "#334155",
                  fontWeight: 600,
                  fontSize: "13px",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteLoading}
                onClick={confirmDeleteCamera}
                style={{
                  padding: "8px 16px",
                  borderRadius: "6px",
                  border: "none",
                  background: "#dc2626",
                  color: "#ffffff",
                  fontWeight: 600,
                  fontSize: "13px",
                  cursor: deleteLoading ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                {deleteLoading ? <RefreshCw size={14} className="animate-spin" /> : <Trash2 size={14} />}
                {deleteLoading ? "Removing..." : "Yes, Remove Camera"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE SUCCESS NOTIFICATION TOAST */}
      {deleteSuccessMsg && (
        <div
          style={{
            position: "fixed",
            bottom: "24px",
            right: "24px",
            zIndex: 10000,
            background: "#0f172a",
            color: "#ffffff",
            padding: "12px 18px",
            borderRadius: "8px",
            boxShadow: "0 10px 15px -3px rgba(0,0,0,0.3)",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            fontSize: "13px",
            fontWeight: 600,
            borderLeft: "4px solid #10b981",
          }}
        >
          <span>âœ“</span>
          <span>{deleteSuccessMsg}</span>
        </div>
      )}

      {/* LIVE CCTV FEED PLAYER MODAL SCREEN */}
      {activeFeedCamera && (
        <CameraFeedModal
          camera={activeFeedCamera}
          onClose={() => setActiveFeedCamera(null)}
        />
      )}
    </div>
  );
}
