import { useState, useEffect, useCallback } from "react";
import {
  Search,
  Download,
  Filter,
  RefreshCw,
  Calendar,
  Camera,
  MapPin,
  ShieldAlert,
  Car,
  Truck,
  Bike,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Info,
  X,
  Radio,
  FileSpreadsheet
} from "lucide-react";
import "./DetectionInvestigation.css";
import { apiFetch, apiUrl } from "../utils/apiConfig";

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
  if (typeStr.includes("auto") || typeStr.includes("rickshaw") || typeStr.includes("3-wheeler")) {
    return (
      <span className="v-pill auto" title="Auto-Rickshaw / 3-Wheeler">
        <AutoRickshawIcon size={13} />
        <span>Auto-rickshaw</span>
      </span>
    );
  }
  if (typeStr.includes("motorcycle") || typeStr.includes("bike") || typeStr.includes("scooter")) {
    return (
      <span className="v-pill bike" title="Motorcycle / Scooter">
        <Bike size={13} />
        <span>Motorcycle</span>
      </span>
    );
  }
  if (typeStr.includes("bus")) {
    return (
      <span className="v-pill bus" title="Bus">
        <Truck size={13} />
        <span>Bus</span>
      </span>
    );
  }
  if (typeStr.includes("truck")) {
    return (
      <span className="v-pill truck" title="Truck">
        <Truck size={13} />
        <span>Truck</span>
      </span>
    );
  }
  if (typeStr.includes("van") || typeStr.includes("suv")) {
    return (
      <span className="v-pill van" title="SUV / Van">
        <Car size={13} />
        <span>SUV / Van</span>
      </span>
    );
  }
  return (
    <span className="v-pill car" title="Passenger Car">
      <Car size={13} />
      <span>Car</span>
    </span>
  );
}

