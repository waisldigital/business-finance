import React, { useEffect, useState } from "react";
import api, { formatApiErrorDetail } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Plus, Trash, X, DownloadSimple } from "@phosphor-icons/react";
import { formatCurrency } from "@/lib/format";
import { useCurrency } from "@/lib/currency";
import { useNavigate } from "react-router-dom";

const ENTITIES = {
  customers: {
    label: "Customer Profile", apiPath: "customers", entity: "customer",
    columns: [
      { key: "customer_name", label: "Name" },
      { key: "sap_customer_code", label: "SAP Code" },
      { key: "industry", label: "Industry" },
      { key: "contact_person", label: "Primary Contact" },
      { key: "email", label: "Email" },
      { key: "phone", label: "Phone" },
      { key: "balance_outstanding_sap", label: "Outstanding", type: "currency" },
      { key: "country", label: "Country" },
    ],
    fields: [
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
    ],
  },
  suppliers: {
    label: "Suppliers", apiPath: "suppliers", entity: "supplier",
    columns: [
      { key: "supplier_name", label: "Name" },
      { key: "supplier_code", label: "Code" },
      { key: "contact_person", label: "Contact" },
      { key: "email", label: "Email" },
      { key: "phone", label: "Phone" },
      { key: "address", label: "Address" },
    ],
    fields: [
      { key: "supplier_name", label: "Supplier Name", required: true },
      { key: "supplier_code", label: "Supplier Code" },
      { key: "contact_person", label: "Contact Person" },
      { key: "email", label: "Email" },
      { key: "phone", label: "Phone" },
      { key: "address", label: "Address", textarea: true },
    ],
  },
  employees: {
    label: "Employees", apiPath: "employees", entity: "employee",
    columns: [
      { key: "employee_name", label: "Name" },
      { key: "employee_code", label: "Code" },
      { key: "email_id", label: "Email" },
      { key: "designation", label: "Designation" },
      { key: "department", label: "Department" },
      { key: "l1_manager_email", label: "L1 Manager" },
      { key: "location", label: "Location" },
    ],
    fields: [
      { key: "employee_code", label: "Employee Code", required: true },
      { key: "employee_name", label: "Employee Name", required: true },
      { key: "email_id", label: "Email", required: true },
      { key: "designation", label: "Designation" },
      { key: "department", label: "Department" },
      { key: "l1_manager_email", label: "L1 Manager Email" },
      { key: "location", label: "Location" },
    ],
  },
};

export default function MasterPage({ entityKey }) {
  const meta = ENTITIES[entityKey];
  const { mode, inrPerUsd } = useCurrency();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    const { data } = await api.get(`/${meta.apiPath}`);
    setRows(data);
  };
  useEffect(() => { load(); /* eslint-disable-line */ }, [entityKey]);

  const onDelete = async (id) => {
    if (!window.confirm("Delete this record?")) return;
    try { await api.delete(`/${meta.apiPath}/${id}`); load(); } catch (e) { alert(formatApiErrorDetail(e.response?.data?.detail)); }
  };

  const downloadExport = async () => {
    const r = await api.get(`/uploads/export/${meta.entity}`, { responseType: "blob" });
    const url = window.URL.createObjectURL(new Blob([r.data]));
    const a = document.createElement("a"); a.href = url; a.download = `${meta.entity}_export.xlsx`; a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div data-testid={`${entityKey}-page`}>
      <PageHeader
        title={meta.label}
        subtitle={`Manage your ${meta.label.toLowerCase()} master data`}
        breadcrumb={`HOME · MASTERS · ${meta.label.toUpperCase()}`}
        actions={
          <div className="flex items-center gap-2">
            <button className="btn-secondary text-xs flex items-center gap-1" onClick={downloadExport} data-testid={`export-${entityKey}`}>
              <DownloadSimple size={12} /> Export
            </button>
            <button className="btn-primary text-xs flex items-center gap-1" onClick={() => { setEditing(null); setShow(true); }} data-testid={`add-${entityKey}`}>
              <Plus size={12} /> New
            </button>
          </div>
        }
      />
      <div className="px-8 py-5">
        <div className="tile overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                {meta.columns.map((c) => <th key={c.key} className={c.type === "currency" ? "num" : ""}>{c.label}</th>)}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isClickable = entityKey === "customers";
                return (
                  <tr
                    key={r.id}
                    data-testid={`${entityKey}-row-${r.id}`}
                    className={isClickable ? "cursor-pointer" : ""}
                    onClick={() => isClickable && navigate(`/customers/${r.id}`)}
                  >
                    {meta.columns.map((c) => (
                      <td key={c.key} className={c.type === "currency" ? "num" : ""}>
                        {c.type === "currency" ? formatCurrency(r[c.key], mode, inrPerUsd) : r[c.key] || "—"}
                      </td>
                    ))}
                    <td className="text-right" onClick={(e) => e.stopPropagation()}>
                      <button className="btn-ghost mr-1 text-xs" onClick={() => { setEditing(r); setShow(true); }}>Edit</button>
                      <button className="btn-ghost" onClick={() => onDelete(r.id)} data-testid={`${entityKey}-delete-${r.id}`}><Trash size={14} /></button>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={meta.columns.length + 1} className="text-center py-12 text-[var(--muted)]">No records yet</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {show && <Modal meta={meta} entity={editing} onClose={() => setShow(false)} onSaved={() => { setShow(false); load(); }} />}
    </div>
  );
}

function Modal({ meta, entity, onClose, onSaved }) {
  const [form, setForm] = useState(entity || meta.fields.reduce((a, f) => { a[f.key] = f.type === "number" ? 0 : ""; return a; }, {}));
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr("");
    try {
      const payload = { ...form };
      meta.fields.forEach((f) => { if (f.type === "number") payload[f.key] = Number(payload[f.key] || 0); });
      if (entity?.id) await api.put(`/${meta.apiPath}/${entity.id}`, payload);
      else await api.post(`/${meta.apiPath}`, payload);
      onSaved();
    } catch (e) {
      setErr(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" data-testid="master-modal">
      <form onSubmit={submit} className="bg-[var(--surface)] border border-[var(--border)] w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="p-5 border-b border-[var(--border)] flex justify-between items-center">
          <h3 className="font-display text-lg font-bold">{entity ? "Edit" : "New"} {meta.label.replace(/s$/, "")}</h3>
          <button type="button" className="btn-ghost" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="p-5 space-y-3">
          {meta.fields.map((f) => (
            <div key={f.key}>
              <label className="block text-[10px] tracking-overline text-[var(--muted)] mb-1">{f.label}{f.required && " *"}</label>
              {f.textarea ? (
                <textarea className="input" rows={2} value={form[f.key] || ""} onChange={(e) => set(f.key, e.target.value)} />
              ) : (
                <input
                  type={f.type === "number" ? "number" : "text"}
                  required={!!f.required}
                  className="input"
                  value={form[f.key] ?? ""}
                  onChange={(e) => set(f.key, e.target.value)}
                  data-testid={`master-field-${f.key}`}
                />
              )}
            </div>
          ))}
          {err && <div className="text-xs text-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] p-2 border border-[color-mix(in_srgb,var(--danger)_30%,transparent)]">{err}</div>}
        </div>
        <div className="p-5 border-t border-[var(--border)] flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy} data-testid="master-modal-submit">{busy ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </div>
  );
}
