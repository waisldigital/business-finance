import React, { useEffect, useState } from "react";
import api, { formatApiErrorDetail } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { useCurrency } from "@/lib/currency";
import { formatCurrency, formatDate } from "@/lib/format";
import { Plus, MagnifyingGlass, PencilSimple, CheckCircle, XCircle, Trophy, HourglassMedium, Warning } from "@phosphor-icons/react";
import { useAuth } from "@/lib/auth";
import PipelineWizardModal, { PIPELINE_STAGES } from "@/components/PipelineWizardModal";
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell, CartesianGrid,
} from "recharts";

function stageChipClass(stage) {
  return {
    "Prospecting": "pipe-prospecting",
    "Active Discussion": "pipe-active",
    "Proposal Submitted": "pipe-proposal",
    "Evaluation/Negotiation": "pipe-negotiation",
    "Closed": "pipe-closed",
  }[stage] || "badge-neutral";
}

function outcomeChipClass(outcome) {
  return outcome === "Won" ? "pipe-won" : outcome === "Lost" ? "pipe-lost" : outcome === "Deferred" ? "badge-pending" : "badge-neutral";
}

function handoffChipClass(status) {
  return {
    "Not Applicable": "badge-neutral",
    "Pending Finance": "badge-pending",
    "Approved": "badge-approved",
    "Rejected": "badge-rejected",
  }[status] || "badge-neutral";
}

function mgmtFlagClass(cat) {
  return cat === "GMR" ? "flag-gmr" : cat === "Non-GMR" ? "flag-non-gmr" : "badge-neutral";
}

function priorityFlagClass(p) {
  return { High: "flag-high", Medium: "flag-medium", Low: "flag-low" }[p] || "flag-medium";
}

const COLORS = ["#E07A3C", "#FFC000", "#5C2B84", "#3D8B7A", "#7B3F00"];

