import React, { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { ArrowSquareOut, MagnifyingGlass, DownloadSimple, CaretDown, CaretRight } from "@phosphor-icons/react";
import { fmtAmount, fmtPct, unitDiv, unitLabel } from "./format";
import { agg, periodPrefix, csvDownload } from "./mis";
import { PeriodPicker } from "./MisCommon";

// Full P&L rows whose double-click lists what is behind them (see backend mis_reports.DRILL_PARTS)
const ROWS = new Set(["rev", "rev_cute", "rev_noncute", "rev_cr", "rev_projects", "rev_noncute_sol", "rev_share",
  "opex_tp", "opex_ca", "opex_shared", "opex_cr", "opex_pj", "emp_direct", "emp_active", "emp_shared", "emp_cr", "emp_pj",
  "emp_indirect", "sga"]);
export const canDrill = (id) => ROWS.has(id) || /^(ei|sga)_/.test(id || "");

/**
 * The list behind a P&L line: projects (revenue, TP opex, resource cost), airports, locations or departments,
 * with AOP, actual (+ forecast after the cut-off) and the variance for the chosen FY / YTD / MTD.
 */
export default function DrillList({ row, geo, tag, unit, period: p0, month: m0, months: mm0, onOpenFormat, revenueModal }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [period, setPeriod] = useState(p0 || "ytd");
  const [month, setMonth] = useState(m0 ?? null);
  const [q, setQ] = useState("");
  const [closed, setClosed] = useState({});
  const [showRev, setShowRev] = useState(false);
  useEffect(() => {
    setData(null); setErr("");
    api.get("/aop/mis/drill", { params: { row: row.id, geo, tag } })
      .then((r) => setData(r.data)).catch((e) => setErr(e.response?.data?.detail || e.message));
  }, [row.id, geo, tag]);
  const months = data?.months || mm0;
  const m = month ?? months?.default_month ?? 0;
  const sign = row.sign === 1 ? 1 : -1; // revenue: actual above AOP is favourable; costs: below AOP is
  const prefix = periodPrefix(period, months, m) || "FY";
  const groups = useMemo(() => (data?.groups || []).map((g) => ({
    ...g,
    items: g.items.filter((i) => !q || `${i.label} ${i.sub || ""} ${i.project_id || ""}`.toLowerCase().includes(q.toLowerCase())),
  })), [data, q]);
  const val = (i, k) => agg(i.values?.[k], period, m) || 0;
  const tot = (items, k) => items.reduce((a, i) => a + val(i, k), 0);
  const money = (v) => fmtAmount(v, unit);
  const exportCsv = () => {
    const div = unitDiv(unit);
    const lines = [["Group", "Item", "Detail", `${prefix} AOP`, `${prefix} Actual`, "Variance"]];
    groups.forEach((g) => g.items.forEach((i) => {
      const a = val(i, "b_plan"); const b = val(i, "af_plan");
      lines.push([g.label, i.label, i.sub || "", a / div, b / div, ((b - a) * sign) / div]);
    }));
    csvDownload(lines, `${row.label}_${period}.csv`);
  };
  const cut = months?.cutoff;
  return (
    <div className="space-y-2" data-testid="drill-list">
      <div className="flex items-center gap-1.5 flex-wrap">
        <PeriodPicker period={period} month={m} months={months}
                      onChange={(c) => { if (c.period) setPeriod(c.period); if (c.month !== undefined) setMonth(c.month); }} testid="drill-period" />
        <span className="relative">
          <MagnifyingGlass size={12} className="absolute left-2 top-2 text-[var(--muted)]" />
          <input className="input-sm pl-6 w-48" placeholder="Search project / location" value={q} onChange={(e) => setQ(e.target.value)} data-testid="drill-search" />
        </span>
        <div className="flex-1" />
        {revenueModal && <button className="icon-btn" onClick={() => setShowRev((x) => !x)}>{showRev ? "Hide" : "Revenue performance"}</button>}
        {onOpenFormat && <button className="icon-btn" onClick={onOpenFormat} title="Open the detailed report format"><ArrowSquareOut size={13} />Detailed report</button>}
        <button className="icon-btn" onClick={exportCsv} title="Export (csv)"><DownloadSimple size={13} /></button>
      </div>
      {err && <div className="text-xs text-[var(--danger)]">{String(err)}</div>}
      {!data && !err && <div className="text-xs text-[var(--muted)] p-3">Loading…</div>}
      {data && !groups.length && <div className="text-xs text-[var(--muted)] p-3">Nothing to list for this line.</div>}
      {showRev && revenueModal}
      {data && groups.length > 0 && (
        <div className="overflow-auto border border-[var(--border)]" style={{ maxHeight: "70vh" }}>
          <table className="mis-table w-full" data-testid="drill-table">
            <thead>
              <tr>
                <th className="lbl h-head">{groups.length === 1 ? groups[0].item_label : "Item"} ({unitLabel(unit)})</th>
                <th className="h-head !text-left">Detail</th>
                <th className="h-cacr !text-right">{prefix} AOP</th>
                <th className="h-cacr !text-right" title={cut ? `Actual to ${cut}, forecast after` : undefined}>{prefix} Actual{period === "fy" ? " + Fcst" : ""}</th>
                <th className="h-tot !text-right" title="favourable (+) / adverse (−)">Var</th>
                <th className="h-tot !text-right">Var %</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const a = tot(g.items, "b_plan"); const b = tot(g.items, "af_plan"); const v = (b - a) * sign;
                const open = !closed[g.label];
                return (
                  <React.Fragment key={g.label}>
                    {groups.length > 1 && (
                      <tr className="sub dbl" onClick={() => setClosed((c) => ({ ...c, [g.label]: open }))}>
                        <td className="lbl"><span className="inline-flex items-center gap-1">{open ? <CaretDown size={11} /> : <CaretRight size={11} />}{g.label} <span className="text-[var(--muted)] font-normal">· {g.items.length}</span></span></td>
                        <td />
                        <td className="num gl">{money(a)}</td><td className="num">{money(b)}</td>
                        <td className={`num ${v < 0 ? "neg" : ""}`}>{money(v)}</td><td className="num">{a ? fmtPct(v / Math.abs(a)) : ""}</td>
                      </tr>
                    )}
                    {open && g.items.map((i) => {
                      const ia = val(i, "b_plan"); const ib = val(i, "af_plan"); const iv = (ib - ia) * sign;
                      return (
                        <tr key={`${g.label}|${i.id}`} className={groups.length > 1 ? "child" : ""} data-testid={`drill-item-${i.id}`}>
                          <td className="lbl"><span style={{ paddingLeft: groups.length > 1 ? 14 : 0 }}>{i.label}</span>
                            {i.project_id && i.project_id !== i.label && <span className="ml-1 text-[10px] text-[var(--muted)]">{i.project_id}</span>}</td>
                          <td className="text-[10.5px] text-[var(--muted)]">{i.sub || ""}</td>
                          <td className="num gl">{money(ia)}</td><td className="num">{money(ib)}</td>
                          <td className={`num ${iv < 0 ? "neg" : ""}`}>{money(iv)}</td><td className="num">{ia ? fmtPct(iv / Math.abs(ia)) : ""}</td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                );
              })}
              {groups.length > 1 && (() => {
                const all = groups.flatMap((g) => g.items);
                const a = tot(all, "b_plan"); const b = tot(all, "af_plan"); const v = (b - a) * sign;
                return (
                  <tr className="key">
                    <td className="lbl">Total</td><td />
                    <td className="num gl">{money(a)}</td><td className="num">{money(b)}</td>
                    <td className={`num ${v < 0 ? "neg" : ""}`}>{money(v)}</td><td className="num">{a ? fmtPct(v / Math.abs(a)) : ""}</td>
                  </tr>
                );
              })()}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
