import { useState, useRef } from "react";
import {
  FileSpreadsheet,
  UploadCloud,
  Download,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FileText,
  RefreshCw,
  MapPin,
  Check,
  AlertCircle,
  Eye,
  Layers,
  ArrowRight,
  Edit2,
  Trash2,
  Plus,
  X,
  Save,
  HelpCircle
} from "lucide-react";
import "./CsvImport.css";
import { apiFetch, apiUrl } from "../utils/apiConfig";

export default function CsvImport({ onNavigateToMap }) {
  const fileInputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);

  // Validation State
  const [isValidating, setIsValidating] = useState(false);
  const [validationData, setValidationData] = useState(null);
  const [validationError, setValidationError] = useState("");
  const [filterMode, setFilterMode] = useState("ALL"); // "ALL" | "VALID" | "ERROR"

  // Inline Row Editing State
  const [editingRowIndex, setEditingRowIndex] = useState(null);
  const [editDraft, setEditDraft] = useState({});

  // Import State
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState("");

  // Sentinel Gateway 1-Click Sync State
  const [sentinelGatewayUrl, setSentinelGatewayUrl] = useState("https://cctv.corp8.cloud/cameras.json");
  const [isSyncingSentinel, setIsSyncingSentinel] = useState(false);
  const [syncError, setSyncError] = useState("");

  // Current workflow step calculation (1: Upload, 2: Validate, 3: Preview, 4: Import)
  const currentStep = importResult ? 4 : validationData ? 3 : selectedFile ? 2 : 1;

  // 1. Download CSV Template
  const handleDownloadTemplate = async () => {
    try {
      const response = await apiFetch(apiUrl("/api/cameras/csv-template"));
      if (!response.ok) throw new Error("Template download failed");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "gujarat_cctv_registry_template.csv";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.warn("Using client-side CSV template fallback:", err);
      const fallbackCsv = `camera_code,dept_name,camera_type,make_model,source_type,ip_address,rtsp_url,latitude,longitude,status,ageing
CAM-GJ-001,Gujarat Police,ANPR,Hikvision ANPR 4K,NETWORK_CCTV,103.250.160.189,rtsp://admin:pass@103.250.160.189:8554/stream/cam01,23.0225,72.5714,ONLINE,0.5
CAM-GJ-002,Ahmedabad Municipal Corporation,FIXED,Dahua HD Bullet,NETWORK_CCTV,103.250.160.189,rtsp://admin:pass@103.250.160.189:8554/stream/cam02,23.0338,72.5850,ONLINE,1.0
CAM-GJ-003,Surat Municipal Corporation,PTZ,Axis PTZ Dome,NETWORK_CCTV,103.250.160.189,rtsp://admin:pass@103.250.160.189:8554/stream/cam03,21.1702,72.8311,ONLINE,0.8`;
      const blob = new Blob([fallbackCsv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "gujarat_cctv_registry_template.csv";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  // 2. Drag & Drop & File Selection
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  // 3. Process & Validate CSV File
  const processFile = async (file) => {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setValidationError("Invalid file format. Please upload a valid CSV file ending with .csv");
      return;
    }

    setSelectedFile(file);
    setValidationError("");
    setImportError("");
    setImportResult(null);
    setEditingRowIndex(null);
    setIsValidating(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await apiFetch(apiUrl("/api/cameras/validate-csv"), {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || data.message || "Failed to validate CSV schema.");
      }

      setValidationData(data);
    } catch (err) {
      setValidationError(err.message || "Failed to validate CSV file.");
      setValidationData(null);
    } finally {
      setIsValidating(false);
    }
  };

  // 4. Revalidate current rows after inline edit/delete/add
  const revalidateCurrentRows = async (rows) => {
    setIsValidating(true);
    try {
      const response = await apiFetch(apiUrl("/api/cameras/validate-records"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records: rows }),
      });
      const data = await response.json();
      if (response.ok) {
        setValidationData(data);
      }
    } catch (err) {
      console.error("Failed to revalidate records:", err);
    } finally {
      setIsValidating(false);
    }
  };

  // 5. Row Edit Handlers
  const handleStartEdit = (row, idx) => {
    setEditingRowIndex(idx);
    setEditDraft({
      camera_code: row.camera_code || "",
      dept_name: row.dept_name || "",
      camera_type: row.camera_type || "FIXED",
      make_model: row.make_model || "",
      source_type: row.source_type || "NETWORK_CCTV",
      ip_address: row.ip_address || "",
      rtsp_url: row.rtsp_url || "",
      latitude: row.latitude !== undefined && row.latitude !== null ? row.latitude : 23.0225,
      longitude: row.longitude !== undefined && row.longitude !== null ? row.longitude : 72.5714,
      status: row.status || "ONLINE",
      ageing: row.ageing !== undefined && row.ageing !== null ? row.ageing : 1.0,
    });
  };

  const handleCancelEdit = () => {
    setEditingRowIndex(null);
    setEditDraft({});
  };

  const handleSaveEdit = async (idx) => {
    if (!validationData || !validationData.rows) return;
    const updatedRows = [...validationData.rows];
    updatedRows[idx] = {
      ...updatedRows[idx],
      ...editDraft,
      latitude: editDraft.latitude ? parseFloat(editDraft.latitude) : null,
      longitude: editDraft.longitude ? parseFloat(editDraft.longitude) : null,
      ageing: editDraft.ageing ? parseFloat(editDraft.ageing) : 0.0,
    };
    setEditingRowIndex(null);
    setEditDraft({});
    await revalidateCurrentRows(updatedRows);
  };

  const handleDeleteRow = async (idx) => {
    if (!validationData || !validationData.rows) return;
    const updatedRows = validationData.rows.filter((_, i) => i !== idx);
    setEditingRowIndex(null);
    await revalidateCurrentRows(updatedRows);
  };

  const handleAddNewRow = async () => {
    const currentRows = validationData?.rows || [];
    const newIdx = currentRows.length;
    const newRow = {
      row_number: newIdx + 1,
      camera_code: `CAM-GJ-${String(newIdx + 1).padStart(4, "0")}`,
      dept_name: "Gujarat Police",
      camera_type: "ANPR",
      make_model: "Hikvision ANPR 4K",
      source_type: "NETWORK_CCTV",
      ip_address: `192.168.1.${100 + newIdx}`,
      rtsp_url: `rtsp://admin:pass123@192.168.1.${100 + newIdx}:554/live`,
      latitude: 23.0225,
      longitude: 72.5714,
      status: "ONLINE",
      ageing: 0.5,
    };
    const updatedRows = [...currentRows, newRow];
    await revalidateCurrentRows(updatedRows);
    setEditingRowIndex(newIdx);
    setEditDraft({ ...newRow });
  };

  // 6. Confirm & Bulk Import
  const handleConfirmImport = async () => {
    if (!validationData?.rows || validationData.rows.length === 0) return;

    setIsImporting(true);
    setImportError("");

    try {
      const validRowsToImport = validationData.rows.filter((r) => r.is_valid);
      if (validRowsToImport.length === 0) {
        throw new Error("No valid camera rows to import. Please correct row errors first.");
      }

      const response = await apiFetch(apiUrl("/api/cameras/bulk-import-json"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cameras: validRowsToImport }),
      });

      let data;
      const cType = response.headers.get("content-type") || "";
      if (cType.includes("application/json")) {
        data = await response.json();
      } else {
        const rawText = await response.text();
        throw new Error(rawText || `Server error (${response.status})`);
      }

      if (!response.ok) {
        throw new Error(data?.detail || data?.message || "Failed to import cameras");
      }

      setImportResult(data);
    } catch (err) {
      setImportError(err.message || "Bulk import failed. Please verify the entries.");
    } finally {
      setIsImporting(false);
    }
  };

  // 7. Reset Form
  const handleReset = () => {
    setSelectedFile(null);
    setValidationData(null);
    setValidationError("");
    setImportResult(null);
    setImportError("");
    setEditingRowIndex(null);
    setEditDraft({});
    setFilterMode("ALL");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // 8. Sentinel Gateway 1-Click Sync
  const handleSyncSentinel = async () => {
    setIsSyncingSentinel(true);
    setSyncError("");
    setImportError("");
    try {
      const response = await apiFetch(apiUrl("/api/cameras/sync-sentinel"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gateway_url: sentinelGatewayUrl }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.detail || "Failed to sync from Sentinel Gateway");
      }
      setImportResult({
        imported_count: data.synced_count,
        skipped_count: 0,
        failed_count: 0,
        imported_cameras: data.synced_codes || [],
        message: data.message,
      });
    } catch (err) {
      setSyncError(err.message || "Failed to synchronize cameras from Sentinel Gateway.");
    } finally {
      setIsSyncingSentinel(false);
    }
  };

  // Normalized counts
  const totalCount = validationData
    ? (validationData.total_records ?? validationData.total_rows ?? validationData.rows?.length ?? 0)
    : 0;
  const validCount = validationData
    ? (validationData.valid_records ?? validationData.valid_count ?? validationData.rows?.filter((r) => r.is_valid).length ?? 0)
    : 0;
  const invalidCount = validationData
    ? (validationData.error_records ?? validationData.invalid_count ?? validationData.rows?.filter((r) => !r.is_valid).length ?? 0)
    : 0;

  // Filtered rows for preview table
  const filteredRows = (validationData?.rows || []).map((row, originalIndex) => ({
    ...row,
    originalIndex,
  })).filter((r) => {
    if (filterMode === "VALID") return r.is_valid;
    if (filterMode === "ERROR") return !r.is_valid;
    return true;
  });

  return (
    <div className="csv-import-container">
      {/* 1. HEADER SECTION */}
      <div className="csv-page-header">
        <div className="csv-header-text">
          <div className="csv-eyebrow">
            <FileSpreadsheet size={13} />
            <span>BULK ASSET REGISTRATION</span>
          </div>
          <h2>Bulk Camera Onboarding via CSV</h2>
          <p>
            Upload, validate, and preview your CCTV &amp; ANPR camera fleet in bulk before deploying them to the statewide GIS live map.
          </p>
        </div>

        <button
          type="button"
          className="template-download-btn"
          onClick={handleDownloadTemplate}
          title="Download official CSV sample template with required headers"
        >
          <Download size={15} />
          <span>Download CSV Template</span>
        </button>
      </div>

      {/* 2. STEP WORKFLOW INDICATOR */}
      <div className="csv-workflow-stepper">
        <div className={`step-node ${currentStep === 1 ? "active" : currentStep > 1 ? "completed" : ""}`}>
          <div className="step-circle">{currentStep > 1 ? "âœ“" : "1"}</div>
          <span>Upload CSV</span>
        </div>

        <div className={`step-divider ${currentStep > 1 ? "filled" : ""}`}></div>

        <div className={`step-node ${currentStep === 2 ? "active" : currentStep > 2 ? "completed" : ""}`}>
          <div className="step-circle">{currentStep > 2 ? "âœ“" : "2"}</div>
          <span>Validate Schema</span>
        </div>

        <div className={`step-divider ${currentStep > 2 ? "filled" : ""}`}></div>

        <div className={`step-node ${currentStep === 3 ? "active" : currentStep > 3 ? "completed" : ""}`}>
          <div className="step-circle">{currentStep > 3 ? "âœ“" : "3"}</div>
          <span>Preview &amp; Review</span>
        </div>

        <div className={`step-divider ${currentStep > 3 ? "filled" : ""}`}></div>

        <div className={`step-node ${currentStep === 4 ? "completed active" : ""}`}>
          <div className="step-circle">4</div>
          <span>Import to Registry</span>
        </div>
      </div>

      {/* 3. SUCCESS SUMMARY STATE */}
      {importResult && (
        <div className="import-success-card">
          <div className="success-header-row">
            <div className="success-icon-box">
              <CheckCircle2 size={28} />
            </div>
            <div>
              <h3>Cameras Successfully Imported!</h3>
              <p>The cameras below have been registered in the Gujarat State CCTV Registry and are ready for live surveillance.</p>
            </div>
          </div>

          {/* KPI Summary: Imported: X, Skipped: Y, Failed: Z */}
          <div className="import-metrics-grid">
            <div className="metric-tile imported">
              <span>Imported</span>
              <strong>{importResult.imported_count || 0}</strong>
            </div>

            <div className="metric-tile skipped">
              <span>Skipped</span>
              <strong>
                {importResult.skipped_count !== undefined
                  ? importResult.skipped_count
                  : Math.max(0, totalCount - (importResult.imported_count || 0))}
              </strong>
            </div>

            <div className="metric-tile failed">
              <span>Failed</span>
              <strong>{importResult.failed_count !== undefined ? importResult.failed_count : invalidCount}</strong>
            </div>
          </div>

          {/* Imported Camera Badges */}
          {((importResult.imported_codes || importResult.imported_cameras)?.length > 0) && (
            <div className="imported-chips-row">
              {(importResult.imported_codes || importResult.imported_cameras).slice(0, 12).map((code) => (
                <span key={code} className="imported-cam-badge">
                  {code}
                </span>
              ))}
              {(importResult.imported_codes || importResult.imported_cameras).length > 12 && (
                <span className="imported-cam-badge" style={{ color: "#94a3b8" }}>
                  +{(importResult.imported_codes || importResult.imported_cameras).length - 12} more
                </span>
              )}
            </div>
          )}

          <div className="success-actions">
            {onNavigateToMap && (
              <button
                type="button"
                className="btn-primary-import"
                onClick={onNavigateToMap}
              >
                <MapPin size={15} />
                <span>View Imported Cameras on GIS Live Map</span>
              </button>
            )}

            <button
              type="button"
              className="btn-secondary"
              onClick={handleReset}
            >
              Upload Another CSV
            </button>
          </div>
        </div>
      )}

      {/* 4. SENTINEL GATEWAY 1-CLICK SYNC (When not viewing preview or result) */}
      {!validationData && !importResult && (
        <div className="sentinel-sync-card">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
              <span className="sentinel-sync-badge">OFFICIAL SENTINEL INTEGRATION</span>
              <span style={{ fontSize: "11px", color: "#94a3b8" }}>Gujarat Police Hackathon 2026</span>
            </div>
            <h4 style={{ margin: "0 0 4px", fontSize: "14px", fontWeight: 700, color: "#f8fafc" }}>
              Sync Live Cameras from Sentinel Gateway (/api/ingest)
            </h4>
            <p style={{ margin: 0, fontSize: "12px", color: "#94a3b8" }}>
              Import judge-provided camera feeds from the published catalogue; if catalogue access
              requires login, use the bundled judge camera list. RTSP credentials stay encrypted on
              the backend.
            </p>
            {syncError && (
              <p style={{ margin: "6px 0 0", fontSize: "12px", color: "#f87171" }}>
                {syncError}
              </p>
            )}
          </div>

          <div className="sentinel-sync-actions">
            <input
              type="text"
              value={sentinelGatewayUrl}
              onChange={(e) => setSentinelGatewayUrl(e.target.value)}
              placeholder="https://cctv.corp8.cloud/cameras.json"
              className="sentinel-input"
            />
            <button
              type="button"
              disabled={isSyncingSentinel}
              onClick={handleSyncSentinel}
              className="sentinel-sync-btn"
            >
              <RefreshCw size={13} className={isSyncingSentinel ? "animate-spin" : ""} />
              <span>{isSyncingSentinel ? "Syncing Grid..." : "1-Click Sync"}</span>
            </button>
          </div>
        </div>
      )}

      {/* 5. UPLOAD & DROPZONE CARD (When not validated or results) */}
      {!validationData && !importResult && (
        <div className="csv-upload-section">
          {/* Hidden File Input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            style={{ display: "none" }}
            onChange={handleFileChange}
          />

          {!selectedFile ? (
            /* EMPTY STATE DROPZONE */
            <div
              className={`csv-dropzone ${dragActive ? "drag-active" : ""}`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="dropzone-inner">
                <div className="dropzone-icon-box">
                  <UploadCloud size={32} />
                </div>
                <h4>Drag &amp; drop your CSV file here</h4>
                <p>or click anywhere to browse from your device</p>
                <button
                  type="button"
                  className="dropzone-browse-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                >
                  <FileSpreadsheet size={14} />
                  <span>Browse .CSV File</span>
                </button>
                <span className="format-pill">Accepted format: .csv only (UTF-8, Max 10 MB)</span>
              </div>
            </div>
          ) : (
            /* FILE SELECTED CARD */
            <div className="file-selected-box">
              <div className="file-meta-col">
                <div className="file-badge-icon">
                  <FileText size={22} />
                </div>
                <div className="file-meta-text">
                  <strong>{selectedFile.name}</strong>
                  <span>{(selectedFile.size / 1024).toFixed(1)} KB â€¢ Ready for schema validation</span>
                </div>
              </div>

              <div className="file-action-buttons">
                <button
                  type="button"
                  className="btn-file-action"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Replace File
                </button>

                <button
                  type="button"
                  className="btn-file-action danger"
                  onClick={handleReset}
                >
                  <X size={13} />
                  <span>Remove</span>
                </button>

                <button
                  type="button"
                  className="btn-primary-import"
                  onClick={() => processFile(selectedFile)}
                  disabled={isValidating}
                  style={{ padding: "8px 16px", fontSize: "12px" }}
                >
                  <RefreshCw size={13} className={isValidating ? "animate-spin" : ""} />
                  <span>{isValidating ? "Validating..." : "Validate CSV"}</span>
                </button>
              </div>
            </div>
          )}

          {/* REQUIRED COLUMNS FORMAT HELPER */}
          <div className="csv-columns-reference">
            <div className="ref-header">
              <HelpCircle size={14} color="#38bdf8" />
              <span>Required CSV Column Schema:</span>
            </div>
            <div className="ref-chips-grid">
              <span className="ref-col-chip required" title="Unique camera identifier">camera_code *</span>
              <span className="ref-col-chip required" title="Department name or agency">dept_name *</span>
              <span className="ref-col-chip required" title="Camera type: ANPR, FIXED, PTZ, BULLET, DOME, THERMAL">camera_type *</span>
              <span className="ref-col-chip required" title="IP Address">ip_address *</span>
              <span className="ref-col-chip required" title="RTSP Stream URL">rtsp_url *</span>
              <span className="ref-col-chip required" title="Latitude coordinate (e.g. 23.0225)">latitude *</span>
              <span className="ref-col-chip required" title="Longitude coordinate (e.g. 72.5714)">longitude *</span>
              <span className="ref-col-chip optional" title="Make and model (optional)">make_model</span>
              <span className="ref-col-chip optional" title="Camera status: ONLINE / OFFLINE (optional)">status</span>
              <span className="ref-col-chip optional" title="Ageing in years (optional)">ageing</span>
            </div>
          </div>
        </div>
      )}

      {/* 6. VALIDATING PROGRESS BANNER */}
      {isValidating && (
        <div className="validating-banner">
          <RefreshCw size={18} className="animate-spin" />
          <span>Validating schema, coordinates, and network camera parameters...</span>
        </div>
      )}

      {/* 7. VALIDATION ERROR ALERT */}
      {validationError && (
        <div className="csv-error-alert">
          <AlertCircle size={20} />
          <div>
            <strong>CSV Validation Failed</strong>
            <p>{validationError}</p>
          </div>
          <button type="button" onClick={() => setValidationError("")}>
            <XCircle size={16} />
          </button>
        </div>
      )}

      {/* 8. PREVIEW & REVIEW TABLE */}
      {validationData && !importResult && (
        <div className="csv-results-section">
          {/* STATS & FILTER TOOLBAR */}
          <div className="csv-summary-toolbar">
            <div className="kpi-group">
              <div className="kpi-pill total">
                <span>Total Rows Detected:</span>
                <strong>{totalCount}</strong>
              </div>

              <div className="kpi-pill valid">
                <Check size={14} />
                <span>Ready to Import:</span>
                <strong>{validCount}</strong>
              </div>

              {invalidCount > 0 && (
                <div className="kpi-pill error">
                  <AlertTriangle size={14} />
                  <span>Issues Found:</span>
                  <strong>{invalidCount}</strong>
                </div>
              )}
            </div>

            <div className="filter-and-actions">
              <div className="filter-toggle-group">
                <button
                  type="button"
                  className={`filter-btn ${filterMode === "ALL" ? "active" : ""}`}
                  onClick={() => setFilterMode("ALL")}
                >
                  All Rows ({totalCount})
                </button>

                <button
                  type="button"
                  className={`filter-btn valid ${filterMode === "VALID" ? "active" : ""}`}
                  onClick={() => setFilterMode("VALID")}
                >
                  Valid Only ({validCount})
                </button>

                {invalidCount > 0 && (
                  <button
                    type="button"
                    className={`filter-btn error ${filterMode === "ERROR" ? "active" : ""}`}
                    onClick={() => setFilterMode("ERROR")}
                  >
                    Errors Only ({invalidCount})
                  </button>
                )}
              </div>

              <button
                type="button"
                className="add-row-action-btn"
                onClick={handleAddNewRow}
              >
                <Plus size={13} />
                <span>Add Camera Row</span>
              </button>
            </div>
          </div>

          {/* DATA PREVIEW TABLE */}
          <div className="csv-table-wrapper">
            <table className="csv-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Status</th>
                  <th>Camera Code</th>
                  <th>Department</th>
                  <th>Type</th>
                  <th>IP Address</th>
                  <th>RTSP Stream</th>
                  <th>Coordinates</th>
                  <th>Validation Diagnostics</th>
                  <th style={{ textAlign: "center", minWidth: "90px" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const isEditing = editingRowIndex === row.originalIndex;

                  return (
                    <tr
                      key={row.row_number || row.originalIndex}
                      className={row.is_valid ? "row-valid" : "row-invalid"}
                      style={isEditing ? { background: "rgba(56, 189, 248, 0.08)" } : {}}
                    >
                      <td>{row.originalIndex + 1}</td>

                      {/* STATUS BADGE */}
                      <td>
                        {row.is_valid ? (
                          <span className="status-badge valid">
                            <Check size={11} /> Ready
                          </span>
                        ) : (
                          <span className="status-badge error">
                            <XCircle size={11} /> Error
                          </span>
                        )}
                      </td>

                      {/* CAMERA CODE */}
                      <td>
                        {isEditing ? (
                          <input
                            type="text"
                            value={editDraft.camera_code}
                            onChange={(e) => setEditDraft({ ...editDraft, camera_code: e.target.value })}
                            style={{
                              width: "110px",
                              padding: "4px 6px",
                              fontSize: "12px",
                              borderRadius: "4px",
                              background: "#0f172a",
                              color: "#f8fafc",
                              border: "1px solid #475569"
                            }}
                          />
                        ) : (
                          <strong className="code-text">{row.camera_code}</strong>
                        )}
                      </td>

                      {/* DEPARTMENT */}
                      <td>
                        {isEditing ? (
                          <input
                            type="text"
                            value={editDraft.dept_name}
                            onChange={(e) => setEditDraft({ ...editDraft, dept_name: e.target.value })}
                            style={{
                              width: "140px",
                              padding: "4px 6px",
                              fontSize: "12px",
                              borderRadius: "4px",
                              background: "#0f172a",
                              color: "#f8fafc",
                              border: "1px solid #475569"
                            }}
                          />
                        ) : (
                          <span style={{ fontSize: "12px", color: "#cbd5e1" }}>{row.dept_name}</span>
                        )}
                      </td>

                      {/* CAMERA TYPE */}
                      <td>
                        {isEditing ? (
                          <select
                            value={editDraft.camera_type}
                            onChange={(e) => setEditDraft({ ...editDraft, camera_type: e.target.value })}
                            style={{
                              padding: "4px 6px",
                              fontSize: "11px",
                              borderRadius: "4px",
                              background: "#0f172a",
                              color: "#f8fafc",
                              border: "1px solid #475569"
                            }}
                          >
                            <option value="ANPR">ANPR</option>
                            <option value="BULLET">Bullet</option>
                            <option value="PTZ">PTZ</option>
                            <option value="DOME">Dome</option>
                            <option value="FIXED">Fixed</option>
                            <option value="THERMAL">Thermal</option>
                          </select>
                        ) : (
                          <span className={`type-pill ${row.camera_type === "ANPR" ? "anpr" : ""}`}>
                            {row.camera_type}
                          </span>
                        )}
                      </td>

                      {/* IP ADDRESS */}
                      <td>
                        {isEditing ? (
                          <input
                            type="text"
                            value={editDraft.ip_address}
                            onChange={(e) => setEditDraft({ ...editDraft, ip_address: e.target.value })}
                            style={{
                              width: "110px",
                              padding: "4px 6px",
                              fontSize: "12px",
                              borderRadius: "4px",
                              background: "#0f172a",
                              color: "#f8fafc",
                              border: "1px solid #475569"
                            }}
                          />
                        ) : (
                          <code style={{ fontSize: "11px", color: "#94a3b8" }}>{row.ip_address || "â€”"}</code>
                        )}
                      </td>

                      {/* RTSP STREAM */}
                      <td>
                        {isEditing ? (
                          <input
                            type="text"
                            value={editDraft.rtsp_url}
                            onChange={(e) => setEditDraft({ ...editDraft, rtsp_url: e.target.value })}
                            style={{
                              width: "180px",
                              padding: "4px 6px",
                              fontSize: "11px",
                              borderRadius: "4px",
                              background: "#0f172a",
                              color: "#f8fafc",
                              border: "1px solid #475569"
                            }}
                          />
                        ) : (
                          <span
                            title={row.rtsp_url}
                            style={{ fontSize: "11px", color: "#cbd5e1", maxWidth: "160px", display: "inline-block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                          >
                            {row.rtsp_url || "â€”"}
                          </span>
                        )}
                      </td>

                      {/* COORDINATES */}
                      <td>
                        {isEditing ? (
                          <div style={{ display: "flex", gap: "4px" }}>
                            <input
                              type="number"
                              step="0.0001"
                              placeholder="Lat"
                              value={editDraft.latitude}
                              onChange={(e) => setEditDraft({ ...editDraft, latitude: e.target.value })}
                              style={{ width: "65px", padding: "4px", fontSize: "11px", borderRadius: "4px", background: "#0f172a", color: "#f8fafc", border: "1px solid #475569" }}
                            />
                            <input
                              type="number"
                              step="0.0001"
                              placeholder="Lng"
                              value={editDraft.longitude}
                              onChange={(e) => setEditDraft({ ...editDraft, longitude: e.target.value })}
                              style={{ width: "65px", padding: "4px", fontSize: "11px", borderRadius: "4px", background: "#0f172a", color: "#f8fafc", border: "1px solid #475569" }}
                            />
                          </div>
                        ) : (
                          <span className="coords-text">
                            {row.latitude !== null && row.latitude !== undefined ? Number(row.latitude).toFixed(4) : "â€”"},{" "}
                            {row.longitude !== null && row.longitude !== undefined ? Number(row.longitude).toFixed(4) : "â€”"}
                          </span>
                        )}
                      </td>

                      {/* DIAGNOSTICS */}
                      <td>
                        {row.is_valid ? (
                          <span className="note-ok">Passed schema verification</span>
                        ) : (
                          <span className="note-err" title={(row.errors || []).join("; ")}>
                            {(row.errors || []).join("; ") || "Invalid entry"}
                          </span>
                        )}
                      </td>

                      {/* ACTIONS */}
                      <td style={{ textAlign: "center" }}>
                        {isEditing ? (
                          <div style={{ display: "inline-flex", gap: "6px" }}>
                            <button
                              type="button"
                              onClick={() => handleSaveEdit(row.originalIndex)}
                              title="Save edits"
                              style={{
                                padding: "4px 8px",
                                background: "#16a34a",
                                color: "#ffffff",
                                border: "none",
                                borderRadius: "4px",
                                cursor: "pointer",
                                display: "inline-flex",
                                alignItems: "center"
                              }}
                            >
                              <Save size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={handleCancelEdit}
                              title="Cancel"
                              style={{
                                padding: "4px 8px",
                                background: "#475569",
                                color: "#ffffff",
                                border: "none",
                                borderRadius: "4px",
                                cursor: "pointer",
                                display: "inline-flex",
                                alignItems: "center"
                              }}
                            >
                              <X size={13} />
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: "inline-flex", gap: "6px" }}>
                            <button
                              type="button"
                              onClick={() => handleStartEdit(row, row.originalIndex)}
                              title="Edit this camera"
                              style={{
                                padding: "4px 7px",
                                background: "#1e293b",
                                color: "#38bdf8",
                                border: "1px solid #334155",
                                borderRadius: "4px",
                                cursor: "pointer",
                                display: "inline-flex",
                                alignItems: "center"
                              }}
                            >
                              <Edit2 size={12} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteRow(row.originalIndex)}
                              title="Remove from batch"
                              style={{
                                padding: "4px 7px",
                                background: "rgba(239, 68, 68, 0.15)",
                                color: "#f87171",
                                border: "1px solid rgba(239, 68, 68, 0.3)",
                                borderRadius: "4px",
                                cursor: "pointer",
                                display: "inline-flex",
                                alignItems: "center"
                              }}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* SUBMIT FOOTER BAR */}
          <div className="csv-submit-deck">
            <div className="submit-info">
              {validCount > 0 ? (
                <p>
                  Ready to deploy <strong>{validCount} verified cameras</strong> into the Gujarat State CCTV Registry.
                  {invalidCount > 0 && ` (${invalidCount} invalid rows will be skipped).`}
                </p>
              ) : (
                <p style={{ color: "#f87171" }}>
                  No valid camera records detected. Use the edit icon to fix row errors or click "Add Camera Row".
                </p>
              )}
            </div>

            {importError && (
              <div className="csv-error-alert" style={{ margin: "10px 0 0", width: "100%" }}>
                <AlertCircle size={16} />
                <span>{importError}</span>
              </div>
            )}

            <div className="submit-buttons">
              <button
                type="button"
                className="btn-secondary"
                onClick={handleReset}
              >
                Change File
              </button>

              <button
                type="button"
                className="btn-primary-import"
                onClick={handleConfirmImport}
                disabled={isImporting || validCount === 0}
              >
                {isImporting ? (
                  <>
                    <RefreshCw size={15} className="animate-spin" />
                    <span>Importing Cameras...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={15} />
                    <span>Confirm &amp; Import {validCount} Cameras</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
