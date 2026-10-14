import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { download } from "@/aop/format";
import { CheckSquareOffset, Check, X, ArrowClockwise, DownloadSimple, CaretDown, CaretRight } from "@phosphor-icons/react";

const fmt = (v) => (v === null || v === undefined || v === "" ? "—" : typeof v === "number" ? v.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : String(v));

/** User submissions (one batch per submit): see the whole batch as one file and approve or reject it at once. */
export default function AdminAopApprovals() {
  const [params] = useSearchParams();
  const [status, setStatus] = useState("pending");
  const [batches, setBatches] = useState([]);
  const [open, setOpen] = useState(params.get("batch"));
  const [detail, setDetail] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const load = useCallback(() => api.get("/aop/change-batches", { params: { status } }).then((r) => setBatches(r.data)), [status]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (open && !detail[open]) api.get(`/aop/change-batches/${open}`).then((r) => setDetail((d) => ({ ...d, [open]: r.data }))).catch(() => {});
  }, [open, detail]);
  const decide = async (b, approve) => {
    const comment = approve ? "" : window.prompt(`Reject ${b.number}? Reason (sent to ${b.requested_by_name || b.requested_by}):`, "");
    if (comment === null) return;
    if (approve && !window.confirm(`Approve all ${b.count} change(s) of ${b.number}?`)) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/aop/change-batches/${b.id}/decide`, { approve, comment });
      setMsg(`${b.number}: ${data.decided} change(s) ${approve ? "approved" : "rejected"}`);
      setDetail((d) => ({ ...d, [b.id]: undefined })); load();
    } catch (e) { setMsg(e.response?.data?.detail || e.message); } finally { setBusy(false); }
  };
  const exportBatch = (b) => api.get(`/aop/change-batches/${b.id}/export`, { responseType: "blob" }).then((r) => download(r.data, `${b.number}.xlsx`));
  return (
    <div data-testid="admin-aop-approvals">
      <PageHeader compact icon={CheckSquareOffset} title="AOP approvals" subtitle="Each user submission is one batch: download it as one file, approve or reject it at once"
              actions={<>
                <div className="seg">{["pending", "approved", "partly approved", "rejected", "all"].map((s) => <button key={s} className={status === s ? "on" : ""} onClick={() => setStatus(s)}>{s}</button>)}</div>
                <button className="icon-btn" onClick={load} title="Reload"><ArrowClockwise size={13} /></button>
              </>} />
      <div className="p-3 space-y-2 text-xs">
        {msg && <div className="text-[var(--success)]">{msg}</div>}
        {batches.map((b) => {
          const d = detail[b.id];
          return (
            <div key={b.id} className="border border-[var(--border)] bg-[var(--surface)]" data-testid={`batch-${b.number}`}>
              <div className="flex items-center gap-2 px-2 py-1.5">
                <button onClick={() => setOpen(open === b.id ? null : b.id)}>{open === b.id ? <CaretDown size={12} /> : <CaretRight size={12} />}</button>
                <span className="font-mono font-semibold">{b.number}</span>
                <span>{b.requested_by_name || b.requested_by}</span>
                <span className="text-[var(--muted)]">{new Date(b.submitted_at).toLocaleString("en-IN")}</span>
                <span className="chip">{b.count} change{b.count > 1 ? "s" : ""} · {b.lines} line{b.lines > 1 ? "s" : ""}</span>
                <span className="text-[var(--muted)]">{(b.datasets || []).join(", ")}</span>
                {b.note && <span className="italic">“{b.note}”</span>}
                <span className="flex-1" />
                <span className="chip">{b.status}{b.decided_by ? ` · ${b.decided_by}` : ""}</span>
                <button className="icon-btn" onClick={() => exportBatch(b)} title="Download the whole submission (xlsx)"><DownloadSimple size={13} />xlsx</button>
                {b.status === "pending" && <>
                  <button className="icon-btn primary" disabled={busy} onClick={() => decide(b, true)} data-testid="batch-approve"><Check size={13} />Approve all</button>
                  <button className="icon-btn danger" disabled={busy} onClick={() => decide(b, false)}><X size={13} />Reject</button>
                </>}
              </div>
              {open === b.id && (
                <div className="border-t border-[var(--border-soft)] overflow-auto">
                  {!d ? <div className="p-3 text-[var(--muted)]">Loading…</div> : (
                    <table className="w-full">
                      <thead className="bg-[var(--table-header-bg)] text-[10.5px] text-[var(--muted)]">
                        <tr>{["Dataset", "Line", "AOP code", "PO", "Vendor", "Location", "Column", "Approved value", "Proposed", "Change", "Status"].map((h) => <th key={h} className="text-left px-2 py-1">{h}</th>)}</tr>
                      </thead>
                      <tbody>
                        {d.changes.map((c) => (
                          <tr key={c.id} className="border-t border-[var(--border-soft)]">
                            <td className="px-2 py-1">{c.dataset_label}</td><td className="px-2 font-mono">{c.key}</td>
                            <td className="px-2">{c.line.aop_code}</td><td className="px-2 font-mono">{c.line.po}</td>
                            <td className="px-2 max-w-[180px] truncate">{c.line.vendor}</td><td className="px-2">{c.line.tag}</td>
                            <td className="px-2">{c.field_label}</td>
                            <td className="px-2 text-right tabular-nums text-[var(--muted)]">{fmt(c.old)}</td>
                            <td className="px-2 text-right tabular-nums font-semibold">{fmt(c.new)}</td>
                            <td className="px-2 text-right tabular-nums">{typeof c.new === "number" && typeof c.old === "number" ? fmt(c.new - c.old) : ""}</td>
                            <td className="px-2">{c.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {!batches.length && <div className="border border-dashed border-[var(--border)] p-8 text-center text-[var(--muted)]">No {status === "all" ? "" : status} submissions</div>}
      </div>
    </div>
  );
}
