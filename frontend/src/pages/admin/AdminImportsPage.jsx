import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { FileArrowUp, FileXls, CheckCircle, Warning, ClockCounterClockwise, DownloadSimple, UploadSimple } from "@phosphor-icons/react";

const KINDS = [
  { key: "aop", url: "/aop/import/aop-workbook", title: "Consolidated AOP workbook",
    help: "Reads Assumptions, CUTE / Non-CUTE / CR & Project revenue, Opex_Raw Data, Resource Dashboard, Overhead_Inputs + Indirect Cost ledger, Budgeted CAPEX and the WAISL P&L. Replaces those datasets and the imported actuals." },
  { key: "zmm", url: "/aop/import/zmm", title: "ZMM PO report", zmm: true,
    help: "The SAP ZMM PO report as e-mailed (sheet Data / ZMM_PO_Report, else the first sheet). Foreign-currency POs are converted to INR at the PO date (Net Order Value × the rate of the PO's Created On date, from Inputs → FX rates by date; missing dates are fetched from the ECB reference rates, else the Assumptions rate is used and flagged). A “Linked Forecast S.No” / “Opex line(s)” column, if present, adds to the mapping. Rebuilds PO items, flags changes on mapped POs, re-resolves links and recalculates the Opex forecast. The same file twice changes nothing. New POs and changes land in Review." },
  { key: "opex", url: "/aop/import/opex-workbook", title: "Opex forecast workbook — mapping & corrections",
    help: "Tracker lines from Opex_Forecast (upserted by S. No. — portal edits are kept) with the old ↔ new PO mapping from “New PO(s) mapped (ZMM)” (or a PO_Links sheet) and statuses (Line_Status). Its ZMM_PO_Report sheet: if a newer SAP report is already loaded it is NOT loaded over it — only its “Linked Forecast S.No” mapping and the periods / WBS corrected in it (as corrections) are taken. Rows without S. No. are rejected. Afterwards map and correct in the portal: Opex sheet → New PO(s) mapped, ZMM sheet → Opex line(s) and any SAP value, or the PO links tab." },
  { key: "mis", url: "/aop/import/mis-actuals", title: "Monthly actuals — MIS working file", monthly: true,
    help: "SAP_Revenue + SAP_Expense classified with the Mapping sheet → revenue, revenue share, opex, overheads and finance-cost actuals of the plan year, line by line. Replaces only the months in the file and moves the actual cut-off." },
  { key: "resource", url: "/aop/import/resource-cost", title: "Monthly actuals — resource cost file", monthly: true,
    help: "Final Resource Cost (employee × WBS × month) → payroll actuals by airport, project and department with FTE / headcount." },
  { key: "package", url: "/aop/import/reporting-package", title: "Monthly actuals — Financial Reporting Package (MIS)", monthly: true,
    help: "The month-end MIS workbook → the plan year's actuals for every P&L line of its closed months: CUTE (airport × PAX type), Non-CUTE, CR and Revenue share by location; project revenue, TP opex and resource cost per project (Project Summary); CA / CR opex and direct resources by airport; indirect resources (with FTE) and SG&A by department and CA+CR / Solutions; depreciation, finance cost, other income and tax. For those months it is the reports' actual source (SAP-dump actuals stay for raw drill-downs); the cut-off moves to its last closed month. Also loads actual billable PAX and the capex tracker. The result shows the reconciliation against the package's own P&L sheet." },
  { key: "projects", url: "/aop/import/project-health", title: "Project health tracker", monthly: true,
    help: "Project revenue master → TCV (PO value), customer, sales owner and status on the CR & project master." },
];

