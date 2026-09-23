import React, { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { useAuth } from "@/lib/auth";
import { Plus, MagnifyingGlass, ArrowsClockwise, CheckCircle, Funnel } from "@phosphor-icons/react";
import CRFormModal from "@/components/CRFormModal";

const STATUS_COLORS = {
  draft:         { bg: "rgba(148,163,184,0.18)", fg: "#94a3b8", label: "Draft" },
  submitted:     { bg: "rgba(59,130,246,0.18)",  fg: "#3b82f6", label: "Submitted" },
  wbs_pending:   { bg: "rgba(234,179,8,0.18)",   fg: "#eab308", label: "WBS Pending" },
  wbs_approved:  { bg: "rgba(34,197,94,0.18)",   fg: "#22c55e", label: "WBS Approved" },
  approved:      { bg: "rgba(34,197,94,0.24)",   fg: "#16a34a", label: "Approved" },
  rejected:      { bg: "rgba(239,68,68,0.18)",   fg: "#ef4444", label: "Rejected" },
  completed:     { bg: "rgba(168,85,247,0.18)",  fg: "#a855f7", label: "Completed" },
};

function CRStatusBadge({ status }) {
  const s = STATUS_COLORS[status] || STATUS_COLORS.draft;
  return (
    <span className="px-2 py-0.5 text-[10px] tracking-overline font-semibold" style={{ background: s.bg, color: s.fg }}>
      {s.label}
    </span>
  );
}

function fmt(n) {
  if (!n && n !== 0) return "—";
  return Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export default function ChangeRequestsPage() {
  const { user } = useAuth();
  const isFinance = user?.role === "finance" || user?.role === "admin";
  const [rows, setRows] = useState([]);
  const [metrics, setMetrics] = useState({ total_count: 0, total_po_value: 0, total_cost: 0, total_margin_pct: 0 });
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

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
    if (!search) return rows;
    const s = search.toLowerCase();
    return rows.filter((r) =>
      (r.cr_name || "").toLowerCase().includes(s) ||
      (r.cr_number || "").toLowerCase().includes(s) ||
      (r.customer_name || "").toLowerCase().includes(s) ||
      (r.wbs_element || "").toLowerCase().includes(s),
    );
  }, [search, rows]);

  const approveWBS = async (r) => {
    if (!window.confirm(`Approve WBS ${r.wbs_element} for CR ${r.cr_number}?`)) return;
    try {
      await api.post(`/change-requests/${r.id}/approve-wbs`);
      load();
    } catch (e) {
      alert(e.response?.data?.detail || e.message);
    }
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

      <div className="px-8 py-6 space-y-5">
        {/* Metric Chips */}
        <div className="grid grid-cols-4 gap-3" data-testid="cr-metric-chips">
          <Metric label="# Change Requests" value={metrics.total_count || 0} />
          <Metric label="Total PO Value" value={fmt(metrics.total_po_value)} />
          <Metric label="Total Cost" value={fmt(metrics.total_cost)} />
          <Metric
            label="Avg Margin %"
            value={`${Number(metrics.total_margin_pct || 0).toFixed(2)} %`}
            tone={Number(metrics.total_margin_pct || 0) >= 25 ? "success" : "danger"}
          />
        </div>

        {/* Search + Filters */}
        <div className="tile p-3 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[260px]">
            <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input
              className="input pl-9 h-9"
              placeholder="Search CR name, number, customer, WBS…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="cr-search"
            />
          </div>

          <div className="flex items-center gap-2">
            <Funnel size={12} className="text-[var(--muted)]" />
            <select className="input h-9" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} data-testid="cr-status-filter">
              <option value="">All statuses</option>
              {Object.entries(STATUS_COLORS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] tracking-overline text-[var(--muted)]">Date</span>
            <input type="date" className="input h-9" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} data-testid="cr-date-from" />
            <span className="text-xs text-[var(--muted)]">→</span>
            <input type="date" className="input h-9" value={dateTo} onChange={(e) => setDateTo(e.target.value)} data-testid="cr-date-to" />
            {(dateFrom || dateTo) && (
              <button className="btn-ghost text-xs" onClick={() => { setDateFrom(""); setDateTo(""); }}>Clear</button>
            )}
          </div>

          <div className="text-[11px] text-[var(--muted)] flex items-center gap-2 ml-auto">
            <ArrowsClockwise size={14} /> {filtered.length} record{filtered.length === 1 ? "" : "s"}
          </div>
        </div>

        {/* Table */}
        <div className="tile overflow-hidden">
          <table className="tbl" data-testid="cr-table">
            <thead>
              <tr>
                <th>CR Number</th>
                <th>Name</th>
                <th>Customer</th>
                <th>Airport</th>
                <th>WBS</th>
                <th className="num">PO Value</th>
                <th className="num">Margin %</th>
                <th>Approver</th>
                <th>Status</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} data-testid={`cr-row-${r.id}`}>
                  <td className="font-mono text-xs">{r.cr_number}</td>
                  <td>
                    <div className="font-medium">{r.cr_name}</div>
                    <div className="text-[10px] text-[var(--muted)]">by {r.created_by_name || "—"}</div>
                  </td>
                  <td>{r.customer_name || "—"}</td>
                  <td>{r.airport_name || "—"}</td>
                  <td className="font-mono text-xs">{r.wbs_element || "—"}</td>
                  <td className="num">{fmt(r.po_value)}</td>
                  <td className="num" style={{ color: Number(r.estimated_margin_pct || 0) >= 25 ? "var(--success, #22c55e)" : "var(--danger)" }}>
                    {Number(r.estimated_margin_pct || 0).toFixed(2)} %
                  </td>
                  <td className="text-xs">{(r.approver_emails || []).join(", ") || (r.approver_role || "—")}</td>
                  <td><CRStatusBadge status={r.status} /></td>
                  <td className="text-[11px] text-[var(--muted)]">{(r.created_at || "").slice(0, 10)}</td>
                  <td className="text-right">
                    {!r.wbs_approved && r.status === "wbs_pending" && isFinance && (
                      <button
                        className="btn-ghost text-xs flex items-center gap-1"
                        onClick={() => approveWBS(r)}
                        data-testid={`cr-approve-wbs-${r.id}`}
                        title="Approve WBS code"
                      >
                        <CheckCircle size={14} weight="bold" /> Approve WBS
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
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={11} className="text-center py-12 text-[var(--muted)]">
                  No change requests yet. Click <span className="text-[var(--gold)]">New CR</span> to create one.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

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

function Metric({ label, value, tone }) {
  const color = tone === "success" ? "var(--success, #22c55e)" : tone === "danger" ? "var(--danger)" : "var(--gold)";
  return (
    <div className="tile p-3">
      <div className="text-[10px] tracking-overline text-[var(--muted)]">{label}</div>
      <div className="text-xl font-display font-bold mt-1" style={{ color }}>{value}</div>
    </div>
  );
}
