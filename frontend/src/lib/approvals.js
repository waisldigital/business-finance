// Pending approvals for the signed-in user (stage gates + change requests), shared by the sidebar badge and the
// inbox. Refreshes every minute while the tab is visible and whenever a decision is made (refreshApprovals()).
import { useEffect, useState } from "react";
import api from "@/lib/api";

const EVENT = "fs:approvals-changed";
export const refreshApprovals = () => window.dispatchEvent(new Event(EVENT));

export function useApprovalsInbox({ enabled = true } = {}) {
  const [inbox, setInbox] = useState({ stage_gates: [], change_requests: [], count: 0 });
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const load = () => {
      if (document.visibilityState === "hidden") return;
      api.get("/approvals/inbox").then((r) => { if (alive) { setInbox(r.data); setLoaded(true); } }).catch(() => {});
    };
    load();
    const t = setInterval(load, 60000);
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    window.addEventListener(EVENT, load);
    document.addEventListener("visibilitychange", onVis);
    return () => { alive = false; clearInterval(t); window.removeEventListener(EVENT, load); document.removeEventListener("visibilitychange", onVis); };
  }, [enabled]);
  return { ...inbox, loaded };
}
