import React, { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { useAuth } from "@/lib/auth";
import { useCurrency } from "@/lib/currency";
import { formatMoney } from "@/aop/format";
import StatTile from "@/components/common/StatTile";
import { useNavigate } from "react-router-dom";
import {
  Plus, MagnifyingGlass, ArrowsClockwise, CheckCircle, Funnel,
  GitPullRequest, CurrencyInr, ChartPie, ListChecks, X,
  CaretDown, Eye, ShieldCheck, ClockCounterClockwise,
} from "@phosphor-icons/react";
import CRFormModal from "@/components/CRFormModal";
import CRReview, { canDecideCR } from "@/components/CRReview";
import Modal from "@/components/common/Modal";
import { refreshApprovals } from "@/lib/approvals";

const STATUS_CONFIG = {
  draft:         { bg: "rgba(148,163,184,0.18)", fg: "#94a3b8", label: "Draft",        icon: ClockCounterClockwise },
  submitted:     { bg: "rgba(59,130,246,0.18)",  fg: "#3b82f6", label: "Submitted",    icon: ArrowsClockwise },
  wbs_pending:   { bg: "rgba(234,179,8,0.18)",   fg: "#eab308", label: "WBS Pending",  icon: Eye },
  wbs_approved:  { bg: "rgba(34,197,94,0.18)",   fg: "#22c55e", label: "WBS Approved", icon: ShieldCheck },
  approved:      { bg: "rgba(34,197,94,0.24)",   fg: "#16a34a", label: "Approved",     icon: CheckCircle },
  rejected:      { bg: "rgba(239,68,68,0.18)",   fg: "#ef4444", label: "Rejected",     icon: X },
  completed:     { bg: "rgba(168,85,247,0.18)",  fg: "#a855f7", label: "Completed",    icon: ListChecks },
};

function CRStatusBadge({ status }) {
  const s = STATUS_CONFIG[status] || STATUS_CONFIG.draft;
  const Icon = s.icon;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] tracking-overline font-semibold" style={{ background: s.bg, color: s.fg }}>
      {Icon && <Icon size={10} weight="bold" />}
      {s.label}
    </span>
  );
}

