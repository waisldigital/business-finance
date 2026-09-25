import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import api, { formatApiErrorDetail } from "./api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null = checking, false = unauth, object = auth
  const [error, setError] = useState("");

  const fetchMe = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
    } catch {
      setUser(false);
    }
  }, []);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  const login = async (email, password) => {
    setError("");
    try {
      const { data } = await api.post("/auth/login", { email, password });
      if (data.access_token) localStorage.setItem("fs_token", data.access_token);
      if (data.refresh_token) localStorage.setItem("fs_refresh", data.refresh_token);
      setUser(data.user);
      return data.user || true;
    } catch (e) {
      setError(formatApiErrorDetail(e.response?.data?.detail) || e.message);
      return false;
    }
  };

  const logout = async () => {
    try { await api.post("/auth/logout"); } catch {}
    localStorage.removeItem("fs_token");
    localStorage.removeItem("fs_refresh");
    setUser(false);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, error, setError, refresh: fetchMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

// Admins land in the admin portal, everyone else in the user workspace
export const homeFor = (user) => (user && user.role === "admin" ? "/admin" : "/app");

// ?next= after a session expiry: only same-site paths, and only into the signed-in user's portal
export function nextPath(search, user) {
  const next = new URLSearchParams(search).get("next") || "";
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/login")) return null;
  if (user?.role === "admin" ? !next.startsWith("/admin") && !next.startsWith("/app/change-requests/") : next.startsWith("/admin")) return null;
  return next;
}
