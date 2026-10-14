import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Excel-like cell selection for every report table on the page (the data grids have their own): click a cell, then
// Shift+click, drag or Shift+arrows to select a range; Ctrl/Cmd+C copies it; the numbers' count, sum and average
// show in a badge. Tables opt out with data-no-cell-select.
const parse = (txt) => {
  const t = String(txt || "").replace(/[₹\s]/g, "").replace(/[−–]/g, "-");
  if (!t || t === "-" || /[a-zA-Z]/.test(t)) return null;
  const neg = /^\(.*\)$/.test(t);
  const n = Number(t.replace(/[(),%]/g, ""));
  if (Number.isNaN(n)) return null;
  return (neg ? -n : n) * (t.endsWith("%") ? 0.01 : 1);
};
const fmt = (n) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

export default function TableSelection({ root = "main" }) {
  const st = useRef({ table: null, anchor: null, active: null, dragging: false });
  const [stats, setStats] = useState(null);

  useEffect(() => {
    const cellAt = (table, r, c) => table.rows[r]?.cells[c];
    const paint = () => {
      document.querySelectorAll(".tsel, .tsel-active").forEach((el) => el.classList.remove("tsel", "tsel-active"));
      const { table, anchor, active } = st.current;
      if (!table || !anchor || !active || !document.body.contains(table)) { setStats(null); return; }
      const r1 = Math.min(anchor.r, active.r), r2 = Math.max(anchor.r, active.r);
      const c1 = Math.min(anchor.c, active.c), c2 = Math.max(anchor.c, active.c);
      let cells = 0, n = 0, sum = 0;
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
        const el = cellAt(table, r, c);
        if (!el || el.tagName !== "TD") continue;
        el.classList.add("tsel");
        cells += 1;
        const v = parse(el.innerText);
        if (v !== null) { n += 1; sum += v; }
      }
      cellAt(table, active.r, active.c)?.classList.add("tsel-active");
      setStats(cells > 1 ? { cells, n, sum } : null);
    };
    const pos = (td) => ({ r: td.parentElement.rowIndex, c: td.cellIndex });
    const eligible = (td) => td && td.closest(root) && !td.closest(".aop-grid, [data-no-cell-select], [role=dialog]");
    const down = (e) => {
      const td = e.target.closest?.("td");
      if (e.target.closest?.("button, a, input, select, textarea, label")) return;
      if (!eligible(td)) { if (!e.target.closest?.("[data-tsel-badge]")) { st.current = { table: null }; paint(); } return; }
      const table = td.closest("table");
      const p = pos(td);
      if (e.shiftKey && st.current.table === table && st.current.anchor) st.current.active = p;
      else st.current = { table, anchor: p, active: p };
      st.current.dragging = true;
      if (e.shiftKey) e.preventDefault(); // no text selection while extending
      paint();
    };
    const over = (e) => {
      if (!st.current.dragging) return;
      const td = e.target.closest?.("td");
      if (!td || td.closest("table") !== st.current.table) return;
      st.current.active = pos(td);
      paint();
    };
    const up = () => { st.current.dragging = false; };
    const key = (e) => {
      const s = st.current;
      if (!s.table || !s.active) return;
      if (e.target.closest?.("input, select, textarea, [contenteditable=true]")) return;
      const d = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowRight: [0, 1], ArrowLeft: [0, -1] }[e.key];
      if (d) {
        e.preventDefault();
        const rows = s.table.rows.length;
        const n = { r: Math.max(0, Math.min(rows - 1, s.active.r + d[0])), c: Math.max(0, s.active.c + d[1]) };
        n.c = Math.min(n.c, (s.table.rows[n.r]?.cells.length || 1) - 1);
        s.active = n;
        if (!e.shiftKey) s.anchor = n;
        paint();
        cellAt(s.table, n.r, n.c)?.scrollIntoView({ block: "nearest", inline: "nearest" });
      } else if (e.key === "Escape") { st.current = { table: null }; paint(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c" && !window.getSelection()?.toString()) {
        const r1 = Math.min(s.anchor.r, s.active.r), r2 = Math.max(s.anchor.r, s.active.r);
        const c1 = Math.min(s.anchor.c, s.active.c), c2 = Math.max(s.anchor.c, s.active.c);
        const lines = [];
        for (let r = r1; r <= r2; r++) {
          const l = [];
          for (let c = c1; c <= c2; c++) l.push((cellAt(s.table, r, c)?.innerText || "").trim());
          lines.push(l.join("\t"));
        }
        navigator.clipboard?.writeText(lines.join("\n")).catch(() => {});
        e.preventDefault();
      }
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("mouseover", over);
    document.addEventListener("mouseup", up);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("mouseover", over);
      document.removeEventListener("mouseup", up);
      document.removeEventListener("keydown", key);
    };
  }, [root]);

  if (!stats) return null;
  return createPortal(
    <div data-tsel-badge className="fixed bottom-3 right-4 z-50 bg-[var(--surface)] border border-[var(--gold)] shadow-lg px-3 py-1.5 text-[11px] tabular-nums flex items-center gap-3"
         data-testid="table-selection-stats">
      <span className="text-[var(--muted)]">{stats.cells} cells</span>
      {stats.n > 0 && <>
        <span>Count <b>{stats.n}</b></span>
        <span>Sum <b>{fmt(stats.sum)}</b></span>
        <span>Average <b>{fmt(stats.sum / stats.n)}</b></span>
      </>}
    </div>, document.body);
}
