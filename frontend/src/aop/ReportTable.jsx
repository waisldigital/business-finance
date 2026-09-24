import React, { useMemo, useState } from "react";
import { DownloadSimple, ArrowsInLineVertical, ArrowsOutLineVertical } from "@phosphor-icons/react";
import GridSettings from "./GridSettings";
import ColumnHeader from "./ColumnHeader";
import { arrangeColumns, passes } from "./gridView";
import { csvDownload } from "./mis";

/**
 * Table used by the MIS report formats.
 *  - rows: [{id, parent?, label, kind: "total"|"sub"|"key"|"pct"|"grand", masked?, drill?}] (parent → collapsible;
 *    a row with children opens / closes on click — no buttons)
 *  - columns: [{key, label, group?, cls?, num?, get(row) → value, fmt(v,row) → string, neg?}]
 *  - view / update / reset: from useGridView (column order, hidden, filters, sort, 12M)
 *  - onRowDrill(row): double-click action (drill-down)
 */
export default function ReportTable({ rows, columns, view, update, reset, shared, hasMonths = false, onRowDrill, labelHeader = "Particulars",
                                      name = "report", defaultOpen = false, height = "calc(100vh - 260px)", testid = "report-table", toolbar }) {
  const [open, setOpen] = useState({});
  const kids = useMemo(() => {
    const m = {};
    rows.forEach((r) => { if (r.parent) (m[r.parent] = m[r.parent] || []).push(r.id); });
    return m;
  }, [rows]);
  const isOpen = (id) => (id in open ? open[id] : defaultOpen);
  const depth = useMemo(() => {
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    const d = {};
    rows.forEach((r) => { let n = 0; let p = r.parent; while (p && byId[p]) { n += 1; p = byId[p].parent; } d[r.id] = n; });
    return d;
  }, [rows]);

  const label = { key: "__label", label: labelHeader };
  const labelRows = useMemo(() => rows.map((r) => ({ ...r, __label: r.label })), [rows]);
  const all = useMemo(() => arrangeColumns(columns, view), [columns, view]);
  const cols = all.filter((c) => !c.hiddenByUser);

  // filters / sort apply to leaf rows; parents stay while any child survives; sort within siblings
  const shown = useMemo(() => {
    const act = Object.entries(view.filters || {}).filter(([, f]) => f && (f.values || f.cond?.op));
    const byKey = Object.fromEntries([label, ...columns].map((c) => [c.key, c]));
    const val = (r, k) => (k === "__label" ? r.label : byKey[k]?.get?.(r));
    const pass = (r) => act.every(([k, f]) => !byKey[k] || passes(val(r, k), f, !!byKey[k].num));
    const keep = new Set();
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    rows.forEach((r) => {
      if (kids[r.id] || !act.length || r.kind === "grand" || pass(r)) {
        keep.add(r.id);
        let p = r.parent;
        while (p && byId[p]) { keep.add(p); p = byId[p].parent; }
      }
    });
    let list = rows.filter((r) => keep.has(r.id) && (!kids[r.id] || !act.length || kids[r.id].some((k) => keep.has(k)) || pass(r)));
    if (view.sort && byKey[view.sort.key]) {
      const dir = view.sort.dir === "desc" ? -1 : 1;
      const num = view.sort.key !== "__label" && byKey[view.sort.key].num;
      const cmp = (a, b) => (num ? ((Number(val(a, view.sort.key)) || 0) - (Number(val(b, view.sort.key)) || 0))
        : String(val(a, view.sort.key) ?? "").localeCompare(String(val(b, view.sort.key) ?? ""), undefined, { numeric: true })) * dir;
      // stable sort among siblings: rebuild the tree order
      const children = {};
      const roots = [];
      list.forEach((r) => (r.parent && keep.has(r.parent) ? (children[r.parent] = children[r.parent] || []).push(r) : roots.push(r)));
      const fixed = (r) => r.kind === "grand" || r.kind === "pct" || r.pinned;
      const order = (arr) => {
        const movable = arr.filter((r) => !fixed(r)).sort(cmp);
        let i = 0;
        return arr.map((r) => (fixed(r) ? r : movable[i++]));
      };
      const out = [];
      const walk = (arr) => order(arr).forEach((r) => { out.push(r); if (children[r.id]) walk(children[r.id]); });
      walk(roots);
      list = out;
    }
    return list;
  }, [rows, columns, view, kids]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = shown.filter((r) => {
    let p = r.parent;
    const byId = Object.fromEntries(rows.map((x) => [x.id, x]));
    while (p && byId[p]) { if (!isOpen(p)) return false; p = byId[p].parent; }
    return true;
  });
  const setAll = (v) => setOpen(Object.fromEntries(Object.keys(kids).map((k) => [k, v])));

  const exportCsv = () => {
    csvDownload([[labelHeader, ...cols.map((c) => `${c.group ? `${c.group} ` : ""}${c.label}`)],
                 ...shown.map((r) => ["  ".repeat(depth[r.id] || 0) + r.label, ...cols.map((c) => (r.masked ? "restricted" : c.csv ? c.csv(r) : c.get(r)))])],
                `${name}.csv`);
  };

  // two header rows when columns carry groups
  const groups = [];
  cols.forEach((c) => {
    const g = c.group || "";
    if (groups.length && groups[groups.length - 1].g === g && groups[groups.length - 1].cls === c.groupCls) groups[groups.length - 1].n += 1;
    else groups.push({ g, n: 1, cls: c.groupCls || c.cls || "h-tot" });
  });
  const hasGroups = cols.some((c) => c.group);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        {toolbar}
        <div className="flex-1" />
        {Object.keys(kids).length > 0 && (
          <div className="seg" title="Rows">
            <button onClick={() => setAll(false)} title="Consolidated (collapse all)" data-testid={`${testid}-collapse`}><ArrowsInLineVertical size={12} /></button>
            <button onClick={() => setAll(true)} title="Expand all" data-testid={`${testid}-expand`}><ArrowsOutLineVertical size={12} /></button>
          </div>
        )}
        <GridSettings cols={all} view={view} update={update} reset={reset} shared={shared} hasMonths={hasMonths} pivotable={false} testid={`${testid}-settings`} />
        <button className="icon-btn" onClick={exportCsv} title="Download this report (csv)" data-testid={`${testid}-download`}><DownloadSimple size={13} /></button>
      </div>
      <div className="overflow-auto border border-[var(--border)]" style={{ maxHeight: height }}>
        <table className="mis-table w-max min-w-full" data-testid={testid}>
          <thead>
            {hasGroups && (
              <tr>
                <th className="lbl h-head" rowSpan={2}>
                  <ColumnHeader col={label} rows={labelRows} view={view} update={update} />
                </th>
                {groups.map((g, i) => <th key={i} className={g.cls} colSpan={g.n}>{g.g}</th>)}
              </tr>
            )}
            <tr>
              {!hasGroups && <th className="lbl h-head"><ColumnHeader col={label} rows={labelRows} view={view} update={update} /></th>}
              {cols.map((c) => (
                <th key={c.key} className={`${c.groupCls || c.cls || "h-tot"} !text-right`} title={c.title}>
                  <ColumnHeader col={{ ...c, numeric: c.num }} rows={rows.map((r) => ({ ...r, [c.key]: r.masked ? null : c.get(r) }))} view={view} update={update} align="right" testid={`${testid}-h-${c.key}`} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const d = depth[r.id] || 0;
              const hasKids = !!kids[r.id];
              return (
                <tr key={r.id} data-testid={`${testid}-row-${r.id}`}
                    className={`${r.kind === "grand" ? "grand" : r.kind === "key" || r.kind === "total" ? "key" : r.kind === "sub" ? "sub" : ""} ${d ? "child" : ""} ${r.kind === "pct" ? "pct" : ""} ${hasKids ? "cursor-pointer" : ""} ${r.drill || onRowDrill ? "dbl" : ""}`}
                    onClick={hasKids ? () => setOpen((o) => ({ ...o, [r.id]: !isOpen(r.id) })) : undefined}
                    onDoubleClick={onRowDrill ? () => onRowDrill(r) : undefined}
                    title={r.drill ? "Double-click to drill down" : hasKids ? (isOpen(r.id) ? "Click to close" : "Click to open") : undefined}>
                  <td className={`lbl ${r.kind === "grand" ? "!bg-[var(--mis-head)]" : ""}`}>
                    <span style={{ paddingLeft: d * 14 }} className={`inline-block ${hasKids && !isOpen(r.id) ? "underline decoration-dotted underline-offset-2 decoration-[var(--muted)]" : ""}`}>{r.label}</span>
                  </td>
                  {cols.map((c, i) => {
                    const v = r.masked ? null : c.get(r);
                    const first = i === 0 || cols[i - 1].group !== c.group;
                    return (
                      <td key={c.key} className={`num ${first && hasGroups ? "gl" : ""} ${c.cellCls ? c.cellCls(r, v) : ""} ${typeof v === "number" && v < 0 && c.neg !== false && r.kind !== "pct" ? "neg" : ""}`}>
                        {r.masked ? "•••" : c.fmt ? c.fmt(v, r) : v}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
