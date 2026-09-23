import React, { useEffect, useMemo, useState } from "react";
import api, { formatApiErrorDetail } from "@/lib/api";
import { X, Plus, Trash, MagnifyingGlass, Upload, WarningCircle } from "@phosphor-icons/react";
import CustomerQuickAddModal from "./CustomerQuickAddModal";

const AIRPORTS = ["DIAL", "GHIAL", "GGIAL", "GVIAL", "Other"];
const MANDAYS_PER_YEAR = 250;

function emptyResource() {
  return { resource_count: 1, mandays: 0, grade: "", amount: 0, free_text: "" };
}

function emptyMilestone() {
  return { date: "", billing_amount: 0, notes: "" };
}

function fmt(n) {
  if (!n && n !== 0) return "—";
  return Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export default function CRFormModal({ existing, onClose, onSaved }) {
  const isEdit = !!existing?.id;
  const [employees, setEmployees] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [showCustAdd, setShowCustAdd] = useState(false);
  const [custQuery, setCustQuery] = useState("");
  const [showCustList, setShowCustList] = useState(false);
  const [poFile, setPoFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const [form, setForm] = useState(() => existing || {
    cr_name: "",
    customer_id: null,
    customer_name: "",
    airport_name: "DIAL",
    wbs_element: "",
    po_received: false,
    customer_po_number: "",
    po_value: 0,
    po_issue_date: "",
    po_from_date: "",
    po_to_date: "",
    vendor_cost: 0,
    vendor_cost_remarks: "",
    resource_lines: [],
    resource_cost_remarks: "",
    business_justification: "",
    customer_payment_terms: "",
    vendor_payment_terms: "",
    pbg_ld_required: false,
    pbg_ld_details: "",
    milestones: [],
    assignees_to: [],
    assignees_cc: [],
    currency: "INR",
  });

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  // -------- Load lookups --------
  useEffect(() => {
    (async () => {
      try {
        const [c, e] = await Promise.all([
          api.get("/customers"),
          api.get("/employees"),
        ]);
        setCustomers(c.data || []);
        setEmployees(e.data || []);
      } catch (_) {}
    })();
  }, []);

  // -------- Calculated cost & margin --------
  const resourceTotal = useMemo(
    () => (form.resource_lines || []).reduce((s, r) => s + Number(r.amount || 0), 0),
    [form.resource_lines],
  );
  const totalCost = useMemo(
    () => Number(form.vendor_cost || 0) + resourceTotal,
    [form.vendor_cost, resourceTotal],
  );
  const marginAmount = useMemo(
    () => Number(form.po_value || 0) - totalCost,
    [form.po_value, totalCost],
  );
  const marginPct = useMemo(() => {
    const po = Number(form.po_value || 0);
    return po > 0 ? (marginAmount / po) * 100 : 0;
  }, [marginAmount, form.po_value]);

  const lowMargin = marginPct < 25 && Number(form.po_value || 0) > 0;

  // -------- Approver preview (live) --------
  const [approverPreview, setApproverPreview] = useState({ approver_emails: [], approver_role: null, approver_rule_name: null });

  useEffect(() => {
    // Match approval rules client-side for instant preview (server re-validates on save).
    (async () => {
      try {
        const { data: rules } = await api.get("/approvals/rules");
        const po = Number(form.po_value || 0);
        const applicable = (rules || []).filter((r) => {
          if (!r.is_active) return false;
          const at = (r.applies_to || "both").toLowerCase();
          if (!["change_request", "both"].includes(at)) return false;
          if (r.min_revenue != null && po < Number(r.min_revenue)) return false;
          if (r.max_revenue != null && po > Number(r.max_revenue)) return false;
          if (r.min_margin_pct != null && marginPct < Number(r.min_margin_pct)) return false;
          if (r.max_margin_pct != null && marginPct > Number(r.max_margin_pct)) return false;
          return true;
        });
        applicable.sort((a, b) => {
          const wa = (a.max_revenue ?? 1e18) - (a.min_revenue ?? 0);
          const wb = (b.max_revenue ?? 1e18) - (b.min_revenue ?? 0);
          return wa - wb;
        });
        const chosen = applicable[0];
        setApproverPreview(chosen ? {
          approver_emails: chosen.approver_emails || [],
          approver_role: chosen.approver_role,
          approver_rule_name: chosen.name,
        } : { approver_emails: [], approver_role: null, approver_rule_name: null });
      } catch (_) {}
    })();
  }, [form.po_value, marginPct]);

  // -------- Customer search --------
  const custResults = useMemo(() => {
    const q = custQuery.trim().toLowerCase();
    if (!q) return customers.slice(0, 8);
    return customers
      .filter((c) => (c.customer_name || "").toLowerCase().includes(q))
      .slice(0, 12);
  }, [custQuery, customers]);

  const selectCustomer = (c) => {
    set({ customer_id: c.id, customer_name: c.customer_name });
    setCustQuery(c.customer_name);
    setShowCustList(false);
  };

  // -------- Resource line ops --------
  const addResource = () => set({ resource_lines: [...(form.resource_lines || []), emptyResource()] });
  const updResource = (i, patch) => {
    const list = [...(form.resource_lines || [])];
    list[i] = { ...list[i], ...patch };
    set({ resource_lines: list });
  };
  const delResource = (i) => set({ resource_lines: (form.resource_lines || []).filter((_, ix) => ix !== i) });

  // -------- Milestone ops --------
  const addMilestone = () => set({ milestones: [...(form.milestones || []), emptyMilestone()] });
  const updMilestone = (i, patch) => {
    const list = [...(form.milestones || [])];
    list[i] = { ...list[i], ...patch };
    set({ milestones: list });
  };
  const delMilestone = (i) => set({ milestones: (form.milestones || []).filter((_, ix) => ix !== i) });

  // -------- Save --------
  const save = async (alsoSubmit = false) => {
    setErr("");
    if (!form.cr_name?.trim()) return setErr("CR Name is required");
    if (!form.wbs_element?.trim()) return setErr("WBS Element (WSIN) is required");
    if (alsoSubmit && lowMargin && !form.business_justification?.trim()) {
      return setErr("Business justification is required when margin is below 25%");
    }
    setBusy(true);
    try {
      const payload = {
        ...form,
        po_value: Number(form.po_value || 0),
        vendor_cost: Number(form.vendor_cost || 0),
        resource_lines: (form.resource_lines || []).map((r) => ({
          resource_count: Number(r.resource_count || 0),
          mandays: Number(r.mandays || 0),
          grade: r.grade || null,
          amount: Number(r.amount || 0),
          free_text: r.free_text || null,
        })),
        milestones: (form.milestones || []).map((m) => ({
          date: m.date || null,
          billing_amount: Number(m.billing_amount || 0),
          notes: m.notes || null,
        })),
      };
      let saved;
      if (isEdit) {
        const { data } = await api.put(`/change-requests/${existing.id}`, payload);
        saved = data;
      } else {
        const { data } = await api.post("/change-requests", payload);
        saved = data;
      }
      // Upload PO attachment if provided
      if (poFile) {
        const fd = new FormData();
        fd.append("file", poFile);
        await api.post(`/change-requests/${saved.id}/attachments?kind=customer_po`, fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      }
      if (alsoSubmit) {
        await api.post(`/change-requests/${saved.id}/submit`);
      }
      onSaved(saved);
    } catch (e) {
      setErr(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/55 z-[60] flex items-center justify-center p-3" data-testid="cr-form-modal">
      <div className="bg-[var(--surface)] border border-[var(--border)] w-full max-w-5xl max-h-[94vh] overflow-y-auto">
        {/* Header */}
        <div className="p-5 border-b border-[var(--border)] flex justify-between items-center sticky top-0 bg-[var(--surface)] z-10">
          <div>
            <h3 className="font-display text-lg font-bold">{isEdit ? "Edit" : "New"} Change Request</h3>
            <div className="text-[10px] tracking-overline text-[var(--muted)]">
              {isEdit ? `CR · ${existing.cr_number}` : "WAISL · CHANGE REQUEST · CREATE"}
            </div>
          </div>
          <button className="btn-ghost" onClick={onClose} data-testid="cr-form-close"><X size={16} /></button>
        </div>

        <div className="p-5 grid grid-cols-3 gap-4">

          {/* Core fields */}
          <div className="col-span-3">
            <div className="text-[10px] tracking-overline text-[var(--muted)] mb-2">CR DETAILS</div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="block text-[10px] tracking-overline text-[var(--muted)] mb-1">CR Name *</label>
                <input className="input" value={form.cr_name} onChange={(e) => set({ cr_name: e.target.value })} data-testid="cr-name" />
              </div>
              <div>
                <label className="block text-[10px] tracking-overline text-[var(--muted)] mb-1">Airport Name</label>
                <select className="input" value={form.airport_name} onChange={(e) => set({ airport_name: e.target.value })} data-testid="cr-airport">
                  {AIRPORTS.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>

              {/* Customer search/select */}
              <div className="col-span-2 relative">
                <label className="block text-[10px] tracking-overline text-[var(--muted)] mb-1">Customer Name *</label>
                <div className="relative">
                  <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                  <input
                    className="input pl-9"
                    placeholder="Search customer…"
                    value={custQuery}
                    onChange={(e) => { setCustQuery(e.target.value); setShowCustList(true); }}
                    onFocus={() => setShowCustList(true)}
                    data-testid="cr-customer-search"
                  />
                </div>
                {showCustList && (
                  <div className="absolute left-0 right-0 mt-1 max-h-60 overflow-auto bg-[var(--surface-2)] border border-[var(--border)] z-20 shadow-lg">
                    {custResults.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--row-hover)] flex justify-between"
                        onClick={() => selectCustomer(c)}
                        data-testid={`cr-customer-opt-${c.id}`}
                      >
                        <span>{c.customer_name}</span>
                        <span className="text-[10px] text-[var(--muted)]">{c.sap_customer_code || ""}</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-xs text-[var(--gold)] border-t border-[var(--border)] hover:bg-[var(--row-hover)] flex items-center gap-1"
                      onClick={() => { setShowCustList(false); setShowCustAdd(true); }}
                      data-testid="cr-add-new-customer"
                    >
                      <Plus size={12} /> Add new customer {custQuery && `"${custQuery}"`}
                    </button>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-[10px] tracking-overline text-[var(--muted)] mb-1">WBS Element (WSIN) *</label>
                <input className="input font-mono" value={form.wbs_element} onChange={(e) => set({ wbs_element: e.target.value.toUpperCase() })} data-testid="cr-wbs" />
              </div>
            </div>
          </div>

          {/* Customer PO Section */}
          <div className="col-span-3">
            <div className="text-[10px] tracking-overline text-[var(--muted)] mb-2 mt-2">CUSTOMER PO</div>
            <div className="grid grid-cols-4 gap-3">
              <div className="col-span-4 flex items-center gap-3 text-xs">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={!!form.po_received} onChange={(e) => set({ po_received: e.target.checked })} data-testid="cr-po-received" />
                  PO Received
                </label>
              </div>
              <div>
                <label className="block text-[10px] tracking-overline text-[var(--muted)] mb-1">PO Number</label>
                <input className="input" value={form.customer_po_number || ""} onChange={(e) => set({ customer_po_number: e.target.value })} data-testid="cr-po-number" />
              </div>
              <div>
                <label className="block text-[10px] tracking-overline text-[var(--muted)] mb-1">PO Value (INR) *</label>
                <input type="number" min="0" className="input" value={form.po_value} onChange={(e) => set({ po_value: e.target.value })} data-testid="cr-po-value" />
              </div>
              <div>
                <label className="block text-[10px] tracking-overline text-[var(--muted)] mb-1">PO Issue Date</label>
                <input type="date" className="input" value={form.po_issue_date || ""} onChange={(e) => set({ po_issue_date: e.target.value })} />
              </div>
              <div>
                <label className="block text-[10px] tracking-overline text-[var(--muted)] mb-1">PO Period</label>
                <div className="flex gap-1">
                  <input type="date" className="input" value={form.po_from_date || ""} onChange={(e) => set({ po_from_date: e.target.value })} />
                  <input type="date" className="input" value={form.po_to_date || ""} onChange={(e) => set({ po_to_date: e.target.value })} />
                </div>
              </div>
              <div className="col-span-4">
                <label className="block text-[10px] tracking-overline text-[var(--muted)] mb-1">PO Attachment (PDF)</label>
                <div className="flex items-center gap-2">
                  <label className="btn-secondary text-xs flex items-center gap-1 cursor-pointer" data-testid="cr-po-upload">
                    <Upload size={12} /> {poFile ? poFile.name : "Choose file…"}
                    <input type="file" accept=".pdf,.png,.jpg,.jpeg" className="hidden" onChange={(e) => setPoFile(e.target.files?.[0] || null)} />
                  </label>
                  {poFile && <button type="button" className="btn-ghost text-xs" onClick={() => setPoFile(null)}>Remove</button>}
                </div>
              </div>
            </div>
          </div>

          {/* Budgeted Cost */}
          <div className="col-span-3">
            <div className="text-[10px] tracking-overline text-[var(--muted)] mb-2 mt-2">BUDGETED COST</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] tracking-overline text-[var(--muted)] mb-1">Vendor Cost (single total)</label>
                <input type="number" min="0" className="input" value={form.vendor_cost} onChange={(e) => set({ vendor_cost: e.target.value })} data-testid="cr-vendor-cost" />
                <input className="input mt-2" placeholder="Vendor cost remarks (optional)" value={form.vendor_cost_remarks || ""} onChange={(e) => set({ vendor_cost_remarks: e.target.value })} />
              </div>
              <div>
                <label className="block text-[10px] tracking-overline text-[var(--muted)] mb-1">Resource Cost Total (calc.)</label>
                <input className="input" disabled value={fmt(resourceTotal)} data-testid="cr-resource-total" />
                <input className="input mt-2" placeholder="Resource cost remarks (optional)" value={form.resource_cost_remarks || ""} onChange={(e) => set({ resource_cost_remarks: e.target.value })} />
              </div>
            </div>

            <div className="mt-3 tile p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] tracking-overline text-[var(--muted)]">Resource Cost Lines · Assumption: {MANDAYS_PER_YEAR} mandays/year</div>
                <button type="button" className="btn-ghost text-xs flex items-center gap-1" onClick={addResource} data-testid="cr-add-resource">
                  <Plus size={12} /> Add resource
                </button>
              </div>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Grade</th><th className="num">Count</th><th className="num">Mandays</th><th className="num">Amount</th><th>Note</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {(form.resource_lines || []).map((r, i) => (
                    <tr key={i}>
                      <td><input className="input h-8" value={r.grade || ""} onChange={(e) => updResource(i, { grade: e.target.value })} /></td>
                      <td className="num"><input type="number" className="input h-8 text-right" value={r.resource_count} onChange={(e) => updResource(i, { resource_count: e.target.value })} /></td>
                      <td className="num"><input type="number" className="input h-8 text-right" value={r.mandays} onChange={(e) => updResource(i, { mandays: e.target.value })} /></td>
                      <td className="num"><input type="number" className="input h-8 text-right" value={r.amount} onChange={(e) => updResource(i, { amount: e.target.value })} data-testid={`cr-res-amt-${i}`} /></td>
                      <td><input className="input h-8" value={r.free_text || ""} onChange={(e) => updResource(i, { free_text: e.target.value })} /></td>
                      <td><button type="button" className="btn-ghost" onClick={() => delResource(i)}><Trash size={12} /></button></td>
                    </tr>
                  ))}
                  {(form.resource_lines || []).length === 0 && (
                    <tr><td colSpan={6} className="text-center text-xs text-[var(--muted)] py-3">No resource lines — vendor cost only.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Margin calculator strip */}
          <div className="col-span-3 grid grid-cols-4 gap-3 mt-2">
            <Tile label="PO Value" value={fmt(form.po_value)} accent="gold" />
            <Tile label="Total Cost" value={fmt(totalCost)} />
            <Tile label="Margin Amount" value={fmt(marginAmount)} />
            <Tile
              label="Margin %"
              value={`${marginPct.toFixed(2)} %`}
              accent={lowMargin ? "danger" : "success"}
              testid="cr-margin-pct"
            />
          </div>

          {/* Business justification */}
          {lowMargin && (
            <div className="col-span-3">
              <div className="text-[10px] tracking-overline mb-1" style={{ color: "var(--danger)" }}>
                <WarningCircle size={12} className="inline mr-1" />
                MARGIN BELOW 25% — BUSINESS JUSTIFICATION REQUIRED *
              </div>
              <textarea
                className="input"
                rows={3}
                placeholder="Provide business justification for accepting a margin below 25%..."
                value={form.business_justification || ""}
                onChange={(e) => set({ business_justification: e.target.value })}
                data-testid="cr-justification"
              />
            </div>
          )}

          {/* Payment terms / PBG-LD */}
          <div className="col-span-3">
            <div className="text-[10px] tracking-overline text-[var(--muted)] mb-2 mt-2">TERMS</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] tracking-overline text-[var(--muted)] mb-1">Customer Payment Terms</label>
                <textarea className="input" rows={2} value={form.customer_payment_terms || ""} onChange={(e) => set({ customer_payment_terms: e.target.value })} />
              </div>
              <div>
                <label className="block text-[10px] tracking-overline text-[var(--muted)] mb-1">Vendor Payment Terms</label>
                <textarea className="input" rows={2} value={form.vendor_payment_terms || ""} onChange={(e) => set({ vendor_payment_terms: e.target.value })} />
              </div>
              <div className="col-span-2 flex items-start gap-3">
                <label className="flex items-center gap-2 text-xs pt-5">
                  <input type="checkbox" checked={!!form.pbg_ld_required} onChange={(e) => set({ pbg_ld_required: e.target.checked })} data-testid="cr-pbg-required" />
                  PBG / LD Required
                </label>
                {form.pbg_ld_required && (
                  <div className="flex-1">
                    <label className="block text-[10px] tracking-overline text-[var(--muted)] mb-1">PBG / LD Details</label>
                    <input className="input" value={form.pbg_ld_details || ""} onChange={(e) => set({ pbg_ld_details: e.target.value })} />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Milestones */}
          <div className="col-span-3">
            <div className="flex justify-between items-center mb-2 mt-2">
              <div className="text-[10px] tracking-overline text-[var(--muted)]">MILESTONES / BILLING SCHEDULE</div>
              <button type="button" className="btn-ghost text-xs flex items-center gap-1" onClick={addMilestone}><Plus size={12} /> Add milestone</button>
            </div>
            <table className="tbl">
              <thead>
                <tr><th>Date</th><th className="num">Billing Amount</th><th>Notes</th><th></th></tr>
              </thead>
              <tbody>
                {(form.milestones || []).map((m, i) => (
                  <tr key={i}>
                    <td><input type="date" className="input h-8" value={m.date || ""} onChange={(e) => updMilestone(i, { date: e.target.value })} /></td>
                    <td className="num"><input type="number" className="input h-8 text-right" value={m.billing_amount} onChange={(e) => updMilestone(i, { billing_amount: e.target.value })} /></td>
                    <td><input className="input h-8" value={m.notes || ""} onChange={(e) => updMilestone(i, { notes: e.target.value })} /></td>
                    <td><button type="button" className="btn-ghost" onClick={() => delMilestone(i)}><Trash size={12} /></button></td>
                  </tr>
                ))}
                {(form.milestones || []).length === 0 && (
                  <tr><td colSpan={4} className="text-center text-xs text-[var(--muted)] py-3">No milestones added.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Assignees */}
          <div className="col-span-3 grid grid-cols-2 gap-3">
            <AssigneePicker label="Assignees · To" employees={employees} value={form.assignees_to} onChange={(v) => set({ assignees_to: v })} testid="cr-assignees-to" />
            <AssigneePicker label="Assignees · CC" employees={employees} value={form.assignees_cc} onChange={(v) => set({ assignees_cc: v })} testid="cr-assignees-cc" />
          </div>

          {/* Approver preview */}
          <div className="col-span-3 tile p-3 mt-2">
            <div className="text-[10px] tracking-overline text-[var(--muted)] mb-1">APPROVER (from Approval Matrix)</div>
            {approverPreview.approver_rule_name ? (
              <div className="text-sm">
                <span className="text-[var(--gold)] font-semibold">{approverPreview.approver_rule_name}</span>
                <span className="text-[var(--muted)] mx-2">·</span>
                <span>{(approverPreview.approver_emails || []).join(", ") || "—"}</span>
                {approverPreview.approver_role && (
                  <>
                    <span className="text-[var(--muted)] mx-2">·</span>
                    <span className="capitalize text-[var(--muted)]">Role: {approverPreview.approver_role}</span>
                  </>
                )}
              </div>
            ) : (
              <div className="text-xs text-[var(--muted)]">No matching approval rule for PO {fmt(form.po_value)} · Margin {marginPct.toFixed(2)}%. Define one in <span className="font-mono">Settings → Approval Matrix</span>.</div>
            )}
          </div>

          {err && (
            <div className="col-span-3 text-xs text-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] p-2 border border-[color-mix(in_srgb,var(--danger)_30%,transparent)]">
              {err}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-[var(--border)] flex justify-between items-center sticky bottom-0 bg-[var(--surface)]">
          <div className="text-[10px] tracking-overline text-[var(--muted)]">All fields are saved as draft until submitted</div>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="btn-secondary" onClick={() => save(false)} disabled={busy} data-testid="cr-save-draft">{busy ? "Saving…" : "Save Draft"}</button>
            <button className="btn-primary" onClick={() => save(true)} disabled={busy} data-testid="cr-submit">{busy ? "Submitting…" : "Save & Submit"}</button>
          </div>
        </div>
      </div>

      {showCustAdd && (
        <CustomerQuickAddModal
          initialName={custQuery}
          onClose={() => setShowCustAdd(false)}
          onSaved={(c) => {
            setCustomers((list) => [c, ...list]);
            selectCustomer(c);
            setShowCustAdd(false);
          }}
        />
      )}
    </div>
  );
}

function Tile({ label, value, accent, testid }) {
  const colors = {
    gold: "var(--gold)",
    success: "var(--success, #22c55e)",
    danger: "var(--danger)",
  };
  return (
    <div className="tile p-3" data-testid={testid}>
      <div className="text-[10px] tracking-overline text-[var(--muted)]">{label}</div>
      <div className="text-lg font-display font-bold mt-1" style={{ color: accent ? colors[accent] : "var(--text)" }}>
        {value}
      </div>
    </div>
  );
}

function AssigneePicker({ label, employees, value = [], onChange, testid }) {
  const [q, setQ] = useState("");
  const filtered = employees
    .filter((e) => !value.includes(e.id))
    .filter((e) => {
      if (!q) return true;
      const s = q.toLowerCase();
      return (e.employee_name || "").toLowerCase().includes(s) || (e.email_id || "").toLowerCase().includes(s);
    })
    .slice(0, 6);
  const byId = (id) => employees.find((e) => e.id === id);
  return (
    <div>
      <label className="block text-[10px] tracking-overline text-[var(--muted)] mb-1">{label}</label>
      <div className="tile p-2">
        <div className="flex flex-wrap gap-1 mb-2">
          {value.map((id) => {
            const e = byId(id);
            return (
              <span key={id} className="px-2 py-1 text-[11px] bg-[var(--surface-2)] border border-[var(--border)] flex items-center gap-1">
                {e?.employee_name || id}
                <button className="text-[var(--muted)]" onClick={() => onChange(value.filter((x) => x !== id))}><X size={10} /></button>
              </span>
            );
          })}
          {value.length === 0 && <span className="text-[11px] text-[var(--muted)]">None selected</span>}
        </div>
        <input className="input h-8" placeholder="Search employee…" value={q} onChange={(e) => setQ(e.target.value)} data-testid={testid} />
        {q && filtered.length > 0 && (
          <div className="mt-1 bg-[var(--surface-2)] border border-[var(--border)] max-h-40 overflow-auto">
            {filtered.map((e) => (
              <button key={e.id} type="button" className="w-full px-2 py-1 text-left text-xs hover:bg-[var(--row-hover)]" onClick={() => { onChange([...value, e.id]); setQ(""); }}>
                {e.employee_name} <span className="text-[var(--muted)]">· {e.email_id}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
