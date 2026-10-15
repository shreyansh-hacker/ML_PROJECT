import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Camera,
  CheckCircle2,
  Plus,
  ShieldCheck,
  Video,
  X,
  RefreshCw,
  AlertCircle,
  MapPin,
  Wifi,
  AlertTriangle,
  Play,
  FileSpreadsheet,
  Radio,
  LayoutGrid,
  Search
} from "lucide-react";

import GisMap from "./components/GisMap";
import CsvImport from "./components/CsvImport";
import CameraFeedModal from "./components/CameraFeedModal";
import AnprRadar from "./components/AnprRadar";
import SurveillanceMatrix from "./components/SurveillanceMatrix";
import DetectionInvestigation from "./components/DetectionInvestigation";
import { apiFetch, apiUrl, API_BASE_URL } from "./utils/apiConfig";
import "./App.css";

const fallbackDepartments = [
  "Gujarat Police",
  "Ahmedabad Municipal Corporation",
  "Surat Municipal Corporation",
  "Vadodara Municipal Corporation",
  "Rajkot Municipal Corporation",
  "Gujarat State Road Transport",
  "Gujarat Traffic Police",
  "Gujarat Metro Rail",
  "Gandhinagar Municipal Corporation",
  "Surat Traffic Police",
];

const emptyCamera = {
  sourceType: "NETWORK_CCTV",
  cameraCode: "",
  cameraType: "FIXED",
  latitude: "23.0225",
  longitude: "72.5714",
  makeModel: "",
  ipAddress: "",
  rtspUrl: "",
  status: "ONLINE",
  ageing: "0.5",
};

