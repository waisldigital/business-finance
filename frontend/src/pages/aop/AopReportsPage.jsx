import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { useCurrency } from "@/lib/currency";
import Header from "@/aop/Header";
import { PresentationChart, Stack, CaretUp, CaretDown, X, EyeSlash, ArrowLeft, Database } from "@phosphor-icons/react";
import { Popover } from "@/aop/MisCommon";
import DatasetWorkspace from "@/aop/DatasetWorkspace";
import { AirportGM, CuteAnalysis, OpexAnalysis, Resources, OverheadsSummary, OverheadsNature, OverheadsLines, ProjectHealth, CapexTracker } from "@/aop/MisDrillReports";
import { usePref } from "@/aop/mis";
import { saveSharedView, clearSharedView, useSharedView } from "@/aop/gridView";
import FullPnL from "@/aop/FullPnL";
import PnLView from "@/aop/PnLView";
import RevenuePerformance from "@/aop/RevenuePerformance";
import RegionalPnL from "@/aop/RegionalPnL";
import { Margin, Opex, Overheads, Wbs } from "@/aop/LegacyReports";

const BODIES = {
  full_pnl: FullPnL, detailed_pnl: PnLView, revenue_performance: RevenuePerformance, regional_pnl: RegionalPnL,
  margin_profile: Margin, opex_forecast: Opex, overheads: Overheads, wbs: Wbs,
  airport_gm: AirportGM, cute_analysis: CuteAnalysis, opex_analysis: OpexAnalysis, resources: Resources,
  overheads_summary: OverheadsSummary, overheads_nature: OverheadsNature, overheads_lines: OverheadsLines,
  project_health: ProjectHealth, capex_tracker: CapexTracker,
};

// Data behind each format — opened from the card to upload / download it and to key in the FY'28 AOP
const SOURCES = {
  full_pnl: ["rev_cute", "rev_noncute", "rev_projects", "opex_lines", "payroll_lines", "overhead_plan", "pl_other"],
  detailed_pnl: ["rev_cute", "rev_noncute", "rev_projects", "opex_lines", "payroll_lines", "overhead_plan", "pl_other"],
  revenue_performance: ["rev_cute", "rev_cute_drivers", "rev_noncute", "rev_projects"],
  regional_pnl: ["rev_projects", "project_master", "payroll_lines", "overhead_plan"],
  airport_gm: ["rev_cute", "rev_noncute", "rev_projects", "opex_lines", "payroll_lines"],
  cute_analysis: ["rev_cute", "rev_cute_drivers"],
  opex_analysis: ["opex_lines", "opex_tracker", "po_register"],
  resources: ["payroll_lines"],
  overheads_summary: ["overhead_plan", "overhead_lines", "cc_gl_map"],
  overheads_nature: ["overhead_plan", "overhead_lines"],
  overheads_lines: ["overhead_plan", "overhead_lines"],
  project_health: ["rev_projects", "project_master"],
  capex_tracker: ["capex_lines", "capex_tracker", "capex_history"],
  margin_profile: ["rev_cute", "rev_noncute", "opex_lines", "payroll_lines"],
  opex_forecast: ["opex_tracker", "po_register"],
  overheads: ["overhead_plan", "overhead_lines"],
  wbs: ["opex_lines", "overhead_lines"],
};

/**
 * AOP reports: pick one or more report formats from the dropdown; each selected format renders as its own page,
 * stacked in the order chosen. The admin decides which formats users can see (Plan settings → Report formats).
 */
