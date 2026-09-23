import React, { useState } from "react";
import api, { formatApiErrorDetail } from "@/lib/api";
import { X } from "@phosphor-icons/react";

// Reused field definitions — kept in sync with MasterPage "customers" entity.
const CUSTOMER_FIELDS = [
  { key: "customer_name", label: "Customer Name", required: true },
  { key: "sap_customer_code", label: "SAP Customer Code" },
  { key: "parent_group", label: "Parent Group / Holding Company" },
  { key: "industry", label: "Industry" },
  { key: "sector", label: "Sector" },
  { key: "business_category", label: "GMR / Non-GMR" },
  { key: "domestic_international", label: "Domestic / International" },
  { key: "balance_outstanding_sap", label: "Balance Outstanding (SAP)", type: "number" },
  { key: "contact_person", label: "Primary Contact Person" },
  { key: "primary_designation", label: "Primary Designation" },
  { key: "primary_department", label: "Primary Department" },
  { key: "email", label: "Primary Email" },
  { key: "phone", label: "Primary Phone" },
  { key: "secondary_contact_person", label: "Secondary Contact Person" },
  { key: "secondary_email", label: "Secondary Email" },
  { key: "secondary_phone", label: "Secondary Phone" },
  { key: "account_owner_email", label: "Account Owner Email" },
  { key: "website", label: "Website" },
  { key: "country", label: "Country" },
  { key: "state", label: "State" },
  { key: "region", label: "Region" },
  { key: "address_billing", label: "Billing Address", textarea: true },
  { key: "address_shipping", label: "Shipping Address", textarea: true },
  { key: "risk_notes", label: "Risk Notes", textarea: true },
];

export default function CustomerQuickAddModal({ initialName = "", onClose, onSaved }) {
  const [form, setForm] = useState(() => {
    const base = CUSTOMER_FIELDS.reduce((a, f) => {
      a[f.key] = f.type === "number" ? 0 : "";
      return a;
    }, {});
    if (initialName) base.customer_name = initialName;
    return base;
  });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const payload = { ...form };
      CUSTOMER_FIELDS.forEach((f) => {
        if (f.type === "number") payload[f.key] = Number(payload[f.key] || 0);
      });
      const { data } = await api.post("/customers", payload);
      onSaved(data);
    } catch (e) {
      setErr(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4"
      data-testid="customer-quick-add-modal"
    >
      <form
        onSubmit={submit}
        className="bg-[var(--surface)] border border-[var(--border)] w-full max-w-3xl max-h-[90vh] overflow-y-auto"
      >
        <div className="p-5 border-b border-[var(--border)] flex justify-between items-center sticky top-0 bg-[var(--surface)] z-10">
          <div>
            <h3 className="font-display text-lg font-bold">Add New Customer</h3>
            <div className="text-[10px] tracking-overline text-[var(--muted)]">CUSTOMER MASTER · INLINE CREATE</div>
          </div>
          <button type="button" className="btn-ghost" onClick={onClose} data-testid="customer-quick-add-close">
            <X size={16} />
          </button>
        </div>
        <div className="p-5 grid grid-cols-2 gap-3">
          {CUSTOMER_FIELDS.map((f) => (
            <div key={f.key} className={f.textarea ? "col-span-2" : ""}>
              <label className="block text-[10px] tracking-overline text-[var(--muted)] mb-1">
                {f.label}{f.required && " *"}
              </label>
              {f.textarea ? (
                <textarea
                  className="input"
                  rows={2}
                  value={form[f.key] || ""}
                  onChange={(e) => set(f.key, e.target.value)}
                  data-testid={`cust-quick-${f.key}`}
                />
              ) : (
                <input
                  type={f.type === "number" ? "number" : "text"}
                  required={!!f.required}
                  className="input"
                  value={form[f.key] ?? ""}
                  onChange={(e) => set(f.key, e.target.value)}
                  data-testid={`cust-quick-${f.key}`}
                />
              )}
            </div>
          ))}
          {err && (
            <div className="col-span-2 text-xs text-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] p-2 border border-[color-mix(in_srgb,var(--danger)_30%,transparent)]">
              {err}
            </div>
          )}
        </div>
        <div className="p-5 border-t border-[var(--border)] flex justify-end gap-2 sticky bottom-0 bg-[var(--surface)]">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy} data-testid="customer-quick-add-submit">
            {busy ? "Saving…" : "Save Customer"}
          </button>
        </div>
      </form>
    </div>
  );
}