export default function DetectionInvestigation({ onTrackOnMap, onOpenAnpr }) {
  // Filter States
  const [plate, setPlate] = useState("");
  const [cameraId, setCameraId] = useState("");
  const [vehicleType, setVehicleType] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [watchlistStatus, setWatchlistStatus] = useState("all");
  const [location, setLocation] = useState("");

  // Pagination & Results
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [availableCameras, setAvailableCameras] = useState([]);
  const [availableVehicleTypes, setAvailableVehicleTypes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Detail Modal State
  const [selectedEvent, setSelectedEvent] = useState(null);

  // Fetch results callback
  const fetchResults = useCallback(async (targetPage = page) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (plate.trim()) params.append("plate", plate.trim());
      if (cameraId) params.append("camera_id", cameraId);
      if (vehicleType && vehicleType !== "all") params.append("vehicle_type", vehicleType);
      if (fromDate) params.append("from_date", fromDate);
      if (toDate) params.append("to_date", toDate);
      if (watchlistStatus && watchlistStatus !== "all") params.append("watchlist_status", watchlistStatus);
      if (location.trim()) params.append("location", location.trim());
      params.append("page", targetPage);
      params.append("page_size", pageSize);

      const res = await apiFetch(apiUrl(`/api/anpr/investigation/search?${params.toString()}`));
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
        setTotal(data.total || 0);
        setPage(data.page || 1);
        setTotalPages(data.total_pages || 1);
        if (data.available_cameras) setAvailableCameras(data.available_cameras);
        if (data.available_vehicle_types) setAvailableVehicleTypes(data.available_vehicle_types);
      }
    } catch (err) {
      console.error("Error searching detection metadata:", err);
    } finally {
      setLoading(false);
    }
  }, [plate, cameraId, vehicleType, fromDate, toDate, watchlistStatus, location, page, pageSize]);

  // Initial load
  useEffect(() => {
    fetchResults(1);
  }, [fetchResults]);

  // Apply search
  const handleApplySearch = (e) => {
    if (e) e.preventDefault();
    fetchResults(1);
  };

  // Reset filters
  const handleResetFilters = () => {
    setPlate("");
    setCameraId("");
    setVehicleType("all");
    setFromDate("");
    setToDate("");
    setWatchlistStatus("all");
    setLocation("");
    setTimeout(() => {
      fetchResults(1);
    }, 50);
  };

  // Export CSV of currently filtered results
  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (plate.trim()) params.append("plate", plate.trim());
      if (cameraId) params.append("camera_id", cameraId);
      if (vehicleType && vehicleType !== "all") params.append("vehicle_type", vehicleType);
      if (fromDate) params.append("from_date", fromDate);
      if (toDate) params.append("to_date", toDate);
      if (watchlistStatus && watchlistStatus !== "all") params.append("watchlist_status", watchlistStatus);
      if (location.trim()) params.append("location", location.trim());

      const downloadUrl = apiUrl(`/api/anpr/investigation/export-csv?${params.toString()}`);
      // Trigger browser download via hidden link
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.setAttribute("download", `sentinel_investigation_export.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error("Error exporting CSV:", err);
    } finally {
      setTimeout(() => setExporting(false), 800);
    }
  };

  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= totalPages) {
      fetchResults(newPage);
    }
  };

  return (
    <div className="investigation-container">
      {/* HEADER CARD */}
      <div className="investigation-header-card">
        <div className="inv-title-group">
          <div className="inv-badge">
            <Radio size={14} />
            <span>METADATA AUDIT &amp; FORENSICS</span>
          </div>
          <h3>Searchable Detection Metadata &amp; Investigation</h3>
          <p>Search, filter, and audit all ANPR detection logs across cameras and export forensic CSV records.</p>
        </div>

        <div className="inv-header-actions">
          <button
            type="button"
            className="csv-export-btn"
            onClick={handleExportCsv}
            disabled={exporting || items.length === 0}
            title="Download CSV file of the currently filtered detection records"
          >
            <Download size={15} />
            <span>{exporting ? "Generating CSV..." : `Export CSV (${total})`}</span>
          </button>
        </div>
      </div>

      {/* FILTER CONTROLS */}
      <div className="investigation-filter-card">
        <form onSubmit={handleApplySearch}>
          <div className="filter-grid">
            {/* Number Plate Filter */}
            <div className="filter-item">
              <label>
                <Search size={12} />
                <span>Number Plate</span>
              </label>
              <input
                type="text"
                className="filter-input"
                placeholder="e.g. GJ 01 AB 1234"
                value={plate}
                onChange={(e) => setPlate(e.target.value)}
              />
            </div>

            {/* Camera Filter */}
            <div className="filter-item">
              <label>
                <Camera size={12} />
                <span>Camera Stream</span>
              </label>
              <select
                className="filter-select"
                value={cameraId}
                onChange={(e) => setCameraId(e.target.value)}
              >
                <option value="">All Registered Cameras</option>
                {availableCameras.map((c) => (
                  <option key={c.id || c.code} value={c.id || c.code}>
                    {c.code} - {c.location || c.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Vehicle Type Filter */}
            <div className="filter-item">
              <label>
                <Car size={12} />
                <span>Vehicle Type</span>
              </label>
              <select
                className="filter-select"
                value={vehicleType}
                onChange={(e) => setVehicleType(e.target.value)}
              >
                <option value="all">All Vehicle Types</option>
                {availableVehicleTypes.map((vt) => (
                  <option key={vt} value={vt}>{vt}</option>
                ))}
              </select>
            </div>

            {/* Watchlist Filter */}
            <div className="filter-item">
              <label>
                <ShieldAlert size={12} />
                <span>Watchlist Status</span>
              </label>
              <select
                className="filter-select"
                value={watchlistStatus}
                onChange={(e) => setWatchlistStatus(e.target.value)}
              >
                <option value="all">All Detections</option>
                <option value="watchlist_only">Watchlist Flagged Only</option>
                <option value="non_watchlist">Clean Records Only</option>
              </select>
            </div>

            {/* From Date */}
            <div className="filter-item">
              <label>
                <Calendar size={12} />
                <span>From Date / Time</span>
              </label>
              <input
                type="date"
                className="filter-input"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>

            {/* To Date */}
            <div className="filter-item">
              <label>
                <Calendar size={12} />
                <span>To Date / Time</span>
              </label>
              <input
                type="date"
                className="filter-input"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>

            {/* Location Search */}
            <div className="filter-item">
              <label>
                <MapPin size={12} />
                <span>Location / City</span>
              </label>
              <input
                type="text"
                className="filter-input"
                placeholder="e.g. Ahmedabad, NH-48"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>
          </div>

          <div className="filter-actions-bar">
            <div className="filter-stats">
              Showing <strong>{items.length}</strong> of <strong>{total}</strong> filtered records (Page {page} of {totalPages})
            </div>

            <div className="filter-buttons">
              <button
                type="button"
                className="filter-btn-reset"
                onClick={handleResetFilters}
              >
                <RefreshCw size={13} />
                <span>Reset Filters</span>
              </button>

              <button
                type="submit"
                className="filter-btn-apply"
                disabled={loading}
              >
                <Filter size={13} />
                <span>{loading ? "Searching..." : "Apply Filters"}</span>
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* RESULTS TABLE */}
      <div className="investigation-table-card">
        <div className="table-responsive">
          <table className="inv-table">
            <thead>
              <tr>
                <th>Crop</th>
                <th>Plate Number</th>
                <th>Vehicle Type</th>
                <th>Camera</th>
                <th>Location</th>
                <th>OCR Conf</th>
                <th>Timestamp (UTC)</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan="9" style={{ textAlign: "center", padding: "40px 20px", color: "#94a3b8" }}>
                    {loading ? "Loading matching detection events..." : "No detection events match the specified filters."}
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const confPct = Math.round((item.ocr_confidence || 0) * 100);
                  const isClean = !item.is_watchlist_alert;

                  return (
                    <tr
                      key={item.event_id}
                      onClick={() => setSelectedEvent(item)}
                      title="Click row to view complete metadata and crop"
                    >
                      {/* CROP THUMBNAIL */}
                      <td>
                        <div className="crop-thumb-box">
                          {item.crop_url ? (
                            <img
                              crossOrigin="use-credentials"
                              src={apiUrl(item.crop_url)}
                              alt={item.plate_number}
                              className="crop-thumb-img"
                              onError={(e) => {
                                e.currentTarget.style.display = "none";
                                const fallback = e.currentTarget.parentElement.querySelector(".crop-thumb-none");
                                if (fallback) fallback.style.display = "block";
                              }}
                            />
                          ) : null}
                          <span
                            className="crop-thumb-none"
                            style={{ display: item.crop_url ? "none" : "block" }}
                          >
                            NO CROP
                          </span>
                        </div>
                      </td>

                      {/* NUMBER PLATE */}
                      <td>
                        <div className="plate-num-badge">
                          <span>{item.plate_number || "UNREADABLE"}</span>
                        </div>
                      </td>

                      {/* VEHICLE TYPE */}
                      <td>
                        {renderVehicleBadge(item.vehicle_type)}
                      </td>

                      {/* CAMERA */}
                      <td>
                        <strong style={{ color: "#38bdf8", fontFamily: "monospace" }}>
                          {item.camera_code || "CAM"}
                        </strong>
                      </td>

                      {/* LOCATION */}
                      <td>
                        <span style={{ fontSize: "12px", color: "#cbd5e1" }}>
                          {item.location || item.dept_name || "Surveillance"}
                        </span>
                      </td>

                      {/* OCR CONFIDENCE */}
                      <td>
                        <span style={{
                          fontWeight: 700,
                          fontSize: "12px",
                          color: confPct >= 70 ? "#4ade80" : confPct >= 40 ? "#facc15" : "#94a3b8"
                        }}>
                          {confPct}%
                        </span>
                      </td>

                      {/* TIMESTAMP */}
                      <td style={{ fontSize: "11px", color: "#94a3b8", fontFamily: "monospace" }}>
                        {item.timestamp ? item.timestamp.replace("T", " ").slice(0, 19) : "â€”"}
                      </td>

                      {/* WATCHLIST STATUS */}
                      <td>
                        <span className={`wl-tag ${isClean ? "clean" : "alert"}`}>
                          {isClean ? "CLEAN" : `ALERT (${item.watchlist_reason || "Suspect"})`}
                        </span>
                      </td>

                      {/* ACTIONS */}
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="row-actions-group">
                          {/* GIS ROUTE BUTTON */}
                          {item.plate_number && !item.plate_number.includes("IN-TRANSIT") && onTrackOnMap && (
                            <button
                              type="button"
                              className="action-btn-sm route-btn"
                              onClick={() => onTrackOnMap(item.raw_plate || item.plate_number)}
                              title="Track travel route on GIS map"
                            >
                              <MapPin size={11} />
                              <span>Route</span>
                            </button>
                          )}

                          {/* OPEN CAMERA BUTTON */}
                          {onOpenAnpr && (
                            <button
                              type="button"
                              className="action-btn-sm"
                              onClick={() => onOpenAnpr({ id: item.camera_id, camera_code: item.camera_code })}
                              title="Open live camera feed in ANPR Intelligence"
                            >
                              <ExternalLink size={11} />
                              <span>Camera</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* PAGINATION CONTROLS */}
        <div className="pagination-bar">
          <div className="page-size-selector">
            <span>Rows per page:</span>
            <select
              className="page-size-select"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
            >
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </div>

          <div className="page-nav-group">
            <button
              type="button"
              className="page-btn"
              onClick={() => handlePageChange(page - 1)}
              disabled={page <= 1}
            >
              <ChevronLeft size={14} />
              <span>Prev</span>
            </button>

            <span className="page-indicator">
              Page <strong>{page}</strong> of <strong>{totalPages}</strong>
            </span>

            <button
              type="button"
              className="page-btn"
              onClick={() => handlePageChange(page + 1)}
              disabled={page >= totalPages}
            >
              <span>Next</span>
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* DETAIL INSPECTION MODAL */}
      {selectedEvent && (
        <div className="modal-backdrop" onClick={() => setSelectedEvent(null)}>
          <div className="detail-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h4>
                <Info size={16} color="#38bdf8" />
                <span>Detection Event Details â€” {selectedEvent.event_id}</span>
              </h4>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setSelectedEvent(null)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-body">
              {/* CROP DISPLAY */}
              <div className="detail-crop-preview">
                {selectedEvent.crop_url ? (
                  <img
                    crossOrigin="use-credentials"
                    src={apiUrl(selectedEvent.crop_url)}
                    alt={selectedEvent.plate_number}
                  />
                ) : (
                  <span style={{ color: "#64748b", fontSize: "12px" }}>No crop snapshot available</span>
                )}
              </div>

              {/* DETAILS GRID */}
              <div className="detail-grid">
                <div className="detail-field">
                  <span>Number Plate</span>
                  <div className="plate-num-badge">
                    <span>{selectedEvent.plate_number || "UNREADABLE"}</span>
                  </div>
                </div>

                <div className="detail-field">
                  <span>Vehicle Classification</span>
                  <div>{renderVehicleBadge(selectedEvent.vehicle_type)}</div>
                </div>

                <div className="detail-field">
                  <span>Camera Code / ID</span>
                  <strong>{selectedEvent.camera_code} ({selectedEvent.camera_id})</strong>
                </div>

                <div className="detail-field">
                  <span>Department / Location</span>
                  <strong>{selectedEvent.location || selectedEvent.dept_name}</strong>
                </div>

                <div className="detail-field">
                  <span>OCR Confidence</span>
                  <strong style={{ color: "#38bdf8" }}>
                    {Math.round((selectedEvent.ocr_confidence || 0) * 100)}%
                  </strong>
                </div>

                <div className="detail-field">
                  <span>Watchlist Status</span>
                  <div>
                    <span className={`wl-tag ${!selectedEvent.is_watchlist_alert ? "clean" : "alert"}`}>
                      {!selectedEvent.is_watchlist_alert ? "CLEAN" : `SUSPECT (${selectedEvent.watchlist_reason || "Watchlist"})`}
                    </span>
                  </div>
                </div>

                <div className="detail-field" style={{ gridColumn: "1 / -1" }}>
                  <span>Exact Timestamp</span>
                  <strong style={{ fontFamily: "monospace" }}>{selectedEvent.timestamp}</strong>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              {selectedEvent.plate_number && !selectedEvent.plate_number.includes("IN-TRANSIT") && onTrackOnMap && (
                <button
                  type="button"
                  className="filter-btn-apply"
                  onClick={() => {
                    const p = selectedEvent.raw_plate || selectedEvent.plate_number;
                    setSelectedEvent(null);
                    onTrackOnMap(p);
                  }}
                >
                  <MapPin size={14} />
                  <span>Track Route on GIS Map</span>
                </button>
              )}

              {onOpenAnpr && (
                <button
                  type="button"
                  className="csv-export-btn"
                  onClick={() => {
                    const c = { id: selectedEvent.camera_id, camera_code: selectedEvent.camera_code };
                    setSelectedEvent(null);
                    onOpenAnpr(c);
                  }}
                >
                  <Radio size={14} />
                  <span>Open Camera in ANPR</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