export default function AopReportsPage({ admin = false }) {
  const { unit } = useCurrency();
  const [catalog, setCatalog] = useState(null);
  const [datasets, setDatasets] = useState([]);
  const [err, setErr] = useState("");
  const [pref, setPref] = usePref(admin ? "aop_reports_admin_v1" : "aop_reports_v1", { selected: ["full_pnl"] });
  const usersDefault = useSharedView("aop_reports_v1");
  const [defMsg, setDefMsg] = useState("");
  useEffect(() => {
    api.get("/aop/mis/formats").then((r) => setCatalog(r.data.formats)).catch((e) => setErr(e.response?.data?.detail || e.message));
    api.get("/aop/datasets").then((r) => setDatasets(r.data)).catch(() => {});
  }, []);

  const byKey = Object.fromEntries((catalog || []).map((f) => [f.key, f]));
  const selected = pref.selected.filter((k) => byKey[k]);
  const toggle = (k, on) => setPref((p) => ({ selected: on ? [...p.selected.filter((x) => x !== k), k] : p.selected.filter((x) => x !== k) }));
  const move = (k, d) => setPref((p) => {
    const a = p.selected.filter((x) => byKey[x]); const i = a.indexOf(k); const j = i + d;
    if (j < 0 || j >= a.length) return {};
    [a[i], a[j]] = [a[j], a[i]];
    return { selected: a };
  });
  const groups = [["aop_pnl", "P&L formats"], ["aop_reports", "Analysis"]];

  return (
    <div data-testid="aop-reports-page">
      <Header icon={PresentationChart} title="AOP reports"
              subtitle="MIS and AOP report formats on the single actual source — pick one or more formats; each opens as its own page below"
              actions={<>
                <Popover icon={<Stack size={14} />} label={<span className="text-[11px]">Formats · {selected.length}</span>} testid="format-picker" width="w-80">
                  <div className="px-3 py-1.5 text-[10px] text-[var(--muted)] border-b border-[var(--border)]">Click a format to show it alone · tick the box to add it to the page</div>
                  {admin && (
                    <div className="px-3 py-1.5 border-b border-[var(--border)] bg-[var(--surface-2)] flex items-center gap-1.5 flex-wrap" data-testid="formats-default">
                      <span className="text-[10.5px] flex-1">{defMsg || (usersDefault ? `Users' default: ${(usersDefault.selected || []).length} format(s)` : "Users' default: Full P&L")}</span>
                      <button className="icon-btn !h-6 !text-[10.5px]" onClick={() => saveSharedView("aop_reports_v1", { selected }).then(() => setDefMsg("Saved as users' default"))}
                              data-testid="formats-save-default">Set as users' default</button>
                      {usersDefault && <button className="icon-btn !h-6 !text-[10.5px]" onClick={() => clearSharedView("aop_reports_v1").then(() => setDefMsg("Cleared"))}>Clear</button>}
                    </div>
                  )}
                  {groups.map(([sec, title]) => {
                    const items = (catalog || []).filter((f) => f.section === sec);
                    if (!items.length) return null;
                    return (
                      <div key={sec}>
                        <div className="px-3 py-1.5 border-b border-[var(--border)] text-[10px] tracking-overline text-[var(--muted)]">{title}</div>
                        {items.map((f) => (
                          <div key={f.key} className="flex items-start gap-2 px-3 py-1.5 cursor-pointer hover:bg-[var(--row-hover)]"
                               onClick={() => setPref({ selected: [f.key] })} title="Click to show only this format · tick the box to add it"
                               data-testid={`fmt-row-${f.key}`}>
                            <input type="checkbox" className="accent-[var(--gold)] mt-0.5 cursor-pointer" checked={selected.includes(f.key)}
                                   onClick={(e) => e.stopPropagation()} onChange={(e) => toggle(f.key, e.target.checked)} data-testid={`fmt-${f.key}`} />
                            <span className="flex-1 min-w-0">
                              <span className={`block ${selected.includes(f.key) ? "font-semibold" : ""}`}>{f.label}</span>
                              {f.description && <span className="block text-[10px] text-[var(--muted)] truncate">{f.description}</span>}
                            </span>
                            {!f.enabled && <span className="chip !text-[9.5px] text-[var(--warning)]" title="Hidden from users"><EyeSlash size={10} />off</span>}
                            <span className="chip !text-[9.5px]">{f.ref}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </Popover>
              </>} />
      <div className="p-3 space-y-4">
        {err && <div className="text-xs text-[var(--danger)]">{String(err)}</div>}
        {catalog && !selected.length && (
          <div className="text-xs text-[var(--muted)] border border-dashed border-[var(--border)] p-6 text-center">
            {catalog.length ? "Pick a report format from the Formats menu." : "No report formats are enabled for your role — ask an administrator."}
          </div>
        )}
        {selected.map((k, i) => (
          <ReportCard key={k} f={byKey[k]} byKey={byKey} unit={unit} datasets={datasets} admin={admin}
                      first={i === 0} last={i === selected.length - 1} onMove={(d) => move(k, d)} onClose={() => toggle(k, false)} />
        ))}
      </div>
    </div>
  );
}

/**
 * One report page. Double-clicks push a drill-down (Back returns, breadcrumbs jump); the data button opens the
 * datasets behind the report — download / bulk upload (permitted roles) and the FY'28 AOP inputs.
 */
function ReportCard({ f, byKey, unit, datasets, admin, first, last, onMove, onClose }) {
  const [stack, setStack] = useState([{ key: f.key, params: {}, label: f.label }]);
  const [showData, setShowData] = useState(false);
  const top = stack[stack.length - 1];
  const cur = byKey[top.key] || f;
  const Body = BODIES[top.key];
  const drill = (key, params = {}, label) => {
    if (!BODIES[key] || !byKey[key]) return; // format not enabled / not permitted for this role
    setStack((s) => [...s, { key, params, label: label ? `${byKey[key].label} · ${label}` : byKey[key].label }]);
  };
  const back = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  const sources = (SOURCES[top.key] || []).map((k) => datasets.find((d) => d.key === k)).filter(Boolean);
  return (
    <section className="mis mis-card" data-testid={`report-${f.key}`}>
      <div className="mis-title">
        {stack.length > 1 && (
          <button className="inline-flex items-center gap-1 text-[11px] bg-white/10 hover:bg-white/20 px-2 py-0.5" onClick={back} data-testid={`back-${f.key}`}>
            <ArrowLeft size={12} />Back
          </button>
        )}
        <span className="text-[10px] tracking-overline opacity-70">{cur.ref}</span>
        <span className="text-sm font-semibold flex items-center gap-1 min-w-0 truncate">
          {stack.map((s, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="opacity-50">›</span>}
              <button className={`truncate ${i < stack.length - 1 ? "opacity-70 hover:opacity-100 underline decoration-dotted" : ""}`}
                      onClick={() => setStack((st) => st.slice(0, i + 1))} disabled={i === stack.length - 1}>{s.label}</button>
            </React.Fragment>
          ))}
        </span>
        {!cur.enabled && <span className="chip !text-[9.5px] !bg-transparent !text-amber-300 !border-amber-300/50"><EyeSlash size={10} />Hidden from users</span>}
        <div className="flex-1" />
        {sources.length > 0 && (
          <button className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 ${showData ? "bg-white/25" : "bg-white/10 hover:bg-white/20"}`}
                  onClick={() => setShowData((x) => !x)} title="Data behind this report: download, bulk upload and FY'28 AOP inputs" data-testid={`data-${f.key}`}>
            <Database size={12} />Data & FY'28 AOP
          </button>
        )}
        <button className="text-white/70 hover:text-white disabled:opacity-30" disabled={first} onClick={() => onMove(-1)} title="Move up"><CaretUp size={13} /></button>
        <button className="text-white/70 hover:text-white disabled:opacity-30" disabled={last} onClick={() => onMove(1)} title="Move down"><CaretDown size={13} /></button>
        <button className="text-white/70 hover:text-white" onClick={onClose} title="Close"><X size={13} /></button>
      </div>
      {showData && <DataPanel sources={sources} admin={admin} />}
      <div className="p-2">{Body && <Body key={stack.length} unit={unit} params={top.params} onDrill={drill} />}</div>
    </section>
  );
}

function DataPanel({ sources, admin }) {
  const [active, setActive] = useState(sources[0]?.key);
  const ds = sources.find((d) => d.key === active) || sources[0];
  if (!ds) return null;
  return (
    <div className="border-b border-[var(--border)] bg-[var(--surface-2)] p-2 space-y-2" data-testid="report-data-panel">
      <div className="flex items-center gap-1 flex-wrap">
        {sources.map((d) => (
          <button key={d.key} className={`chip ${d.key === ds.key ? "!border-[var(--gold)] !text-[var(--gold)] font-semibold" : ""}`} onClick={() => setActive(d.key)}>{d.label}</button>
        ))}
        <span className="text-[10.5px] text-[var(--muted)] ml-2">
          FY'28 AOP columns open by default · edit cells or paste from Excel{ds.can_upload ? " · bulk upload / download with line ids" : " · bulk upload needs the upload permission"}
        </span>
      </div>
      <DatasetWorkspace dataset={ds} admin={admin} focusVersion="B28" key={ds.key} />
    </div>
  );
}
