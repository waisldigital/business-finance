import React from "react";

export function StatusBadge({ status }) {
  const map = {
    "Pending": "badge-pending",
    "Approved": "badge-approved",
    "Rejected": "badge-rejected",
    "Not Required": "badge-neutral",
    "Pipeline": "badge-neutral",
    "Deal P&L": "badge-gold",
    "Customer PO": "badge-gold",
    "Operations": "badge-approved",
    "Closure": "badge-neutral",
  };
  const cls = map[status] || "badge-neutral";
  return <span className={`badge ${cls}`} data-testid={`badge-${(status || "").replace(/[^a-zA-Z0-9]/g, "-").toLowerCase()}`}>{status || "—"}</span>;
}
