import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import Header from "@/aop/Header";
import { SlidersHorizontal, FloppyDisk, CheckCircle, PencilSimpleLine, ShieldCheck } from "@phosphor-icons/react";

const SECTIONS = [
  ["aop_inputs", "AOP inputs"], ["aop_revenue", "Revenue"], ["aop_opex", "Opex & POs"], ["aop_overheads", "Overheads"],
  ["aop_payroll", "Payroll"], ["aop_capex", "Capex"],
];

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
      </div>
    </div>
  );
}
