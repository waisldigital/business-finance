import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import Header from "@/aop/Header";
import { ClockCounterClockwise } from "@phosphor-icons/react";

export default function MyChangesPage() {
  const [status, setStatus] = useState("pending");
  const [rows, setRows] = useState([]);
  useEffect(() => { api.get("/aop/changes", { params: { status } }).then((r) => setRows(r.data)); }, [status]);
  return (
    <div data-testid="aop-my-changes">
      <Header icon={ClockCounterClockwise} title="My changes" subtitle="AOP edits you made that need (or needed) admin approval"
              actions={<div className="seg">{["pending", "approved", "rejected"].map((s) => <button key={s} className={status === s ? "on" : ""} onClick={() => setStatus(s)}>{s}</button>)}</div>} />
      <div className="p-3">
        <table className="w-full text-xs border border-[var(--border)] bg-[var(--surface)]">
          <thead className="bg-[var(--table-header-bg)] text-[10.5px] text-[var(--muted)]">
            <tr>{["Dataset", "Row", "Field", "Old", "New", "When", "Decision"].map((h) => <th key={h} className="text-left px-2 py-1.5">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-[var(--border-soft)]">
                <td className="px-2 py-1">{r.dataset}</td><td className="px-2 font-mono">{r.key}</td><td className="px-2 font-mono">{r.field}</td>
                <td className="px-2 text-[var(--muted)]">{String(r.old ?? "—")}</td><td className="px-2 font-semibold">{String(r.new ?? "—")}</td>
                <td className="px-2 text-[var(--muted)]">{new Date(r.updated_at || r.created_at).toLocaleString("en-IN")}</td>
                <td className="px-2">{r.decided_by ? `${r.status} by ${r.decided_by}${r.comment ? ` — ${r.comment}` : ""}` : "awaiting"}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7} className="text-center py-8 text-[var(--muted)]">Nothing {status}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
