// Grid view state shared by dataset screens and report tables: column order / visibility, pivot levels,
// sorting, Excel-style column filters and the 12-month toggle. Saved per viewer and per grid in localStorage.
import { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";

const MONTH_KEY = /^([A-Z]\d{2}[A-Z]?)__(\d{4}-\d{2})$/;

export const isMonthCol = (c) => MONTH_KEY.test(c.key);
export const versionOf = (c) => (MONTH_KEY.exec(c.key) || [])[1];
// "B27" → "FY'27 B" (A = actual, B = budget, F = forecast; B27A / B27T = active / to be hired)
export const versionLabel = (v) => {
  const m = /^([ABF])(\d{2})([AT]?)$/.exec(v || "");
  return m ? `FY'${m[2]} ${m[1]}${m[3] === "A" ? " active" : m[3] === "T" ? " to hire" : ""}` : v;
};
export const isNumeric = (c) => ["number", "money", "percent"].includes(c.type) || isMonthCol(c) || c.numeric;

// pivot defaults follow Excel's tabular layout: no subtotal rows, item labels repeated on every line
const DEFAULT_VIEW = { order: null, hidden: [], pivot: 0, subtotals: false, repeatLabels: true, filtersOn: false, twelveM: false, sort: null, filters: {} };

function loadLocal(key) {
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
}

// ------------------------------------------------------------------ admin default views (shared by every viewer)
// The admin can save any grid's / report's current layout as everyone's default (server: /aop/views). A viewer
// starts from it until they change something; "Default" returns to it.
let shared = null;
let pending = null;
const listeners = new Set();
const notify = () => listeners.forEach((f) => f(shared || {}));

export function loadSharedViews(force = false) {
  if (!pending || force) {
    pending = api.get("/aop/views").then((r) => { shared = r.data || {}; notify(); return shared; })
      .catch(() => { shared = shared || {}; return shared; });
  }
  return pending;
}

export function useSharedView(key) {
  const [v, setV] = useState(() => (shared ? shared[key] || null : null));
  useEffect(() => {
    const f = (all) => setV(all[key] || null);
    listeners.add(f);
    if (shared) f(shared); else loadSharedViews();
    return () => listeners.delete(f);
  }, [key]);
  return v;
}

const SHARED_FIELDS = ["order", "hidden", "pivot", "subtotals", "repeatLabels", "filtersOn", "twelveM", "sort", "period",
  "measures", "segments", "variance", "subs", "section", "view", "selected"];

export async function saveSharedView(key, view) {
  const body = Object.fromEntries(SHARED_FIELDS.filter((k) => k in view).map((k) => [k, view[k]]));
  await api.put(`/aop/views/${encodeURIComponent(key)}`, body);
  shared = { ...(shared || {}), [key]: body };
  notify();
}

export async function clearSharedView(key) {
  await api.delete(`/aop/views/${encodeURIComponent(key)}`);
  const next = { ...(shared || {}) };
  delete next[key];
  shared = next;
  notify();
}

/**
 * View state for one grid: the code default, overlaid with the admin's default for everyone, overlaid with the
 * viewer's own changes (kept in localStorage). reset() drops the viewer's changes → back to the admin default.
 * The 4th element carries the admin actions (save the current layout as everyone's default / clear it).
 */
export function useGridView(storageKey, defaults = {}) {
  const init = { ...DEFAULT_VIEW, ...defaults };
  const sharedView = useSharedView(storageKey);
  const [local, setLocal] = useState(() => loadLocal(storageKey));
  const base = { ...init, ...(sharedView || {}) };
  const view = local ? { ...base, ...local } : base;
  const update = (patch) => setLocal((cur) => {
    const v = cur ? { ...base, ...cur } : base;
    const next = { ...v, ...(typeof patch === "function" ? patch(v) : patch) };
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* storage unavailable */ }
    return next;
  });
  const reset = () => { try { localStorage.removeItem(storageKey); } catch { /* ignore */ } setLocal(null); };
  const admin = {
    key: storageKey, hasDefault: !!sharedView,
    save: () => saveSharedView(storageKey, view).then(reset),
    clear: () => clearSharedView(storageKey),
  };
  return [view, update, reset, admin];
}

/**
 * Columns as the viewer arranged them. With 12M off, a version's monthly columns fold into one total column
 * (key `<VER>__sum`, computed) so the grid stays compact; switch 12M on to see every month.
 */
export function arrangeColumns(columns, view) {
  let cols = columns.filter((c) => !c.hidden);
  if (!view.twelveM) {
    const out = [];
    const seen = new Set();
    // a version with an editable FY column (<VER>__annual, e.g. the departments' FY'28 budget) shows that column
    // instead of a read-only sum of its months
    const annual = new Set(cols.filter((c) => /__annual$/.test(c.key)).map((c) => c.key.split("__")[0]));
    for (const c of cols) {
      if (isMonthCol(c)) {
        const v = versionOf(c);
        if (!seen.has(v)) {
          seen.add(v);
          if (!annual.has(v)) out.push({ key: `${v}__sum`, label: `${versionLabel(v)} total`, type: "number", group: c.group, virtual: true, version: v });
        }
      } else out.push(c);
    }
    cols = out;
  }
  const byKey = Object.fromEntries(cols.map((c) => [c.key, c]));
  const order = (view.order || []).filter((k) => byKey[k]);
  const rest = cols.map((c) => c.key).filter((k) => !order.includes(k));
  const hidden = new Set(view.hidden || []);
  return [...order, ...rest].map((k) => byKey[k]).map((c) => ({ ...c, hiddenByUser: hidden.has(c.key) }));
}

