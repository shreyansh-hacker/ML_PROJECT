/**
 * Gujarat Sentinel API Configuration Helper
 * Supports local development (Vite proxy fallback) and cloud production (Vercel -> Render).
 */

const RAW_API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").trim();
export const API_BASE_URL = RAW_API_BASE_URL.replace(/\/+$/, "");

/**
 * Prepends the backend API base URL if defined in environment variables.
 * Falls back cleanly to relative paths for local development.
 *
 * Examples:
 *   apiUrl('/api/departments') -> "https://sentinel-api.onrender.com/api/departments" (production)
 *   apiUrl('/api/departments') -> "/api/departments" (local dev)
 *
 * @param {string} path - The endpoint path or image URL
 * @returns {string} - The resolved full or relative URL
 */
export function apiUrl(path = "") {
  if (!path) return API_BASE_URL || "";
  if (typeof path !== "string") return path;
  if (
    path.startsWith("http://") ||
    path.startsWith("https://") ||
    path.startsWith("blob:") ||
    path.startsWith("data:")
  ) {
    return path;
  }
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  if (!API_BASE_URL) return cleanPath;
  return `${API_BASE_URL}${cleanPath}`;
}

export async function apiFetch(input, options = {}) {
  const response = await fetch(input, {
    ...options,
    credentials: "include"
  });
  if (
    response.status === 401 &&
    !String(input).includes("/api/auth/login") &&
    !String(input).includes("/api/auth/session")
  ) {
    window.dispatchEvent(new Event("sentinel:unauthorized"));
  }
  return response;
}

export default apiUrl;
