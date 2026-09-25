import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDateTime } from "@/lib/format";
import { Check, X } from "@phosphor-icons/react";

export default function ApprovalsPage() {
  const [tab, setTab] = useState("Pending");
  const [rows, setRows] = useState([]);

  const load = async () => {
    const { data } = await api.get("/approvals/requests", { params: tab === "All" ? {} : { status: tab } });
    setRows(data);
  };
  useEffect(() => { load(); /* eslint-disable-line */ }, [tab]);

  return (
    <div data-testid="approvals-page">
      <PageHeader title="Approval Queue" subtitle="Stage transitions awaiting review" breadcrumb="HOME · APPROVALS" />
      <div className="px-8 py-5">
        <div className="flex gap-1 mb-4">
          {["Pending", "Approved", "Rejected", "All"].map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 text-xs font-medium border-b-2 ${tab === t ? "border-[var(--gold)] text-[var(--gold)]" : "border-transparent text-[var(--muted)]"}`}
              data-testid={`approvals-tab-${t.toLowerCase()}`}>{t}</button>
          ))}
        </div>
        <StageGateTable rows={rows} onAction={(id, act) => actionRequest(id, act).then(load)} />
      </div>
    </div>
  );
}

/** Approve / reject a project stage-gate request, with an optional comment. */
export async function actionRequest(id, act) {
  const comment = window.prompt(`${act === "approve" ? "Approval" : "Rejection"} comment? (optional)`);
  if (comment === null) return;
  try {
    await api.post(`/approvals/requests/${id}/action`, { action: act, comment });
  } catch (e) {
    alert(e.response?.data?.detail || e.message);
  }
}

/** Stage-gate approval requests — the admin queue and each approver's inbox. */
export function StageGateTable({ rows, onAction, empty = "No requests in this category" }) {
  return (
    <div className="tile overflow-x-auto">
      <table className="tbl">
        <thead><tr><th>Project</th><th>Target Stage</th><th>Rule</th><th>Approver</th><th>Status</th><th>Requested</th><th></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} data-testid={`approval-row-${r.id}`}>
              <td><div className="font-medium">{r.project_name}</div></td>
              <td><StatusBadge status={r.target_stage} /></td>
              <td>{r.rule_name}</td>
              <td className="text-xs">
                {r.approver_role && <span className="capitalize text-[var(--gold)]">{r.approver_role}</span>}
                {r.approver_emails?.length ? <div>{r.approver_emails.join(", ")}</div> : null}
              </td>
              <td><StatusBadge status={r.status} /></td>
              <td className="text-xs">{formatDateTime(r.requested_at)}<div className="text-[var(--muted)]">by {r.requested_by}</div></td>
              <td>
                {r.status === "Pending" && (
                  <div className="flex gap-1">
                    <button className="btn-primary text-xs flex items-center gap-1" onClick={() => onAction(r.id, "approve")} data-testid={`approve-${r.id}`}>
                      <Check size={12} weight="bold" /> Approve
                    </button>
                    <button className="btn-secondary text-xs flex items-center gap-1" onClick={() => onAction(r.id, "reject")} data-testid={`reject-${r.id}`}>
                      <X size={12} weight="bold" /> Reject
                    </button>
                  </div>
                )}
                {r.status !== "Pending" && r.actioned_by && (
                  <div className="text-xs text-[var(--muted)]">{r.actioned_by} · {formatDateTime(r.actioned_at)}</div>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={7} className="text-center py-12 text-[var(--muted)]">{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
