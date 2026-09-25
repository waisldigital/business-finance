import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

const instance = axios.create({
  baseURL: API,
});

// Attach Authorization header if token present (fallback for cross-origin cookie issues)
instance.interceptors.request.use((cfg) => {
  const token = localStorage.getItem("fs_token");
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

// Session expiry: on a 401, refresh the session once (concurrent 401s share one refresh) and retry the
// request; if that fails, sign out and go to the login page, which returns here afterwards (?next=).
let refreshing = null;
const isAuthCall = (url = "") => /\/auth\/(login|refresh|logout)/.test(url);

async function refreshSession() {
  const refresh_token = localStorage.getItem("fs_refresh");
  const { data } = await axios.post(`${API}/auth/refresh`, refresh_token ? { refresh_token } : {}, { withCredentials: true });
  if (!data?.access_token) throw new Error("no token");
  localStorage.setItem("fs_token", data.access_token);
  if (data.refresh_token) localStorage.setItem("fs_refresh", data.refresh_token);
  return data.access_token;
}

export function sessionExpired() {
  localStorage.removeItem("fs_token");
  localStorage.removeItem("fs_refresh");
  const { pathname, search } = window.location;
  if (!pathname.startsWith("/login")) {
    window.location.assign(`/login?next=${encodeURIComponent(pathname + search)}`);
  }
}

instance.interceptors.response.use(
  (r) => r,
  async (err) => {
    const cfg = err.config || {};
    if (err.response?.status !== 401 || isAuthCall(cfg.url)) return Promise.reject(err);
    const hadSession = !!localStorage.getItem("fs_token") || !!localStorage.getItem("fs_refresh");
    if (!hadSession) return Promise.reject(err); // never signed in: let the caller handle it (login screen)
    if (!cfg._retried) {
      cfg._retried = true;
      try {
        refreshing = refreshing || refreshSession().finally(() => { refreshing = null; });
        const token = await refreshing;
        cfg.headers = { ...(cfg.headers || {}), Authorization: `Bearer ${token}` };
        return instance(cfg);
      } catch {
        /* fall through: the session is over */
      }
    }
    sessionExpired();
    return Promise.reject(err);
  }
);

export default instance;

export function formatApiErrorDetail(detail) {
  if (detail == null) return "Something went wrong. Please try again.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail
      .map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e)))
      .filter(Boolean)
      .join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
}
