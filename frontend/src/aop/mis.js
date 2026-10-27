// Helpers shared by the MIS report formats (Full P&L, revenue performance, regional P&L).
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { download } from "./format";
import { useGridView } from "./gridView";

// Values arrive as 13-slot vectors: 12 fiscal months (Apr..Mar) + full-year total (slot 12).
export function agg(vec, period, month) {
  if (!vec) return null;
  if (period === "fy") return vec[12];
  if (period === "mtd") return vec[month] ?? 0;
  let s = 0;
  for (let i = 0; i <= month; i += 1) s += vec[i] || 0;
  return s;
}

export const PERIODS = [["fy", "FY"], ["ytd", "YTD"], ["mtd", "MTD"]];

export function periodPrefix(period, months, month) {
  if (period === "fy") return "";
  if (period === "ytd") return `YTD ${months?.labels?.[month] || ""}`;
  return months?.labels?.[month] || "MTD";
}

/**
 * Collapsible rows. Parent links come from `row.parent` (MIS payloads) or, when `byLevel` is set,
 * from the row order + level (the WAISL P&L): a row's parent is the nearest earlier row with a lower level.
 * `pinned(row)` rows never become children (headline ratios stay visible in a consolidated view).
 */
export function useTree(rows, { byLevel = false, defaultOpen = false, pinned = () => false } = {}) {
  const parentOf = useMemo(() => {
    const out = {};
    if (!byLevel) {
      (rows || []).forEach((r) => { if (r.parent) out[r.id] = r.parent; });
      return out;
    }
    const stack = [];
    (rows || []).forEach((r) => {
      if (pinned(r)) return;
      const lvl = r.level || 0;
      while (stack.length && stack[stack.length - 1].level >= lvl) stack.pop();
      if (stack.length) out[r.id] = stack[stack.length - 1].id;
      stack.push({ id: r.id, level: lvl });
    });
    return out;
  }, [rows, byLevel]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasKids = useMemo(() => new Set(Object.values(parentOf)), [parentOf]);
  const [open, setOpen] = useState({});
  const isOpen = useCallback((id) => (id in open ? open[id] : defaultOpen), [open, defaultOpen]);
  const visible = useCallback((r) => {
    let p = parentOf[r.id];
    while (p) {
      if (!isOpen(p)) return false;
      p = parentOf[p];
    }
    return true;
  }, [parentOf, isOpen]);
  const toggle = (id) => setOpen((o) => ({ ...o, [id]: !(id in o ? o[id] : defaultOpen) }));
  const setAll = (v) => setOpen(Object.fromEntries([...hasKids].map((id) => [id, v])));
  const depth = (id) => { let d = 0; let p = parentOf[id]; while (p) { d += 1; p = parentOf[p]; } return d; };
  return { visible, toggle, isOpen, hasKids, expandAll: () => setAll(true), collapseAll: () => setAll(false), depth, parentOf };
}

export function csvDownload(lines, name) {
  download(new Blob([lines.map((l) => l.map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`).join(",")).join("\n")],
                    { type: "text/csv" }), name);
}

// Per-viewer view preferences (localStorage) over the admin's default for everyone (see gridView.useGridView)
export function usePref(key, initial) {
  const [v, set, reset, admin] = useGridView(key, initial);
  return [v, set, reset, admin];
}

// The AOP reports page's one period (FY / YTD / MTD + month): every format on the page follows it, so picking a
// month in one report filters all of them. Outside the page (a drill-down opened alone) a format keeps its own.
export const PeriodContext = createContext(null);

export function usePagePeriod(local) {
  const page = useContext(PeriodContext);
  if (!page) return local;
  return { period: page.period || "ytd", month: page.month ?? local.month, set: page.set, months: page.months, shared: true };
}

// Fiscal-month indexes a period covers (index 0 = April)
export function periodIndexes(period, month) {
  if (period === "fy" || month === null || month === undefined) return [...Array(12).keys()];
  return period === "mtd" ? [month] : [...Array(month + 1).keys()];
}
