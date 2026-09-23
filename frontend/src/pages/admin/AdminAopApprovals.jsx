import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import Header from "@/aop/Header";
import { CheckSquareOffset, Check, X, ArrowClockwise } from "@phosphor-icons/react";

export default function AdminAopApprovals() {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("pending");
  const [sel, setSel] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const load = () => api.get("/aop/changes", { params: { status } }).then((r) => { setRows(r.data); setSel(new Set()); });
  useEffect(() => { load(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  const decide = async (approve) => {
    const ids = Array.from(sel);
    if (!ids.length) return;
    const comment = approve ? "" : (window.prompt("Reason for rejection (optional)") || "");
    setBusy(true);
    try { await api.post("/aop/changes/decide", { ids, approve, comment }); await load(); } finally { setBusy(false); }
  };
  return (
    <div data-testid="admin-aop-approvals">
      <Header icon={CheckSquareOffset} title="AOP approvals" subtitle="User edits waiting for approval (sections set to 'with approval' in Plan settings)"
              actions={
                <>
                  <div className="seg">
                    {["pending", "approved", "rejected"].map((s) => <button key={s} className={status === s ? "on" : ""} onClick={() => setStatus(s)}>{s}</button>)}
                  </div>
                  <button className="icon-btn" onClick={load} title="Reload"><ArrowClockwise size={13} /></button>
                  {status === "pending" && (
                    <>
                      <button className="icon-btn" disabled={!sel.size || busy} onClick={() => decide(true)} title="Approve selected" data-testid="approve-btn"><Check size={14} className="text-[var(--success)]" />{sel.size || ""}</button>
                      <button className="icon-btn danger" disabled={!sel.size || busy} onClick={() => decide(false)} title="Reject selected"><X size={14} /></button>
                    </>
                  )}
                </>
              } />
      <div className="p-3">
        <table className="w-full text-xs border border-[var(--border)] bg-[var(--surface)]">
          <thead className="bg-[var(--table-header-bg)] text-[10.5px] text-[var(--muted)]">
            <tr>
              {status === "pending" && <th className="w-7 px-2 py-1.5"><input type="checkbox" className="accent-[var(--gold)]" checked={rows.length > 0 && sel.size === rows.length} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /></th>}
              {["Dataset", "Row key", "Field", "Old", "New", "Requested by", "When", status !== "pending" ? "Decided by" : ""].filter(Boolean).map((h) => <th key={h} className="text-left px-2">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-[var(--border-soft)]">
                {status === "pending" && <td className="px-2 py-1"><input type="checkbox" className="accent-[var(--gold)]" checked={sel.has(r.id)} onChange={(e) => { const n = new Set(sel); e.target.checked ? n.add(r.id) : n.delete(r.id); setSel(n); }} /></td>}
                <td className="px-2 py-1">{r.dataset}</td>
                <td className="px-2 font-mono">{r.key}</td>
                <td className="px-2 font-mono">{r.field}</td>
                <td className="px-2 text-[var(--muted)]">{String(r.old ?? "—")}</td>
                <td className="px-2 font-semibold">{String(r.new ?? "—")}</td>
                <td className="px-2">{r.requested_by_name || r.requested_by}</td>
                <td className="px-2 text-[var(--muted)]">{new Date(r.updated_at || r.created_at).toLocaleString("en-IN")}</td>
                {status !== "pending" && <td className="px-2">{r.decided_by}{r.comment ? ` — ${r.comment}` : ""}</td>}
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={9} className="text-center py-8 text-[var(--muted)]">Nothing {status}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
