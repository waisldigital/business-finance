import React, { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { Info, CalendarBlank, WarningCircle } from "@phosphor-icons/react";
import { ResponsiveContainer, ComposedChart, BarChart, Bar, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";
import { fmtAmount, fmtPct, unitDiv } from "./format";
import { agg, periodPrefix } from "./mis";
import { PeriodPicker } from "./MisCommon";
import ReportTable from "./ReportTable";
import { useGridView } from "./gridView";

const TEAL = "#31869b";
const MAROON = "#963634";
const NAVY = "#1e3a5f";

// ------------------------------------------------------------------ shared bits
function useMis(url, params) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const key = JSON.stringify(params || {});
  const load = () => {
    setErr("");
    if (!url) { setData(null); return; }
    api.get(url, { params }).then((r) => setData(r.data)).catch((e) => setErr(e.response?.data?.detail || e.message));
  };
  useEffect(load, [url, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return [data, err, load];
}

function usePeriod(storageKey, data) {
  const [view, update, reset] = useGridView(storageKey, { period: "ytd", month: null });
  const month = view.month ?? data?.months?.default_month ?? 0;
  return { view, update, reset, period: view.period || "ytd", month };
}

const Err = ({ err }) => (err ? <div className="text-xs text-[var(--danger)] flex items-center gap-1"><WarningCircle size={12} />{String(err)}</div> : null);
const Note = ({ children }) => <div className="text-[10.5px] text-[var(--muted)] flex items-center gap-1"><Info size={11} />{children}</div>;

const money = (unit) => (v) => (v === null || v === undefined ? "" : fmtAmount(v, unit));
const pct0 = (v) => (v === null || v === undefined || Number.isNaN(v) ? "NA" : fmtPct(v));
const ratio = (a, b) => (b ? a / b : null);
const monthCols = (data, meas, get, unit, label = "") => (data?.months?.labels || []).map((l, i) => ({
  key: `m_${meas}_${i}`, label: `${l}${label}`, group: "12M", groupCls: "h-sub", num: true, get: (r) => get(r, i), fmt: money(unit),
}));

// ------------------------------------------------------------------ slide 10 — airport-wise gross margin
export function AirportGM({ unit, onDrill }) {
  const [data, err] = useMis("/aop/mis/airport-gm");
  const p = usePeriod("aop_rep_airport_gm_v1", data);
  const ms = [["a_base", "PY"], ["b_plan", "AOP"], ["af_plan", "Act"]];
  const cls = { DIAL: "h-cacr", GHIAL: "h-sol", GGIAL: "h-cacr", GVIAL: "h-sol", total: "h-tot" };
  const byId = useMemo(() => Object.fromEntries((data?.rows || []).map((r) => [r.id, r])), [data]);
  const val = (r, c, m) => {
    if (r.kind === "pct") { const n = val(byId[r.ratio[0]], c, m); const d = val(byId[r.ratio[1]], c, m); return ratio(n, d); }
    const v = r.values?.[c]?.[m];
    return v ? agg(v, p.period, p.month) : v === undefined ? null : 0;
  };
  const columns = (data?.columns || []).flatMap((c) => ms.filter(([m]) => c.key !== "GVIAL" || m !== "a_base").map(([m, l]) => ({
    key: `${c.key}_${m}`, label: l, group: c.label, groupCls: cls[c.key] || "h-tot", num: true,
    get: (r) => val(r, c.key, m), fmt: (v, r) => (r.kind === "pct" ? pct0(v) : money(unit)(v)),
  })));
  const rows = (data?.rows || []).map((r) => ({ ...r, kind: r.kind === "total" ? "key" : r.kind }));
  const chart = (data?.columns || []).map((c) => ({
    name: c.label, "YTD AOP Rev": (val(byId.rev || {}, c.key, "b_plan") || 0) / unitDiv(unit), "YTD Actual Rev": (val(byId.rev || {}, c.key, "af_plan") || 0) / unitDiv(unit),
    "AOP GM %": (ratio(val(byId.gm || {}, c.key, "b_plan"), val(byId.rev || {}, c.key, "b_plan")) || 0) * 100,
    "Actual GM %": (ratio(val(byId.gm || {}, c.key, "af_plan"), val(byId.rev || {}, c.key, "af_plan")) || 0) * 100,
  }));
  return (
    <div className="space-y-2" data-testid="fmt-airport-gm">
      <Err err={err} />
      {data && (
        <ReportTable rows={rows} columns={columns} view={p.view} update={p.update} reset={p.reset} name="airport_gm" testid="agm"
                     labelHeader={`Particulars · ${periodPrefix(p.period, data.months, p.month) || "FY"}`} defaultOpen
                     onRowDrill={(r) => r.drill && onDrill?.(r.drill, {}, r.label)}
                     toolbar={<PeriodPicker period={p.period} month={p.month} months={data.months} onChange={p.update} testid="agm-period" />} />
      )}
      {data && (
        <div className="border border-[var(--border)] p-2">
          <div className="text-[11px] font-semibold mb-1">Revenue (bars) and gross margin % (lines) — AOP vs actual</div>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={chart} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid stroke="var(--border-soft)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} /><YAxis yAxisId="l" tick={{ fontSize: 10 }} /><YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10 }} unit="%" />
              <Tooltip formatter={(v) => Number(v).toFixed(0)} /><Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar yAxisId="l" dataKey="YTD AOP Rev" fill={TEAL} /><Bar yAxisId="l" dataKey="YTD Actual Rev" fill={MAROON} />
              <Line yAxisId="r" dataKey="AOP GM %" stroke={NAVY} strokeWidth={2} /><Line yAxisId="r" dataKey="Actual GM %" stroke="#d97706" strokeWidth={2} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
      <Note>Shared-services opex and resources are allocated to airports with the Assumptions split · double-click a line to drill down.</Note>
    </div>
  );
}

// ------------------------------------------------------------------ slide 20 — CUTE: PAX × rate
export function CuteAnalysis({ unit }) {
  const [data, err] = useMis("/aop/mis/cute");
  const p = usePeriod("aop_rep_cute_v1", data);
  const [meas, setMeas] = useState("af_plan");
  const labels = data?.months?.labels || [];
  const upto = p.period === "fy" ? 11 : p.month;
  const from = p.period === "mtd" ? p.month : 0;
  const sumRange = (v) => (v ? v.slice(from, upto + 1).reduce((a, b) => a + (b || 0), 0) : null);
  const rows = (data?.rows || []).map((r) => ({ id: r.id, label: r.pax_type === "Combined" ? r.airport : `${r.airport} · ${r.pax_type}`,
    parent: r.pax_type === "Combined" ? undefined : `${r.airport}|Combined`, kind: r.pax_type === "Combined" ? "sub" : undefined, src: r }));
  // parents first
  rows.sort((a, b) => (a.src.airport === b.src.airport ? (a.parent ? 1 : 0) - (b.parent ? 1 : 0) : 0));
  const pax = (r, m) => sumRange(r.src.pax?.[m]);
  const rev = (r, m) => sumRange(r.src.revenue?.[m]);
  const ms = [["a_base", "PY"], ["b_plan", "AOP"], ["af_plan", "Act"]];
  const columns = [
    ...ms.map(([m, l]) => ({ key: `rev_${m}`, label: l, group: `Revenue (${unit === "usd" ? "$ Mn" : unit === "lakh" ? "₹ L" : "₹ Cr"})`, groupCls: "h-cacr", num: true, get: (r) => rev(r, m), fmt: money(unit) })),
    ...ms.map(([m, l]) => ({ key: `pax_${m}`, label: l, group: "Billable PAX ('000)", groupCls: "h-sol", num: true, get: (r) => { const v = pax(r, m); return v === null ? null : v / 1e3; }, fmt: (v) => (v === null ? "—" : Math.round(v).toLocaleString("en-IN")) })),
    ...ms.map(([m, l]) => ({ key: `rate_${m}`, label: l, group: "Rate (₹ / PAX)", groupCls: "h-tot", num: true, get: (r) => { const x = pax(r, m); return x ? rev(r, m) / x : null; }, fmt: (v) => (v === null ? "—" : Math.round(v).toLocaleString("en-IN")) })),
    ...(p.view.twelveM ? monthCols(data, "rev", (r, i) => r.src.revenue?.[meas]?.[i], unit, "") : []),
    ...(p.view.twelveM ? labels.map((l, i) => ({ key: `mp_${i}`, label: l, group: "12M PAX ('000)", groupCls: "h-sub", num: true, get: (r) => (r.src.pax?.[meas]?.[i] || 0) / 1e3, fmt: (v) => Math.round(v).toLocaleString("en-IN") })) : []),
  ];
  return (
    <div className="space-y-2" data-testid="fmt-cute">
      <Err err={err} />
      {data && (
        <ReportTable rows={rows} columns={columns} view={p.view} update={p.update} reset={p.reset} hasMonths name="cute_analysis" testid="cute"
                     labelHeader={`Location · ${periodPrefix(p.period, data.months, p.month) || "FY"}`} defaultOpen
                     toolbar={<>
                       <PeriodPicker period={p.period} month={p.month} months={data.months} onChange={p.update} testid="cute-period" />
                       {p.view.twelveM && <div className="seg" title="12M shows">{[["b_plan", "AOP"], ["af_plan", "Act"], ["a_base", "PY"]].map(([k, l]) => <button key={k} className={meas === k ? "on" : ""} onClick={() => setMeas(k)}>{l}</button>)}</div>}
                     </>} />
      )}
      {data && !data.pax_actual_loaded && <Note>No actual PAX loaded yet — import the reporting package or add “PAX Actual” rows in CUTE drivers.</Note>}
      <Note>CUTE revenue = billable PAX × rate per PAX. Actual rate = actual revenue ÷ actual billed PAX.</Note>
    </div>
  );
}

// ------------------------------------------------------------------ slides 21–22 — opex
export function OpexAnalysis({ unit }) {
  const [data, err] = useMis("/aop/mis/opex");
  const p = usePeriod("aop_rep_opex_v1", data);
  const v = (vals, m) => (vals?.[m] ? agg(vals[m], p.period, p.month) : null);
  const locRows = [...(data?.by_location || []).map((r) => ({ ...r })),
    { id: "total", label: "TOTAL", kind: "grand", values: sumVals(data?.by_location || []) }];
  const locCols = [
    { key: "py", label: `${data?.base_fy || "PY"} actual (FY)`, num: true, get: (r) => r.values?.a_base?.[12], fmt: money(unit) },
    { key: "aop", label: `AOP ${data?.plan_fy || ""} (FY)`, num: true, get: (r) => r.values?.b_plan?.[12], fmt: money(unit) },
    { key: "act", label: `${periodPrefix(p.period, data?.months, p.month) || "FY"} spend`, num: true, get: (r) => v(r.values, "af_plan"), fmt: money(unit) },
    { key: "rem", label: "Remaining budget", num: true, get: (r) => (r.values?.b_plan?.[12] || 0) - (v(r.values, "af_plan") || 0), fmt: money(unit) },
    { key: "util", label: "Utilisation", num: true, get: (r) => ratio(v(r.values, "af_plan"), r.values?.b_plan?.[12]), fmt: pct0 },
  ];
  const catRows = [...(data?.by_category || []), { id: "total", label: "Total (CA)", kind: "grand", values: sumVals(data?.by_category || []) }];
  const catCols = [
    { key: "aop", label: `${periodPrefix(p.period, data?.months, p.month) || "FY"} AOP`, num: true, get: (r) => v(r.values, "b_plan"), fmt: money(unit) },
    { key: "act", label: "Actual", num: true, get: (r) => v(r.values, "af_plan"), fmt: money(unit) },
    { key: "var", label: "Variance", num: true, get: (r) => (v(r.values, "b_plan") || 0) - (v(r.values, "af_plan") || 0), fmt: money(unit) },
    { key: "varp", label: "Variance %", num: true, get: (r) => ratio((v(r.values, "b_plan") || 0) - (v(r.values, "af_plan") || 0), v(r.values, "b_plan")), fmt: pct0 },
  ];
  const cut = data?.months?.cutoff || "";
  const pm = data?.months?.plan_months || [];
  const trendRows = [...(data?.trend || []), { id: "total", label: "CA opex total", kind: "grand", values: sumVals(data?.trend || []) }];
  const cumAct = []; const cumAop = [];
  const tot = trendRows[trendRows.length - 1].values;
  (tot?.af_plan || []).slice(0, 12).reduce((a, x, i) => { cumAct[i] = a + x; return cumAct[i]; }, 0);
  (tot?.b_plan || []).slice(0, 12).reduce((a, x, i) => { cumAop[i] = a + x; return cumAop[i]; }, 0);
  const trendExtra = [
    { id: "cum_act", label: "Cumulative act / fcst", kind: "key", values: { af_plan: [...cumAct, cumAct[11]] }, pinned: true },
    { id: "cum_aop", label: "Cumulative AOP", kind: "key", values: { af_plan: [...cumAop, cumAop[11]] }, pinned: true },
    { id: "vs_aop", label: "Vs AOP (AOP − act/fcst)", kind: "pct", values: { af_plan: cumAop.map((x, i) => x - cumAct[i]).concat([cumAop[11] - cumAct[11]]) }, pinned: true },
  ];
  const trendCols = (data?.months?.labels || []).map((l, i) => ({
    key: `t${i}`, label: l, group: pm[i] <= cut ? "Act" : "Fcst", groupCls: pm[i] <= cut ? "h-cacr" : "h-sol", num: true,
    get: (r) => r.values?.af_plan?.[i], fmt: money(unit),
  })).concat([{ key: "t_tot", label: "Total", group: "FY", groupCls: "h-tot", num: true, get: (r) => r.values?.af_plan?.[12], fmt: money(unit) }]);
  const v2 = useGridView("aop_rep_opex_cat_v1", {});
  const v3 = useGridView("aop_rep_opex_trend_v1", {});
  const chart = catRows.filter((r) => r.kind !== "grand").map((r) => ({ name: r.label, AOP: (v(r.values, "b_plan") || 0) / unitDiv(unit), Actual: (v(r.values, "af_plan") || 0) / unitDiv(unit) }));
  return (
    <div className="space-y-3" data-testid="fmt-opex">
      <Err err={err} />
      {data && (
        <>
          <div className="text-[11px] font-semibold">(1) Last year vs AOP vs current spend — by location</div>
          <ReportTable rows={locRows} columns={locCols} view={p.view} update={p.update} reset={p.reset} name="opex_by_location" testid="opex-loc"
                       labelHeader="Location" height="none"
                       toolbar={<PeriodPicker period={p.period} month={p.month} months={data.months} onChange={p.update} testid="opex-period" />} />
          <div className="grid lg:grid-cols-2 gap-3">
            <div>
              <div className="text-[11px] font-semibold mb-1">(2) Spend by category — CA</div>
              <ReportTable rows={catRows} columns={catCols} view={v2[0]} update={v2[1]} reset={v2[2]} name="opex_by_category" testid="opex-cat" labelHeader="Category" height="none" />
            </div>
            <div className="border border-[var(--border)] p-2">
              <div className="text-[11px] font-semibold mb-1">AOP vs actual by category</div>
              <ResponsiveContainer width="100%" height={210}>
                <BarChart data={chart} layout="vertical" margin={{ top: 0, right: 10, left: 40, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border-soft)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10 }} /><YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={110} />
                  <Tooltip formatter={(x) => Number(x).toFixed(0)} /><Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="AOP" fill={TEAL} /><Bar dataKey="Actual" fill={MAROON} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="text-[11px] font-semibold flex items-center gap-1"><CalendarBlank size={12} />(5) {data.plan_fy} opex act + fcst trend — CA only</div>
          <ReportTable rows={[...trendRows, ...trendExtra]} columns={trendCols} view={v3[0]} update={v3[1]} reset={v3[2]} name="opex_trend" testid="opex-trend" labelHeader="Location" height="none" />
          <Note>{data.category_note} Forecast months use the opex lines' forecast / budget until the tracker forecast is posted.</Note>
        </>
      )}
    </div>
  );
}

function sumVals(rows) {
  const out = {};
  rows.forEach((r) => Object.entries(r.values || {}).forEach(([m, v]) => {
    out[m] = out[m] || new Array(13).fill(0);
    (v || []).forEach((x, i) => { out[m][i] += x || 0; });
  }));
  return out;
}

// ------------------------------------------------------------------ slides 23–24 — resources
export function Resources({ unit, params }) {
  const [data, err] = useMis("/aop/mis/resources");
  const p = usePeriod("aop_rep_resources_v1", data);
  const [section, setSection] = useState(params?.section || "all");
  const src = (data?.rows || []).filter((r) => section === "all" || r.section === section || (section === "indirect" && r.section === "capex"));
  const rows = [];
  const groups = {};
  src.forEach((r) => {
    const gid = `g:${r.group}`;
    if (!groups[gid]) { groups[gid] = { id: gid, label: r.group, kind: "sub", kids: [] }; rows.push(groups[gid]); }
    const id = `${gid}:${r.label}`;
    groups[gid].kids.push(r);
    rows.push({ ...r, id, parent: gid, masked: false, costMasked: !!r.masked });
  });
  const sumKids = (g, f) => g.kids.reduce((a, k) => a + (f(k) || 0), 0);
  const masked = (data?.rows || []).some((r) => r.masked);
  const cost = (r, m) => (r.cost?.[m] ? agg(r.cost[m], p.period, p.month) : 0);
  const mfmt = (v) => (masked ? "•••" : money(unit)(v));
  const fte = (r) => (r.fte?.af_plan ? r.fte.af_plan[p.month] || 0 : null);
  const get = (f) => (r) => (r.kids ? sumKids(r, f) : f(r));
  const columns = [
    { key: "hc_act", label: `FTE (${data?.months?.labels?.[p.month] || ""})`, group: "Headcount", groupCls: "h-cacr", num: true, get: get(fte), fmt: (v) => (v === null || v === undefined ? "—" : Number(v).toFixed(0)) },
    { key: "c_aop", label: "AOP", group: `Cost · ${periodPrefix(p.period, data?.months, p.month) || "FY"}`, groupCls: "h-sol", num: true, get: get((r) => cost(r, "b_plan")), fmt: mfmt },
    { key: "c_act", label: "Act", group: `Cost · ${periodPrefix(p.period, data?.months, p.month) || "FY"}`, groupCls: "h-sol", num: true, get: get((r) => cost(r, "af_plan")), fmt: mfmt },
    { key: "c_var", label: "Bud vs act", group: `Cost · ${periodPrefix(p.period, data?.months, p.month) || "FY"}`, groupCls: "h-sol", num: true, get: get((r) => (cost(r, "b_plan") || 0) - (cost(r, "af_plan") || 0)), fmt: mfmt },
    { key: "c_fy", label: `AOP ${data?.plan_fy || ""}`, group: "FY", groupCls: "h-tot", num: true, get: get((r) => r.cost?.b_plan?.[12]), fmt: mfmt },
    ...(p.view.twelveM ? monthCols(data, "res", (r, i) => (r.kids ? sumKids(r, (k) => k.cost?.af_plan?.[i]) : r.cost?.af_plan?.[i]), unit).map((c) => ({ ...c, fmt: mfmt })) : []),
  ];
  return (
    <div className="space-y-2" data-testid="fmt-resources">
      <Err err={err} />
      {data && (
        <ReportTable rows={rows} columns={columns} view={p.view} update={p.update} reset={p.reset} hasMonths name="resources" testid="res" labelHeader="Particulars"
                     toolbar={<>
                       <div className="seg">{[["all", "All"], ["direct", "Direct"], ["indirect", "Indirect"]].map(([k, l]) => <button key={k} className={section === k ? "on" : ""} onClick={() => setSection(k)} data-testid={`res-${k}`}>{l}</button>)}</div>
                       <PeriodPicker period={p.period} month={p.month} months={data.months} onChange={p.update} testid="res-period" />
                     </>} />
      )}
      {data && !data.has_actuals && <Note>No resource-cost actuals loaded — import the monthly resource cost file (Admin → Imports).</Note>}
      {data && <Note>{data.note}</Note>}
      {masked && <Note>Resource cost is confidential for your role (payroll access) — headcount is shown, cost is masked.</Note>}
    </div>
  );
}

// ------------------------------------------------------------------ slides 25–26 — overheads
export function OverheadsSummary({ unit, onDrill }) {
  const [data, err] = useMis("/aop/mis/overheads");
  const p = usePeriod("aop_rep_oh_summary_v1", data);
  const v = (r, s, m) => (r.values?.[s]?.[m] ? agg(r.values[s][m], p.period, p.month) : 0);
  const rows = [...(data?.rows || []).map((r) => ({ ...r, drill: "overheads_nature" })),
    { id: "__total", label: "TOTAL", kind: "grand", values: Object.fromEntries(["CA+CR", "Solutions", "Total"].map((s) => [s, sumVals((data?.rows || []).map((r) => ({ values: r.values[s] })))])) }];
  const cls = { "CA+CR": "h-cacr", Solutions: "h-sol", Total: "h-tot" };
  const pref = periodPrefix(p.period, data?.months, p.month) || "FY";
  const columns = ["CA+CR", "Solutions", "Total"].flatMap((s) => [
    { key: `${s}_aop`, label: `${pref} AOP`, group: s, groupCls: cls[s], num: true, get: (r) => v(r, s, "b_plan"), fmt: money(unit) },
    { key: `${s}_act`, label: `${pref} Act`, group: s, groupCls: cls[s], num: true, get: (r) => v(r, s, "af_plan"), fmt: money(unit) },
    { key: `${s}_var`, label: s === "Total" ? "Var %" : "Var", group: s, groupCls: cls[s], num: true,
      get: (r) => (s === "Total" ? ratio(v(r, s, "b_plan") - v(r, s, "af_plan"), v(r, s, "b_plan")) : v(r, s, "b_plan") - v(r, s, "af_plan")),
      fmt: s === "Total" ? pct0 : money(unit) },
  ]).concat(p.view.twelveM ? monthCols(data, "oh", (r, i) => r.values?.Total?.af_plan?.[i], unit) : []);
  const chart = (data?.rows || []).slice(0, 12).map((r) => ({ name: r.label, "YTD AOP": v(r, "Total", "b_plan") / unitDiv(unit), "YTD Act": v(r, "Total", "af_plan") / unitDiv(unit) }));
  return (
    <div className="space-y-2" data-testid="fmt-oh-summary">
      <Err err={err} />
      {data && (
        <ReportTable rows={rows} columns={columns} view={p.view} update={p.update} reset={p.reset} hasMonths name="overheads_sga" testid="ohs" labelHeader="Department"
                     onRowDrill={(r) => r.drill && onDrill?.("overheads_nature", { dept: r.id }, r.label)}
                     toolbar={<PeriodPicker period={p.period} month={p.month} months={data.months} onChange={p.update} testid="ohs-period" />} />
      )}
      {data && (
        <div className="border border-[var(--border)] p-2">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chart} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid stroke="var(--border-soft)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 9 }} interval={0} /><YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(x) => Number(x).toFixed(0)} /><Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="YTD AOP" fill={TEAL} /><Bar dataKey="YTD Act" fill={MAROON} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <Note>Double-click a department for its nature-wise view, then a nature for the AOP lines and actual bookings.</Note>
    </div>
  );
}

function DeptPicker({ value, onChange, withNature, nature, onNature }) {
  const [opts, setOpts] = useState(null);
  useEffect(() => { api.get("/aop/mis/overheads/departments").then((r) => setOpts(r.data)).catch(() => setOpts({ departments: [], natures: {} })); }, []);
  if (!opts) return null;
  return (
    <>
      <select className="input-sm" value={value || ""} onChange={(e) => onChange(e.target.value)} data-testid="oh-dept">
        <option value="">Department…</option>
        {opts.departments.map((d) => <option key={d}>{d}</option>)}
      </select>
      {withNature && (
        <select className="input-sm" value={nature || ""} onChange={(e) => onNature(e.target.value || null)} data-testid="oh-nature">
          <option value="">All natures</option>
          {(opts.natures[value] || []).map((d) => <option key={d}>{d}</option>)}
        </select>
      )}
    </>
  );
}

export function OverheadsNature({ unit, params, onDrill }) {
  const [dept, setDept] = useState(params?.dept || "");
  const [data, err] = useMis(dept ? "/aop/mis/overheads/nature" : null, { dept });
  const p = usePeriod("aop_rep_oh_nature_v1", data);
  useEffect(() => { if (params?.dept) setDept(params.dept); }, [params?.dept]);
  const pref = periodPrefix(p.period, data?.months, p.month) || "FY";
  const v = (r, m) => (r.values?.[m] ? agg(r.values[m], p.period, p.month) : 0);
  const rows = [...(data?.rows || []).map((r) => ({ ...r, drill: "overheads_lines" })),
    { id: "__total", label: "Total", kind: "grand", values: sumVals(data?.rows || []) }];
  const columns = [
    { key: "fy", label: `AOP ${data?.plan_fy || ""}`, num: true, get: (r) => r.values?.b_plan?.[12], fmt: money(unit) },
    { key: "aop", label: `${pref} AOP`, num: true, get: (r) => v(r, "b_plan"), fmt: money(unit) },
    { key: "act", label: `${pref} Act`, num: true, get: (r) => v(r, "af_plan"), fmt: money(unit) },
    { key: "var", label: "Var", num: true, get: (r) => v(r, "b_plan") - v(r, "af_plan"), fmt: money(unit) },
    ...(p.view.twelveM ? monthCols(data, "ohn", (r, i) => r.values?.af_plan?.[i], unit) : []),
  ];
  return (
    <div className="space-y-2" data-testid="fmt-oh-nature">
      <Err err={dept ? err : ""} />
      <ReportTable rows={dept ? rows : []} columns={columns} view={p.view} update={p.update} reset={p.reset} hasMonths name={`overheads_${dept}`} testid="ohn"
                   labelHeader={dept || "Nature"}
                   onRowDrill={(r) => r.drill && onDrill?.("overheads_lines", { dept, nature: r.id }, r.label)}
                   toolbar={<>
                     <DeptPicker value={dept} onChange={setDept} />
                     {data && <PeriodPicker period={p.period} month={p.month} months={data.months} onChange={p.update} testid="ohn-period" />}
                   </>} />
      {!dept && <Note>Pick a department.</Note>}
    </div>
  );
}

export function OverheadsLines({ unit, params }) {
  const [dept, setDept] = useState(params?.dept || "");
  const [nature, setNature] = useState(params?.nature || null);
  const [data, err] = useMis(dept ? "/aop/mis/overheads/lines" : null, { dept, nature: nature || undefined });
  const p = usePeriod("aop_rep_oh_lines_v1", data);
  const pv = useGridView("aop_rep_oh_book_v1", {});
  const upto = p.period === "fy" ? 11 : p.month;
  const from = p.period === "mtd" ? p.month : 0;
  const aopRows = (data?.aop_lines || []).map((l, i) => ({ id: `a${i}`, label: l.description || l.aop_head, src: l }));
  const aopCols = [
    { key: "head", label: "AOP head", get: (r) => r.src.aop_head, fmt: (v) => v },
    { key: "nature", label: "Nature", get: (r) => r.src.nature, fmt: (v) => v },
    { key: "seg", label: "Segment", get: (r) => r.src.segment, fmt: (v) => v },
    { key: "fy", label: "AOP FY", num: true, get: (r) => r.src.monthly.reduce((a, b) => a + b, 0), fmt: money(unit) },
    { key: "ytd", label: `${periodPrefix(p.period, data?.months, p.month) || "FY"} AOP`, num: true, get: (r) => r.src.monthly.slice(from, upto + 1).reduce((a, b) => a + b, 0), fmt: money(unit) },
    ...(p.view.twelveM ? (data?.months?.labels || []).map((l, i) => ({ key: `am${i}`, label: l, group: "12M", groupCls: "h-sub", num: true, get: (r) => r.src.monthly[i], fmt: money(unit) })) : []),
  ];
  const pm = data?.months?.plan_months || [];
  const inRange = (per) => { const i = pm.indexOf(per); return i >= from && i <= upto; };
  const book = (data?.bookings || []).filter((b) => inRange(b.period)).map((b, i) => ({ id: `b${i}`, label: b.vendor || b.gl_text || "—", src: b }));
  const bookCols = [
    { key: "date", label: "Date", get: (r) => r.src.date, fmt: (v) => v },
    { key: "voucher", label: "Voucher", get: (r) => r.src.voucher, fmt: (v) => v },
    { key: "nature", label: "Nature", get: (r) => r.src.nature, fmt: (v) => v },
    { key: "detail", label: "Detail", get: (r) => r.src.detail, fmt: (v) => v },
    { key: "gl", label: "GL", get: (r) => r.src.gl_text || r.src.gl, fmt: (v) => v },
    { key: "cc", label: "Cost centre", get: (r) => r.src.cost_centre, fmt: (v) => v },
    { key: "seg", label: "Segment", get: (r) => r.src.segment, fmt: (v) => v },
    { key: "text", label: "Narration", get: (r) => r.src.narration, fmt: (v) => <span className="whitespace-normal max-w-[320px] inline-block">{v}</span> },
    { key: "amt", label: "Amount", num: true, get: (r) => r.src.amount, fmt: money(unit) },
  ];
  const tot = (rs, f) => rs.reduce((a, r) => a + (f(r) || 0), 0);
  return (
    <div className="space-y-3" data-testid="fmt-oh-lines">
      <Err err={dept ? err : ""} />
      <div className="flex items-center gap-1.5 flex-wrap">
        <DeptPicker value={dept} onChange={(d) => { setDept(d); setNature(null); }} withNature nature={nature} onNature={setNature} />
        {data && <PeriodPicker period={p.period} month={p.month} months={data.months} onChange={p.update} testid="ohl-period" />}
        {data && (
          <span className="text-[11px] ml-2">
            AOP <b>{money(unit)(tot(aopRows, (r) => r.src.monthly.slice(from, upto + 1).reduce((a, b) => a + b, 0)))}</b> · Actual <b>{money(unit)(tot(book, (r) => r.src.amount))}</b>
          </span>
        )}
      </div>
      {dept && data && (
        <>
          <div className="text-[11px] font-semibold">AOP lines ({aopRows.length})</div>
          <ReportTable rows={aopRows} columns={aopCols} view={p.view} update={p.update} reset={p.reset} hasMonths name="overhead_aop_lines" testid="ohl-aop" labelHeader="Description" height="360px" />
          <div className="text-[11px] font-semibold">Actual bookings ({book.length})</div>
          <ReportTable rows={book} columns={bookCols} view={pv[0]} update={pv[1]} reset={pv[2]} name="overhead_bookings" testid="ohl-book" labelHeader="Vendor" height="460px" />
        </>
      )}
      {!dept && <Note>Pick a department (and optionally a nature) to see its AOP lines and every actual booking.</Note>}
    </div>
  );
}

// ------------------------------------------------------------------ slide 12 — project health
export function ProjectHealth({ unit }) {
  const [data, err] = useMis("/aop/mis/project-health");
  const p = usePeriod("aop_rep_projects_v1", data);
  const [top, setTop] = useState(15);
  const g = (r, part, m) => (r[part]?.[m] ? agg(r[part][m], p.period, p.month) : 0);
  const src = [...(data?.rows || [])].sort((a, b) => g(b, "rev", "af_plan") - g(a, "rev", "af_plan"));
  const head = top ? src.slice(0, top) : src;
  const rest = top ? src.slice(top) : [];
  const merge = (rs, id, label) => ({ id, label, kind: "sub", rev: sumVals(rs.map((r) => ({ values: r.rev }))), cost: sumVals(rs.map((r) => ({ values: r.cost }))) });
  const rows = [...head.map((r) => ({ ...r })),
    ...(rest.length ? [merge(rest, "__others", `Others (${rest.length})`), ...rest.map((r) => ({ ...r, parent: "__others" }))] : []),
    { ...merge(src, "__total", "Grand Total"), kind: "grand" }];
  const pref = periodPrefix(p.period, data?.months, p.month) || "FY";
  const gm = (r, m) => ratio(g(r, "rev", m) - g(r, "cost", m), g(r, "rev", m));
  const col = (key, label, group, cls, get, fmt, extra = {}) => ({ key, label, group, groupCls: cls, num: true, get, fmt, ...extra });
  const columns = [
    col("tcv", "TCV", "Deal", "h-head", (r) => r.tcv, money(unit)),
    col("dm", "Margin*", "Deal", "h-head", (r) => r.deal_margin, pct0),
    col("r_aop", "AOP", `Rev (${pref})`, "h-cacr", (r) => g(r, "rev", "b_plan"), money(unit)),
    col("r_act", "Act", `Rev (${pref})`, "h-cacr", (r) => g(r, "rev", "af_plan"), money(unit)),
    col("r_var", "Var", `Rev (${pref})`, "h-cacr", (r) => g(r, "rev", "af_plan") - g(r, "rev", "b_plan"), money(unit)),
    col("c_aop", "AOP", `Cost (${pref})`, "h-sol", (r) => g(r, "cost", "b_plan"), money(unit)),
    col("c_act", "Act", `Cost (${pref})`, "h-sol", (r) => g(r, "cost", "af_plan"), money(unit)),
    col("c_var", "Var", `Cost (${pref})`, "h-sol", (r) => g(r, "cost", "b_plan") - g(r, "cost", "af_plan"), money(unit)),
    col("g_aop", "AOP", "Gross margin", "h-tot", (r) => gm(r, "b_plan"), pct0),
    col("g_act", "Act", "Gross margin", "h-tot", (r) => gm(r, "af_plan"), pct0),
    col("g_var", "Var", "Gross margin", "h-tot", (r) => { const a = gm(r, "b_plan"); const b = gm(r, "af_plan"); return a === null || b === null || !a || !b ? null : b - a; }, pct0,
        { cellCls: (r, v) => (v === null ? "" : v < 0 ? "!text-[var(--danger)] font-semibold" : v > 0 ? "!text-[var(--success)] font-semibold" : "") }),
    ...(p.view.twelveM ? monthCols(data, "prj", (r, i) => r.rev?.af_plan?.[i], unit, " rev") : []),
  ];
  return (
    <div className="space-y-2" data-testid="fmt-projects">
      <Err err={err} />
      {data && (
        <ReportTable rows={rows} columns={columns} view={p.view} update={p.update} reset={p.reset} hasMonths name="project_health" testid="prj" labelHeader="Project (Solutions)"
                     toolbar={<>
                       <PeriodPicker period={p.period} month={p.month} months={data.months} onChange={p.update} testid="prj-period" />
                       <label className="text-[11px] flex items-center gap-1">Top
                         <select className="input-sm" value={top} onChange={(e) => setTop(Number(e.target.value))}>{[10, 15, 20, 30, 0].map((n) => <option key={n} value={n}>{n || "All"}</option>)}</select>
                       </label>
                     </>} />
      )}
      {data && <Note>{data.note} *Deal margin = budgeted GM % on the project master. {data.unmatched?.rev ? ` Bookings not matched to a project: revenue ${money(unit)(data.unmatched.rev)}.` : ""}</Note>}
    </div>
  );
}

// ------------------------------------------------------------------ slide 13 — capex tracker
export function CapexTracker({ unit }) {
  const [data, err] = useMis("/aop/mis/capex-tracker");
  const p = usePeriod("aop_rep_capex_v1", data);
  const upto = p.period === "fy" ? 11 : p.month;
  const from = p.period === "mtd" ? p.month : 0;
  const act = (r) => (r.actual ? r.actual.slice(from, upto + 1).reduce((a, b) => a + (b || 0), 0) : null);
  const rows = [];
  (data?.rows || []).forEach((l, i) => {
    const lid = `L${i}`;
    rows.push({ ...l, id: lid, kind: "sub" });
    (l.children || []).forEach((c, j) => {
      const cid = `${lid}C${j}`;
      rows.push({ ...c, id: cid, parent: lid });
      (c.lines || []).forEach((x, k) => rows.push({ id: `${cid}X${k}`, parent: cid, label: x.label, budget: x.budget, lineItem: true }));
    });
    if (!(l.children || []).length) (l.lines || []).forEach((x, k) => rows.push({ id: `${lid}X${k}`, parent: lid, label: x.label, budget: x.budget, lineItem: true }));
  });
  const all = data?.rows || [];
  const S = (k) => all.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  rows.push({ id: "__total", label: "Grand Total", kind: "grand", initial_budget: S("initial_budget"), capex_till_base: S("capex_till_base"), budget: S("budget"),
              open_po: S("open_po"), open_pr: S("open_pr"), actual: new Array(12).fill(0).map((_, i) => all.reduce((a, r) => a + (r.actual?.[i] || 0), 0)) });
  const commit = (r) => (r.lineItem ? null : (act(r) || 0) + (r.open_po || 0) + (r.open_pr || 0));
  const pref = periodPrefix(p.period, data?.months, p.month) || "FY";
  const C = (key, label, get, fmt = money(unit), extra = {}) => ({ key, label, num: true, get, fmt, ...extra });
  const columns = [
    C("init", "Initial budget", (r) => r.initial_budget || null),
    C("till", `Capex till ${data?.base_fy || "PY"}`, (r) => r.capex_till_base || null),
    C("bud", `Bud ${data?.plan_fy || ""}`, (r) => r.budget),
    C("act", `${pref} actual`, (r) => act(r)),
    C("po", "Open PO commitment", (r) => (r.lineItem ? null : r.open_po)),
    C("pr", "PR commitment", (r) => (r.lineItem ? null : r.open_pr)),
    C("tot", "Total commitment", commit),
    C("var", "Variance", (r) => (r.lineItem ? null : (commit(r) || 0) - (r.budget || 0))),
    C("util", "% utilised", (r) => (r.lineItem ? null : ratio(commit(r), r.budget)), pct0),
    ...(p.view.twelveM ? (data?.months?.labels || []).map((l, i) => C(`m${i}`, l, (r) => r.actual?.[i] ?? null, money(unit), { group: "12M actual", groupCls: "h-sub" })) : []),
  ];
  return (
    <div className="space-y-2" data-testid="fmt-capex">
      <Err err={err} />
      {data && (
        <ReportTable rows={rows} columns={columns} view={p.view} update={p.update} reset={p.reset} hasMonths name="capex_tracker" testid="cap" labelHeader="Location / category"
                     toolbar={<PeriodPicker period={p.period} month={p.month} months={data.months} onChange={p.update} testid="cap-period" />} />
      )}
      <Note>Click a location to open its categories and a category for the AOP capex lines. Tracker figures (initial budget, monthly actuals, open PO / PR) come from the capex tracker dataset; locations without it use the capex lines and the year's capex postings.</Note>
    </div>
  );
}
