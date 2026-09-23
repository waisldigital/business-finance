import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import api from "@/lib/api";
import { useAuth } from "@/lib/auth";

const PermsCtx = createContext(null);

const EMPTY = {
  is_admin: false,
  is_permanent_admin: false,
  permissions: {
    dashboard: { can_view: false, can_edit: false, can_delete: false },
    pipeline: { can_view: false, can_edit: false, can_delete: false },
    projects: { can_view: false, can_edit: false, can_delete: false },
    change_requests: { can_view: false, can_edit: false, can_delete: false },
    customer_profile: { can_view: false, can_edit: false, can_delete: false },
    wbs_budget: { can_view: false, can_edit: false, can_delete: false },
  },
};

export function PermissionsProvider({ children }) {
  const { user } = useAuth();
  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) { setData(EMPTY); setLoading(false); return; }
    try {
      const { data } = await api.get("/me/permissions");
      setData(data);
    } catch {
      setData(EMPTY);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);

  return <PermsCtx.Provider value={{ ...data, loading, refresh }}>{children}</PermsCtx.Provider>;
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
  if (action === "delete") return !!p.can_delete;
  return false;
}
