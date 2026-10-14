import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "@/lib/api";
import DatasetWorkspace from "@/aop/DatasetWorkspace";
import CapexSummary from "@/aop/CapexSummary";
import { SlidersHorizontal, TrendUp, Receipt, Buildings, LockKey, HardDrives } from "@phosphor-icons/react";

export const SECTION_META = {
  aop_inputs:    { icon: SlidersHorizontal, title: "AOP inputs", subtitle: "Drivers for next year's plan — scenario (Low/Base/High), FX, escalation, PAX, rates, growth, allocations" },
  aop_revenue:   { icon: TrendUp,   title: "Revenue", subtitle: "CA (CUTE & Non-CUTE), Change Requests and Projects · airport & country mapping" },
  aop_opex:      { icon: Receipt,   title: "Opex & POs", subtitle: "Direct third-party opex: forecast tracker (latest PO first), budget lines, PO links and the ZMM PO report — click any PO number; map new POs in Review" },
  aop_overheads: { icon: Buildings, title: "Overheads", subtitle: "Department overheads — original WBS / AOP-head budget, and next year's plan on Cost centre + GL" },
  aop_payroll:   { icon: LockKey,   title: "Payroll", subtitle: "Confidential · resource cost by project / department, active and to-be-hired" },
  aop_capex:     { icon: HardDrives, title: "Capex", subtitle: "Budgeted capex by department, location and sub-system" },
};

// Tabs order within a section (datasets not listed fall back to catalogue order)
const ORDER = ["capex_lines", "capex_history", "opex_tracker", "opex_lines", "po_links", "po_items", "po_register", "po_triage", "po_changes", "po_corrections", "zmm_runs", "overhead_plan", "overhead_lines", "cc_gl_map",
               "assumptions", "pl_other", "rev_cute", "rev_cute_drivers", "rev_noncute", "rev_projects", "project_master", "taxonomy_airports"];

// Datasets shown as separate tables in one tab, split on a field (e.g. CUTE drivers: PAX lines and Rate lines)
export const SPLITS = {
  rev_cute_drivers: { field: "metric", parts: [["PAX", "PAX"], ["Rate (INR)", "Rates (INR per PAX)"]] },
};

/** A tab's body: one grid, or one grid per part of a split dataset (each with its own view). */
export function DatasetBody({ dataset, ...props }) {
  const split = SPLITS[dataset.key];
  if (!split) return <DatasetWorkspace dataset={dataset} {...props} />;
  return (
    <div className="space-y-4">
      {split.parts.map(([value, label]) => (
        <section key={value} data-testid={`split-${dataset.key}-${value}`}>
          <h3 className="text-[11px] tracking-overline text-[var(--muted)] mb-1">{label}</h3>
          <DatasetWorkspace dataset={dataset} filter={{ field: split.field, value, label }} {...props} />
        </section>
      ))}
    </div>
  );
}

export default function AopSectionPage({ section }) {
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

  // sections with a report view show it as the first tab
  const reports = section === "aop_capex" ? [{ key: "_summary", label: "Summary", report: true }] : [];
  const tabs = [...reports, ...datasets];
  const current = tabs.find((d) => d.key === params.get("ds")) || tabs[0];

  return (
    <div data-testid={`aop-section-${section}`}>
      {/* no page title: the top bar's breadcrumb names the section; a single tab needs no tab bar */}
      {tabs.length > 1 && (
      <div className="px-3 pt-2 flex items-center gap-1 border-b border-[var(--border)] bg-[var(--surface)] overflow-x-auto">
        {tabs.map((d) => (
          <button key={d.key} onClick={() => setParams({ ds: d.key })} data-testid={`tab-${d.key}`}
                  className={`px-3 py-1.5 text-xs whitespace-nowrap border-b-2 -mb-px ${current?.key === d.key ? "border-[var(--gold)] text-[var(--text)] font-semibold" : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"}`}>
            {d.label} {!d.report && <span className="text-[10px] opacity-60 tabular-nums">{d.rows.toLocaleString("en-IN")}</span>}
          </button>
        ))}
      </div>
      )}
      <div className="p-3">
        {err && <div className="text-xs text-[var(--danger)]">{String(err)}</div>}
        {current?.report && <CapexSummary />}
        {current && !current.report && (
          <>
            <DatasetBody key={current.key} dataset={current} />
          </>
        )}
        {!current && !err && <div className="text-xs text-[var(--muted)]">No datasets available in this section for your role.</div>}
      </div>
    </div>
  );
}
