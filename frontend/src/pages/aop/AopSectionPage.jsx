import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "@/lib/api";
import Header from "@/aop/Header";
import DatasetWorkspace from "@/aop/DatasetWorkspace";
import { SlidersHorizontal, TrendUp, Receipt, Buildings, LockKey, HardDrives, Info } from "@phosphor-icons/react";

export const SECTION_META = {
  aop_inputs:    { icon: SlidersHorizontal, title: "AOP inputs", subtitle: "Drivers for next year's plan — scenario (Low/Base/High), FX, escalation, PAX, rates, growth, allocations" },
  aop_revenue:   { icon: TrendUp,   title: "Revenue", subtitle: "CA (CUTE & Non-CUTE), Change Requests and Projects · airport & country mapping" },
  aop_opex:      { icon: Receipt,   title: "Opex & POs", subtitle: "Direct third-party opex: forecast tracker (old ↔ new PO), budget lines and the PO register — click any PO number" },
  aop_overheads: { icon: Buildings, title: "Overheads", subtitle: "Department overheads — original WBS / AOP-head budget, and next year's plan on Cost centre + GL" },
  aop_payroll:   { icon: LockKey,   title: "Payroll", subtitle: "Confidential · resource cost by project / department, active and to-be-hired" },
  aop_capex:     { icon: HardDrives, title: "Capex", subtitle: "Budgeted capex by department, location and sub-system" },
};

// Tabs order within a section (datasets not listed fall back to catalogue order)
const ORDER = ["opex_tracker", "opex_lines", "po_register", "overhead_plan", "overhead_lines", "cc_gl_map",
               "assumptions", "pl_other", "rev_cute", "rev_cute_drivers", "rev_noncute", "rev_projects", "project_master", "taxonomy_airports"];

export default function AopSectionPage({ section }) {
  const meta = SECTION_META[section] || { title: section };
  const [datasets, setDatasets] = useState([]);
  const [params, setParams] = useSearchParams();
  const [err, setErr] = useState("");

  useEffect(() => {
    api.get("/aop/datasets").then((r) => {
      const list = r.data.filter((d) => d.section === section);
      list.sort((a, b) => (ORDER.indexOf(a.key) + 1 || 99) - (ORDER.indexOf(b.key) + 1 || 99));
      setDatasets(list);
    }).catch((e) => setErr(e.response?.data?.detail || e.message));
  }, [section]);

  const current = datasets.find((d) => d.key === params.get("ds")) || datasets[0];

  return (
    <div data-testid={`aop-section-${section}`}>
      <Header icon={meta.icon} title={meta.title} subtitle={meta.subtitle} />
      <div className="px-3 pt-2 flex items-center gap-1 border-b border-[var(--border)] bg-[var(--surface)] overflow-x-auto">
        {datasets.map((d) => (
          <button key={d.key} onClick={() => setParams({ ds: d.key })} data-testid={`tab-${d.key}`}
                  className={`px-3 py-1.5 text-xs whitespace-nowrap border-b-2 -mb-px ${current?.key === d.key ? "border-[var(--gold)] text-[var(--text)] font-semibold" : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"}`}>
            {d.label} <span className="text-[10px] opacity-60 tabular-nums">{d.rows.toLocaleString("en-IN")}</span>
          </button>
        ))}
      </div>
      <div className="p-3">
        {err && <div className="text-xs text-[var(--danger)]">{String(err)}</div>}
        {current && (
          <>
            <div className="text-[10.5px] text-[var(--muted)] mb-1.5 flex items-center gap-1"><Info size={11} />{current.description}</div>
            <DatasetWorkspace key={current.key} dataset={current} />
          </>
        )}
        {!current && !err && <div className="text-xs text-[var(--muted)]">No datasets available in this section for your role.</div>}
      </div>
    </div>
  );
}
