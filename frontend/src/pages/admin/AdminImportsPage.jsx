import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import Header from "@/aop/Header";
import { FileArrowUp, FileXls, CheckCircle, Warning, ClockCounterClockwise } from "@phosphor-icons/react";

const KINDS = [
  { key: "aop", url: "/aop/import/aop-workbook", title: "Consolidated AOP workbook",
    help: "Reads Assumptions, CUTE / Non-CUTE / CR & Project revenue, Opex_Raw Data, Resource Dashboard, Overhead_Inputs + Indirect Cost ledger, Budgeted CAPEX and the WAISL P&L. Replaces those datasets and the imported actuals." },
  { key: "opex", url: "/aop/import/opex-workbook", title: "Opex forecast workbook",
    help: "Reads the Opex_Forecast tab (old ↔ new PO mapping, overrides, forecast) and the ZMM_PO_Report (PO register)." },
  { key: "mis", url: "/aop/import/mis-actuals", title: "Monthly actuals — MIS working file", monthly: true,
    help: "SAP_Revenue + SAP_Expense classified with the Mapping sheet → revenue, revenue share, opex, overheads and finance-cost actuals of the plan year, line by line. Replaces only the months in the file and moves the actual cut-off." },
  { key: "resource", url: "/aop/import/resource-cost", title: "Monthly actuals — resource cost file", monthly: true,
    help: "Final Resource Cost (employee × WBS × month) → payroll actuals by airport, project and department with FTE / headcount." },
  { key: "package", url: "/aop/import/reporting-package", title: "Reporting package — PAX & capex tracker", monthly: true,
    help: "Revenue Analysis billable PAX (actual months) → CUTE drivers “PAX Actual”; CAPEX Tracker → capex tracker (initial budget, capex till last year, monthly actuals, open PO / PR)." },
  { key: "projects", url: "/aop/import/project-health", title: "Project health tracker", monthly: true,
    help: "Project revenue master → TCV (PO value), customer, sales owner and status on the CR & project master." },
];

export default function AdminImportsPage() {
  const [history, setHistory] = useState([]);
  const load = () => api.get("/aop/imports").then((r) => setHistory(r.data));
  useEffect(() => { load(); }, []);
  return (
    <div data-testid="admin-imports-page">
      <Header icon={FileArrowUp} title="Imports" subtitle="Load the AOP from Excel — tabs and columns are located by name, so re-arranged workbooks still import" />
      <div className="p-3 grid md:grid-cols-2 gap-3">
        {KINDS.map((k) => <ImportCard key={k.key} kind={k} onDone={load} />)}
      </div>
      <div className="px-3">
        <div className="text-[10.5px] tracking-overline text-[var(--muted)] mb-1 flex items-center gap-1"><ClockCounterClockwise size={12} /> History</div>
        <div className="border border-[var(--border)] bg-[var(--surface)] divide-y divide-[var(--border-soft)] text-xs">
          {history.map((h) => (
            <div key={h.id} className="px-3 py-1.5">
              <div className="flex items-center gap-2">
                <FileXls size={14} className="text-[var(--success)]" />
                <span className="font-semibold">{h.file}</span>
                <span className="chip">{h.kind}</span>
                <span className="text-[var(--muted)]">{new Date(h.at).toLocaleString("en-IN")} · {h.by}</span>
                {h.meta?.base_fy && <span className="chip">{h.meta.base_fy} actuals to {h.meta.actual_cutoff} · plan {h.meta.plan_fy}</span>}
              </div>
              <div className="text-[var(--muted)] mt-0.5">{Object.entries(h.counts || {}).map(([k, v]) => `${k}: ${v}`).join(" · ")}{h.actuals ? ` · actuals: ${h.actuals}` : ""}
                {h.meta?.periods ? ` · months ${h.meta.periods.join(", ")}` : ""}
                {h.meta?.skipped ? ` · skipped: ${Object.entries(h.meta.skipped).map(([k, v]) => `${k} ${v}`).join(", ")}` : ""}</div>
              {h.warnings?.map((w, i) => <div key={i} className="text-[var(--warning)] flex items-center gap-1"><Warning size={11} />{w}</div>)}
            </div>
          ))}
          {!history.length && <div className="px-3 py-6 text-center text-[var(--muted)]">No imports yet</div>}
        </div>
      </div>
    </div>
  );
}

function ImportCard({ kind, onDone }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState("");
  const run = async () => {
    const msg = kind.monthly ? `Import "${file.name}"? Actuals of the months it contains are replaced.` : `Import "${file.name}"? The datasets it contains will be replaced.`;
    if (!file || !window.confirm(msg)) return;
    setBusy(true); setErr(""); setRes(null);
    try {
      const fd = new FormData(); fd.append("file", file);
      const { data } = await api.post(kind.url, fd, { timeout: 600000 });
      setRes(data); onDone();
    } catch (e) { setErr(e.response?.data?.detail || e.message); } finally { setBusy(false); }
  };
  return (
    <div className="border border-[var(--border)] bg-[var(--surface)] p-3 text-xs space-y-2" data-testid={`import-${kind.key}`}>
      <div className="font-semibold text-sm flex items-center gap-2"><FileXls size={16} className="text-[var(--success)]" />{kind.title}</div>
      <div className="text-[var(--muted)]">{kind.help}</div>
      <div className="flex items-center gap-1.5">
        <label className="flex-1 flex items-center gap-2 border border-dashed border-[var(--border)] px-2 h-8 cursor-pointer hover:border-[var(--gold)] truncate">
          <FileArrowUp size={14} className="text-[var(--muted)]" />
          <span className="truncate">{file ? file.name : "Choose .xlsx"}</span>
          <input type="file" accept=".xlsx,.xlsm" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </label>
        <button className="icon-btn primary !h-8" disabled={!file || busy} onClick={run} data-testid={`import-run-${kind.key}`}>
          <FileArrowUp size={14} />{busy ? "Importing…" : "Import"}
        </button>
      </div>
      {err && <div className="text-[var(--danger)]">{String(err)}</div>}
      {res && (
        <div className="text-[var(--success)] flex items-start gap-1"><CheckCircle size={13} className="mt-0.5" />
          <span>{Object.entries(res.counts || {}).map(([k, v]) => `${k}: ${v}`).join(" · ")}{res.actuals ? ` · ${res.actuals} actuals` : ""}
            {res.periods ? ` · months ${res.periods.join(", ")}` : ""}{res.pax_rows ? ` · ${res.pax_rows} PAX rows` : ""}{res.matched !== undefined ? ` · ${res.matched}/${res.projects} projects matched` : ""}</span>
        </div>
      )}
    </div>
  );
}