export default function AdminImportsPage() {
  const [history, setHistory] = useState([]);
  const load = () => api.get("/aop/imports").then((r) => setHistory(r.data));
  useEffect(() => { load(); }, []);
  return (
    <div data-testid="admin-imports-page">
      <PageHeader compact icon={FileArrowUp} title="Imports" subtitle="Load the AOP from Excel — tabs and columns are located by name, so re-arranged workbooks still import" />
      <div className="p-3">
        <AopModelCard onDone={load} />
      </div>
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

function AopModelCard({ onDone }) {
  const [downloading, setDownloading] = useState(false);
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState("");
  const download = async () => {
    setDownloading(true);
    try {
      const { data, headers } = await api.get("/aop/workbook/download", { responseType: "blob", timeout: 300000 });
      const cd = headers["content-disposition"] || "";
      const match = cd.match(/filename="?([^"]+)"?/);
      const name = match ? match[1] : "AOP_Model.xlsx";
      const url = URL.createObjectURL(data);
      const a = document.createElement("a"); a.href = url; a.download = name; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setErr(e.response?.data?.detail || e.message); }
    finally { setDownloading(false); }
  };
  const upload = async () => {
    if (!file || !window.confirm(`Upload "${file.name}"? Modified line items will be upserted, new lines added, and removed lines flagged.`)) return;
    setUploading(true); setErr(""); setRes(null);
    try {
      const fd = new FormData(); fd.append("file", file);
      const { data } = await api.post("/aop/workbook/upload", fd, { timeout: 600000 });
      setRes(data); onDone();
    } catch (e) { setErr(e.response?.data?.detail || e.message); }
    finally { setUploading(false); }
  };
  return (
    <div className="border border-[var(--gold)]/30 bg-[var(--surface)] p-4 text-xs space-y-3" data-testid="aop-model-card">
      <div className="font-semibold text-sm flex items-center gap-2">
        <FileXls size={18} className="text-[var(--gold)]" />
        Full AOP Model Workbook
        <span className="chip !bg-[var(--gold)]/15 !text-[var(--gold)]">Formula-based</span>
      </div>
      <div className="text-[var(--muted)]">
        Download the entire AOP as a multi-sheet Excel workbook. The P&L tab uses SUMIFS formulas referencing the raw data tabs
        (revenue, opex, payroll, overheads, etc.) — edit line items in the data tabs and re-upload to apply changes.
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <button className="icon-btn primary !h-8 gap-1.5" onClick={download} disabled={downloading} data-testid="aop-model-download">
          <DownloadSimple size={14} />{downloading ? "Preparing…" : "Download Model"}
        </button>
        <div className="flex items-center gap-1.5">
          <label className="flex items-center gap-2 border border-dashed border-[var(--border)] px-2 h-8 cursor-pointer hover:border-[var(--gold)] truncate max-w-[260px]">
            <UploadSimple size={14} className="text-[var(--muted)]" />
            <span className="truncate">{file ? file.name : "Choose modified .xlsx"}</span>
            <input type="file" accept=".xlsx,.xlsm" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </label>
          <button className="icon-btn !h-8 gap-1.5" disabled={!file || uploading} onClick={upload} data-testid="aop-model-upload">
            <UploadSimple size={14} />{uploading ? "Uploading…" : "Upload Changes"}
          </button>
        </div>
      </div>
      {err && <div className="text-[var(--danger)]">{String(err)}</div>}
      {res && (
        <div className="text-[var(--success)] flex items-start gap-1"><CheckCircle size={13} className="mt-0.5" />
          <span>{Object.entries(res.counts || {}).map(([ds, c]) =>
            `${ds}: +${c.added} updated ${c.updated} removed ${c.removed}`).join(" · ")}</span>
        </div>
      )}
    </div>
  );
}

function ImportCard({ kind, onDone }) {
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState("");
  const run = async () => {
    const msg = kind.zmm ? `Run the ZMM pipeline on "${file.name}"?` : kind.monthly ? `Import "${file.name}"? Actuals of the months it contains are replaced.` : `Import "${file.name}"? The datasets it contains will be replaced.`;
    if (!file || !window.confirm(msg)) return;
    setBusy(true); setErr(""); setRes(null);
    try {
      const fd = new FormData(); fd.append("file", file);
      const { data } = await api.post(kind.url, fd, { timeout: 600000 });
      setRes(data); onDone();
    } catch (e) {
      setErr(e.response?.status === 401 ? "Your session has ended — sign in again and re-run the import." : (e.response?.data?.detail || e.message));
    } finally { setBusy(false); }
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
      {res && kind.zmm && (
        <div className="text-[var(--success)] flex items-start gap-1"><CheckCircle size={13} className="mt-0.5" />
          <span>{res.rows} rows · {res.po_items} PO items · {res.new_pos} new POs · {res.to_map} to map · {res.changes_flagged} changes flagged · forecast Δ ₹{((res.forecast_delta || 0) / 1e5).toFixed(2)} L — see <a className="underline" href="/admin/aop/review">Review</a></span>
        </div>
      )}
      {res && (res.rejected?.length > 0 || res.warnings?.length > 0) && (
        <div className="text-[var(--warning)] space-y-0.5">{[...(res.rejected || []), ...(res.warnings || [])].slice(0, 12).map((w, i) => <div key={i} className="flex items-center gap-1"><Warning size={11} />{w}</div>)}</div>
      )}
      {res && !kind.zmm && (
        <div className="text-[var(--success)] flex items-start gap-1"><CheckCircle size={13} className="mt-0.5" />
          <span>{Object.entries(res.counts || {}).map(([k, v]) => `${k}: ${v}`).join(" · ")}{res.actuals ? ` · ${res.actuals} actuals` : ""}
            {res.periods ? ` · months ${res.periods.join(", ")}` : ""}{res.pax_rows ? ` · ${res.pax_rows} PAX rows` : ""}{res.matched !== undefined ? ` · ${res.matched}/${res.projects} projects matched` : ""}</span>
        </div>
      )}
      {res?.meta?.by_block && (
        <div className="border border-[var(--border-soft)] p-2 space-y-1" data-testid="package-reconciliation">
          <div className="font-semibold">Actuals read (₹ Cr, {res.meta.actual_months?.[0]} → {res.meta.cutoff})</div>
          <div className="grid grid-cols-2 gap-x-4">
            {Object.entries(res.meta.by_block).map(([k, v]) => (
              <div key={k} className="flex justify-between"><span>{k}</span><span className="tabular-nums">{Number(v).toFixed(2)}</span></div>
            ))}
          </div>
          {res.meta.mismatches?.length
            ? <div className="text-[var(--warning)]">Differs from the package's P&L sheet: {res.meta.mismatches.map((m) => `${m.line} ${m.period} (${m.diff > 0 ? "+" : ""}${m.diff.toFixed(2)})`).join(" · ")}</div>
            : <div className="text-[var(--success)] flex items-center gap-1"><CheckCircle size={12} />Ties to the package's P&L sheet for every month</div>}
        </div>
      )}
    </div>
  );
}
