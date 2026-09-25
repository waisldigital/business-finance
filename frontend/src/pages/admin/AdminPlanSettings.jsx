import React, { useEffect, useState } from "react";
import { SECTIONS as ALL_SECTIONS } from "@/config/sections";
import api from "@/lib/api";
import Header from "@/aop/Header";
import { SlidersHorizontal, FloppyDisk, CheckCircle, PencilSimpleLine, ShieldCheck, MagicWand, PresentationChart, Eye, EyeSlash } from "@phosphor-icons/react";

const DRIVERS = [
  ["cute_growth", "CUTE revenue growth (PAX × rate)"], ["noncute_growth", "Non-CUTE revenue growth"],
  ["cr_growth", "Change Request revenue growth"], ["projects_growth", "Projects revenue & TP cost growth"],
  ["opex_escalation", "Recurring opex escalation (one-time → 0)"], ["payroll_increment", "Payroll increment"],
  ["payroll_loading", "Payroll CTC loading"], ["overhead_escalation", "Overhead escalation on CC+GL run-rate"],
];

// sections whose user edits can go straight in or through approval (AOP data sections)
const SECTIONS = ALL_SECTIONS.filter((x) => x.group === "aop" && x.nav && !x.nav.sections).map((x) => [x.key, x.nav.label]);

const F = ({ label, children }) => (
  <label className="block"><span className="block text-[10px] tracking-overline text-[var(--muted)] mb-1">{label}</span>{children}</label>
);

