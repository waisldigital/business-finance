import React, { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { GearSix, DownloadSimple, ArrowClockwise, LockSimple } from "@phosphor-icons/react";
import { fmtAmount, fmtPct, unitDiv, unitLabel } from "./format";
import { agg, periodPrefix, useTree, csvDownload, usePref } from "./mis";
import { TreeLabel, ExpandButtons, PeriodPicker, Popover, Check, useFilters, FilterBar, MisModal } from "./MisCommon";
import RevenuePerformance from "./RevenuePerformance";
import { SharedDefault } from "./GridSettings";
import { useAuth } from "@/lib/auth";

const SEG_CLASS = { cacr: "cacr", sol: "sol", total: "tot" };
const DEFAULTS = { measures: ["af_plan", "b_draft"], segments: ["cacr", "sol", "total"], variance: true, period: "fy", month: null };

/**
 * Full P&L — CA+CR · Solutions · Total (MIS slides 5a / 5c). Year columns from the gear menu; FY / YTD / MTD
 * toggle replaces the separate MTD slide. Parent lines collapse with "+"; double-click Revenue for the
 * revenue performance drill-down.
 */
// Full P&L row → drill-down format
const DRILL = {
  rev: ["revenue_performance"], rev_cute: ["cute_analysis"], rev_noncute: ["revenue_performance"], rev_cr: ["revenue_performance"],
  rev_projects: ["project_health"], gm: ["airport_gm"], total_direct: ["airport_gm"], opex_tp: ["opex_analysis"], opex_ca: ["opex_analysis"],
  opex_shared: ["opex_analysis"], opex_cr: ["opex_analysis"], opex_pj: ["project_health"], emp_direct: ["resources", { section: "direct" }],
  emp_indirect: ["resources", { section: "indirect" }], sga: ["overheads_summary"], total_indirect: ["overheads_summary"],
};
const drillOf = (r) => DRILL[r.id] || (r.parent === "emp_direct" ? ["resources", { section: "direct" }]
  : r.parent === "emp_indirect" ? ["resources", { section: "indirect" }] : r.parent === "sga" ? ["overheads_summary"] : null);

export default function FullPnL({ unit, onDrill }) {
  const f = useFilters();
  const [pref, setPref, resetPref, sharedPref] = usePref("aop_mis_full_pnl_v1", DEFAULTS);
  const { user } = useAuth() || {};
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [drill, setDrill] = useState(false);

  const load = async () => {
    setLoading(true); setErr("");
    try {
      const { data } = await api.get("/aop/mis/full-pnl", { params: { geo: f.geo, tag: f.tag } });
      setData(data);
    } catch (e) { setErr(e.response?.data?.detail || e.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [f.geo, f.tag]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => data?.rows || [], [data]);
  const tree = useTree(rows, { defaultOpen: false });
  const month = pref.month ?? data?.months?.default_month ?? 0;
  const measures = (data?.measures || []).filter((m) => m.available && pref.measures.includes(m.key));
  const segments = (data?.segments || []).filter((s) => pref.segments.includes(s.key));
  const withVar = pref.variance && measures.length >= 2;
  const prefix = periodPrefix(pref.period, data?.months, month);
  const byId = useMemo(() => Object.fromEntries(rows.map((r) => [r.id, r])), [rows]);

  const val = (r, m, s) => {
    if (r.kind === "pct") {
      const [n, d] = r.ratio;
      const num = val(byId[n], m, s); const den = val(byId[d], m, s);
      return num === null || den === null || !den ? null : num / den;
    }
    if (!r.values) return null;
    return agg(r.values[m]?.[s], pref.period, month);
  };
  const variance = (r, s) => {
    const a = val(r, measures[0].key, s); const b = val(r, measures[measures.length - 1].key, s);
    if (a === null || b === null) return null;
    return r.kind === "pct" ? b - a : (b - a) * (r.sign || 1);
  };
  const show = (r, v, isVar) => {
    if (r.masked) return "•••";
    if (v === null || v === undefined) return "";
    return r.kind === "pct" ? (isVar ? `${(v * 100).toFixed(1)} pp` : fmtPct(v)) : fmtAmount(v, unit);
  };
  const varLabel = measures.length >= 2 ? `${measures[measures.length - 1].label} vs ${measures[0].label}` : "";

  const exportCsv = () => {
    const head = ["Particulars", ...segments.flatMap((s) => [...measures.map((m) => `${s.label} ${prefix} ${m.label}`.replace(/\s+/g, " ")),
                                                            ...(withVar ? [`${s.label} Var`] : [])])];
    const div = unitDiv(unit);
    const out = rows.map((r) => [r.label, ...segments.flatMap((s) => {
      const cells = measures.map((m) => { const v = val(r, m.key, s.key); return r.masked ? "restricted" : r.kind === "pct" ? v : (v ?? 0) / div; });
      if (withVar) { const v = variance(r, s.key); cells.push(r.masked ? "restricted" : r.kind === "pct" ? v : (v ?? 0) / div); }
      return cells;
    })]);
    csvDownload([head, ...out], `Full_PnL_${pref.period}.csv`);
  };

  const cols = segments.length * (measures.length + (withVar ? 1 : 0));
  return (
    <div className="space-y-2" data-testid="fmt-full-pnl">
      <div className="flex items-center gap-1.5 flex-wrap">
        <FilterBar f={f} />
        <span className="w-2" />
        <PeriodPicker period={pref.period} month={month} months={data?.months} onChange={(p) => setPref(p)} testid="full-period" />
        <div className="flex-1" />
        <ExpandButtons tree={tree} />
        <Popover icon={<GearSix size={14} />} label={<span className="text-[10.5px] tabular-nums">{measures.length}</span>} testid="full-columns">
          <div className="px-3 py-1.5 border-b border-[var(--border)] text-[10px] tracking-overline text-[var(--muted)] flex items-center">
            <span className="flex-1">Year columns</span>
            <button className="text-[10px] underline" onClick={resetPref}>Reset</button>
          </div>
          {(data?.measures || []).map((m) => (
            <Check key={m.key} checked={pref.measures.includes(m.key) && m.available} disabled={!m.available} note={m.note} testid={`full-m-${m.key}`}
                   onChange={(on) => setPref((p) => ({ measures: on ? [...p.measures, m.key] : p.measures.filter((x) => x !== m.key) }))}>
              {m.label}{!m.available && <span className="ml-1 text-[9.5px] font-normal">· from {m.fy}</span>}
            </Check>
          ))}
          <div className="px-3 py-1.5 border-y border-[var(--border)] text-[10px] tracking-overline text-[var(--muted)]">Segments</div>
          {(data?.segments || []).map((s) => (
            <Check key={s.key} checked={pref.segments.includes(s.key)} testid={`full-s-${s.key}`}
                   onChange={(on) => setPref((p) => ({ segments: on ? [...p.segments, s.key] : p.segments.filter((x) => x !== s.key) }))}>{s.label}</Check>
          ))}
          <div className="border-t border-[var(--border)]">
            <Check checked={pref.variance} onChange={(on) => setPref({ variance: on })} testid="full-var">Variance (last vs first year)</Check>
          </div>
          {user?.role === "admin" && <div className="border-t border-[var(--border)]"><SharedDefault shared={sharedPref} testid="full" /></div>}
        </Popover>
        <button className="icon-btn" onClick={exportCsv} title="Export view (csv)"><DownloadSimple size={13} /></button>
        <button className="icon-btn" onClick={load} title="Refresh"><ArrowClockwise size={13} className={loading ? "animate-spin" : ""} /></button>
      </div>
      {err && <div className="text-xs text-[var(--danger)]">{String(err)}</div>}
      {data && (
        <div className="flex items-center gap-3 text-[10.5px] text-[var(--muted)] flex-wrap">
          {!data.meta?.payroll_visible && <span className="flex items-center gap-1"><LockSimple size={11} /> Employee cost lines are confidential for your role; totals include them.</span>}
          <span className="ml-auto">Actuals to {data.months?.cutoff}</span>
        </div>
      )}
      {data && (
        <div className="overflow-auto border border-[var(--border)]" style={{ maxHeight: "calc(100vh - 230px)" }}>
          <table className="mis-table w-max min-w-full" data-testid="full-pnl-table">
            <thead>
              <tr>
                <th className="lbl h-head" rowSpan={2}>Particulars ({unitLabel(unit)})</th>
                {segments.map((s) => <th key={s.key} className={`h-${SEG_CLASS[s.key]}`} colSpan={measures.length + (withVar ? 1 : 0)}>{s.label}</th>)}
              </tr>
              <tr>
                {segments.map((s) => (
                  <React.Fragment key={s.key}>
                    {measures.map((m) => <th key={m.key} className={`h-${SEG_CLASS[s.key]} !text-right`}>{prefix} {m.label}</th>)}
                    {withVar && <th className={`h-${SEG_CLASS[s.key]} !text-right`} title={`${varLabel} · favourable (+) / adverse (−)`}>Var</th>}
                  </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.filter(tree.visible).map((r) => {
                const dr = onDrill ? drillOf(r) : (r.id === "rev" || r.parent === "rev" ? ["modal"] : null);
                const isRev = !!dr;
                const d = tree.depth(r.id);
                return (
                  <tr key={r.id} className={`${r.key ? "key" : r.kind === "subtotal" ? "sub" : ""} ${d ? "child" : ""} ${r.kind === "pct" ? "pct" : ""} ${isRev ? "dbl" : ""}`}
                      onDoubleClick={isRev ? () => (onDrill ? onDrill(dr[0], dr[1] || {}, r.label) : setDrill(true)) : undefined} data-testid={`full-row-${r.id}`}>
                    <td className="lbl"><TreeLabel row={r} tree={tree} depth={d} title={isRev ? "Double-click to drill down" : undefined} /></td>
                    {cols === 0 && <td />}
                    {segments.map((s) => (
                      <React.Fragment key={s.key}>
                        {measures.map((m, i) => {
                          const v = val(r, m.key, s.key);
                          return <td key={m.key} className={`num ${i === 0 ? "gl" : ""} ${typeof v === "number" && v < 0 && r.kind !== "pct" ? "neg" : ""}`}>{show(r, v)}</td>;
                        })}
                        {withVar && (() => {
                          const v = variance(r, s.key);
                          return <td className={`num v-${SEG_CLASS[s.key]} ${typeof v === "number" && v < 0 ? "neg" : ""}`}>{show(r, v, true)}</td>;
                        })()}
                      </React.Fragment>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {drill && (
        <MisModal title="Revenue performance — Actuals vs AOP" onClose={() => setDrill(false)} testid="revenue-drill">
          <RevenuePerformance unit={unit} geo={f.geo} tag={f.tag} initialMonth={month} embedded />
        </MisModal>
      )}
    </div>
  );
}
