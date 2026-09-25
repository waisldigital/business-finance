import React from "react";
import { useParams, Link } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { usePermissions } from "@/lib/permissions";
import PageHeader from "@/components/PageHeader";
import CRReview from "@/components/CRReview";
import ChangeRequestsPage from "@/pages/ChangeRequestsPage";
import { refreshApprovals } from "@/lib/approvals";

/**
 * /app/change-requests/:id — where CR notifications point. Users with the Change Requests section get the CR list
 * with this CR open; approvers without it (and admins) get the CR on its own page.
 */
export default function CRLinkPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const { permissions } = usePermissions();
  if (user?.role !== "admin" && permissions?.change_requests?.can_view) return <ChangeRequestsPage openId={id} />;
  return (
    <div data-testid="cr-link-page">
      <PageHeader title="Change request" subtitle="Review and decide" breadcrumb="HOME · CHANGE REQUEST" />
      <div className="px-8 py-5">
        <div className="tile !p-0"><CRReview id={id} onDecided={refreshApprovals} /></div>
        <Link to={user?.role === "admin" ? "/admin" : "/app/approvals"} className="text-xs text-[var(--gold)] underline mt-3 inline-block">Back</Link>
      </div>
    </div>
  );
}