export default function AdminPlanSettings() {
  const [cfg, setCfg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => { api.get("/aop/config").then((r) => setCfg(r.data)); }, []);
  if (!cfg) return null;
  const set = (patch) => { setSaved(false); setCfg((c) => ({ ...c, ...patch })); };
  const save = async () => {
    setBusy(true);
    try {
      const { data } = await api.put("/aop/config", {
        base_fy: cfg.base_fy, plan_fy: cfg.plan_fy, draft_fy: cfg.draft_fy, cutoffs: cfg.cutoffs,
        tax_rate: Number(cfg.tax_rate), edit_modes: cfg.edit_modes,
      });
      setCfg((c) => ({ ...c, ...data })); setSaved(true);
    } finally { setBusy(false); }
  };
  return (
    <div data-testid="admin-plan-settings">
      <Header icon={SlidersHorizontal} title="Plan settings" subtitle="Planning cycle, actual cut-off and how user edits are applied"
              actions={<>
                {saved && <span className="text-[11px] text-[var(--success)] flex items-center gap-1"><CheckCircle size={12} />Saved</span>}
                <button className="icon-btn primary" onClick={save} disabled={busy} data-testid="plan-save"><FloppyDisk size={14} />Save</button>
              </>} />
      <div className="p-3 grid lg:grid-cols-2 gap-3 text-xs">
        <div className="border border-[var(--border)] bg-[var(--surface)] p-3 space-y-2.5">
          <div className="font-semibold text-sm">Planning cycle</div>
          <div className="grid grid-cols-3 gap-2">
            <F label="Actuals year"><input className="input-sm w-full" value={cfg.base_fy} onChange={(e) => set({ base_fy: e.target.value.toUpperCase() })} /></F>
            <F label="Approved plan"><input className="input-sm w-full" value={cfg.plan_fy} onChange={(e) => set({ plan_fy: e.target.value.toUpperCase() })} /></F>
            <F label="Draft (next AOP)"><input className="input-sm w-full" value={cfg.draft_fy} onChange={(e) => set({ draft_fy: e.target.value.toUpperCase() })} /></F>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <F label="Actuals up to (YYYY-MM)"><input className="input-sm w-full" value={cfg.cutoffs?.default || ""} onChange={(e) => set({ cutoffs: { ...cfg.cutoffs, default: e.target.value } })} /></F>
            <F label="Overheads actuals up to"><input className="input-sm w-full" value={cfg.cutoffs?.overhead || ""} onChange={(e) => set({ cutoffs: { ...cfg.cutoffs, overhead: e.target.value } })} /></F>
            <F label="Tax rate on PBT"><input className="input-sm w-full" type="number" step="0.01" value={cfg.tax_rate} onChange={(e) => set({ tax_rate: e.target.value })} /></F>
          </div>
          <div className="text-[10.5px] text-[var(--muted)]">Months up to the cut-off come from the actual source; later months use the forecast. The workbook import sets these automatically.</div>
        </div>
        <div className="border border-[var(--border)] bg-[var(--surface)] p-3">
          <div className="font-semibold text-sm mb-2">User edits</div>
          <table className="w-full">
            <tbody>
              {SECTIONS.map(([k, label]) => (
                <tr key={k} className="border-t border-[var(--border-soft)]">
                  <td className="py-1.5">{label}</td>
                  <td className="text-right">
                    <div className="seg">
                      <button className={cfg.edit_modes?.[k] === "direct" ? "on" : ""} onClick={() => set({ edit_modes: { ...cfg.edit_modes, [k]: "direct" } })} data-testid={`mode-${k}-direct`}>
                        <PencilSimpleLine size={11} />Direct
                      </button>
                      <button className={cfg.edit_modes?.[k] !== "direct" ? "on" : ""} onClick={() => set({ edit_modes: { ...cfg.edit_modes, [k]: "approval" } })} data-testid={`mode-${k}-approval`}>
                        <ShieldCheck size={11} />With approval
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-[10.5px] text-[var(--muted)] mt-2">Which columns users may edit is set per dataset in Data manager → Columns. Section access comes from Roles.</div>
        </div>
        <ReportFormatsPanel />
        <DraftPanel />
      </div>
    </div>
  );
}


function DraftPanel() {
  const [info, setInfo] = useState(null);
  const [drivers, setDrivers] = useState({});
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => { api.get("/aop/plan/drivers").then((r) => { setInfo(r.data); setDrivers(r.data.drivers); }); }, []);
  if (!info) return null;
  const run = async () => {
    if (overwrite && !window.confirm(`Overwrite existing B ${info.target_fy} values, including user edits?`)) return;
    setBusy(true); setErr(""); setRes(null);
    try {
      const payload = { overwrite, drivers: Object.fromEntries(Object.entries(drivers).map(([k, v]) => [k, Number(v)])) };
      const { data } = await api.post("/aop/plan/generate", payload);
      setRes(data);
    } catch (e) { setErr(e.response?.data?.detail || e.message); } finally { setBusy(false); }
  };
  return (
    <div className="border border-[var(--border)] bg-[var(--surface)] p-3 lg:col-span-2" data-testid="draft-panel">
      <div className="flex items-center gap-2 mb-2">
        <MagicWand size={16} className="text-[var(--gold)]" />
        <div className="font-semibold text-sm flex-1">Next-year draft · B {info.target_fy} from {info.source_fy} actual / forecast</div>
        <label className="flex items-center gap-1.5 text-[11px]">
          <input type="checkbox" className="accent-[var(--danger)]" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
          Overwrite existing values
        </label>
        <button className="icon-btn primary" onClick={run} disabled={busy} data-testid="draft-generate"><MagicWand size={14} />{busy ? "Generating…" : "Generate"}</button>
      </div>
      <div className="grid md:grid-cols-4 gap-2">
        {DRIVERS.map(([k, label]) => (
          <label key={k} className="block">
            <span className="block text-[10px] tracking-overline text-[var(--muted)] mb-1">{label}</span>
            <div className="flex items-center gap-1">
              <input className="input-sm w-full" type="number" step="0.005" value={drivers[k] ?? ""} onChange={(e) => setDrivers({ ...drivers, [k]: e.target.value })} />
              <span className="text-[10.5px] text-[var(--muted)] w-12 text-right tabular-nums">{((Number(drivers[k]) || 0) * 100).toFixed(1)}%</span>
            </div>
          </label>
        ))}
      </div>
      <div className="text-[10.5px] text-[var(--muted)] mt-2">
        Defaults come from Assumptions. Existing B {info.target_fy} values are kept unless “Overwrite” is ticked, so user edits survive a re-run.
        Overheads are seeded on Cost centre + GL from the ledger run-rate; capex asks are entered per line.
      </div>
      {err && <div className="text-xs text-[var(--danger)] mt-1">{String(err)}</div>}
      {res && <div className="text-xs text-[var(--success)] mt-1 flex items-center gap-1"><CheckCircle size={12} />
        {Object.entries(res.counts).map(([k, v]) => `${k}: ${v}`).join(" · ")}</div>}
    </div>
  );
}


const SEGMENTS = [["ca_cr", "CA+CR"], ["solutions", "Solutions"], ["common", "Common · by revenue"]];

// Which report formats users can open, and how indirect costs are split between CA+CR and Solutions
function ReportFormatsPanel() {
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    api.get("/aop/mis/formats").then((r) => setInfo({
      enabled: Object.fromEntries(r.data.formats.map((f) => [f.key, f.enabled])), formats: r.data.formats,
      rules: r.data.segment_rules, blocks: r.data.blocks, noncute: (r.data.solutions_noncute || []).join(", "),
    }));
  }, []);
  if (!info) return null;
  const set = (patch) => { setSaved(false); setInfo((i) => ({ ...i, ...patch })); };
  const save = async () => {
    setBusy(true);
    try {
      await api.put("/aop/config", {
        report_formats: info.enabled, mis_segments: info.rules,
        mis_solutions_noncute: info.noncute.split(",").map((x) => x.trim()).filter(Boolean),
      });
      setSaved(true);
    } finally { setBusy(false); }
  };
  return (
    <div className="border border-[var(--border)] bg-[var(--surface)] p-3 lg:col-span-2" data-testid="report-formats-panel">
      <div className="flex items-center gap-2 mb-2">
        <PresentationChart size={16} className="text-[var(--gold)]" />
        <div className="font-semibold text-sm flex-1">AOP report formats</div>
        {saved && <span className="text-[11px] text-[var(--success)] flex items-center gap-1"><CheckCircle size={12} />Saved</span>}
        <button className="icon-btn primary" onClick={save} disabled={busy} data-testid="formats-save"><FloppyDisk size={14} />Save</button>
      </div>
      <div className="grid lg:grid-cols-2 gap-3">
        <table className="w-full">
          <tbody>
            {info.formats.map((f) => (
              <tr key={f.key} className="border-t border-[var(--border-soft)]">
                <td className="py-1.5"><div className="font-medium">{f.label}</div><div className="text-[10px] text-[var(--muted)]">{f.ref} · {f.section === "aop_pnl" ? "needs P&L access" : "needs Reports access"}</div></td>
                <td className="text-right">
                  <div className="seg">
                    <button className={info.enabled[f.key] ? "on" : ""} onClick={() => set({ enabled: { ...info.enabled, [f.key]: true } })} data-testid={`fmt-on-${f.key}`}><Eye size={11} />On</button>
                    <button className={!info.enabled[f.key] ? "on" : ""} onClick={() => set({ enabled: { ...info.enabled, [f.key]: false } })} data-testid={`fmt-off-${f.key}`}><EyeSlash size={11} />Off</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div>
          <div className="text-[10px] tracking-overline text-[var(--muted)] mb-1">Indirect costs by segment (Full P&L, Regional P&L)</div>
          <table className="w-full">
            <tbody>
              {info.blocks.map((b) => (
                <tr key={b} className="border-t border-[var(--border-soft)]">
                  <td className="py-1">{b}</td>
                  <td className="text-right">
                    <select className="input-sm" value={info.rules[b] || "common"} onChange={(e) => set({ rules: { ...info.rules, [b]: e.target.value } })}>
                      {SEGMENTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <label className="block mt-2">
            <span className="block text-[10px] tracking-overline text-[var(--muted)] mb-1">Non-CUTE locations reported under Solutions</span>
            <input className="input-sm w-full" value={info.noncute} onChange={(e) => set({ noncute: e.target.value })} placeholder="Kuwait, Kannur" />
          </label>
        </div>
      </div>
    </div>
  );
}