function fmt(n) {
  if (!n && n !== 0) return "—";
  return Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export default function ChangeRequestsPage({ openId = null }) {
  const { user } = useAuth();
  const { unit } = useCurrency();
  const navigate = useNavigate();
  const isFinance = user?.role === "finance" || user?.role === "admin";
  const [rows, setRows] = useState([]);
  const [metrics, setMetrics] = useState({ total_count: 0, total_po_value: 0, total_cost: 0, total_margin_pct: 0 });
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [reviewing, setReviewing] = useState(openId);
  const [sortCol, setSortCol] = useState("created_at");
  const [sortDir, setSortDir] = useState(-1);
  useEffect(() => { setReviewing(openId); }, [openId]);

  const load = async () => {
    const params = {};
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    if (statusFilter) params.status = statusFilter;
    const [list, m] = await Promise.all([
      api.get("/change-requests", { params }),
      api.get("/change-requests/metrics", { params: { date_from: dateFrom || undefined, date_to: dateTo || undefined } }),
    ]);
    setRows(list.data || []);
    setMetrics(m.data || {});
  };

  useEffect(() => { load(); /* eslint-disable-line */ }, [dateFrom, dateTo, statusFilter]);

  const filtered = useMemo(() => {
    let out = rows;
    if (search) {
      const s = search.toLowerCase();
      out = out.filter((r) =>
        (r.cr_name || "").toLowerCase().includes(s) ||
        (r.cr_number || "").toLowerCase().includes(s) ||
        (r.customer_name || "").toLowerCase().includes(s) ||
        (r.wbs_element || "").toLowerCase().includes(s),
      );
    }
    out = [...out].sort((a, b) => {
      const va = a[sortCol], vb = b[sortCol];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "number") return (va - vb) * sortDir;
      return String(va).localeCompare(String(vb)) * sortDir;
    });
    return out;
  }, [search, rows, sortCol, sortDir]);

  const byStatus = useMemo(() => {
    const map = {};
    for (const r of rows) map[r.status] = (map[r.status] || 0) + 1;
    return map;
  }, [rows]);

  const approveWBS = async (r) => {
    if (!window.confirm(`Approve WBS ${r.wbs_element} for CR ${r.cr_number}?`)) return;
    try {
      await api.post(`/change-requests/${r.id}/approve-wbs`);
      load();
    } catch (e) {
      alert(e.response?.data?.detail || e.message);
    }
  };

  const toggleSort = (col) => {
    if (sortCol === col) setSortDir((d) => d * -1);
    else { setSortCol(col); setSortDir(1); }
  };
  const SortIcon = ({ col }) => {
    if (sortCol !== col) return null;
    return <CaretDown size={10} weight="bold" className={`inline ml-0.5 transition-transform ${sortDir < 0 ? "rotate-180" : ""}`} />;
  };

  return (
    <div data-testid="change-requests-page">
      <PageHeader
        title="Change Requests"
        subtitle="Customer-funded CRs · margin, approvers and WBS routing"
        breadcrumb="HOME · CHANGE REQUESTS"
        actions={
          <button className="btn-primary text-xs flex items-center gap-1" onClick={() => { setEditing(null); setShowForm(true); }} data-testid="cr-new-btn">
            <Plus size={12} /> New CR
          </button>
        }
      />

      <div className="px-8 py-6 space-y-4">
        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="cr-metric-chips">
          <StatTile label="Change Requests" value={metrics.total_count || 0} icon={GitPullRequest} testid="stat-cr-count" />
          <StatTile label="Total PO Value" value={formatMoney(metrics.total_po_value, unit)} icon={CurrencyInr} testid="stat-cr-po" />
          <StatTile label="Total Cost" value={formatMoney(metrics.total_cost, unit)} testid="stat-cr-cost" />
          <StatTile
            label="Avg Margin %"
            value={`${Number(metrics.total_margin_pct || 0).toFixed(1)}%`}
            accent={Number(metrics.total_margin_pct || 0) >= 25}
            danger={Number(metrics.total_margin_pct || 0) < 25}
            icon={ChartPie}
            testid="stat-cr-margin"
          />
        </div>

        {/* Status Pipeline */}
        <div className="tile p-4" data-testid="cr-status-pipeline">
          <div className="text-[10px] tracking-overline text-[var(--muted)] mb-3">Status Breakdown</div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setStatusFilter("")}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] border transition-all ${!statusFilter ? "border-[var(--gold)] text-[var(--gold)] font-semibold" : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"}`}
              data-testid="cr-filter-all"
            >
              All
              <span className="font-mono text-[10px]">{rows.length}</span>
            </button>
            {Object.entries(STATUS_CONFIG).map(([key, cfg]) => {
              const count = byStatus[key] || 0;
              if (!count) return null;
              const Icon = cfg.icon;
              return (
                <button
                  key={key}
                  onClick={() => setStatusFilter(statusFilter === key ? "" : key)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] border transition-all ${statusFilter === key ? "font-semibold" : "hover:opacity-100"}`}
                  style={{
                    background: statusFilter === key ? cfg.bg : "transparent",
                    borderColor: statusFilter === key ? cfg.fg : "var(--border)",
                    color: statusFilter === key ? cfg.fg : "var(--muted)",
                  }}
                  data-testid={`cr-filter-${key}`}
                >
                  {Icon && <Icon size={10} weight="bold" />}
                  {cfg.label}
                  <span className="font-mono text-[10px]">{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Search + Filters */}
        <div className="tile p-3 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[260px]">
            <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input
              className="input pl-9 h-9"
              placeholder="Search CR name, number, customer, WBS..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="cr-search"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] tracking-overline text-[var(--muted)]">Date</span>
            <input type="date" className="input h-9" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} data-testid="cr-date-from" />
            <span className="text-xs text-[var(--muted)]">to</span>
            <input type="date" className="input h-9" value={dateTo} onChange={(e) => setDateTo(e.target.value)} data-testid="cr-date-to" />
            {(dateFrom || dateTo) && (
              <button className="btn-ghost text-xs flex items-center gap-1" onClick={() => { setDateFrom(""); setDateTo(""); }}>
                <X size={10} /> Clear
              </button>
            )}
          </div>

          <div className="text-[11px] text-[var(--muted)] flex items-center gap-2 ml-auto">
            {filtered.length} record{filtered.length === 1 ? "" : "s"}
          </div>
        </div>

        {/* Table */}
        <div className="tile overflow-hidden">
          <table className="tbl" data-testid="cr-table">
            <thead>
              <tr>
                <th className="cursor-pointer select-none" onClick={() => toggleSort("cr_number")}>CR Number <SortIcon col="cr_number" /></th>
                <th className="cursor-pointer select-none" onClick={() => toggleSort("cr_name")}>Name <SortIcon col="cr_name" /></th>
                <th className="cursor-pointer select-none" onClick={() => toggleSort("customer_name")}>Customer <SortIcon col="customer_name" /></th>
                <th>Airport</th>
                <th>WBS</th>
                <th className="num cursor-pointer select-none" onClick={() => toggleSort("po_value")}>PO Value <SortIcon col="po_value" /></th>
                <th className="num cursor-pointer select-none" onClick={() => toggleSort("estimated_margin_pct")}>Margin % <SortIcon col="estimated_margin_pct" /></th>
                <th>Approver</th>
                <th className="cursor-pointer select-none" onClick={() => toggleSort("status")}>Status <SortIcon col="status" /></th>
                <th className="cursor-pointer select-none" onClick={() => toggleSort("created_at")}>Created <SortIcon col="created_at" /></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="cursor-pointer hover:bg-[var(--row-hover)]" onClick={() => navigate(`/app/change-requests/${r.id}`)} data-testid={`cr-row-${r.id}`}>
                  <td className="font-mono text-xs">{r.cr_number}</td>
                  <td>
                    <div className="font-medium">{r.cr_name}</div>
                    <div className="text-[10px] text-[var(--muted)]">by {r.created_by_name || "—"}</div>
                  </td>
                  <td>{r.customer_name || "—"}</td>
                  <td>{r.airport_name || "—"}</td>
                  <td className="font-mono text-xs">{r.wbs_element || "—"}</td>
                  <td className="num">{formatMoney(r.po_value, unit)}</td>
                  <td className="num" style={{ color: Number(r.estimated_margin_pct || 0) >= 25 ? "var(--success, #22c55e)" : "var(--danger)" }}>
                    {Number(r.estimated_margin_pct || 0).toFixed(1)}%
                  </td>
                  <td className="text-xs max-w-[160px] truncate" title={(r.approver_emails || []).join(", ")}>
                    {(r.approver_emails || []).join(", ") || (r.approver_role || "—")}
                  </td>
                  <td><CRStatusBadge status={r.status} /></td>
                  <td className="text-[11px] text-[var(--muted)]">{(r.created_at || "").slice(0, 10)}</td>
                  <td className="text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1 justify-end">
                      {!r.wbs_approved && r.status === "wbs_pending" && isFinance && (
                        <button
                          className="btn-ghost text-xs flex items-center gap-1"
                          onClick={() => approveWBS(r)}
                          data-testid={`cr-approve-wbs-${r.id}`}
                          title="Approve WBS code"
                        >
                          <CheckCircle size={14} weight="bold" /> WBS
                        </button>
                      )}
                      {canDecideCR(r, user) && (
                        <button className="btn-primary text-xs" onClick={() => setReviewing(r.id)} data-testid={`cr-review-${r.id}`}
                                title="Review and approve or reject">
                          Review
                        </button>
                      )}
                      {r.status === "draft" && (
                        <button
                          className="btn-ghost text-xs"
                          onClick={() => { setEditing(r); setShowForm(true); }}
                          data-testid={`cr-edit-${r.id}`}
                        >
                          Edit
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={11} className="text-center py-12 text-[var(--muted)]">
                  No change requests found. Click <span className="text-[var(--gold)]">New CR</span> to create one.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {reviewing && (
        <Modal title="Change request" subtitle="REVIEW" size="lg" onClose={() => setReviewing(null)} testid="cr-review-modal">
          <CRReview id={reviewing} onDecided={() => { load(); refreshApprovals(); }} />
        </Modal>
      )}
      {showForm && (
        <CRFormModal
          existing={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); load(); }}
        />
      )}
    </div>
  );
}
