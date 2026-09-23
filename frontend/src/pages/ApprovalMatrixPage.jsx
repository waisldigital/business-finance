import React, { useEffect, useState } from "react";
import api, { formatApiErrorDetail } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Plus, X, Trash } from "@phosphor-icons/react";
import { useCurrency } from "@/lib/currency";
import { formatCurrency } from "@/lib/format";

const STAGES = ["", "Deal P&L", "Customer PO", "Operations", "Closure"];
const ROLES = ["", "admin", "finance", "leadership", "approver"];
const BIZ = ["Any", "GMR", "Non-GMR"];

export default function ApprovalMatrixPage({ embedded = false }) {
  const [rows, setRows] = useState([]);
  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState(null);
  const { mode, inrPerUsd } = useCurrency();

  const load = async () => {
    const { data } = await api.get("/approvals/rules");
    setRows(data);
  };
  useEffect(() => { load(); }, []);

  const remove = async (id) => {
    if (!window.confirm("Delete rule?")) return;
    await api.delete(`/approvals/rules/${id}`); load();
  };

  return (
    <div data-testid="approval-matrix-page">
      {!embedded && (
        <PageHeader
          title="Approval Matrix"
          subtitle="Configure who must approve which stage transitions, and when"
          breadcrumb="HOME · ADMIN · APPROVAL MATRIX"
          actions={<button className="btn-primary text-xs flex items-center gap-1" onClick={() => { setEditing(null); setShow(true); }} data-testid="add-rule-btn"><Plus size={12} /> Add Rule</button>}
        />
      )}
      <div className={embedded ? "space-y-4" : "px-8 py-5"}>
        {embedded && (
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-display text-lg font-bold">Approval Matrix</h3>
              <div className="text-xs text-[var(--muted)]">Configure who must approve which stage transitions, and when.</div>
            </div>
            <button className="btn-primary text-xs flex items-center gap-1" onClick={() => { setEditing(null); setShow(true); }} data-testid="add-rule-btn"><Plus size={12} /> Add Rule</button>
          </div>
        )}
        <div className="tile overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr><th>Name</th><th>Target Stage</th><th>Business</th><th className="num">Min Revenue</th><th className="num">Max Revenue</th><th className="num">Margin %</th><th>Approvers</th><th>Active</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-testid={`rule-row-${r.id}`}>
                  <td className="font-medium">{r.name}</td>
                  <td>{r.target_stage || "Any"}</td>
                  <td>{r.business_category || "Any"}</td>
                  <td className="num">{r.min_revenue ? formatCurrency(r.min_revenue, mode, inrPerUsd) : "—"}</td>
                  <td className="num">{r.max_revenue ? formatCurrency(r.max_revenue, mode, inrPerUsd) : "—"}</td>
                  <td className="num">
                    {r.min_margin_pct != null ? `≥${r.min_margin_pct}%` : ""}
                    {r.max_margin_pct != null ? ` ≤${r.max_margin_pct}%` : ""}
                    {r.min_margin_pct == null && r.max_margin_pct == null ? "—" : ""}
                  </td>
                  <td className="text-xs">
                    {r.approver_role && <span className="badge badge-gold capitalize">{r.approver_role}</span>}
                    {r.approver_emails?.length ? <div className="mt-1">{r.approver_emails.join(", ")}</div> : null}
                  </td>
                  <td>{r.is_active ? <span className="badge badge-approved">Active</span> : <span className="badge badge-neutral">Off</span>}</td>
                  <td>
                    <button className="btn-ghost text-xs" onClick={() => { setEditing(r); setShow(true); }}>Edit</button>
                    <button className="btn-ghost text-xs ml-1" onClick={() => remove(r.id)}><Trash size={12} /></button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={9} className="text-center py-12 text-[var(--muted)]">No rules yet</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {show && <RuleModal rule={editing} onClose={() => setShow(false)} onSaved={() => { setShow(false); load(); }} />}
    </div>
  );
}

