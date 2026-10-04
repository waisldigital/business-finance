import React, { useCallback, useEffect, useState } from "react";
import api from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { download } from "@/aop/format";
import { ClockCounterClockwise, PaperPlaneTilt, Trash, DownloadSimple } from "@phosphor-icons/react";

const fmt = (v) => (v === null || v === undefined || v === "" ? "—" : typeof v === "number" ? v.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : String(v));

/** My AOP edits: drafts not yet submitted, and my submissions (one batch each) with the admin's decision. */
export default function MyChangesPage() {
  const [tab, setTab] = useState("draft");
  const [rows, setRows] = useState([]);
  const [batches, setBatches] = useState([]);
  const [msg, setMsg] = useState("");
  const load = useCallback(() => {
    if (tab === "batches") api.get("/aop/change-batches", { params: { status: "all" } }).then((r) => setBatches(r.data));
    else api.get("/aop/changes", { params: { status: tab } }).then((r) => setRows(r.data));
  }, [tab]);
  useEffect(() => { load(); }, [load]);
  const submit = async () => {
    const note = window.prompt(`Submit ${rows.length} change(s) for approval as one batch? Note for the approver (optional):`, "");
    if (note === null) return;
    try { const { data } = await api.post("/aop/changes/submit", { note }); setMsg(`Submitted as ${data.number}`); load(); }
    catch (e) { setMsg(e.response?.data?.detail || e.message); }
  };
  const discard = async () => {
    if (!window.confirm(`Discard all ${rows.length} unsubmitted change(s)?`)) return;
    await api.post("/aop/changes/discard", {}); load();
  };
  const exportBatch = (b) => api.get(`/aop/change-batches/${b.id}/export`, { responseType: "blob" }).then((r) => download(r.data, `${b.number}.xlsx`));
  return (
    <div data-testid="aop-my-changes">
      <PageHeader compact icon={ClockCounterClockwise} title="My changes" subtitle="Your AOP edits: drafts stay yours until you submit them; each submission is approved by the admin as one batch"
              actions={<div className="seg">{[["draft", "Not submitted"], ["batches", "Submissions"], ["pending", "Awaiting approval"], ["approved", "Approved"], ["rejected", "Rejected"]].map(([s, l]) =>
                <button key={s} className={tab === s ? "on" : ""} onClick={() => setTab(s)}>{l}</button>)}</div>} />
      <div className="p-3 space-y-2 text-xs">
        {tab === "draft" && rows.length > 0 && (
          <div className="flex items-center gap-2">
            <button className="icon-btn primary" onClick={submit} data-testid="my-submit"><PaperPlaneTilt size={13} />Submit all for approval ({rows.length})</button>
            <button className="icon-btn" onClick={discard}><Trash size={13} />Discard all</button>
            {msg && <span className="text-[var(--muted)]">{msg}</span>}
          </div>
        )}
        {tab === "batches" ? (
          <table className="w-full border border-[var(--border)] bg-[var(--surface)]">
            <thead className="bg-[var(--table-header-bg)] text-[10.5px] text-[var(--muted)]">
              <tr>{["Batch", "Submitted", "Changes", "Lines", "Datasets", "Note", "Status", ""].map((h) => <th key={h} className="text-left px-2 py-1.5">{h}</th>)}</tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id} className="border-t border-[var(--border-soft)]">
                  <td className="px-2 py-1 font-mono">{b.number}</td>
                  <td className="px-2 text-[var(--muted)]">{new Date(b.submitted_at).toLocaleString("en-IN")}</td>
                  <td className="px-2">{b.count}</td><td className="px-2">{b.lines}</td><td className="px-2">{(b.datasets || []).join(", ")}</td>
                  <td className="px-2">{b.note}</td>
                  <td className="px-2">{b.status}{b.decided_by ? ` · ${b.decided_by}` : ""}{b.comment ? ` — ${b.comment}` : ""}</td>
                  <td className="px-2"><button className="icon-btn !h-6" onClick={() => exportBatch(b)} title="Download as Excel"><DownloadSimple size={12} /></button></td>
                </tr>
              ))}
              {!batches.length && <tr><td colSpan={8} className="text-center py-8 text-[var(--muted)]">No submissions yet</td></tr>}
            </tbody>
          </table>
        ) : (
          <table className="w-full border border-[var(--border)] bg-[var(--surface)]">
            <thead className="bg-[var(--table-header-bg)] text-[10.5px] text-[var(--muted)]">
              <tr>{["Dataset", "Row", "Field", "Approved value", "Your value", "When", "Decision"].map((h) => <th key={h} className="text-left px-2 py-1.5">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-[var(--border-soft)]">
                  <td className="px-2 py-1">{r.dataset}</td><td className="px-2 font-mono">{r.key}</td><td className="px-2 font-mono">{r.field}</td>
                  <td className="px-2 text-[var(--muted)]">{fmt(r.old)}</td><td className="px-2 font-semibold">{fmt(r.new)}</td>
                  <td className="px-2 text-[var(--muted)]">{new Date(r.updated_at || r.created_at).toLocaleString("en-IN")}</td>
                  <td className="px-2">{r.decided_by ? `${r.status} by ${r.decided_by}${r.comment ? ` — ${r.comment}` : ""}` : r.status === "draft" ? "not submitted" : "awaiting"}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={7} className="text-center py-8 text-[var(--muted)]">Nothing here</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
