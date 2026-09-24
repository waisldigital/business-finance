import React, { useMemo, useState } from "react";
import { fmtCell } from "./format";
import { buildPivot, cellValue, isNumeric } from "./gridView";
import ColumnHeader from "./ColumnHeader";

/**
 * Pivot view of a grid: rows grouped by the first `levels` visible columns (Excel tabular layout).
 *  - view.subtotals off (default): open groups show just their line items; a closed group is one summed row
 *  - view.subtotals on: a summed row heads every group (closed by default)
 *  - view.repeatLabels on (default): every line repeats its group labels, otherwise only the first line shows them
 * Clicking a group label closes / opens that group — no buttons.
 */
export default function PivotTable({ cols, rows, allRows, view, update, levels, onRowOpen, height = "calc(100vh - 250px)", testid = "pivot" }) {
  const pivot = useMemo(() => buildPivot(rows, cols, levels), [rows, cols, levels]);
  const subtotals = !!view.subtotals;
  const repeat = view.repeatLabels !== false;
  // toggled = groups the viewer flipped from the default (closed with subtotals, open without)
  const [toggled, setToggled] = useState(() => new Set());
  const isOpen = (id) => (subtotals ? toggled.has(id) : !toggled.has(id));
  const flip = (id) => setToggled((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allIds = () => {
    const ids = [];
    const walk = (gs) => gs.forEach((g) => { ids.push(g.id); if (g.children) walk(g.children); });
    walk(pivot.groups);
    return ids;
  };
  const setAll = (open) => setToggled(new Set(open === subtotals ? allIds() : []));
  const fmt = (c, v) => (isNumeric(c) ? fmtCell(v, "number") : fmtCell(v, c.type));

  // flatten into display rows: {kind: "group"|"leaf", ...}; path = the group chain above a line (for labels / clicks)
  const out = [];
  const walk = (groups, path) => {
    for (const g of groups) {
      const open = isOpen(g.id);
      if (!open || subtotals) out.push({ kind: "group", g, path, open });
      if (!open) continue;
      if (g.children) walk(g.children, [...path, g]);
      else g.rows.forEach((r, i) => out.push({ kind: "leaf", r, path: [...path, g], first: i === 0, id: `${g.id}#${i}` }));
    }
  };
  walk(pivot.groups, []);
  // without repeated labels, a label shows only where it changes from the line above
  const prevPath = [];

  return (
    <div className="border border-[var(--border)] bg-[var(--surface)]" data-testid={testid}>
      <div className="flex items-center gap-2 px-2 py-1 border-b border-[var(--border)] text-[10.5px] text-[var(--muted)]">
        <span>{pivot.count.toLocaleString("en-IN")} line items · grouped by {cols.slice(0, levels).map((c) => c.label).join(" › ")}
          {subtotals ? " · subtotals on" : ""}</span>
        <div className="flex-1" />
        <button className="underline hover:text-[var(--gold)]" onClick={() => setAll(true)} data-testid={`${testid}-expand`}>Expand all</button>
        <button className="underline hover:text-[var(--gold)]" onClick={() => setAll(false)} data-testid={`${testid}-collapse`}>Collapse all</button>
      </div>
      <div className="overflow-auto" style={{ maxHeight: height }}>
        <table className="pnl-table text-[12px] w-max min-w-full border-separate border-spacing-0">
          <thead>
            <tr>
              {cols.map((c, i) => (
                <th key={c.key} className={`${i === 0 ? "lbl" : ""} ${isNumeric(c) ? "text-right" : "text-left"} ${i < levels ? "!text-[var(--gold)]" : ""}`}>
                  <ColumnHeader col={c} rows={allRows} view={view} update={update} align={isNumeric(c) ? "right" : "left"} testid={`${testid}-h-${c.key}`} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {out.map((x) => {
              if (x.kind === "group") {
                const g = x.g;
                return (
                  <tr key={g.id} className={`cursor-pointer select-none ${subtotals ? (g.level === 0 ? "total" : "subtotal") : "subtotal"}`} onClick={() => flip(g.id)}
                      data-testid={`${testid}-g-${g.level}-${g.label}`} title={x.open ? "Click to close" : "Click to open"}>
                    {cols.map((c, i) => {
                      if (i < levels) {
                        const label = i < g.level ? x.path[i]?.label : i === g.level ? g.label : "";
                        return (
                          <td key={c.key} className={`${i === 0 ? "lbl" : ""} ${i < g.level ? "text-[var(--muted)] font-normal" : ""}`}>
                            {i === g.level ? (
                              <span className="inline-flex items-center gap-1.5">
                                <span>{label}</span>
                                <span className="text-[9.5px] font-normal text-[var(--muted)] tabular-nums">{g.count}</span>
                              </span>
                            ) : (repeat ? label : "")}
                          </td>
                        );
                      }
                      return <td key={c.key} className={isNumeric(c) ? "num" : ""}>{isNumeric(c) ? fmt(c, g.sums[c.key]) : ""}</td>;
                    })}
                  </tr>
                );
              }
              const show = x.path.map((g, i) => repeat || subtotals === false && prevPath[i] !== g.id);
              x.path.forEach((g, i) => { prevPath[i] = g.id; });
              return (
                <tr key={x.id} className="hover:bg-[var(--row-hover)]" onDoubleClick={() => onRowOpen?.(x.r)}>
                  {cols.map((c, i) => {
                    if (i < levels) {
                      const g = x.path[i];
                      const visible = subtotals ? repeat : show[i];
                      return (
                        <td key={c.key} className={`${i === 0 ? "lbl" : ""} ${subtotals ? "text-[var(--muted)]" : "cursor-pointer hover:text-[var(--gold)]"}`}
                            onClick={subtotals ? undefined : () => flip(g.id)} title={subtotals ? undefined : `Click to close ${g.label}`}>
                          {visible ? g.label : ""}
                        </td>
                      );
                    }
                    return <td key={c.key} className={`${isNumeric(c) ? "num" : ""}`}>{fmt(c, cellValue(x.r, c))}</td>;
                  })}
                </tr>
              );
            })}
            <tr className="total">
              {cols.map((c, i) => <td key={c.key} className={`${i === 0 ? "lbl" : ""} ${isNumeric(c) ? "num" : ""}`}>{i === 0 ? "Grand total" : isNumeric(c) ? fmt(c, pivot.total[c.key]) : ""}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
