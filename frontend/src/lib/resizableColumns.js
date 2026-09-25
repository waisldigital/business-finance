// Drag-to-resize columns on every table in the app (Excel-like): a handle on each header's right edge;
// drag to set the width, double-click to return the column to its automatic width. Widths are kept per
// viewer, per screen and table, by header text (localStorage) and re-applied whenever the table re-renders.
import { useEffect } from "react";

const STORE = "fs_col_widths_v1";
let seq = 0;

function load() {
  try { return JSON.parse(localStorage.getItem(STORE) || "{}"); } catch { return {}; }
}
function save(all) {
  try { localStorage.setItem(STORE, JSON.stringify(all)); } catch { /* storage unavailable */ }
}

const headerText = (th) => (th.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80) || `#${th.cellIndex}`;

function tableKey(table) {
  const tables = Array.from(document.querySelectorAll("table"));
  const id = table.getAttribute("data-testid") || `t${tables.indexOf(table)}`;
  return `${window.location.pathname}|${id}`;
}

// body column index under a header cell — matched on the left edge, so grouped / spanned headers still work
function columnIndex(table, th) {
  const row = table.tBodies[0]?.rows[0];
  if (!row) return th.cellIndex;
  const left = th.getBoundingClientRect().left;
  let best = -1; let dist = Infinity;
  Array.from(row.cells).forEach((c, i) => {
    const d = Math.abs(c.getBoundingClientRect().left - left);
    if (d < dist) { dist = d; best = i; }
  });
  return dist < 4 ? best : th.cellIndex;
}

function styleFor(table) {
  if (!table.dataset.rzid) table.dataset.rzid = `rz${++seq}`;
  let el = document.getElementById(`style-${table.dataset.rzid}`);
  if (!el) {
    el = document.createElement("style");
    el.id = `style-${table.dataset.rzid}`;
    document.head.appendChild(el);
  }
  return el;
}

function render(table, widths) {
  const id = table.dataset.rzid;
  const css = Object.entries(widths).map(([idx, w]) => {
    const n = Number(idx) + 1;
    const box = `width:${w}px;min-width:${w}px;max-width:${w}px;overflow:hidden;text-overflow:ellipsis;`;
    return `table[data-rzid="${id}"] > tbody > tr > td:nth-child(${n}){${box}}table[data-rzid="${id}"] th[data-rzc="${idx}"]{${box}}`;
  }).join("");
  styleFor(table).textContent = css;
}

function applyStored(table) {
  const saved = load()[tableKey(table)];
  if (!saved) return;
  styleFor(table);
  const widths = {};
  table.querySelectorAll("thead th").forEach((th) => {
    const w = saved[headerText(th)];
    if (w) {
      const idx = columnIndex(table, th);
      th.dataset.rzc = String(idx);
      widths[idx] = w;
    }
  });
  if (Object.keys(widths).length) render(table, widths);
}

function attach(th) {
  if (th.dataset.rz) return;
  th.dataset.rz = "1";
  if (getComputedStyle(th).position === "static") th.style.position = "relative";
  const h = document.createElement("span");
  h.className = "col-rz";
  h.title = "Drag to resize · double-click for automatic width";
  const stop = (e) => { e.stopPropagation(); };
  h.addEventListener("click", stop);
  h.addEventListener("dblclick", (e) => {
    e.stopPropagation(); e.preventDefault();
    const table = th.closest("table");
    const key = tableKey(table);
    const all = load();
    if (all[key]) { delete all[key][headerText(th)]; save(all); }
    delete th.dataset.rzc;
    styleFor(table).textContent = "";
    applyStored(table);
  });
  h.addEventListener("mousedown", (e) => {
    e.preventDefault(); e.stopPropagation();
    const table = th.closest("table");
    const idx = columnIndex(table, th);
    th.dataset.rzc = String(idx);
    const startX = e.clientX;
    const startW = th.getBoundingClientRect().width;
    const key = tableKey(table);
    const text = headerText(th);
    const current = {};
    table.querySelectorAll("thead th[data-rzc]").forEach((x) => {
      const w = (load()[key] || {})[headerText(x)];
      if (w) current[x.dataset.rzc] = w;
    });
    document.body.classList.add("col-resizing");
    const move = (ev) => {
      current[idx] = Math.max(36, Math.round(startW + ev.clientX - startX));
      render(table, current);
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.body.classList.remove("col-resizing");
      const all = load();
      all[key] = { ...(all[key] || {}), [text]: current[idx] };
      save(all);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  });
  th.appendChild(h);
}

function scan() {
  document.querySelectorAll("table").forEach((table) => {
    const fresh = table.querySelectorAll("thead th:not([data-rz])");
    if (!fresh.length) return;
    fresh.forEach(attach);
    applyStored(table);
  });
}

export function useResizableColumns() {
  useEffect(() => {
    let raf = 0;
    // rescan only when a table header could have appeared (not on every keystroke or cell update)
    const addsHeaders = (records) => records.some((r) => Array.from(r.addedNodes).some((n) =>
      n.nodeType === 1 && (n.tagName === "TABLE" || n.tagName === "TH" || n.tagName === "THEAD" || n.tagName === "TR"
                           || (n.querySelector && n.querySelector("th")))));
    const obs = new MutationObserver((records) => {
      if (!addsHeaders(records)) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(scan);
    });
    obs.observe(document.body, { childList: true, subtree: true });
    scan();
    return () => { obs.disconnect(); cancelAnimationFrame(raf); };
  }, []);
}
