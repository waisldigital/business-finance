import React, { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { DownloadSimple, ArrowClockwise, CalendarBlank, Info } from "@phosphor-icons/react";
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";
import { fmtAmount, fmtPct, unitDiv, unitLabel } from "./format";
import { agg, useTree, csvDownload } from "./mis";
import { TreeLabel, ExpandButtons, useFilters, FilterBar } from "./MisCommon";

const TEAL = "#31869b";
const MAROON = "#963634";

/**
 * Revenue performance (MIS slide 4): revenue by stream — full-year AOP, YTD and MTD AOP vs actual/forecast
 * with variances — plus billable PAX. Standalone format, and the drill-down on the P&L Revenue line.
 */
export default function RevenuePerformance({ unit, geo, tag, initialMonth, embedded = false, onDrill }) {
  const own = useFilters();
  const g = embedded ? geo : own.geo;
  const t = embedded ? tag : own.tag;
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [month, setMonth] = useState(initialMonth ?? null);

  const load = () => {
    setErr("");
    api.get("/aop/mis/revenue", { params: { geo: g, tag: t } }).then((r) => setData(r.data)).catch((e) => setErr(e.response?.data?.detail || e.message));
  };
  useEffect(load, [g, t]);

  const rows = useMemo(() => data?.rows || [], [data]);
  const tree = useTree(rows, { defaultOpen: false });
  const m = month ?? data?.months?.default_month ?? 0;
  const labels = data?.months?.labels || [];
  const ms = Object.fromEntries((data?.measures || []).map((x) => [x.key, x]));
  const aopLbl = ms.b_plan?.label || "AOP";
  const prev = m > 0 ? m - 1 : null;

  const cols = [
    { key: "fy_aop", label: `${aopLbl}`, grp: "fy", get: (r) => agg(r.values.b_plan, "fy") },
    { key: "ytd_aop", label: "AOP", grp: "ytd", get: (r) => agg(r.values.b_plan, "ytd", m) },
    { key: "ytd_act", label: "Act", grp: "ytd", get: (r) => agg(r.values.af_plan, "ytd", m) },
    { key: "ytd_var", label: "Var", grp: "ytd", var: true, get: (r) => agg(r.values.af_plan, "ytd", m) - agg(r.values.b_plan, "ytd", m) },
    { key: "ytd_pct", label: "%", grp: "ytd", pct: true, get: (r) => { const b = agg(r.values.b_plan, "ytd", m); return b ? (agg(r.values.af_plan, "ytd", m) - b) / Math.abs(b) : null; } },
    ...(prev !== null ? [{ key: "prev_act", label: "Act", grp: "prev", get: (r) => agg(r.values.af_plan, "mtd", prev) }] : []),
    { key: "mtd_aop", label: "AOP", grp: "mtd", get: (r) => agg(r.values.b_plan, "mtd", m) },
    { key: "mtd_act", label: "Act", grp: "mtd", get: (r) => agg(r.values.af_plan, "mtd", m) },
    { key: "mtd_var", label: "Var", grp: "mtd", var: true, get: (r) => agg(r.values.af_plan, "mtd", m) - agg(r.values.b_plan, "mtd", m) },
    { key: "mtd_pct", label: "%", grp: "mtd", pct: true, get: (r) => { const b = agg(r.values.b_plan, "mtd", m); return b ? (agg(r.values.af_plan, "mtd", m) - b) / Math.abs(b) : null; } },
  ];
  const groups = [
    { key: "fy", label: data ? data.meta.plan_fy : "", cls: "h-cacr" },
    { key: "ytd", label: `YTD ${labels[m] || ""}`, cls: "h-cacr" },
    ...(prev !== null ? [{ key: "prev", label: labels[prev], cls: "h-sol" }] : []),
    { key: "mtd", label: labels[m] || "MTD", cls: "h-sol" },
  ].map((x) => ({ ...x, span: cols.filter((c) => c.grp === x.key).length }));

  const show = (c, v) => (v === null || v === undefined ? "" : c.pct ? fmtPct(v) : fmtAmount(v, unit));
  const exportCsv = () => {
    const div = unitDiv(unit);
    csvDownload([["Revenue stream", ...cols.map((c) => `${groups.find((g2) => g2.key === c.grp)?.label} ${c.label}`)],
                 ...rows.map((r) => [r.label, ...cols.map((c) => { const v = c.get(r); return c.pct ? v : (v ?? 0) / div; })])], "Revenue_performance.csv");
  };

  return (
    <div className="space-y-2" data-testid="fmt-revenue">
      <div className="flex items-center gap-1.5 flex-wrap">
        {!embedded && <FilterBar f={own} />}
        <span className="inline-flex items-center gap-1">
          <CalendarBlank size={12} className="text-[var(--muted)]" />
          <select className="input-sm" value={m} onChange={(e) => setMonth(Number(e.target.value))} data-testid="rev-month">
            {labels.map((l, i) => <option key={l} value={i}>{l}</option>)}
          </select>
        </span>
        <span className="text-[10.5px] text-[var(--muted)]">Act = {ms.af_plan?.label} (actual to cut-off, forecast after) · AOP = {aopLbl}</span>
        <div className="flex-1" />
        <ExpandButtons tree={tree} />
        <button className="icon-btn" onClick={exportCsv} title="Export (csv)"><DownloadSimple size={13} /></button>
        <button className="icon-btn" onClick={load} title="Refresh"><ArrowClockwise size={13} /></button>
      </div>
      {err && <div className="text-xs text-[var(--danger)]">{String(err)}</div>}
      {data && (
        <div className="overflow-auto border border-[var(--border)]">
          <table className="mis-table w-max min-w-full" data-testid="revenue-table">
            <thead>
              <tr>
                <th className="lbl h-head" rowSpan={2}>Revenue stream ({unitLabel(unit)})</th>
                {groups.map((x) => <th key={x.key} className={x.cls} colSpan={x.span}>{x.label}</th>)}
              </tr>
              <tr>{cols.map((c) => <th key={c.key} className={`${groups.find((x) => x.key === c.grp).cls} !text-right`}>{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {rows.filter(tree.visible).map((r) => {
                const d = tree.depth(r.id);
                return (
                  <tr key={r.id} className={`${r.kind === "total" ? "grand" : ""} ${d ? "child" : ""} ${onDrill && (r.id === "cute" || r.parent === "cute" || r.id === "projects") ? "dbl" : ""}`}
                      onDoubleClick={onDrill && (r.id === "cute" || r.parent === "cute") ? () => onDrill("cute_analysis", {}, "CUTE — PAX × rate")
                        : onDrill && (r.id === "projects" || r.parent === "projects") ? () => onDrill("project_health", {}, "Project health") : undefined}
                      data-testid={`rev-row-${r.id}`}>
                    <td className={`lbl ${r.kind === "total" ? "!bg-[var(--mis-head)]" : ""}`}><TreeLabel row={r} tree={tree} depth={d} /></td>
                    {cols.map((c, i) => {
                      const v = c.get(r);
                      const first = i === 0 || cols[i - 1].grp !== c.grp;
                      return <td key={c.key} className={`num ${first ? "gl" : ""} ${(c.var || c.pct) && v < 0 ? "neg" : ""}`}>{show(c, v)}</td>;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {data && <PaxCharts pax={data.pax} labels={labels} month={m} aopLbl={aopLbl} />}
    </div>
  );
}

// Billable PAX (Mn): monthly trend (DIAL & GHIAL) and YTD by location / passenger type, AOP vs actual
function PaxCharts({ pax, labels, month, aopLbl }) {
  const series = useMemo(() => {
    // an airport's split rows (Domestic / International) replace its Combined row
    const split = new Set(pax.filter((p) => p.pax_type !== "Combined").map((p) => p.airport));
    return pax.filter((p) => p.pax_type !== "Combined" || !split.has(p.airport));
  }, [pax]);
  const hasAct = series.some((p) => p.measures.af_plan);
  const trendAirports = ["DIAL", "GHIAL"].filter((a) => series.some((p) => p.airport === a));
  const trend = labels.map((l, i) => {
    const pick = (k) => series.filter((p) => trendAirports.includes(p.airport)).reduce((s, p) => s + ((p.measures[k] || [])[i] || 0), 0) / 1e6;
    return { month: l, AOP: pick("b_plan"), Actual: hasAct ? pick("af_plan") : null };
  });
  const ytd = (arr) => (arr || []).slice(0, month + 1).reduce((a, b) => a + (b || 0), 0) / 1e6;
  const bars = series.filter((p) => p.measures.b_plan).map((p) => ({
    name: `${p.airport}${p.pax_type === "Combined" ? "" : ` ${p.pax_type.slice(0, 3)}`}`,
    AOP: ytd(p.measures.b_plan), Actual: hasAct ? ytd(p.measures.af_plan) : null,
  }));
  if (!series.length) return null;
  const tick = { fontSize: 10, fill: "var(--muted)" };
  return (
    <div className="grid lg:grid-cols-2 gap-2">
      <div className="border border-[var(--border)] p-2">
        <div className="text-[11px] font-semibold mb-1">Billable PAX trend ({trendAirports.join(" & ")}) — monthly (Mn)</div>
        <ResponsiveContainer width="100%" height={190}>
          <LineChart data={trend} margin={{ top: 5, right: 10, left: -18, bottom: 0 }}>
            <CartesianGrid stroke="var(--border-soft)" vertical={false} />
            <XAxis dataKey="month" tick={tick} /><YAxis tick={tick} />
            <Tooltip formatter={(v) => (v === null ? "—" : `${Math.round(v * 1000).toLocaleString("en-IN")} K`)} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Line dataKey="AOP" name={`AOP PAX (${aopLbl})`} stroke={TEAL} strokeWidth={2} dot={false} />
            {hasAct && <Line dataKey="Actual" name="Actual PAX" stroke={MAROON} strokeWidth={2} dot={{ r: 2 }} />}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="border border-[var(--border)] p-2">
        <div className="text-[11px] font-semibold mb-1">YTD billable PAX by location — Apr to {labels[month]} (Mn)</div>
        <ResponsiveContainer width="100%" height={190}>
          <BarChart data={bars} margin={{ top: 5, right: 10, left: -18, bottom: 0 }}>
            <CartesianGrid stroke="var(--border-soft)" vertical={false} />
            <XAxis dataKey="name" tick={tick} /><YAxis tick={tick} />
            <Tooltip formatter={(v) => (v === null ? "—" : `${Math.round(v * 1000).toLocaleString("en-IN")} K`)} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Bar dataKey="AOP" fill={TEAL} />
            {hasAct && <Bar dataKey="Actual" fill={MAROON} />}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {!hasAct && (
        <div className="lg:col-span-2 text-[10.5px] text-[var(--muted)] flex items-center gap-1">
          <Info size={11} /> No actual PAX for the current year yet — add rows with metric “PAX Actual” in AOP Inputs → CUTE drivers.
        </div>
      )}
    </div>
  );
}
