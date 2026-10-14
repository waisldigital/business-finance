import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import api from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { emptyPermissions } from "@/config/sections";

const PermsCtx = createContext(null);

const EMPTY = { is_admin: false, is_permanent_admin: false, permissions: emptyPermissions() };

export function PermissionsProvider({ children }) {
  const { user } = useAuth();
  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [owner, setOwner] = useState(null); // whose permissions `data` holds

  const refresh = useCallback(async () => {
    if (user === null) return; // auth still resolving — stay in loading state
    if (!user) { setData(EMPTY); setOwner(null); setLoading(false); return; }
    setLoading(true); // never let route guards judge a signed-in user against empty permissions
    try {
      const { data } = await api.get("/me/permissions");
      setData(data);
    } catch {
      setData(EMPTY);
    } finally {
      setOwner(user.id);
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);

  // right after sign-in the user is known before their permissions are: report loading until they arrive
  const stale = !!user && owner !== user.id;
  return <PermsCtx.Provider value={{ ...data, loading: loading || stale, refresh }}>{children}</PermsCtx.Provider>;
}

export function usePermissions() {
  const ctx = useContext(PermsCtx);
  if (!ctx) return { ...EMPTY, loading: true, refresh: async () => {} };
  return ctx;
}

export function useCan(section, action = "view") {
  const { is_admin, permissions } = usePermissions();
  if (is_admin) return true;
  const p = permissions?.[section];
  if (!p) return false;
  if (action === "view") return !!p.can_view;
  if (action === "edit") return !!p.can_edit;
  if (action === "upload") return !!p.can_upload;
  if (action === "delete") return !!p.can_delete;
  return false;
}