function RuleModal({ rule, onClose, onSaved }) {
  const isEdit = !!rule?.id;
  const [form, setForm] = useState(rule || {
    name: "", business_category: "Any", target_stage: "",
    min_revenue: "", max_revenue: "", min_margin_pct: "", max_margin_pct: "",
    approver_emails: [], approver_role: "", is_active: true,
  });
  const [emailsRaw, setEmailsRaw] = useState((rule?.approver_emails || []).join(", "));
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr("");
    try {
      const payload = {
        ...form,
        min_revenue: form.min_revenue === "" ? null : Number(form.min_revenue),
        max_revenue: form.max_revenue === "" ? null : Number(form.max_revenue),
        min_margin_pct: form.min_margin_pct === "" ? null : Number(form.min_margin_pct),
        max_margin_pct: form.max_margin_pct === "" ? null : Number(form.max_margin_pct),
        target_stage: form.target_stage || null,
        approver_role: form.approver_role || null,
        approver_emails: emailsRaw.split(",").map((s) => s.trim()).filter(Boolean),
      };
      if (isEdit) await api.put(`/approvals/rules/${rule.id}`, payload);
      else await api.post("/approvals/rules", payload);
      onSaved();
    } catch (e) { setErr(formatApiErrorDetail(e.response?.data?.detail) || e.message); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-[var(--surface)] border border-[var(--border)] w-full max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="rule-modal">
        <div className="p-5 border-b flex justify-between items-center"><h3 className="font-display text-lg font-bold">{isEdit ? "Edit" : "New"} Approval Rule</h3><button type="button" onClick={onClose}><X size={16} /></button></div>
        <div className="p-5 grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-[10px] tracking-overline text-[var(--muted)] mb-1">Name *</label>
            <input className="input" required value={form.name} onChange={(e) => set("name", e.target.value)} data-testid="rule-name" />
          </div>
          <div>
            <label className="block text-[10px] tracking-overline text-[var(--muted)] mb-1">Target Stage</label>
            <select className="input" value={form.target_stage || ""} onChange={(e) => set("target_stage", e.target.value)}>
              {STAGES.map((s) => <option key={s} value={s}>{s || "Any"}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] tracking-overline text-[var(--muted)] mb-1">Business Category</label>
            <select className="input" value={form.business_category || "Any"} onChange={(e) => set("business_category", e.target.value)}>
              {BIZ.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] tracking-overline text-[var(--muted)] mb-1">Min Revenue (₹)</label>
            <input type="number" className="input font-mono" value={form.min_revenue ?? ""} onChange={(e) => set("min_revenue", e.target.value)} />
          </div>
          <div>
            <label className="block text-[10px] tracking-overline text-[var(--muted)] mb-1">Max Revenue (₹)</label>
            <input type="number" className="input font-mono" value={form.max_revenue ?? ""} onChange={(e) => set("max_revenue", e.target.value)} />
          </div>
          <div>
            <label className="block text-[10px] tracking-overline text-[var(--muted)] mb-1">Min Margin %</label>
            <input type="number" className="input font-mono" value={form.min_margin_pct ?? ""} onChange={(e) => set("min_margin_pct", e.target.value)} />
          </div>
          <div>
            <label className="block text-[10px] tracking-overline text-[var(--muted)] mb-1">Max Margin %</label>
            <input type="number" className="input font-mono" value={form.max_margin_pct ?? ""} onChange={(e) => set("max_margin_pct", e.target.value)} />
          </div>
          <div>
            <label className="block text-[10px] tracking-overline text-[var(--muted)] mb-1">Approver Role</label>
            <select className="input" value={form.approver_role || ""} onChange={(e) => set("approver_role", e.target.value)}>
              {ROLES.map((r) => <option key={r} value={r} className="capitalize">{r || "—"}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] tracking-overline text-[var(--muted)] mb-1">Status</label>
            <select className="input" value={form.is_active ? "1" : "0"} onChange={(e) => set("is_active", e.target.value === "1")}>
              <option value="1">Active</option><option value="0">Off</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-[10px] tracking-overline text-[var(--muted)] mb-1">Approver Emails (comma separated)</label>
            <input className="input" value={emailsRaw} onChange={(e) => setEmailsRaw(e.target.value)} data-testid="rule-emails" />
          </div>
          {err && <div className="col-span-2 text-xs text-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] p-2 border border-[color-mix(in_srgb,var(--danger)_30%,transparent)]">{err}</div>}
        </div>
        <div className="p-5 border-t flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy} data-testid="rule-modal-submit">{busy ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </div>
  );
}