export function cellValue(row, col) {
  const f = row.fields || row;
  if (col.virtual && col.version) {
    let s = 0;
    for (const [k, v] of Object.entries(f)) if (k.startsWith(`${col.version}__`) && /\d{4}-\d{2}$/.test(k) && typeof v === "number") s += v;
    return s;
  }
  return col.key.includes(".") && !(col.key in f) ? col.key.split(".").reduce((o, k) => (o == null ? o : o[k]), f) : f[col.key];
}

// ------------------------------------------------------------------ filters (Excel-style)
// filter = {values: [..] | null (all), cond: {op, a, b} | null, text: ""}
export function passes(v, flt, numeric) {
  if (!flt) return true;
  const s = v === null || v === undefined || v === "" ? "(Blanks)" : String(v);
  if (flt.values && !flt.values.includes(s)) return false;
  if (flt.cond && flt.cond.op) {
    const { op, a, b } = flt.cond;
    if (numeric) {
      const n = Number(v) || 0; const x = Number(a); const y = Number(b);
      if (op === "gt" && !(n > x)) return false;
      if (op === "gte" && !(n >= x)) return false;
      if (op === "lt" && !(n < x)) return false;
      if (op === "lte" && !(n <= x)) return false;
      if (op === "eq" && !(n === x)) return false;
      if (op === "ne" && !(n !== x)) return false;
      if (op === "between" && !(n >= Math.min(x, y) && n <= Math.max(x, y))) return false;
      if (op === "top10") return true;
    } else {
      const t = s.toLowerCase(); const q = String(a || "").toLowerCase();
      if (op === "contains" && !t.includes(q)) return false;
      if (op === "ncontains" && t.includes(q)) return false;
      if (op === "begins" && !t.startsWith(q)) return false;
      if (op === "ends" && !t.endsWith(q)) return false;
      if (op === "eq" && t !== q) return false;
      if (op === "ne" && t === q) return false;
    }
  }
  return true;
}

export function applyView(rows, cols, view) {
  const active = Object.entries(view.filters || {}).filter(([k, f]) => f && (f.values || f.cond?.op));
  const byKey = Object.fromEntries(cols.map((c) => [c.key, c]));
  let out = rows;
  if (active.length) {
    out = rows.filter((r) => active.every(([k, f]) => !byKey[k] || passes(cellValue(r, byKey[k]), f, isNumeric(byKey[k]))));
    // "Top 10" style numeric filters
    for (const [k, f] of active) {
      if (f.cond?.op === "top10" && byKey[k]) {
        const n = Number(f.cond.a) || 10;
        const sorted = [...out].sort((x, y) => (Number(cellValue(y, byKey[k])) || 0) - (Number(cellValue(x, byKey[k])) || 0));
        const keep = new Set(sorted.slice(0, n));
        out = out.filter((r) => keep.has(r));
      }
    }
  }
  if (view.sort && byKey[view.sort.key]) {
    const c = byKey[view.sort.key];
    const dir = view.sort.dir === "desc" ? -1 : 1;
    const num = isNumeric(c);
    out = [...out].sort((a, b) => {
      const x = cellValue(a, c); const y = cellValue(b, c);
      if (num) return ((Number(x) || 0) - (Number(y) || 0)) * dir;
      return String(x ?? "").localeCompare(String(y ?? ""), undefined, { numeric: true }) * dir;
    });
  }
  return out;
}

export function distinctValues(rows, col, limit = 1000) {
  const m = new Map();
  for (const r of rows) {
    const v = cellValue(r, col);
    const s = v === null || v === undefined || v === "" ? "(Blanks)" : String(v);
    m.set(s, (m.get(s) || 0) + 1);
    if (m.size > limit) break;
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
}

// ------------------------------------------------------------------ pivot
/**
 * Group rows by the first `levels` visible columns. Group rows carry sums of every numeric column and the
 * number of line items; the deepest level expands to the line items themselves.
 */
export function buildPivot(rows, cols, levels) {
  const keyCols = cols.slice(0, levels);
  const numCols = cols.filter((c) => isNumeric(c));
  const root = { id: "", children: new Map(), rows: [] };
  for (const r of rows) {
    let node = root;
    keyCols.forEach((c, i) => {
      const v = cellValue(r, c);
      const label = v === null || v === undefined || v === "" ? "(Blanks)" : String(v);
      if (!node.children.has(label)) node.children.set(label, { id: `${node.id}\u0001${label}`, label, level: i, col: c.key, children: new Map(), rows: [] });
      node = node.children.get(label);
      node.rows.push(r);
    });
  }
  const sums = (rs) => Object.fromEntries(numCols.map((c) => [c.key, rs.reduce((s, r) => s + (Number(cellValue(r, c)) || 0), 0)]));
  const flatten = (node) => [...node.children.values()].map((n) => ({
    id: n.id, label: n.label, level: n.level, col: n.col, count: n.rows.length, sums: sums(n.rows),
    children: n.children.size ? flatten(n) : null, rows: n.children.size ? null : n.rows,
  }));
  return { groups: flatten(root), total: sums(rows), count: rows.length };
}

export function useFiltered(rows, cols, view) {
  return useMemo(() => applyView(rows, cols, view), [rows, cols, view]);
}