function App() {
  const [authReady, setAuthReady] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [activeTab, setActiveTab] = useState("onboarding"); // "onboarding" | "bulk_csv" | "map" | "video_wall" | "anpr" | "investigation"
  const [step, setStep] = useState(1);
  const [gisTrackPlate, setGisTrackPlate] = useState(null);
  const [anprInitialSource, setAnprInitialSource] = useState(null);

  // Departments state
  const [departments, setDepartments] = useState(fallbackDepartments);
  const [departmentObjects, setDepartmentObjects] = useState([]);
  const [selectedDepartment, setSelectedDepartment] = useState("");

  // New Department modal
  const [showNewDepartment, setShowNewDepartment] = useState(false);
  const [newDepartment, setNewDepartment] = useState("");
  const [departmentCode, setDepartmentCode] = useState("");

  // Camera details state
  const [cameraSource, setCameraSource] = useState("NETWORK_CCTV");
  const [camera, setCamera] = useState(emptyCamera);

  // WebRTC Webcam stream state
  const [cameraStream, setCameraStream] = useState(null);
  const [webcamError, setWebcamError] = useState("");

  // IP Connectivity & Validation Probe State
  const [ipTesting, setIpTesting] = useState(false);
  const [ipCheckResult, setIpCheckResult] = useState(null);

  // UI status & feedback states
  const [error, setError] = useState("");
  const [backendOnline, setBackendOnline] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedCamera, setSubmittedCamera] = useState(null);

  // Live Camera Feed Modal trigger
  const [streamNowCamera, setStreamNowCamera] = useState(null);

  const videoRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch(apiUrl("/api/auth/session"))
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled) {
          setIsAuthenticated(Boolean(data.authenticated));
          setAuthReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) setAuthReady(true);
      });
    const handleUnauthorized = () => setIsAuthenticated(false);
    window.addEventListener("sentinel:unauthorized", handleUnauthorized);
    return () => {
      cancelled = true;
      window.removeEventListener("sentinel:unauthorized", handleUnauthorized);
    };
  }, []);

  const handleLogin = async (event) => {
    event.preventDefault();
    setIsLoggingIn(true);
    setLoginError("");
    try {
      const response = await apiFetch(apiUrl("/api/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: loginPassword })
      });
      const data = await response.json();
      if (!response.ok) {
        setLoginError(data.detail || "Login failed.");
        return;
      }
      setLoginPassword("");
      setIsAuthenticated(true);
    } catch {
      setLoginError("Could not reach the security service. Check that the backend is running.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      const response = await apiFetch(apiUrl("/api/auth/logout"), { method: "POST" });
      if (!response.ok) throw new Error("The server could not end the secure session.");
      setIsAuthenticated(false);
      setActiveTab("onboarding");
    } catch (logoutError) {
      console.error("Failed to end the secure session:", logoutError);
    }
  };

  // 1. Fetch departments and check backend health on mount with auto-retry and keep-alive heartbeat
  useEffect(() => {
    if (!authReady || !isAuthenticated) return undefined;
    let isCancelled = false;
    let retryTimer = null;
    let heartbeatTimer = null;

    async function loadInitialData() {
      try {
        const response = await apiFetch(apiUrl("/api/departments"));
        if (!isCancelled && response.ok) {
          const data = await response.json();
          setBackendOnline(true);
          if (data && data.length > 0) {
            setDepartmentObjects(data);
            setDepartments(data.map((d) => d.dept_name));
          }
          return true;
        }
      } catch (err) {
        console.warn("Backend connection attempt failed:", err);
      }
      if (!isCancelled) {
        setBackendOnline(false);
      }
      return false;
    }

    async function pollUntilOnline() {
      const isOnline = await loadInitialData();
      if (!isOnline && !isCancelled) {
        // Render cold start can take 15-30s. Auto-retry every 4 seconds until connected
        retryTimer = setTimeout(pollUntilOnline, 4000);
      }
    }

    pollUntilOnline();

    // Heartbeat ping every 30s to keep Render free-tier instance warm while user has tab open
    heartbeatTimer = setInterval(async () => {
      try {
        const res = await apiFetch(apiUrl("/health"));
        if (!isCancelled) {
          setBackendOnline(res.ok);
        }
      } catch {
        if (!isCancelled) setBackendOnline(false);
      }
    }, 30000);

    return () => {
      isCancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    };
  }, [authReady, isAuthenticated]);

  const updateCamera = (field, value) => {
    setCamera((previous) => ({
      ...previous,
      [field]: value,
    }));

    if (field === "ipAddress") {
      setIpCheckResult(null);
    }
  };

  // 2. Real-time Live IP Validation & TCP Socket Probe
  const handleTestIpConnection = async () => {
    const rawIp = (camera.ipAddress || "").trim();
    if (!rawIp) {
      setIpCheckResult({
        is_valid_format: false,
        detail: "Please enter an IP address first before testing.",
      });
      return;
    }

    setIpTesting(true);
    setIpCheckResult(null);

    try {
      const response = await apiFetch(apiUrl("/api/cameras/validate-ip"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ip_address: rawIp,
          port: 554,
          timeout_seconds: 2.0,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setIpCheckResult(data);

        if (data.is_reachable) {
          updateCamera("status", "ONLINE");
        } else if (data.is_valid_format) {
          updateCamera("status", "OFFLINE");
        }
      } else {
        setIpCheckResult({
          is_valid_format: false,
          is_reachable: false,
          detail: "Backend validation service returned an error.",
        });
      }
    } catch {
      setIpCheckResult({
        is_valid_format: false,
        is_reachable: false,
        detail: "Could not reach backend validation API on port 8000.",
      });
    } finally {
      setIpTesting(false);
    }
  };

  const stopWebcam = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
    }

    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }

    setCameraStream(null);

    setCamera((previous) => ({
      ...previous,
      status: "OFFLINE",
    }));
  };

  const startWebcam = async () => {
    try {
      setWebcamError("");

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setWebcamError("Webcam access is not supported in this browser.");
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });

      setCameraStream(stream);

      setCamera((previous) => ({
        ...previous,
        sourceType: "LOCAL_WEBCAM",
        cameraType: "FIXED",
        status: "ONLINE",
      }));
    } catch (cameraError) {
      console.error("Webcam error:", cameraError);
      setWebcamError("Unable to access laptop camera. Please grant camera permission.");
    }
  };

  useEffect(() => {
    if (cameraStream && videoRef.current) {
      videoRef.current.srcObject = cameraStream;
      videoRef.current.muted = true;
      videoRef.current.playsInline = true;

      videoRef.current.play().catch((err) => {
        console.error("Video play error:", err);
      });
    }
  }, [cameraStream]);

  useEffect(() => {
    return () => {
      if (cameraStream) {
        cameraStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [cameraStream]);

  const handleSourceChange = (source) => {
    if (source === "NETWORK_CCTV") {
      stopWebcam();
    }

    setCameraSource(source);
    setIpCheckResult(null);

    setCamera((previous) => ({
      ...previous,
      sourceType: source,
      ipAddress: source === "LOCAL_WEBCAM" ? "127.0.0.1" : previous.ipAddress,
      rtspUrl: source === "LOCAL_WEBCAM" ? "webrtc://local-device/webcam" : previous.rtspUrl,
      latitude: previous.latitude || "23.0225",
      longitude: previous.longitude || "72.5714",
      makeModel: source === "LOCAL_WEBCAM" ? "Laptop High-Def Webcam" : previous.makeModel,
      ageing: source === "LOCAL_WEBCAM" ? "0" : previous.ageing,
      cameraType: source === "LOCAL_WEBCAM" ? "FIXED" : previous.cameraType || "FIXED",
      status: source === "LOCAL_WEBCAM" ? "ONLINE" : "ONLINE",
    }));

    setError("");
    setWebcamError("");
  };

  // 3. Department Creation (Integrated with Backend POST /api/departments)
  const handleCreateDepartment = async (event) => {
    event.preventDefault();

    const name = newDepartment.trim();
    const code = departmentCode.trim();

    if (!name || !code) {
      setError("Please fill in all required department fields.");
      return;
    }

    const departmentExists = departments.some(
      (dept) => dept.toLowerCase() === name.toLowerCase()
    );

    if (departmentExists) {
      setError("This department already exists.");
      return;
    }

    try {
      const response = await apiFetch(apiUrl("/api/departments"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dept_name: name, zone_code: code }),
      });

      if (response.ok) {
        const createdDept = await response.json();
        setDepartmentObjects((prev) => [...prev, createdDept]);
        setDepartments((prev) => [...prev, createdDept.dept_name]);
        setSelectedDepartment(createdDept.dept_name);
      } else {
        setDepartments((prev) => [...prev, name]);
        setSelectedDepartment(name);
      }
    } catch {
      setDepartments((prev) => [...prev, name]);
      setSelectedDepartment(name);
    }

    setNewDepartment("");
    setDepartmentCode("");
    setError("");
    setShowNewDepartment(false);
  };

  const continueToCameraDetails = () => {
    if (!selectedDepartment) {
      setError("Please select a department.");
      return;
    }

    setError("");
    setStep(2);
  };

  const continueToReview = (event) => {
    event.preventDefault();

    if (!camera.cameraCode.trim()) {
      setError("Camera Code is required.");
      return;
    }

    if (cameraSource === "NETWORK_CCTV") {
      if (!camera.latitude || !camera.longitude) {
        setError("Latitude and Longitude coordinates are required for Network CCTV.");
        return;
      }

      if (!camera.ipAddress.trim() || !camera.rtspUrl.trim()) {
        setError("IP Address and RTSP URL are required for Network CCTV.");
        return;
      }
    }

    setCamera((previous) => ({
      ...previous,
      sourceType: cameraSource,
    }));

    setError("");
    setStep(3);
  };

  // 4. Submit Camera to Backend API (POST /api/cameras/manual)
  const submitOnboarding = async () => {
    setError("");
    setIsSubmitting(true);

    const matchedDept = departmentObjects.find(
      (d) => d.dept_name.toLowerCase() === selectedDepartment.toLowerCase()
    );

    const payload = {
      dept_id: matchedDept?.id || undefined,
      department_name: selectedDepartment,
      source_type: cameraSource,
      camera_code: camera.cameraCode.trim(),
      make_model:
        cameraSource === "NETWORK_CCTV"
          ? camera.makeModel || "Generic CCTV"
          : "Laptop High-Def Webcam",
      ip_address:
        cameraSource === "NETWORK_CCTV" ? camera.ipAddress.trim() : "127.0.0.1",
      rtsp_url:
        cameraSource === "NETWORK_CCTV" ? camera.rtspUrl.trim() : "webrtc://local-device/webcam",
      latitude: camera.latitude ? parseFloat(camera.latitude) : 23.0225,
      longitude: camera.longitude ? parseFloat(camera.longitude) : 72.5714,
      camera_type: camera.cameraType || "FIXED",
      status: camera.status || "ONLINE",
      ageing:
        cameraSource === "NETWORK_CCTV" && camera.ageing
          ? parseFloat(camera.ageing)
          : 0.0,
    };

    try {
      const response = await apiFetch(apiUrl("/api/cameras/manual"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (response.ok) {
        setSubmittedCamera({
          id: data.id,
          camera_code: data.camera_code,
          status: data.status || camera.status,
          department: selectedDepartment,
          dept_name: selectedDepartment,
          source_type: cameraSource,
          make_model: payload.make_model,
          ip_address: payload.ip_address,
          rtsp_url: payload.rtsp_url,
          latitude: payload.latitude,
          longitude: payload.longitude,
          camera_type: payload.camera_type,
        });
      } else {
        setError(data.detail || "Failed to register camera. Please verify the input values.");
      }
    } catch {
      setError("Cannot reach Backend API. Ensure the backend server is running on port 8000.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    stopWebcam();
    setCamera(emptyCamera);
    setCameraSource("NETWORK_CCTV");
    setSelectedDepartment("");
    setSubmittedCamera(null);
    setIpCheckResult(null);
    setError("");
    setStep(1);
  };

  if (!authReady) {
    return <main className="auth-loading">Checking secure sessionâ€¦</main>;
  }

  if (!isAuthenticated) {
    return (
      <main className="auth-screen">
        <form className="auth-card" onSubmit={handleLogin}>
          <div className="auth-brand-symbol">GS</div>
          <p className="auth-eyebrow">SECURE ACCESS</p>
          <h1>Gujarat Sentinel</h1>
          <p className="auth-description">Sign in to access camera feeds and surveillance controls.</p>
          <label htmlFor="admin-password">Administrator password</label>
          <input
            id="admin-password"
            type="password"
            autoComplete="current-password"
            value={loginPassword}
            onChange={(event) => setLoginPassword(event.target.value)}
            required
            autoFocus
          />
          {loginError && <p className="auth-error" role="alert">{loginError}</p>}
          <button type="submit" disabled={isLoggingIn}>
            {isLoggingIn ? "Signing inâ€¦" : "Sign in"}
          </button>
        </form>
      </main>
    );
  }

  return (
    <div className="onboarding-app">
      {/* HEADER */}
      <header className="onboarding-header">
        <div className="header-brand">
          <div className="brand-symbol">GS</div>
          <div>
            <h1>Gujarat Sentinel</h1>
            <p>CCTV Registry & GIS Foundation</p>
          </div>
        </div>

        {/* PRIMARY VIEW NAVIGATION TABS */}
        <nav className="header-nav-tabs">
          <button
            type="button"
            className={`nav-tab-btn ${activeTab === "onboarding" ? "active" : ""}`}
            onClick={() => setActiveTab("onboarding")}
          >
            <Camera size={16} />
            <span>Single Camera</span>
          </button>

          <button
            type="button"
            className={`nav-tab-btn ${activeTab === "bulk_csv" ? "active" : ""}`}
            onClick={() => setActiveTab("bulk_csv")}
          >
            <FileSpreadsheet size={16} />
            <span>Bulk CSV Upload</span>
          </button>

          <button
            type="button"
            className={`nav-tab-btn ${activeTab === "map" ? "active" : ""}`}
            onClick={() => setActiveTab("map")}
          >
            <MapPin size={16} />
            <span>GIS Live Map</span>
          </button>

          <button
            type="button"
            className={`nav-tab-btn ${activeTab === "video_wall" ? "active" : ""}`}
            onClick={() => setActiveTab("video_wall")}
          >
            <LayoutGrid size={16} />
            <span>Video Wall</span>
          </button>

          <button
            type="button"
            className={`nav-tab-btn ${activeTab === "anpr" ? "active" : ""}`}
            onClick={() => setActiveTab("anpr")}
          >
            <Radio size={16} />
            <span>ANPR Intelligence</span>
          </button>

          <button
            type="button"
            className={`nav-tab-btn ${activeTab === "investigation" ? "active" : ""}`}
            onClick={() => setActiveTab("investigation")}
          >
            <Search size={16} />
            <span>Search &amp; Audit</span>
          </button>
        </nav>

        {/* BACKEND SERVER STATUS */}
        <div className="header-status" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span
            className="online-indicator"
            style={{
              background:
                backendOnline === true
                  ? "#36d399"
                  : backendOnline === false
                  ? "#f87171"
                  : "#fbbf24",
              boxShadow:
                backendOnline === true
                  ? "0 0 8px rgba(54, 211, 153, 0.6)"
                  : backendOnline === false
                  ? "0 0 8px rgba(248, 113, 113, 0.6)"
                  : "0 0 8px rgba(251, 191, 36, 0.6)"
            }}
          ></span>
          <span>
            {backendOnline === true
              ? (API_BASE_URL ? "Backend Connected (Cloud)" : "Backend Connected (Local)")
              : backendOnline === false
              ? (API_BASE_URL ? "Waking Cloud Backend... (Auto-retrying)" : "Backend Offline")
              : "Connecting Backend..."}
          </span>
          {backendOnline === false && (
            <button
              onClick={async () => {
                setBackendOnline(null);
                try {
                  const r = await apiFetch(apiUrl("/api/departments"));
                  if (r.ok) {
                    const data = await r.json();
                    setBackendOnline(true);
                    if (data && data.length > 0) {
                      setDepartmentObjects(data);
                      setDepartments(data.map((d) => d.dept_name));
                    }
                  } else {
                    setBackendOnline(false);
                  }
                } catch {
                  setBackendOnline(false);
                }
              }}
              style={{
                background: "rgba(255, 255, 255, 0.08)",
                border: "1px solid rgba(255, 255, 255, 0.2)",
                color: "#e2e8f0",
                borderRadius: "4px",
                padding: "2px 7px",
                fontSize: "11px",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px"
              }}
              title="Click to manually retry connecting to backend"
            >
              <RefreshCw size={11} /> Retry
            </button>
          )}
          <button type="button" className="auth-logout-button" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </header>

      {/* VIEW SWITCHER */}
      {activeTab === "map" ? (
        <GisMap
          onSwitchToOnboarding={() => setActiveTab("onboarding")}
          onSwitchToBulkCsv={() => setActiveTab("bulk_csv")}
          initialTrackPlate={gisTrackPlate}
          onClearTrackPlate={() => setGisTrackPlate(null)}
        />
      ) : activeTab === "bulk_csv" ? (
        <main className="onboarding-main" style={{ maxWidth: "1280px", margin: "0 auto", padding: "24px 20px" }}>
          <CsvImport onNavigateToMap={() => setActiveTab("map")} />
        </main>
      ) : activeTab === "video_wall" ? (
        <main className="video-wall-page-main">
          <SurveillanceMatrix
            onNavigateToOnboarding={() => setActiveTab("onboarding")}
            onOpenDetailedView={(camera) => {
              setAnprInitialSource(camera.id || camera.camera_code);
              setActiveTab("anpr");
            }}
          />
        </main>
      ) : activeTab === "investigation" ? (
        <main className="investigation-page-main">
          <DetectionInvestigation
            onTrackOnMap={(plate) => {
              setGisTrackPlate(plate);
              setActiveTab("map");
            }}
            onOpenAnpr={(camera) => {
              setAnprInitialSource(camera.id || camera.camera_code);
              setActiveTab("anpr");
            }}
          />
        </main>
      ) : activeTab === "anpr" ? (
        <main className="anpr-page-main">
          <AnprRadar
            onNavigateToOnboarding={() => setActiveTab("onboarding")}
            initialSourceId={anprInitialSource}
            onClearInitialSource={() => setAnprInitialSource(null)}
            onTrackOnMap={(plate) => {
              setGisTrackPlate(plate);
              setActiveTab("map");
            }}
          />
        </main>
      ) : (
        /* MAIN ONBOARDING VIEW */
        <main className="onboarding-main">
          <div className="page-heading">
            <div>
              <p className="eyebrow">CAMERA REGISTRY</p>
              <h2>Main Onboarding Dashboard</h2>
              <p className="page-description">
                Register and manage CCTV assets across Gujarat government departments.
              </p>
            </div>

            <div className="step-counter">Step {step} of 3</div>
          </div>

          {/* PROGRESS BAR */}
          <div className="progress-section">
            <div className={`progress-step ${step >= 1 ? "active" : ""}`}>
              <div className="step-number">1</div>
              <span>Department</span>
            </div>

            <div className="progress-line"></div>

            <div className={`progress-step ${step >= 2 ? "active" : ""}`}>
              <div className="step-number">2</div>
              <span>Camera Details</span>
            </div>

            <div className="progress-line"></div>

            <div className={`progress-step ${step >= 3 ? "active" : ""}`}>
              <div className="step-number">3</div>
              <span>Review & Submit</span>
            </div>
          </div>

          {/* STEP 1 - DEPARTMENT */}
          {step === 1 && (
            <section className="onboarding-card">
              <div className="card-heading">
                <div className="heading-icon">
                  <Building2 size={25} />
                </div>

                <div>
                  <h3>Select Department</h3>
                  <p>
                    Choose an existing department or register a new department for camera onboarding.
                  </p>
                </div>
              </div>

              <div className="department-section">
                <label htmlFor="department">Department *</label>

                <select
                  id="department"
                  value={selectedDepartment}
                  onChange={(event) => setSelectedDepartment(event.target.value)}
                >
                  <option value="">Select a department</option>
                  {departments.map((dept) => (
                    <option key={dept} value={dept}>
                      {dept}
                    </option>
                  ))}
                </select>

                <p className="field-help">
                  Select the department responsible for this CCTV asset.
                </p>
              </div>

              <div className="new-department-box">
                <div className="new-department-info">
                  <div className="small-icon">
                    <Plus size={18} />
                  </div>

                  <div>
                    <h4>Department not listed?</h4>
                    <p>
                      Create a new department in the central registry database.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setShowNewDepartment(true);
                    setError("");
                  }}
                >
                  <Plus size={17} />
                  New Department
                </button>
              </div>

              {selectedDepartment && (
                <div className="selected-department">
                  <ShieldCheck size={19} />
                  <div>
                    <strong>{selectedDepartment}</strong>
                    <p>Department selected for registration.</p>
                  </div>
                </div>
              )}

              {error && <p className="error-message">{error}</p>}

              <div className="card-footer">
                <p>
                  <span className="required-star">*</span> Required field
                </p>

                <button
                  type="button"
                  className="primary-button"
                  disabled={!selectedDepartment}
                  onClick={continueToCameraDetails}
                >
                  Continue to Camera Details
                  <ArrowRight size={18} />
                </button>
              </div>
            </section>
          )}

          {/* STEP 2 - CAMERA DETAILS */}
          {step === 2 && (
            <form className="onboarding-card" onSubmit={continueToReview}>
              <div className="card-heading">
                <div className="heading-icon">
                  <Camera size={25} />
                </div>

                <div>
                  <h3>Camera Details</h3>
                  <p>
                    Enter the required information for the selected camera source.
                  </p>
                </div>
              </div>

              <div className="selected-context">
                <Building2 size={17} />
                <span>
                  Department: <strong>{selectedDepartment}</strong>
                </span>
              </div>

              {/* CAMERA SOURCE */}
              <div className="form-section">
                <h4>Camera Source</h4>

                <div className="source-grid">
                  <button
                    type="button"
                    className={`source-card ${
                      cameraSource === "NETWORK_CCTV" ? "selected" : ""
                    }`}
                    onClick={() => handleSourceChange("NETWORK_CCTV")}
                  >
                    <div className="source-icon">
                      <Camera size={27} />
                    </div>

                    <div>
                      <strong>Network CCTV</strong>
                      <p>IP address and RTSP-based camera</p>
                    </div>

                    {cameraSource === "NETWORK_CCTV" && (
                      <CheckCircle2 className="source-check" size={21} />
                    )}
                  </button>

                  <button
                    type="button"
                    className={`source-card ${
                      cameraSource === "LOCAL_WEBCAM" ? "selected" : ""
                    }`}
                    onClick={() => handleSourceChange("LOCAL_WEBCAM")}
                  >
                    <div className="source-icon">
                      <Video size={27} />
                    </div>

                    <div>
                      <strong>Local Testing Webcam</strong>
                      <p>Use your laptop camera for real live testing</p>
                    </div>

                    {cameraSource === "LOCAL_WEBCAM" && (
                      <CheckCircle2 className="source-check" size={21} />
                    )}
                  </button>
                </div>
              </div>

              {/* BASIC INFORMATION */}
              <div className="form-section">
                <h4>Basic Information</h4>

                <div className="form-grid">
                  <div className="form-group">
                    <label>Camera Code *</label>
                    <input
                      value={camera.cameraCode}
                      onChange={(event) =>
                        updateCamera("cameraCode", event.target.value)
                      }
                      placeholder={
                        cameraSource === "LOCAL_WEBCAM"
                          ? "Example: CAM-LAPTOP-001"
                          : "Example: CAM-AHM-001"
                      }
                    />
                  </div>

                  {cameraSource === "NETWORK_CCTV" && (
                    <>
                      <div className="form-group">
                        <label>Make / Model</label>
                        <input
                          value={camera.makeModel}
                          onChange={(event) =>
                            updateCamera("makeModel", event.target.value)
                          }
                          placeholder="Example: Hikvision DS-2CD2143"
                        />
                      </div>

                      <div className="form-group">
                        <label>Camera Type</label>
                        <select
                          value={camera.cameraType}
                          onChange={(event) =>
                            updateCamera("cameraType", event.target.value)
                          }
                        >
                          <option value="FIXED">Fixed</option>
                          <option value="PTZ">PTZ</option>
                          <option value="BULLET">Bullet</option>
                          <option value="DOME">Dome</option>
                          <option value="THERMAL">Thermal</option>
                        </select>
                      </div>

                      <div className="form-group">
                        <label>Ageing (Years)</label>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          value={camera.ageing}
                          onChange={(event) =>
                            updateCamera("ageing", event.target.value)
                          }
                          placeholder="Example: 1.5"
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* LOCATION ON GUJARAT MAP (Supported for both Network CCTV & Laptop Webcam!) */}
              <div className="form-section">
                <div className="label-with-action">
                  <h4>GIS Map Coordinates {cameraSource === "LOCAL_WEBCAM" && "(Plot on Map)"}</h4>
                </div>

                <div className="form-grid">
                  <div className="form-group">
                    <label>Latitude *</label>
                    <input
                      type="number"
                      step="any"
                      value={camera.latitude}
                      onChange={(event) =>
                        updateCamera("latitude", event.target.value)
                      }
                      placeholder="Example: 23.0225"
                    />
                  </div>

                  <div className="form-group">
                    <label>Longitude *</label>
                    <input
                      type="number"
                      step="any"
                      value={camera.longitude}
                      onChange={(event) =>
                        updateCamera("longitude", event.target.value)
                      }
                      placeholder="Example: 72.5714"
                    />
                  </div>
                </div>

                {/* QUICK LOCATION PRESET BUTTONS */}
                <div className="location-quick-chips">
                  <span style={{ fontSize: "11px", color: "#64748b", fontWeight: 600 }}>Quick Gujarat Coordinates:</span>
                  <button
                    type="button"
                    className="location-chip"
                    onClick={() => {
                      updateCamera("latitude", "23.0225");
                      updateCamera("longitude", "72.5714");
                    }}
                  >
                    ðŸ“ Ahmedabad HQ
                  </button>
                  <button
                    type="button"
                    className="location-chip"
                    onClick={() => {
                      updateCamera("latitude", "23.2156");
                      updateCamera("longitude", "72.6369");
                    }}
                  >
                    ðŸ“ Gandhinagar Capital
                  </button>
                  <button
                    type="button"
                    className="location-chip"
                    onClick={() => {
                      updateCamera("latitude", "21.1702");
                      updateCamera("longitude", "72.8311");
                    }}
                  >
                    ðŸ“ Surat Central
                  </button>
                </div>
              </div>

              {/* NETWORK TECHNICAL INFORMATION WITH LIVE IP VALIDATION & SOCKET PROBE */}
              {cameraSource === "NETWORK_CCTV" && (
                <div className="form-section">
                  <h4>Technical Information & Live IP Probe</h4>

                  <div className="form-grid">
                    <div className="form-group ip-validation-group">
                      <div className="label-with-action">
                        <label>Camera IP Address *</label>
                        <button
                          type="button"
                          className="test-ip-btn"
                          onClick={handleTestIpConnection}
                          disabled={ipTesting || !camera.ipAddress.trim()}
                        >
                          {ipTesting ? (
                            <>
                              <RefreshCw size={13} className="animate-spin" />
                              <span>Probing Socket...</span>
                            </>
                          ) : (
                            <>
                              <Wifi size={13} />
                              <span>Test Connection</span>
                            </>
                          )}
                        </button>
                      </div>

                      <div className="input-with-validation">
                        <input
                          value={camera.ipAddress}
                          onChange={(event) =>
                            updateCamera("ipAddress", event.target.value)
                          }
                          placeholder="Example: 10.10.1.11 or 192.168.1.100"
                        />
                      </div>

                      {/* LIVE PROBE RESULT BADGE */}
                      {ipCheckResult && (
                        <div
                          className={`ip-check-badge ${
                            ipCheckResult.is_reachable
                              ? "success"
                              : ipCheckResult.is_valid_format
                              ? "warning"
                              : "error"
                          }`}
                        >
                          {ipCheckResult.is_reachable ? (
                            <CheckCircle2 size={16} />
                          ) : ipCheckResult.is_valid_format ? (
                            <AlertTriangle size={16} />
                          ) : (
                            <AlertCircle size={16} />
                          )}
                          <div>
                            <strong>
                              {ipCheckResult.is_reachable
                                ? `Online & Reachable (${ipCheckResult.latency_ms}ms)`
                                : ipCheckResult.is_valid_format
                                ? "Device Unreachable / Port 554 Closed"
                                : "Invalid IPv4 Format"}
                            </strong>
                            <p>{ipCheckResult.detail}</p>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="form-group">
                      <label>RTSP URL *</label>
                      <input
                        value={camera.rtspUrl}
                        onChange={(event) =>
                          updateCamera("rtspUrl", event.target.value)
                        }
                        placeholder="rtsp://10.10.1.11:554/stream1"
                      />
                    </div>

                    <div className="form-group">
                      <label>Current Status</label>
                      <select
                        value={camera.status}
                        onChange={(event) =>
                          updateCamera("status", event.target.value)
                        }
                      >
                        <option value="ONLINE">Online</option>
                        <option value="OFFLINE">Offline</option>
                        <option value="MAINTENANCE">Maintenance</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* LOCAL WEBCAM TESTING */}
              {cameraSource === "LOCAL_WEBCAM" && (
                <div className="form-section">
                  <h4>Local Webcam Live Preview</h4>

                  <div className="webcam-panel">
                    <div className="webcam-view">
                      {cameraStream ? (
                        <video
                          ref={videoRef}
                          className="webcam-video"
                          autoPlay
                          playsInline
                          muted
                        />
                      ) : (
                        <div className="webcam-placeholder">
                          <Video size={42} />
                          <p>Webcam preview will appear here</p>
                          <span>Click &quot;Start Camera&quot; to test your local device</span>
                        </div>
                      )}
                    </div>

                    <div className="webcam-actions">
                      {!cameraStream ? (
                        <button
                          type="button"
                          className="primary-button"
                          onClick={startWebcam}
                        >
                          <Video size={18} />
                          Start Camera
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={stopWebcam}
                        >
                          <Video size={18} />
                          Stop Camera
                        </button>
                      )}

                      <span
                        className={`webcam-status ${cameraStream ? "active" : ""}`}
                      >
                        {cameraStream ? "Camera Active" : "Camera Offline"}
                      </span>
                    </div>

                    {webcamError && (
                      <p className="error-message">{webcamError}</p>
                    )}
                  </div>
                </div>
              )}

              {error && <p className="error-message">{error}</p>}

              {/* FOOTER BUTTONS */}
              <div className="card-footer">
                <button
                  type="button"
                  className="cancel-button"
                  onClick={() => setStep(1)}
                >
                  <ArrowLeft size={17} />
                  Back
                </button>

                <button type="submit" className="primary-button">
                  Review Details
                  <ArrowRight size={18} />
                </button>
              </div>
            </form>
          )}

          {/* STEP 3 - REVIEW & SUBMIT */}
          {step === 3 && (
            <section className="onboarding-card">
              {submittedCamera ? (
                <div style={{ textAlign: "center", padding: "30px 20px" }}>
                  <div
                    style={{
                      width: "64px",
                      height: "64px",
                      borderRadius: "50%",
                      background: "#dcfce7",
                      color: "#16a34a",
                      display: "grid",
                      placeItems: "center",
                      margin: "0 auto 20px",
                    }}
                  >
                    <CheckCircle2 size={40} />
                  </div>

                  <h3 style={{ fontSize: "22px", marginBottom: "8px" }}>
                    Camera Registered Successfully!
                  </h3>
                  <p style={{ color: "#64748b", marginBottom: "24px" }}>
                    Your camera is now saved in the system and ready to view on the live feed screen.
                  </p>

                  <div
                    className="review-grid"
                    style={{ textAlign: "left", maxWidth: "600px", margin: "0 auto 28px" }}
                  >
                    <div className="review-item">
                      <span>Camera Code</span>
                      <strong>{submittedCamera.camera_code}</strong>
                    </div>
                    <div className="review-item">
                      <span>Source Type</span>
                      <strong>{submittedCamera.source_type}</strong>
                    </div>
                    <div className="review-item">
                      <span>Department</span>
                      <strong>{submittedCamera.department}</strong>
                    </div>
                    <div className="review-item">
                      <span>Status</span>
                      <strong style={{ color: "#16a34a" }}>{submittedCamera.status}</strong>
                    </div>
                  </div>

                  {/* ACTION BUTTONS WITH DIRECT WATCH LIVE FEED */}
                  <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="primary-button"
                      style={{ background: "#059669" }}
                      onClick={() => setStreamNowCamera(submittedCamera)}
                    >
                      <Play size={18} />
                      Watch Live Feed Now
                    </button>

                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setActiveTab("map")}
                    >
                      <MapPin size={18} />
                      View on Live GIS Map
                    </button>

                    <button
                      type="button"
                      className="cancel-button"
                      onClick={handleReset}
                    >
                      <RefreshCw size={18} />
                      Register Another
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="card-heading">
                    <div className="heading-icon">
                      <CheckCircle2 size={25} />
                    </div>

                    <div>
                      <h3>Review & Submit</h3>
                      <p>
                        Verify the camera asset details before saving to the central database.
                      </p>
                    </div>
                  </div>

                  <div className="review-grid">
                    <div className="review-item">
                      <span>Department</span>
                      <strong>{selectedDepartment}</strong>
                    </div>

                    <div className="review-item">
                      <span>Source Type</span>
                      <strong>
                        {cameraSource === "LOCAL_WEBCAM"
                          ? "Local Testing Webcam"
                          : "Network CCTV"}
                      </strong>
                    </div>

                    <div className="review-item">
                      <span>Camera Code</span>
                      <strong>{camera.cameraCode}</strong>
                    </div>

                    <div className="review-item">
                      <span>Coordinates</span>
                      <strong>
                        {camera.latitude}, {camera.longitude}
                      </strong>
                    </div>

                    {cameraSource === "NETWORK_CCTV" && (
                      <>
                        <div className="review-item">
                          <span>Camera Type</span>
                          <strong>{camera.cameraType || "Fixed"}</strong>
                        </div>

                        <div className="review-item">
                          <span>Make / Model</span>
                          <strong>{camera.makeModel || "Not provided"}</strong>
                        </div>

                        <div className="review-item">
                          <span>IP Address</span>
                          <strong>{camera.ipAddress}</strong>
                        </div>

                        <div className="review-item">
                          <span>RTSP URL</span>
                          <strong>{camera.rtspUrl}</strong>
                        </div>
                      </>
                    )}

                    <div className="review-item">
                      <span>Status</span>
                      <strong>{camera.status}</strong>
                    </div>
                  </div>

                  {error && (
                    <div
                      className="error-message"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        marginTop: "16px",
                      }}
                    >
                      <AlertCircle size={18} />
                      <span>{error}</span>
                    </div>
                  )}

                  <div className="card-footer">
                    <button
                      type="button"
                      className="cancel-button"
                      onClick={() => setStep(2)}
                      disabled={isSubmitting}
                    >
                      <ArrowLeft size={17} />
                      Edit Details
                    </button>

                    <button
                      type="button"
                      className="primary-button"
                      onClick={submitOnboarding}
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? (
                        <>
                          <RefreshCw size={18} className="animate-spin" />
                          Saving to Database...
                        </>
                      ) : (
                        <>
                          Submit Camera
                          <CheckCircle2 size={18} />
                        </>
                      )}
                    </button>
                  </div>
                </>
              )}
            </section>
          )}
        </main>
      )}

      {/* NEW DEPARTMENT MODAL */}
      {showNewDepartment && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="modal-header">
              <div>
                <h3>Create New Department</h3>
                <p>Register a new department into the central system.</p>
              </div>

              <button
                type="button"
                className="close-button"
                onClick={() => setShowNewDepartment(false)}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateDepartment}>
              <label>Department Name *</label>
              <input
                value={newDepartment}
                onChange={(event) => setNewDepartment(event.target.value)}
                placeholder="Example: Ahmedabad Smart City"
              />

              <label>Department Code / Zone *</label>
              <input
                value={departmentCode}
                onChange={(event) => setDepartmentCode(event.target.value)}
                placeholder="Example: ASC-AHD"
              />

              {error && <p className="error-message">{error}</p>}

              <div className="modal-actions">
                <button
                  type="button"
                  className="cancel-button"
                  onClick={() => setShowNewDepartment(false)}
                >
                  Cancel
                </button>

                <button type="submit" className="primary-button">
                  Save Department
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* LIVE CAMERA FEED MODAL SCREEN */}
      {streamNowCamera && (
        <CameraFeedModal
          camera={streamNowCamera}
          onClose={() => setStreamNowCamera(null)}
        />
      )}
    </div>
  );
}

export default App;