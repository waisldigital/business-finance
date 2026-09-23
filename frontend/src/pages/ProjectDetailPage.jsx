import React, { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api, { formatApiErrorDetail } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import StageTracker, { STAGES } from "@/components/StageTracker";
import { StatusBadge } from "@/components/StatusBadge";
import { useCurrency } from "@/lib/currency";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { ArrowLeft, ArrowRight, Plus, Trash, PencilSimple, X, UploadSimple, FileXls, ArrowCounterClockwise, AirplaneTakeoff } from "@phosphor-icons/react";
import ProjectFormModal from "@/components/ProjectFormModal";
import AirplaneButton from "@/components/AirplaneButton";
import { useAuth } from "@/lib/auth";

const TABS = ["Overview", "Revenue", "Cost", "Milestones", "Documents", "Queries", "Audit"];

export default function ProjectDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { mode, inrPerUsd } = useCurrency();
  const { user } = useAuth();

  const [project, setProject] = useState(null);
  const [tab, setTab] = useState("Overview");
  const [revenue, setRevenue] = useState([]);
  const [cost, setCost] = useState([]);
  const [audit, setAudit] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [customers, setCustomers] = useState([]);

  const load = async () => {
    const { data } = await api.get(`/projects/${id}`);
    setProject(data);
    const [r, c, a] = await Promise.all([
      api.get(`/projects/${id}/revenue`),
      api.get(`/projects/${id}/cost`),
      api.get(`/audit?entity_id=${id}&entity_type=project`),
    ]);
    setRevenue(r.data); setCost(c.data); setAudit(a.data);
  };

  useEffect(() => {
    load();
    api.get("/customers").then((r) => setCustomers(r.data)).catch(() => {});
  }, [id]); // eslint-disable-line

  if (!project) return <div className="p-8">Loading…</div>;

  const advance = async (target) => {
    setError(""); setBusy(true);
    try {
      const reason = window.prompt(`Reason for moving to "${target}"? (optional)`) || "";
      const { data } = await api.post(`/projects/${project.id}/transition`, { target_stage: target, reason });
      setProject(data);
      load();
    } catch (e) {
      setError(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally { setBusy(false); }
  };

  const idx = STAGES.indexOf(project.current_stage);
  const nextStage = idx >= 0 && idx < STAGES.length - 1 ? STAGES[idx + 1] : null;
  const prevStage = idx > 0 ? STAGES[idx - 1] : null;
  const isAdmin = user?.role === "admin";

  const onDelete = async () => {
    if (!window.confirm(`Permanently delete project "${project.project_name}"? This will also remove its revenue, cost lines and cannot be undone.`)) return;
    setBusy(true); setError("");
    try {
      await api.delete(`/projects/${project.id}`);
      navigate("/projects");
    } catch (e) {
      setError(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally { setBusy(false); }
  };

  return (
    <div data-testid="project-detail-page">
      <PageHeader
        title={project.project_name}
        subtitle={`${project.wbs_element || ""}  ·  ${project.customer_name || ""}`}
        breadcrumb={<><button onClick={() => navigate("/projects")} className="hover:text-[var(--gold)] inline-flex items-center gap-1"><ArrowLeft size={11} /> ALL PROJECTS</button> · {project.current_stage.toUpperCase()}</>}
        watermark
        actions={
          <div className="flex items-center gap-2">
            {prevStage && (
              <button className="btn-secondary text-xs" onClick={() => advance(prevStage)} disabled={busy} data-testid="rewind-stage-btn">
                ← Send back to {prevStage}
              </button>
            )}
            {nextStage && (
              <AirplaneButton
                className="text-xs"
                onClick={() => advance(nextStage)}
                disabled={busy}
                testid="advance-stage-btn"
              >
                Advance to {nextStage}
              </AirplaneButton>
            )}
            <button className="btn-secondary text-xs flex items-center gap-1" onClick={() => setShowEdit(true)} data-testid="edit-project-btn">
              <PencilSimple size={12} /> Edit
            </button>
            {isAdmin && (
              <button className="btn-secondary text-xs flex items-center gap-1 !text-[var(--danger)] !border-[color-mix(in_srgb,var(--danger)_40%,transparent)] hover:!bg-[color-mix(in_srgb,var(--danger)_12%,transparent)]" onClick={onDelete} disabled={busy} data-testid="delete-project-btn">
                <Trash size={12} /> Delete
              </button>
            )}
          </div>
        }
      />

      {/* Stage tracker */}
      <div className="px-8 py-4 border-b border-[var(--border)] bg-[var(--surface)]">
        <StageTracker current={project.current_stage} />
        {error && <div className="text-xs text-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] p-2 mt-3 border border-[color-mix(in_srgb,var(--danger)_30%,transparent)]">{error}</div>}
      </div>

      {/* Quick stats */}
      <div className="px-8 py-5 grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label="PO Value" value={formatCurrency(project.po_value, mode, inrPerUsd)} />
        <Stat label="Revenue" value={formatCurrency(project.revenue_total, mode, inrPerUsd)} onClick={() => setTab("Revenue")} testid="stat-revenue" />
        <Stat label="Cost" value={formatCurrency(project.cost_total, mode, inrPerUsd)} onClick={() => setTab("Cost")} testid="stat-cost" />
        <Stat label="Margin" value={formatCurrency(project.margin_total, mode, inrPerUsd)} accent />
        <Stat label="Deal Margin %" value={`${(project.margin_pct || 0).toFixed(1)}%`} accent={project.margin_pct >= 15} danger={project.margin_pct < 15} />
      </div>

      {/* Tabs */}
      <div className="px-8 border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-3 text-sm font-medium border-b-2 ${tab === t ? "border-[var(--gold)] text-[var(--gold)]" : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"}`}
              data-testid={`tab-${t.toLowerCase()}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="px-8 py-6">
        {tab === "Overview" && <Overview project={project} />}
        {tab === "Revenue" && <RevenueTab projectId={id} rows={revenue} reload={load} mode={mode} inrPerUsd={inrPerUsd} project={project} />}
        {tab === "Cost" && <CostTab projectId={id} rows={cost} reload={load} mode={mode} inrPerUsd={inrPerUsd} project={project} />}
        {tab === "Milestones" && <Milestones project={project} mode={mode} inrPerUsd={inrPerUsd} />}
        {tab === "Documents" && <DocumentsTab projectId={id} reload={load} />}
        {tab === "Queries" && <QueriesTab projectId={id} />}
        {tab === "Audit" && <AuditTab rows={audit} />}
      </div>

      {showEdit && (
        <ProjectFormModal
          project={project}
          customers={customers}
          onClose={() => setShowEdit(false)}
          onSaved={() => { setShowEdit(false); load(); }}
        />
      )}
    </div>
  );
}

function Stat({ label, value, accent, danger, onClick, testid }) {
  const clickable = !!onClick;
  return (
    <div
      className={`tile p-4 ${clickable ? "cursor-pointer transition-all hover:border-[var(--gold)] hover:translate-y-[-1px]" : ""}`}
      onClick={onClick}
      data-testid={testid}
    >
      <div className="text-[10px] tracking-overline text-[var(--muted)] flex items-center gap-1">
        {label}
        {clickable && <ArrowRight size={10} weight="bold" className="text-[var(--gold)] opacity-70" />}
      </div>
      <div className={`font-mono font-semibold text-xl mt-1 ${accent ? "text-[var(--gold)]" : danger ? "text-[var(--danger)]" : "text-[var(--text)]"}`}>{value}</div>
    </div>
  );
}

function Overview({ project }) {
  const [pipeline, setPipeline] = React.useState(null);
  React.useEffect(() => {
    if (!project.pipeline_id) return;
    api.get(`/pipeline/${project.pipeline_id}`).then((r) => setPipeline(r.data)).catch(() => {});
  }, [project.pipeline_id]);

  const fields = [
    ["Customer", project.customer_name],
    ["Customer PO Number", project.customer_po_number],
    ["PO Date", formatDate(project.po_date)],
    ["Start Date", formatDate(project.start_date)],
    ["End Date", formatDate(project.end_date)],
    ["Billing Type", project.billing_type],
    ["Currency", project.currency],
    ["Country", project.country],
    ["P&L Location", project.pnl_location],
    ["P&L Region", project.pnl_region],
    ["Business Category", project.business_category],
    ["Project Grouping", project.project_grouping],
    ["Location", project.location],
    ["Ownership Email", project.ownership_email],
    ["Finance SPOC", project.finance_spoc_email],
    ["Approval Status", <StatusBadge key="a" status={project.approval_status} />],
    ["Created By", project.created_by],
    ["Updated At", formatDateTime(project.updated_at)],
  ];
  const mgmtFlags = [
    ["MD Review Required", project.md_review_required],
    ["CFO Review Required", project.cfo_review_required],
    ["CEO Visibility", project.ceo_visibility],
    ["Strategic Deal", project.strategic_deal],
  ].filter(([_, v]) => !!v);

  return (
    <div className="space-y-6">
      {pipeline && (
        <div className="tile p-5" data-testid="overview-pipeline-origin">
          <div className="text-[10px] tracking-overline text-[var(--muted)] mb-2">Pipeline Origin</div>
          <div className="font-display text-lg font-bold">{pipeline.opportunity_title}</div>
          <div className="text-[11px] text-[var(--muted)] font-mono">{pipeline.opportunity_id}</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-3 text-xs">
            <Info k="Solution Line" v={pipeline.solution_line} />
            <Info k="Opportunity Type" v={pipeline.opportunity_type} />
            <Info k="Lead Source" v={pipeline.lead_source} />
            <Info k="BD Owner" v={pipeline.bd_owner} />
            <Info k="Decision Maker" v={pipeline.decision_maker_name} />
            <Info k="Customer Budget Approved" v={pipeline.customer_budget_approved ? "Yes" : "No"} />
            <Info k="Final Commercial Value" v={(pipeline.final_commercial_value || 0).toLocaleString()} />
            <Info k="Forecast Category" v={pipeline.forecast_category} />
            <Info k="Probability %" v={`${(pipeline.probability_pct || 0).toFixed(0)}%`} />
            <Info k="Expected Closure" v={pipeline.expected_closure_date} />
            <Info k="Won Against" v={pipeline.won_against_competitor} />
            <Info k="Customer PO" v={pipeline.customer_po_number} />
          </div>
          <a href="/pipeline" className="text-[11px] text-[var(--gold)] underline mt-3 inline-block">View pipeline →</a>
        </div>
      )}

      {mgmtFlags.length > 0 && (
        <div className="tile p-4" data-testid="overview-mgmt-flags">
          <div className="text-[10px] tracking-overline text-[var(--muted)] mb-2">Management Review Flags</div>
          <div className="flex flex-wrap gap-2">
            {mgmtFlags.map(([k]) => (
              <span key={k} className="badge flag-low-margin">{k}</span>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-4">
        {fields.map(([k, v]) => (
          <div key={k} className="flex justify-between border-b border-[var(--border)] pb-2">
            <span className="text-xs text-[var(--muted)] tracking-overline">{k}</span>
            <span className="text-sm font-medium text-[var(--text)]">{v || "—"}</span>
          </div>
        ))}
        {(project.description || project.baseline_remarks || project.finance_remarks) && (
          <div className="md:col-span-2 mt-4 grid md:grid-cols-3 gap-4">
            <div className="tile p-4"><div className="text-[10px] tracking-overline text-[var(--muted)] mb-1">Description</div><div className="text-sm">{project.description || "—"}</div></div>
            <div className="tile p-4"><div className="text-[10px] tracking-overline text-[var(--muted)] mb-1">Baseline Remarks</div><div className="text-sm">{project.baseline_remarks || "—"}</div></div>
            <div className="tile p-4"><div className="text-[10px] tracking-overline text-[var(--muted)] mb-1">Finance Remarks</div><div className="text-sm">{project.finance_remarks || "—"}</div></div>
          </div>
        )}
      </div>
    </div>
  );
}

function Info({ k, v }) {
  return (
    <div>
      <div className="text-[9px] tracking-overline text-[var(--muted)]">{k}</div>
      <div className="font-medium text-[var(--text)]">{v || "—"}</div>
    </div>
  );
}

function RevenueTab({ projectId, rows, reload, mode, inrPerUsd, project }) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-lg font-bold">Revenue Lines</h3>
        <div className="flex items-center gap-2">
          <SapBulkUpload kind="revenue" projectId={projectId} project={project} reload={reload} />
          <button className="btn-primary text-xs flex items-center gap-1" onClick={() => setShow(true)} data-testid="add-revenue-btn"><Plus size={12} /> Add Revenue</button>
        </div>
      </div>
      <table className="tbl tile">
        <thead><tr><th>Code</th><th>Description</th><th>Recognition</th><th>Billing</th><th>Status</th><th className="num">Amount</th><th></th></tr></thead>
        <tbody>
          {(rows || []).map((r) => (
            <tr key={r.id}>
              <td className="font-mono text-xs">{r.revenue_code || "—"}</td>
              <td>{r.description || "—"}</td>
              <td>{formatDate(r.recognition_date)}</td>
              <td>{formatDate(r.billing_date)}</td>
              <td><StatusBadge status={r.is_billed ? "Approved" : "Pending"} /></td>
              <td className="num">{formatCurrency(r.amount, mode, inrPerUsd)}</td>
              <td><button className="btn-ghost" onClick={async () => { await api.delete(`/revenue/${r.id}`); reload(); }}><Trash size={14} /></button></td>
            </tr>
          ))}
          {(!rows || rows.length === 0) && <tr><td colSpan={7} className="text-center py-8 text-[var(--muted)]">No revenue lines yet</td></tr>}
        </tbody>
      </table>
      {show && <LineModal title="Revenue Line" entity="revenue" projectId={projectId} onClose={() => setShow(false)} onSaved={() => { setShow(false); reload(); }} />}
    </div>
  );
}

function CostTab({ projectId, rows, reload, mode, inrPerUsd, project }) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-lg font-bold">Cost Lines</h3>
        <div className="flex items-center gap-2">
          <SapBulkUpload kind="cost" projectId={projectId} project={project} reload={reload} />
          <button className="btn-primary text-xs flex items-center gap-1" onClick={() => setShow(true)} data-testid="add-cost-btn"><Plus size={12} /> Add Cost</button>
        </div>
      </div>
      <table className="tbl tile">
        <thead><tr><th>Vendor PO</th><th>Supplier</th><th>Description</th><th>Date</th><th>Category</th><th className="num">Amount</th><th></th></tr></thead>
        <tbody>
          {(rows || []).map((r) => (
            <tr key={r.id}>
              <td className="font-mono text-xs">{r.vendor_po_ref || "—"}</td>
              <td>{r.supplier_name || "—"}</td>
              <td>{r.description || "—"}</td>
              <td>{formatDate(r.expense_date)}</td>
              <td>{r.category || "—"}</td>
              <td className="num">{formatCurrency(r.amount, mode, inrPerUsd)}</td>
              <td><button className="btn-ghost" onClick={async () => { await api.delete(`/cost/${r.id}`); reload(); }}><Trash size={14} /></button></td>
            </tr>
          ))}
          {(!rows || rows.length === 0) && <tr><td colSpan={7} className="text-center py-8 text-[var(--muted)]">No cost lines yet</td></tr>}
        </tbody>
      </table>
      {show && <LineModal title="Cost Line" entity="cost" projectId={projectId} onClose={() => setShow(false)} onSaved={() => { setShow(false); reload(); }} />}
    </div>
  );
}

// Unified SAP Excel upload (single 4-sheet template covers both Revenue & Cost)
// kind = "revenue" -> imports rows from Revenue_SAP sheet matching project's WBS
// kind = "cost"    -> imports rows from Expenses_SAP sheet matching project's WBS
function SapBulkUpload({ kind, projectId, project, reload }) {
  const inputRef = useRef();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [lastBatch, setLastBatch] = useState(null);

  const loadLast = React.useCallback(async () => {
    try {
      const { data } = await api.get(`/projects/${projectId}/sap-last-import?kind=${kind}`);
      setLastBatch(data?.has_batch ? data : null);
    } catch (_) { setLastBatch(null); }
  }, [projectId, kind]);

  React.useEffect(() => { loadLast(); }, [loadLast]);

  const onPick = async (file) => {
    if (!file) return;
    setBusy(true); setError(""); setResult(null);
    try {
      const fd = new FormData(); fd.append("file", file);
      const params = new URLSearchParams({ kind });
      const { data } = await api.post(`/projects/${projectId}/sap-upload?${params}`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setResult(data);
      reload();
      loadLast();
    } catch (e) {
      setError(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const onUndo = async () => {
    if (!lastBatch) return;
    if (!window.confirm(`Reverse the last SAP import? This will delete ${lastBatch.rows} ${kind} line(s) imported on ${new Date(lastBatch.uploaded_at).toLocaleString()} from "${lastBatch.file_name}".`)) return;
    setBusy(true); setError("");
    try {
      const { data } = await api.post(`/projects/${projectId}/sap-undo-last?kind=${kind}`);
      setResult({ undone: true, ...data });
      reload();
      loadLast();
    } catch (e) {
      setError(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally { setBusy(false); }
  };

  const downloadTemplate = async () => {
    const r = await api.get("/uploads/template/sap-transactions", { responseType: "blob" });
    const url = window.URL.createObjectURL(new Blob([r.data]));
    const a = document.createElement("a"); a.href = url; a.download = "sap_transactions_template.xlsx"; a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="flex items-center gap-2 flex-wrap" data-testid={`sap-bulk-${kind}`}>
      <input ref={inputRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => onPick(e.target.files?.[0])} data-testid={`sap-bulk-input-${kind}`} />
      <button type="button" className="btn-ghost text-[11px] underline decoration-dotted" onClick={downloadTemplate} title="Download the unified SAP template">
        SAP template
      </button>
      <button type="button" className="btn-secondary text-xs flex items-center gap-1" onClick={() => inputRef.current?.click()} disabled={busy} data-testid={`sap-bulk-btn-${kind}`}>
        <FileXls size={12} weight="bold" /> {busy ? "Importing…" : "Import SAP Excel"}
      </button>
      {lastBatch && !busy && (
        <button
          type="button"
          className="btn-secondary text-xs flex items-center gap-1 !text-[var(--warning)] !border-[color-mix(in_srgb,var(--warning)_40%,transparent)] hover:!bg-[color-mix(in_srgb,var(--warning)_12%,transparent)]"
          onClick={onUndo}
          title={`Undo last import · ${lastBatch.rows} rows · ${new Date(lastBatch.uploaded_at).toLocaleString()}`}
          data-testid={`sap-undo-${kind}`}
        >
          <ArrowCounterClockwise size={12} weight="bold" /> Undo last import ({lastBatch.rows})
        </button>
      )}
      {(result || error) && (
        <div
          className={`text-[11px] px-2 py-1 border ${error ? "text-[var(--danger)] border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)]" : "text-[var(--success)] border-[color-mix(in_srgb,var(--success)_30%,transparent)] bg-[color-mix(in_srgb,var(--success)_10%,transparent)]"}`}
          data-testid={`sap-bulk-result-${kind}`}
        >
          {error
            ? error
            : result.undone
              ? `Reversed: ${result.deleted} ${kind} line(s) removed`
              : `Imported ${result.imported} / ${result.matched} rows · ${result.skipped} skipped (WBS ${project?.wbs_element || "—"})`}
          <button className="ml-2 opacity-60" onClick={() => { setResult(null); setError(""); }}>×</button>
        </div>
      )}
    </div>
  );
}

function LineModal({ title, entity, projectId, onClose, onSaved }) {
  const [form, setForm] = useState(entity === "revenue"
    ? { revenue_code: "", description: "", amount: 0, recognition_date: "", billing_date: "", is_billed: false }
    : { vendor_po_ref: "", supplier_name: "", description: "", amount: 0, expense_date: "", category: "" });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const url = entity === "revenue" ? `/projects/${projectId}/revenue` : `/projects/${projectId}/cost`;
      await api.post(url, { ...form, project_id: projectId, amount: Number(form.amount || 0) });
      onSaved();
    } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-[var(--surface)] border border-[var(--border)] w-full max-w-lg p-5 space-y-3" data-testid={`${entity}-line-modal`}>
        <h3 className="font-display text-lg font-bold">{title}</h3>
        {entity === "revenue" ? (
          <>
            <input className="input" placeholder="Revenue code" value={form.revenue_code} onChange={(e) => set("revenue_code", e.target.value)} />
            <input className="input" placeholder="Description" value={form.description} onChange={(e) => set("description", e.target.value)} />
            <div className="grid grid-cols-2 gap-3">
              <input type="date" className="input" value={form.recognition_date} onChange={(e) => set("recognition_date", e.target.value)} />
              <input type="date" className="input" value={form.billing_date} onChange={(e) => set("billing_date", e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input type="number" className="input" placeholder="Amount" value={form.amount} onChange={(e) => set("amount", e.target.value)} />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_billed} onChange={(e) => set("is_billed", e.target.checked)} /> Billed</label>
            </div>
          </>
        ) : (
          <>
            <input className="input" placeholder="Vendor PO ref" value={form.vendor_po_ref} onChange={(e) => set("vendor_po_ref", e.target.value)} />
            <input className="input" placeholder="Supplier name" value={form.supplier_name} onChange={(e) => set("supplier_name", e.target.value)} />
            <input className="input" placeholder="Description" value={form.description} onChange={(e) => set("description", e.target.value)} />
            <div className="grid grid-cols-2 gap-3">
              <input type="date" className="input" value={form.expense_date} onChange={(e) => set("expense_date", e.target.value)} />
              <input className="input" placeholder="Category" value={form.category} onChange={(e) => set("category", e.target.value)} />
            </div>
            <input type="number" className="input" placeholder="Amount" value={form.amount} onChange={(e) => set("amount", e.target.value)} />
          </>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy} data-testid="line-modal-submit">{busy ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </div>
  );
}

function Milestones({ project, mode, inrPerUsd }) {
  const ms = project.milestones || [];
  return (
    <div>
      <h3 className="font-display text-lg font-bold mb-4">Milestones</h3>
      {ms.length === 0 ? (
        <div className="tile p-8 text-center text-[var(--muted)] text-sm">No milestones for this project</div>
      ) : (
        <table className="tbl tile">
          <thead><tr><th>Milestone</th><th>Due Date</th><th className="num">Value</th><th>Status</th></tr></thead>
          <tbody>
            {ms.map((m, i) => (
              <tr key={i}>
                <td>{m.milestone_name}</td>
                <td>{formatDate(m.due_date)}</td>
                <td className="num">{formatCurrency(m.value, mode, inrPerUsd)}</td>
                <td><StatusBadge status={m.is_billed ? "Approved" : "Pending"} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function AuditTab({ rows }) {
  return (
    <div>
      <h3 className="font-display text-lg font-bold mb-4">Audit Trail</h3>
      <table className="tbl tile">
        <thead><tr><th>Timestamp</th><th>Action</th><th>User</th><th>Details</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="text-xs">{formatDateTime(r.timestamp)}</td>
              <td><StatusBadge status={r.action} /></td>
              <td className="text-xs">{r.user_email || "—"}</td>
              <td className="text-xs"><pre className="font-mono text-[10px] whitespace-pre-wrap">{JSON.stringify(r.field_changes, null, 2)}</pre></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={4} className="text-center py-8 text-[var(--muted)]">No audit events</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
// DOCUMENTS TAB (PDF + any file, with optional auto-parse)
// ============================================================
function DocumentsTab({ projectId, reload }) {
  const [docs, setDocs] = React.useState([]);
  const [docName, setDocName] = React.useState("");
  const [pendingFile, setPendingFile] = React.useState(null);
  const [parse, setParse] = React.useState(true);
  const [applyExtracted, setApplyExtracted] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [drag, setDrag] = React.useState(false);
  const [lastResult, setLastResult] = React.useState(null);
  const [error, setError] = React.useState("");
  const inputRef = React.useRef();

  const load = async () => {
    const { data } = await api.get(`/projects/${projectId}/documents`);
    setDocs(data);
  };
  React.useEffect(() => { load(); /* eslint-disable-line */ }, [projectId]);

  const stageFile = (file) => {
    if (!file) return;
    setError("");
    setPendingFile(file);
    if (!docName) setDocName(file.name.replace(/\.[^.]+$/, ""));
  };

  const upload = async () => {
    if (!pendingFile) { setError("Please choose a file"); return; }
    if (!docName.trim()) { setError("Document name is required"); return; }
    setBusy(true); setError(""); setLastResult(null);
    try {
      const fd = new FormData(); fd.append("file", pendingFile);
      const params = new URLSearchParams({
        name: docName.trim(),
        parse: parse ? "true" : "false",
        apply_extracted: applyExtracted ? "true" : "false",
      });
      const { data } = await api.post(`/projects/${projectId}/documents?${params}`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      setLastResult(data);
      setPendingFile(null);
      setDocName("");
      load();
      if (Object.keys(data.applied || {}).length) reload();
    } catch (e) {
      setError(e.response?.data?.detail || e.message);
    } finally { setBusy(false); }
  };

  const download = async (d) => {
    const r = await api.get(`/documents/${d.id}/download`, { responseType: "blob" });
    const url = window.URL.createObjectURL(new Blob([r.data]));
    const a = document.createElement("a"); a.href = url; a.download = d.file_name; a.click();
    window.URL.revokeObjectURL(url);
  };

  const remove = async (d) => {
    if (!window.confirm(`Delete ${d.name || d.file_name}?`)) return;
    await api.delete(`/documents/${d.id}`); load();
  };

  return (
    <div>
      <h3 className="font-display text-lg font-bold mb-4">Documents</h3>

      <div className="tile p-5 mb-5">
        <div className="text-[10px] tracking-overline text-[var(--muted)] mb-3">Upload Customer PO / Vendor PO / Contract / Any document</div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-[10px] tracking-overline text-[var(--muted)] mb-1.5">
              Document Name <span className="text-[var(--gold)]">*</span>
            </label>
            <input
              className="input"
              placeholder="e.g. Customer PO FY26 Q2"
              value={docName}
              onChange={(e) => setDocName(e.target.value)}
              data-testid="doc-name-input"
            />
          </div>
          <div>
            <label className="block text-[10px] tracking-overline text-[var(--muted)] mb-1.5">
              File <span className="text-[var(--gold)]">*</span>
            </label>
            <div className="flex items-center gap-2">
              <input ref={inputRef} type="file" className="hidden" onChange={(e) => stageFile(e.target.files?.[0])} data-testid="doc-input" />
              <button type="button" className="btn-secondary text-xs" onClick={() => inputRef.current?.click()} data-testid="doc-choose-btn">
                {pendingFile ? "Change file" : "Choose File"}
              </button>
              <div className="text-xs text-[var(--muted)] truncate flex-1" data-testid="doc-pending-name">
                {pendingFile ? `${pendingFile.name} · ${(pendingFile.size / 1024).toFixed(1)} KB` : "No file selected"}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 mb-3">
          <label className="flex items-center gap-2 text-xs text-[var(--muted)] cursor-pointer" data-testid="doc-parse-toggle">
            <input type="checkbox" checked={parse} onChange={(e) => setParse(e.target.checked)} />
            Auto-parse PDF (extract PO number, value, milestones)
          </label>
          <label className="flex items-center gap-2 text-xs text-[var(--muted)] cursor-pointer" data-testid="doc-apply-toggle">
            <input type="checkbox" checked={applyExtracted} onChange={(e) => setApplyExtracted(e.target.checked)} disabled={!parse} />
            Apply extracted fields to project (only fills empty fields)
          </label>
        </div>

        <div
          className={`border-2 border-dashed p-8 text-center transition-all ${drag ? "border-[var(--gold)] bg-[color-mix(in_srgb,var(--gold)_15%,transparent)]" : "border-[var(--border)]"}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); stageFile(e.dataTransfer.files?.[0]); }}
          data-testid="doc-drop-zone"
        >
          <div className="text-sm text-[var(--muted)]">
            {pendingFile ? "File ready — enter a name then click Save" : "Drag & drop a file here, or use Choose File above"}
          </div>
          <button
            className="btn-primary mt-3"
            onClick={upload}
            disabled={busy || !pendingFile || !docName.trim()}
            data-testid="doc-upload-btn"
          >
            {busy ? "Uploading…" : "Save Document"}
          </button>
        </div>
        {error && <div className="text-xs text-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] p-2 mt-3 border border-[color-mix(in_srgb,var(--danger)_30%,transparent)]">{error}</div>}
        {lastResult?.document && (
          <div className="mt-4 border border-[var(--border)] p-4" data-testid="doc-last-result">
            <div className="text-[10px] tracking-overline text-[var(--muted)] mb-2">Last upload</div>
            <div className="text-sm font-medium">{lastResult.document.name || lastResult.document.file_name}</div>
            {lastResult.document.parsed && (
              <div className="mt-2 text-xs space-y-1">
                <div className="text-[var(--muted)] tracking-overline text-[10px]">Extracted</div>
                <pre className="font-mono text-[11px] whitespace-pre-wrap bg-[var(--surface-2)] p-2 border border-[var(--border)]">
{JSON.stringify({
  customer_po_number: lastResult.document.parsed.customer_po_number,
  po_date: lastResult.document.parsed.po_date,
  po_value: lastResult.document.parsed.po_value,
  currency: lastResult.document.parsed.currency,
  milestones_found: lastResult.document.parsed.milestones?.length || 0,
  warnings: lastResult.document.parsed.warnings,
}, null, 2)}
                </pre>
                {Object.keys(lastResult.applied || {}).length > 0 && (
                  <div className="text-[var(--success)]">Applied {Object.keys(lastResult.applied).length} fields to project</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <table className="tbl tile">
        <thead><tr><th>Name</th><th>File</th><th>Size</th><th>Uploaded</th><th>Parsed</th><th></th></tr></thead>
        <tbody>
          {docs.map((d) => (
            <tr key={d.id} data-testid={`doc-row-${d.id}`}>
              <td className="font-medium">{d.name || d.file_name}</td>
              <td className="text-xs text-[var(--muted)]">{d.file_name}</td>
              <td className="num text-xs">{(d.size / 1024).toFixed(1)} KB</td>
              <td className="text-xs">{formatDateTime(d.uploaded_at)}<div className="text-[var(--muted)]">{d.uploaded_by}</div></td>
              <td>{d.parsed ? <StatusBadge status="Approved" /> : <StatusBadge status="Not Required" />}</td>
              <td className="text-right">
                <button className="btn-ghost text-xs" onClick={() => download(d)} data-testid={`doc-download-${d.id}`}>Download</button>
                <button className="btn-ghost ml-1" onClick={() => remove(d)} data-testid={`doc-delete-${d.id}`}>
                  <Trash size={14} />
                </button>
              </td>
            </tr>
          ))}
          {docs.length === 0 && <tr><td colSpan={6} className="text-center py-8 text-[var(--muted)]">No documents attached yet</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
// QUERIES TAB (Finance Query threaded discussion)
// ============================================================
function QueriesTab({ projectId }) {
  const [queries, setQueries] = React.useState([]);
  const [show, setShow] = React.useState(false);
  const [active, setActive] = React.useState(null);

  const load = async () => {
    const { data } = await api.get(`/projects/${projectId}/queries`);
    setQueries(data);
  };
  React.useEffect(() => { load(); /* eslint-disable-line */ }, [projectId]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-lg font-bold">Finance Queries</h3>
        <button className="btn-primary text-xs flex items-center gap-1" onClick={() => setShow(true)} data-testid="new-query-btn">
          <Plus size={12} /> New Query
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-5 space-y-2 max-h-[560px] overflow-y-auto" data-testid="queries-list">
          {queries.map((q) => (
            <div
              key={q.id}
              onClick={() => setActive(q)}
              className={`tile p-4 cursor-pointer ${active?.id === q.id ? "border-[var(--gold)]" : ""}`}
              data-testid={`query-item-${q.id}`}
            >
              <div className="flex items-center justify-between">
                <div className="font-medium">{q.subject}</div>
                <StatusBadge status={q.status === "Open" ? "Pending" : "Approved"} />
              </div>
              <div className="text-xs text-[var(--muted)] mt-1 line-clamp-2">{q.description}</div>
              <div className="text-[11px] text-[var(--muted)] mt-2 flex items-center justify-between">
                <span>{q.raised_by_name || q.raised_by}</span>
                <span>{q.replies?.length || 0} {q.replies?.length === 1 ? "reply" : "replies"}</span>
              </div>
            </div>
          ))}
          {queries.length === 0 && <div className="text-sm text-[var(--muted)] text-center py-12">No queries yet</div>}
        </div>

        <div className="lg:col-span-7">
          {active ? <QueryThread query={active} reload={load} setActive={setActive} /> : (
            <div className="tile p-12 text-center text-[var(--muted)] text-sm">Select a query to see the thread</div>
          )}
        </div>
      </div>

      {show && <NewQueryModal projectId={projectId} onClose={() => setShow(false)} onSaved={() => { setShow(false); load(); }} />}
    </div>
  );
}

function QueryThread({ query, reload, setActive }) {
  const [content, setContent] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const reply = async () => {
    if (!content.trim()) return;
    setBusy(true);
    try {
      await api.post(`/queries/${query.id}/replies`, { content });
      setContent("");
      reload();
      const r = await api.get(`/projects/${query.project_id}/queries`);
      const updated = r.data.find((q) => q.id === query.id);
      if (updated) setActive(updated);
    } finally { setBusy(false); }
  };
  const close = async () => {
    await api.patch(`/queries/${query.id}/status?status=Closed`);
    reload();
    const r = await api.get(`/projects/${query.project_id}/queries`);
    setActive(r.data.find((q) => q.id === query.id));
  };
  const reopen = async () => {
    await api.patch(`/queries/${query.id}/status?status=Open`);
    reload();
    const r = await api.get(`/projects/${query.project_id}/queries`);
    setActive(r.data.find((q) => q.id === query.id));
  };

  return (
    <div className="tile p-5" data-testid="query-thread">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[10px] tracking-overline text-[var(--muted)]">Query</div>
          <div className="font-display text-lg font-bold">{query.subject}</div>
        </div>
        {query.status === "Open"
          ? <button className="btn-secondary text-xs" onClick={close} data-testid="close-query-btn">Mark resolved</button>
          : <button className="btn-secondary text-xs" onClick={reopen} data-testid="reopen-query-btn">Reopen</button>}
      </div>

      <div className="border-l-2 border-[var(--gold)] pl-3 py-1 mb-4">
        <div className="text-xs text-[var(--muted)] mb-1">{query.raised_by_name || query.raised_by} · {formatDateTime(query.created_at)}</div>
        <div className="text-sm whitespace-pre-wrap">{query.description}</div>
      </div>

      <div className="space-y-3 max-h-[300px] overflow-y-auto">
        {(query.replies || []).map((r) => (
          <div key={r.id} className="border border-[var(--border)] p-3" data-testid={`reply-${r.id}`}>
            <div className="text-xs text-[var(--muted)] mb-1">{r.replied_by_name || r.replied_by} · {formatDateTime(r.replied_at)}</div>
            <div className="text-sm whitespace-pre-wrap">{r.content}</div>
          </div>
        ))}
      </div>

      {query.status === "Open" && (
        <div className="mt-4 flex flex-col gap-2">
          <textarea
            className="input"
            rows={3}
            placeholder="Type your reply…"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            data-testid="reply-input"
          />
          <button className="btn-primary self-end text-xs" onClick={reply} disabled={busy || !content.trim()} data-testid="reply-submit">
            {busy ? "Posting…" : "Post Reply"}
          </button>
        </div>
      )}
    </div>
  );
}

function NewQueryModal({ projectId, onClose, onSaved }) {
  const [subject, setSubject] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      await api.post(`/projects/${projectId}/queries`, { subject, description });
      onSaved();
    } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-[var(--surface)] border w-full max-w-lg" data-testid="query-modal">
        <div className="p-5 border-b border-[var(--border)] flex justify-between items-center">
          <h3 className="font-display text-lg font-bold">Raise a Finance Query</h3>
          <button type="button" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="p-5 space-y-3">
          <input className="input" required placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} data-testid="query-subject" />
          <textarea className="input" required rows={6} placeholder="Describe the query in detail…" value={description} onChange={(e) => setDescription(e.target.value)} data-testid="query-description" />
        </div>
        <div className="p-5 border-t flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy} data-testid="query-submit">{busy ? "Saving…" : "Raise Query"}</button>
        </div>
      </form>
    </div>
  );
}
