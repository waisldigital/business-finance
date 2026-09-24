import React, { useMemo, useState } from "react";
import { fmtCell } from "./format";
import { buildPivot, cellValue, isNumeric } from "./gridView";
import ColumnHeader from "./ColumnHeader";

/**
 * Pivot view of a grid: rows grouped by the first `levels` visible columns. A group row opens / closes on click
 * (no buttons); numeric columns show the group's sum; the last level opens to the line items.
 */
export default function PivotTable({ cols, rows, allRows, view, update, levels, onRowOpen, height = "calc(100vh - 250px)", testid = "pivot" }) {
  const pivot = useMemo(() => buildPivot(rows, cols, levels), [rows, cols, levels]);
  const [open, setOpen] = useState(() => new Set());
  const toggle = (id) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const expandAll = () => {
    const ids = new Set();
    const walk = (gs) => gs.forEach((g) => { ids.add(g.id); if (g.children) walk(g.children); });
    walk(pivot.groups);
    setOpen(ids);
  };
  const fmt = (c, v) => (isNumeric(c) ? fmtCell(v, "number") : fmtCell(v, c.type));

  const out = [];
  const walk = (groups) => {
    for (const g of groups) {
      out.push({ kind: "group", g });
      if (open.has(g.id)) {
        if (g.children) walk(g.children);
        else g.rows.forEach((r, i) => out.push({ kind: "leaf", r, level: g.level + 1, id: `${g.id}#${i}` }));
      }
    }
  };
  walk(pivot.groups);

  return (
    <div className="border border-[var(--border)] bg-[var(--surface)]" data-testid={testid}>
      <div className="flex items-center gap-2 px-2 py-1 border-b border-[var(--border)] text-[10.5px] text-[var(--muted)]">
        <span>{pivot.count.toLocaleString("en-IN")} line items · grouped by {cols.slice(0, levels).map((c) => c.label).join(" › ")}</span>
        <div className="flex-1" />
        <button className="underline hover:text-[var(--gold)]" onClick={expandAll} data-testid={`${testid}-expand`}>Expand all</button>
        <button className="underline hover:text-[var(--gold)]" onClick={() => setOpen(new Set())} data-testid={`${testid}-collapse`}>Collapse all</button>
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
                  <tr key={g.id} className={`cursor-pointer select-none ${g.level === 0 ? "total" : "subtotal"}`} onClick={() => toggle(g.id)}
                      data-testid={`${testid}-g-${g.level}-${g.label}`} title={open.has(g.id) ? "Click to close" : "Click to open"}>
                    {cols.map((c, i) => {
                      if (i < levels) {
                        return (
                          <td key={c.key} className={i === 0 ? "lbl" : ""} style={i === g.level ? { paddingLeft: 8 } : undefined}>
                            {i === g.level ? (
                              <span className="inline-flex items-center gap-1.5">
                                <span className={open.has(g.id) ? "" : "underline decoration-dotted decoration-[var(--muted)] underline-offset-2"}>{g.label}</span>
                                <span className="text-[9.5px] font-normal text-[var(--muted)] tabular-nums">{g.count}</span>
                              </span>
                            ) : ""}
                          </td>
                        );
                      }
                      return <td key={c.key} className={isNumeric(c) ? "num" : ""}>{isNumeric(c) ? fmt(c, g.sums[c.key]) : ""}</td>;
                    })}
                  </tr>
                );
              }
              return (
                <tr key={x.id} className="hover:bg-[var(--row-hover)]" onDoubleClick={() => onRowOpen?.(x.r)}>
                  {cols.map((c, i) => (
                    <td key={c.key} className={`${i === 0 ? "lbl" : ""} ${isNumeric(c) ? "num" : ""} ${i < levels ? "text-[var(--muted)]" : ""}`}>
                      {fmt(c, cellValue(x.r, c))}
                    </td>
                  ))}
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
