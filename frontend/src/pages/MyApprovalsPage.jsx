import React, { useState } from "react";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/common/Modal";
import CRReview from "@/components/CRReview";
import { StageGateTable, actionRequest } from "@/pages/ApprovalsPage";
import { useApprovalsInbox, refreshApprovals } from "@/lib/approvals";

const age = (iso) => {
  if (!iso) return "—";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d <= 0 ? "today" : `${d} day${d > 1 ? "s" : ""}`;
};

/** Everything waiting for the signed-in user's decision: project stage gates and change requests. */
export default function MyApprovalsPage({ openCr = null }) {
  const inbox = useApprovalsInbox();
  const [cr, setCr] = useState(openCr);
  return (
    <div data-testid="my-approvals-page">
      <PageHeader title="My approvals" subtitle="Stage gates and change requests waiting for your decision" breadcrumb="HOME · MY APPROVALS" />
      <div className="px-8 py-5 space-y-6">
        <section>
          <h3 className="text-[11px] tracking-overline text-[var(--muted)] mb-2">Change requests · {inbox.change_requests.length}</h3>
          <div className="tile overflow-x-auto">
            <table className="tbl" data-testid="my-approvals-crs">
              <thead><tr><th>CR</th><th>Customer</th><th>Airport</th><th className="num">PO value</th><th className="num">Margin</th><th>Status</th><th>Pending</th><th></th></tr></thead>
              <tbody>
                {inbox.change_requests.map((c) => (
                  <tr key={c.id} data-testid={`my-approval-cr-${c.id}`}>
                    <td><div className="font-medium">{c.cr_name}</div><div className="font-mono text-[10px] text-[var(--muted)]">{c.cr_number} · by {c.created_by_name || "—"}</div></td>
                    <td>{c.customer_name || "—"}</td>
                    <td>{c.airport_name || "—"}</td>
                    <td className="num">{Number(c.po_value || 0).toLocaleString("en-IN")}</td>
                    <td className="num" style={{ color: Number(c.estimated_margin_pct || 0) >= 25 ? "var(--success, #22c55e)" : "var(--danger)" }}>
                      {Number(c.estimated_margin_pct || 0).toFixed(1)} %
                    </td>
                    <td className="text-xs capitalize">{c.wbs_approved ? "Ready for decision" : "Awaiting WBS approval"}</td>
                    <td className="text-xs">{age(c.submitted_at || c.created_at)}</td>
                    <td><button className="btn-primary text-xs" onClick={() => setCr(c.id)} data-testid={`my-approval-open-${c.id}`}>Review</button></td>
                  </tr>
                ))}
                {inbox.loaded && !inbox.change_requests.length && <tr><td colSpan={8} className="text-center py-8 text-[var(--muted)]">No change requests waiting for you</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
        <section>
          <h3 className="text-[11px] tracking-overline text-[var(--muted)] mb-2">Project stage gates · {inbox.stage_gates.length}</h3>
          <StageGateTable rows={inbox.stage_gates} empty="No stage gates waiting for you"
                          onAction={(id, act) => actionRequest(id, act).then(refreshApprovals)} />
        </section>
      </div>
      {cr && (
        <Modal title="Change request" subtitle="REVIEW" size="lg" onClose={() => setCr(null)} testid="cr-review-modal">
          <CRReview id={cr} onDecided={() => { refreshApprovals(); }} />
        </Modal>
      )}
    </div>
  );
}
