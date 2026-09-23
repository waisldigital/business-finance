import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDateTime } from "@/lib/format";

const ENTITY_TYPES = ["", "project", "customer", "employee", "supplier", "user", "approval_rule", "approval_request", "upload", "revenue_line", "cost_line"];

export default function AuditPage() {
  const [type, setType] = useState("");
  const [rows, setRows] = useState([]);

  const load = async () => {
    const { data } = await api.get("/audit", { params: { entity_type: type || undefined, limit: 200 } });
    setRows(data);
  };
  useEffect(() => { load(); /* eslint-disable-line */ }, [type]);

  return (
    <div data-testid="audit-page">
      <PageHeader title="Audit Trail" subtitle="Permanent record of every change" breadcrumb="HOME · AUDIT" />
      <div className="px-8 py-5">
        <div className="tile p-3 mb-4 flex flex-wrap gap-2">
          <span className="text-[10px] tracking-overline text-[var(--muted)] self-center mr-2">FILTER ENTITY</span>
          {ENTITY_TYPES.map((t) => (
            <button key={t} onClick={() => setType(t)}
              className={`px-3 py-1.5 text-xs border ${type === t ? "bg-[var(--text)] text-[var(--surface)] border-[#111110]" : "border-[var(--border)] text-[var(--muted)] hover:border-[var(--gold)]"}`}
              data-testid={`audit-filter-${t || "all"}`}>{t || "All"}</button>
          ))}
        </div>
        <div className="tile overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Timestamp</th><th>Entity</th><th>Action</th><th>User</th><th>Reason</th><th>Changes</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-testid={`audit-row-${r.id}`}>
                  <td className="text-xs">{formatDateTime(r.timestamp)}</td>
                  <td className="text-xs"><span className="font-mono">{r.entity_type}</span><div className="text-[10px] text-[var(--muted)]">{(r.entity_id || "").slice(0, 8)}</div></td>
                  <td><StatusBadge status={r.action} /></td>
                  <td className="text-xs">{r.user_email || "system"}</td>
                  <td className="text-xs">{r.reason || "—"}</td>
                  <td><pre className="font-mono text-[10px] whitespace-pre-wrap max-w-md">{JSON.stringify(r.field_changes, null, 2)}</pre></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} className="text-center py-12 text-[var(--muted)]">No audit events</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