export default function PipelinePage() {
  const { user } = useAuth();
  const { mode, inrPerUsd } = useCurrency();
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [stage, setStage] = useState("");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(null);
  const [closing, setClosing] = useState(null);
  const [approving, setApproving] = useState(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [err, setErr] = useState("");

  const canApprove = user && (user.role === "finance" || user.role === "admin");

  const matchesDate = (r) => {
    const d = (r.updated_at || r.created_at || "").slice(0, 10);
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  };

  const filteredRows = rows.filter(matchesDate);

  const load = async () => {
    const params = {};
    if (stage) params.stage = stage;
    if (search) params.search = search;
    const [r1, r2] = await Promise.all([
      api.get("/pipeline", { params }),
      api.get("/pipeline/summary"),
    ]);
    setRows(r1.data);
    setSummary(r2.data);
  };

  useEffect(() => {
    api.get("/customers").then((r) => setCustomers(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    load(); // eslint-disable-next-line
  }, [stage]);

  return (
    <div data-testid="pipeline-page">
      <PageHeader
        title="Pipeline"
        subtitle="Opportunity funnel — 5 stage progression with finance-approved handoff"
        breadcrumb="HOME · PIPELINE"
        actions={
          <button className="btn-primary flex items-center gap-2" onClick={() => setShowCreate(true)} data-testid="new-pipeline-btn">
            <Plus size={14} weight="bold" /> New Opportunity
          </button>
        }
      />

      <div className="px-8 py-6 space-y-5">
        {/* Summary KPI */}
        {summary && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard label="Open Opportunities" value={summary.total_opportunities} icon={<Trophy size={16} weight="duotone" className="text-[var(--gold)]" />} />
            <KpiCard label="Total Pipeline Value" value={formatCurrency(summary.total_value, mode, inrPerUsd)} />
            <KpiCard label="Won Value" value={formatCurrency(summary.won_value, mode, inrPerUsd)} accent />
            <KpiCard label="Awaiting Finance Handoff" value={summary.pending_handoff} icon={<HourglassMedium size={16} weight="duotone" className="text-[var(--warning)]" />} danger={summary.pending_handoff > 0} />
          </div>
        )}

        {/* Funnel chart */}
        {summary?.funnel && (
          <div className="tile p-5" data-testid="pipeline-funnel">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-[10px] tracking-overline text-[var(--muted)]">Pipeline Funnel</div>
                <div className="font-display text-lg font-bold">Count and Value by Stage</div>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={summary.funnel} layout="vertical" margin={{ top: 4, left: 8, right: 24 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="var(--border-soft)" horizontal={false} />
                <XAxis type="number" stroke="var(--muted)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="stage" width={160} stroke="var(--muted)" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip
                  formatter={(v, n) => n === "count" ? [v, "Count"] : [formatCurrency(v, mode, inrPerUsd), "Value"]}
                  contentStyle={{ borderRadius: 4, border: "1px solid var(--border)", background: "var(--surface)", fontSize: 12 }}
                  cursor={{ fill: "var(--surface-2)" }}
                />
                <Bar dataKey="count" radius={[0, 4, 4, 0]} label={{ position: "right", fill: "var(--text)", fontSize: 11, fontWeight: 600 }}>
                  {summary.funnel.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Filters */}
        <div className="tile p-4 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[240px]">
            <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input
              className="input pl-9"
              placeholder="Search opportunity, customer, BD owner…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && load()}
              data-testid="pipeline-search"
            />
          </div>
          <button
            className={`btn-ghost border ${!stage ? "text-[var(--gold)] border-[var(--gold)]" : ""}`}
            onClick={() => setStage("")}
            data-testid="pipeline-filter-all"
          >
            All
          </button>
          {PIPELINE_STAGES.map((s) => (
            <button
              key={s.key}
              className={`btn-ghost border ${stage === s.key ? "text-[var(--gold)] border-[var(--gold)]" : ""}`}
              onClick={() => setStage(s.key)}
              data-testid={`pipeline-filter-${s.key.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
            >
              {s.key}
            </button>
          ))}
          <button className="btn-secondary" onClick={load} data-testid="pipeline-search-btn">Search</button>
        </div>

        {/* Date range filter */}
        <div className="tile p-3 flex flex-wrap items-center gap-3" data-testid="pipeline-date-filter">
          <div className="text-[10px] tracking-overline text-[var(--muted)]">Date Range</div>
          <input type="date" className="input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} data-testid="pipeline-date-from" />
          <span className="text-xs text-[var(--muted)]">to</span>
          <input type="date" className="input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} data-testid="pipeline-date-to" />
          {(dateFrom || dateTo) && (
            <button className="btn-ghost text-xs" onClick={() => { setDateFrom(""); setDateTo(""); }} data-testid="pipeline-date-clear">Clear</button>
          )}
          <span className="ml-auto text-[11px] text-[var(--muted)]">{filteredRows.length} of {rows.length} shown</span>
        </div>

        {err && <div className="text-xs text-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] p-2 border border-[var(--danger)]">{err}</div>}

        {/* Table */}
        <div className="tile overflow-hidden">
          <table className="tbl" data-testid="pipeline-table">
            <thead>
              <tr>
                <th>Opportunity</th>
                <th>Customer</th>
                <th>Stage</th>
                <th>Flags</th>
                <th className="num">Expected</th>
                <th className="num">Negotiated</th>
                <th>Outcome</th>
                <th>Finance Handoff</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => (
                <tr key={r.id} data-testid={`pipeline-row-${r.id}`}>
                  <td>
                    <div className="font-medium text-[var(--text)]">{r.opportunity_title}</div>
                    <div className="text-[11px] text-[var(--muted)]">
                      {r.opportunity_id && <span className="font-mono mr-2">{r.opportunity_id}</span>}
                      {r.bd_owner || ""}
                    </div>
                  </td>
                  <td>{r.customer_name || "—"}</td>
                  <td><span className={`badge ${stageChipClass(r.current_stage)}`} data-testid={`pipeline-stage-${r.id}`}>{r.current_stage}</span></td>
                  <td className="space-x-1 space-y-1">
                    <span className={`badge ${mgmtFlagClass(r.business_category)}`}>{r.business_category}</span>
                    <span className={`badge ${priorityFlagClass(r.priority)}`}>{r.priority}</span>
                    {r.strategic_deal && <span className="badge flag-high" title="Strategic Deal">STRATEGIC</span>}
                    {r.md_review_required && <span className="badge flag-low-margin" title="MD Review">MD</span>}
                    {r.cfo_review_required && <span className="badge flag-low-margin" title="CFO Review">CFO</span>}
                    {r.ceo_visibility && <span className="badge flag-low-margin" title="CEO Visibility">CEO</span>}
                    {r.opportunity_category === "Change Request" && <span className="badge badge-neutral" title="Change Request">CR</span>}
                  </td>
                  <td className="num">{formatCurrency(r.expected_revenue, mode, inrPerUsd)}</td>
                  <td className="num">{formatCurrency(r.negotiated_value || r.proposal_value, mode, inrPerUsd)}</td>
                  <td><span className={`badge ${outcomeChipClass(r.outcome)}`}>{r.outcome}</span></td>
                  <td>
                    <div className="flex items-center gap-2">
                      <span className={`badge ${handoffChipClass(r.handoff_status)}`} data-testid={`handoff-status-${r.id}`}>
                        {r.handoff_status}
                      </span>
                      {canApprove && r.handoff_status === "Pending Finance" && (
                        <button
                          className="btn-primary text-[10px] flex items-center gap-1 px-2 py-1"
                          onClick={() => setApproving(r)}
                          data-testid={`approve-handoff-${r.id}`}
                        >
                          <CheckCircle size={10} weight="bold" /> Review
                        </button>
                      )}
                      {r.handoff_status === "Approved" && r.handoff_project_id && (
                        <a
                          href={r.opportunity_category === "Change Request" ? `/change-requests` : `/projects/${r.handoff_project_id}`}
                          className="text-[10px] text-[var(--gold)] underline"
                          data-testid={`handoff-project-${r.id}`}
                        >
                          {r.opportunity_category === "Change Request" ? "view CR →" : "view project →"}
                        </a>
                      )}
                    </div>
                  </td>
                  <td className="text-right whitespace-nowrap">
                    <button className="btn-ghost" title="Edit" onClick={() => setEditing(r)} data-testid={`pipeline-edit-${r.id}`}>
                      <PencilSimple size={16} weight="duotone" className="text-[var(--gold)]" />
                    </button>
                    {r.outcome === "Open" && r.current_stage !== "Closed" && (
                      <button
                        className="btn-secondary text-[10px] ml-1"
                        onClick={() => setClosing(r)}
                        data-testid={`pipeline-close-${r.id}`}
                      >
                        Close Deal
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {filteredRows.length === 0 && (
                <tr><td colSpan={9} className="text-center py-12 text-[var(--muted)]">No opportunities yet — click <span className="text-[var(--gold)] font-semibold">New Opportunity</span></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showCreate && (
        <PipelineWizardModal customers={customers} onClose={() => setShowCreate(false)} onSaved={() => { setShowCreate(false); load(); }} />
      )}
      {editing && (
        <PipelineWizardModal opportunity={editing} customers={customers} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
      {closing && (
        <CloseDealModal
          opportunity={closing}
          onClose={() => setClosing(null)}
          onClosed={() => { setClosing(null); load(); }}
          onError={setErr}
        />
      )}
      {approving && (
        <ApproveHandoffModal
          opportunity={approving}
          onClose={() => setApproving(null)}
          onActioned={() => { setApproving(null); load(); }}
          onError={setErr}
        />
      )}
    </div>
  );
}

function KpiCard({ label, value, sub, icon, accent, danger }) {
  return (
    <div className="tile p-4">
      <div className="flex items-start justify-between">
        <div className="text-[10px] tracking-overline text-[var(--muted)]">{label}</div>
        {icon}
      </div>
      <div className={`font-mono font-semibold text-2xl mt-1 ${accent ? "text-[var(--gold)]" : danger ? "text-[var(--danger)]" : ""}`}>{value}</div>
      {sub && <div className="text-[11px] text-[var(--muted)] mt-1">{sub}</div>}
    </div>
  );
}

function CloseDealModal({ opportunity, onClose, onClosed, onError }) {
  const [outcome, setOutcome] = useState("Won");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const p = new URLSearchParams({ outcome, reason: reason || "" });
      await api.post(`/pipeline/${opportunity.id}/close?${p}`);
      onClosed();
    } catch (e) {
      onError(formatApiErrorDetail(e.response?.data?.detail) || e.message);
      onClose();
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4" data-testid="close-deal-modal">
      <div className="bg-[var(--surface)] w-full max-w-md border border-[var(--border)]">
        <div className="p-5 border-b border-[var(--border)]">
          <div className="text-[10px] tracking-overline text-[var(--muted)]">CLOSE OPPORTUNITY</div>
          <h3 className="font-display text-lg font-bold">{opportunity.opportunity_title}</h3>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="block text-[10px] tracking-overline text-[var(--muted)] mb-1.5">Outcome <span className="text-[var(--gold)]">*</span></label>
            <select className="input" value={outcome} onChange={(e) => setOutcome(e.target.value)} data-testid="close-outcome">
              <option value="Won">Won</option>
              <option value="Lost">Lost</option>
              <option value="Deferred">Deferred / Dropped</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] tracking-overline text-[var(--muted)] mb-1.5">Reason / Notes</label>
            <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="close-reason" />
          </div>
          {outcome === "Won" && (
            <div className="text-[11px] text-[var(--warning)] flex items-start gap-1 bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] p-2 border border-[color-mix(in_srgb,var(--warning)_35%,transparent)]">
              <Warning size={12} weight="bold" /> A Project will be auto-created after Finance approves the handoff.
            </div>
          )}
        </div>
        <div className="p-5 border-t border-[var(--border)] flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={busy} data-testid="close-deal-submit">
            {busy ? "Closing…" : `Close as ${outcome}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function ApproveHandoffModal({ opportunity, onClose, onActioned, onError }) {
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  const act = async (action) => {
    setBusy(true);
    try {
      await api.post(`/pipeline/${opportunity.id}/approve-handoff`, { action, comment });
      onActioned();
    } catch (e) {
      onError(formatApiErrorDetail(e.response?.data?.detail) || e.message);
      onClose();
    } finally { setBusy(false); }
  };

  const val = opportunity.negotiated_value || opportunity.proposal_value || opportunity.expected_revenue || 0;

  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4" data-testid="approve-handoff-modal">
      <div className="bg-[var(--surface)] w-full max-w-md border border-[var(--border)]">
        <div className="p-5 border-b border-[var(--border)]">
          <div className="text-[10px] tracking-overline text-[var(--muted)]">FINANCE HANDOFF REVIEW</div>
          <h3 className="font-display text-lg font-bold">{opportunity.opportunity_title}</h3>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <Info k="Customer" v={opportunity.customer_name || "—"} />
            <Info k="BD Owner" v={opportunity.bd_owner || "—"} />
            <Info k="Deal Value" v={`₹ ${val.toLocaleString()}`} />
            <Info k="Margin %" v={`${(opportunity.estimated_margin_pct || 0).toFixed(1)}%`} />
          </div>
          <div>
            <label className="block text-[10px] tracking-overline text-[var(--muted)] mb-1.5">Approver Comment</label>
            <textarea className="input" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} data-testid="handoff-comment" />
          </div>
          <div className="text-[11px] text-[var(--muted)]">
            Approving will create a new <span className="text-[var(--text)] font-semibold">Project</span> stub using this opportunity's data.
          </div>
        </div>
        <div className="p-5 border-t border-[var(--border)] flex justify-between gap-2">
          <button className="btn-secondary flex items-center gap-1" onClick={() => act("reject")} disabled={busy} data-testid="handoff-reject">
            <XCircle size={12} weight="bold" /> Reject
          </button>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary flex items-center gap-1" onClick={() => act("approve")} disabled={busy} data-testid="handoff-approve">
              <CheckCircle size={12} weight="bold" /> Approve & Create Project
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Info({ k, v }) {
  return (
    <div>
      <div className="text-[9px] tracking-overline text-[var(--muted)]">{k}</div>
      <div className="font-medium text-[var(--text)]">{v}</div>
    </div>
  );
}
