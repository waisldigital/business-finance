import { useEffect, useState } from "react";
import api from "@/lib/api";

/** Open Review items (to map + PO changes + corrections + checks) for the sidebar badge; refreshed every 2 minutes. */
export function useReviewBadge({ enabled = true } = {}) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const load = () => {
      if (document.visibilityState === "hidden") return;
      api.get("/aop/review/summary").then((r) => { if (alive) setN(r.data.badge || 0); }).catch(() => {});
    };
    load();
    const t = setInterval(load, 120000);
    return () => { alive = false; clearInterval(t); };
  }, [enabled]);
  return n;
}
