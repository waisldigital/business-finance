import React, { useEffect, useRef, useState } from "react";
import api, { formatApiErrorDetail, API as API_BASE } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Plus, MagnifyingGlass, PencilSimple, Trash, UploadSimple, X, Warning, Lock, DownloadSimple, Eye, EyeSlash } from "@phosphor-icons/react";

const PERMANENT_EMAILS = new Set([
  "rohit.kataria@waisldigital.com",
  "tushar.sukhija@waisldigital.com",
]);

const EMPTY = {
  employee_no: "", email_id: "", status: "Active",
  joining_date: "", exit_date: "",
  employment_type: "Employee",
  employee_name: "", role_zoho: "",
  l1_manager: "", location: "",
  department: "", sub_department: "",
  password: "", workspace_role_id: "",
};

export default function EmployeesPage() {
  const [rows, setRows] = useState([]);
  const [roles, setRoles] = useState([]);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [err, setErr] = useState("");

  const load = async () => {
    const [e, r] = await Promise.all([api.get("/employees"), api.get("/roles")]);
    setRows(e.data);
    setRoles(r.data);
  };
  useEffect(() => { load(); }, []);

  const filtered = rows.filter((r) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return [
      r.employee_no, r.employee_name, r.email_id, r.role_zoho,
      r.location, r.department, r.sub_department, r.l1_manager, r.workspace_role_name,
    ].some((v) => (v || "").toString().toLowerCase().includes(s));
  });

  const remove = async (e) => {
    if (PERMANENT_EMAILS.has((e.email_id || "").toLowerCase())) {
      setErr("Permanent admin employees cannot be deleted.");
      return;
    }
    if (!window.confirm(`Delete ${e.employee_name}?`)) return;
    try {
      await api.delete(`/employees/${e.id}`);
      load();
    } catch (ex) {
      setErr(formatApiErrorDetail(ex.response?.data?.detail) || ex.message);
    }
  };

  return (
    <div data-testid="employees-page">
      <PageHeader
        title="Employees"
        subtitle="Master roster · password & workspace role are managed here (no separate User Management)"
        breadcrumb="HOME · ADMINISTRATION · EMPLOYEES"
        actions={
          <div className="flex gap-2">
            <a className="btn-ghost flex items-center gap-2 text-xs" href={`${API_BASE}/employees/template`} data-testid="employees-template-btn">
              <DownloadSimple size={14} weight="bold" /> Template
            </a>
            <button className="btn-secondary flex items-center gap-2" onClick={() => setShowUpload(true)} data-testid="employees-upload-btn">
              <UploadSimple size={14} weight="bold" /> Upload Excel
            </button>
            <button className="btn-primary flex items-center gap-2" onClick={() => setShowCreate(true)} data-testid="employees-add-btn">
              <Plus size={14} weight="bold" /> Add Employee
            </button>
          </div>
        }
      />

      <div className="px-8 py-6 space-y-5">
        <div className="tile p-4 flex items-center gap-3">
          <div className="relative flex-1">
            <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
            <input
              className="input pl-9"
              placeholder="Search by name, email, employee no, department, role…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="employees-search"
            />
          </div>
          <div className="text-[11px] text-[var(--muted)]">{filtered.length} of {rows.length}</div>
        </div>

        {err && (
          <div className="text-xs text-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] p-2 border border-[var(--danger)] flex items-center justify-between gap-2">
            <span className="flex items-center gap-1"><Warning size={12} weight="bold" /> {err}</span>
            <button className="btn-ghost" onClick={() => setErr("")}><X size={12} /></button>
          </div>
        )}

        <div className="tile overflow-x-auto">
          <table className="tbl min-w-[1500px]" data-testid="employees-table">
            <thead>
              <tr>
                <th>Employee No</th>
                <th>Email ID</th>
                <th>Status</th>
                <th>Joining Date</th>
                <th>Exit Date</th>
                <th>Employment Type</th>
                <th>Employee Name</th>
                <th>Role (as per Zoho)</th>
                <th>L1 Manager</th>
                <th>Location</th>
                <th>Department</th>
                <th>Sub Department</th>
                <th>Password</th>
                <th>Roles</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const isPerm = PERMANENT_EMAILS.has((r.email_id || "").toLowerCase());
                return (
                  <tr key={r.id} data-testid={`employee-row-${r.id}`}>
                    <td className="font-mono text-xs">
                      {isPerm && <Lock size={12} weight="fill" className="inline mr-1 text-[var(--gold)]" />}
                      {r.employee_no}
                    </td>
                    <td className="text-xs">{r.email_id}</td>
                    <td><span className={`badge ${r.status === "Active" ? "badge-approved" : "badge-rejected"}`}>{r.status}</span></td>
                    <td className="text-xs">{r.joining_date || "—"}</td>
                    <td className="text-xs">{r.exit_date || "—"}</td>
                    <td className="text-xs">{r.employment_type}</td>
                    <td className="font-medium">{r.employee_name}</td>
                    <td>{r.role_zoho || "—"}</td>
                    <td className="font-mono text-xs">{r.l1_manager || "—"}</td>
                    <td>{r.location || "—"}</td>
                    <td>{r.department || "—"}</td>
                    <td>{r.sub_department || "—"}</td>
                    <td>
                      {r.has_user_account
                        ? <span className="badge badge-approved flex items-center gap-1 w-fit"><Lock size={10} weight="fill" /> Set</span>
                        : <span className="text-[var(--muted)] text-xs">—</span>}
                    </td>
                    <td>
                      {isPerm
                        ? <span className="badge badge-gold">Admin (full)</span>
                        : (r.workspace_role_name ? <span className="badge badge-neutral">{r.workspace_role_name}</span> : <span className="text-[var(--muted)] text-xs">—</span>)}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      <button className="btn-ghost" title="Edit" onClick={() => setEditing(r)} data-testid={`employee-edit-${r.id}`}>
                        <PencilSimple size={14} weight="duotone" className="text-[var(--gold)]" />
                      </button>
                      <button
                        className="btn-ghost ml-1"
                        title={isPerm ? "Permanent admin — cannot delete" : "Delete"}
                        disabled={isPerm}
                        onClick={() => remove(r)}
                        data-testid={`employee-delete-${r.id}`}
                      >
                        <Trash size={14} className={isPerm ? "opacity-30" : "text-[var(--danger)]"} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={15} className="text-center py-12 text-[var(--muted)]">No employees — upload Excel or click <span className="text-[var(--gold)] font-semibold">Add Employee</span></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {(showCreate || editing) && (
        <EmployeeModal
          employee={editing}
          roles={roles}
          onClose={() => { setShowCreate(false); setEditing(null); }}
          onSaved={() => { setShowCreate(false); setEditing(null); load(); }}
        />
      )}
      {showUpload && <UploadModal onClose={() => setShowUpload(false)} onUploaded={() => { setShowUpload(false); load(); }} />}
    </div>
  );
}

function EmployeeModal({ employee, roles, onClose, onSaved }) {
  const [form, setForm] = useState(employee ? { ...EMPTY, ...employee, password: "" } : EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const isPerm = PERMANENT_EMAILS.has((form.email_id || "").toLowerCase());

  const submit = async () => {
    setBusy(true); setErr("");
    try {
      const payload = { ...form };
      if (!payload.joining_date) payload.joining_date = null;
      if (!payload.exit_date) payload.exit_date = null;
      if (!payload.password) delete payload.password;
      if (!payload.workspace_role_id) payload.workspace_role_id = null;
      if (employee?.id) {
        await api.put(`/employees/${employee.id}`, payload);
      } else {
        await api.post("/employees", payload);
      }
      onSaved();
    } catch (e) {
      setErr(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" data-testid="employee-modal">
      <div className="bg-[var(--surface)] w-full max-w-2xl max-h-[92vh] overflow-y-auto border border-[var(--border)]">
        <div className="flex items-center justify-between p-5 border-b border-[var(--border)]">
          <div>
            <div className="text-[10px] tracking-overline text-[var(--muted)]">{employee ? "EDIT" : "NEW"} EMPLOYEE</div>
            <h2 className="font-display text-xl font-bold flex items-center gap-2">{isPerm && <Lock size={14} weight="fill" className="text-[var(--gold)]" />}{employee?.employee_name || "New Employee"}</h2>
          </div>
          <button className="btn-ghost" onClick={onClose} data-testid="employee-modal-close"><X size={18} /></button>
        </div>
        {isPerm && (
          <div className="px-5 pt-4">
            <div className="text-[11px] text-[var(--gold)] bg-[color-mix(in_srgb,var(--gold)_10%,transparent)] p-2 border border-[color-mix(in_srgb,var(--gold)_35%,transparent)] flex items-center gap-1">
              <Lock size={12} weight="fill" /> Permanent admin — email is locked & role is always Admin (full access). Password change is ignored.
            </div>
          </div>
        )}
        <div className="p-5 grid grid-cols-2 gap-4">
          <FormField label="Employee No" required value={form.employee_no} onChange={(v) => set("employee_no", v)} testid="emp-no" />
          <FormField label="Email ID" required type="email" value={form.email_id} onChange={(v) => set("email_id", v)} disabled={isPerm} testid="emp-email" />
          <FormField label="Employee Name" required value={form.employee_name} onChange={(v) => set("employee_name", v)} testid="emp-name" />
          <SelectField label="Status" value={form.status} options={["Active", "Inactive", "Exited"]} onChange={(v) => set("status", v)} testid="emp-status" />
          <FormField label="Joining Date" value={form.joining_date || ""} onChange={(v) => set("joining_date", v)} placeholder="DD-MM-YYYY" testid="emp-joining" />
          <FormField label="Exit Date" value={form.exit_date || ""} onChange={(v) => set("exit_date", v)} placeholder="DD-MM-YYYY" testid="emp-exit" />
          <SelectField label="Employment Type" value={form.employment_type} options={["Employee", "Contractor", "Intern"]} onChange={(v) => set("employment_type", v)} testid="emp-type" />
          <FormField label="Role (as per Zoho)" value={form.role_zoho || ""} onChange={(v) => set("role_zoho", v)} testid="emp-role" />
          <FormField label="L1 Manager (Emp No)" value={form.l1_manager || ""} onChange={(v) => set("l1_manager", v)} testid="emp-l1" />
          <FormField label="Location" value={form.location || ""} onChange={(v) => set("location", v)} testid="emp-location" />
          <FormField label="Department" value={form.department || ""} onChange={(v) => set("department", v)} testid="emp-dept" />
          <FormField label="Sub Department" value={form.sub_department || ""} onChange={(v) => set("sub_department", v)} testid="emp-subdept" />
          {/* NEW Iter 9: Password & Workspace Role */}
          <div>
            <label className="block text-[10px] tracking-overline text-[var(--muted)] mb-1.5">
              Password {!employee && <span className="text-[var(--gold)]">*</span>}
              {employee && <span className="text-[var(--muted)] normal-case ml-1">(leave blank to keep)</span>}
            </label>
            <div className="relative">
              <input
                className="input pr-9"
                type={showPwd ? "text" : "password"}
                value={form.password || ""}
                placeholder={employee ? "•••••••• (unchanged)" : "Set initial password"}
                disabled={isPerm}
                onChange={(e) => set("password", e.target.value)}
                data-testid="emp-password"
              />
              <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 btn-ghost" onClick={() => setShowPwd(!showPwd)}>
                {showPwd ? <EyeSlash size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-[10px] tracking-overline text-[var(--muted)] mb-1.5">Workspace Role</label>
            <select
              className="input"
              value={form.workspace_role_id || ""}
              disabled={isPerm}
              onChange={(e) => set("workspace_role_id", e.target.value)}
              data-testid="emp-workspace-role"
            >
              <option value="">{isPerm ? "Admin — Full Access" : "— No workspace access —"}</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <div className="text-[10px] text-[var(--muted)] mt-1">Manage roles under <em>Settings → Roles</em>.</div>
          </div>
          {err && <div className="col-span-2 text-xs text-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] p-2 border border-[var(--danger)]">{err}</div>}
        </div>
        <div className="p-5 border-t border-[var(--border)] flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={busy} data-testid="emp-save">{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

function UploadModal({ onClose, onUploaded }) {
  const [mode, setMode] = useState("append");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");
  const ref = useRef();

  const submit = async () => {
    if (!file) { setErr("Choose a file first"); return; }
    setBusy(true); setErr(""); setResult(null);
    try {
      const fd = new FormData(); fd.append("file", file);
      const { data } = await api.post(`/employees/bulk-upload?mode=${mode}`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setResult(data);
      onUploaded();
    } catch (e) {
      setErr(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" data-testid="employees-upload-modal">
      <div className="bg-[var(--surface)] w-full max-w-lg border border-[var(--border)]">
        <div className="flex items-center justify-between p-5 border-b border-[var(--border)]">
          <div>
            <div className="text-[10px] tracking-overline text-[var(--muted)]">UPLOAD EMPLOYEES</div>
            <h2 className="font-display text-xl font-bold">Excel / CSV Upload</h2>
          </div>
          <button className="btn-ghost" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex justify-between items-center">
            <a className="btn-ghost text-xs flex items-center gap-1" href={`${API_BASE}/employees/template`} data-testid="upload-template-link">
              <DownloadSimple size={12} weight="bold" /> Download template (with Password & Roles)
            </a>
          </div>

          <div>
            <div className="text-[10px] tracking-overline text-[var(--muted)] mb-2">Mode</div>
            <div className="grid grid-cols-2 gap-2">
              <button
                className={`p-3 border text-left ${mode === "append" ? "border-[var(--gold)] bg-[color-mix(in_srgb,var(--gold)_8%,transparent)]" : "border-[var(--border)]"}`}
                onClick={() => setMode("append")}
                data-testid="mode-append"
              >
                <div className="font-display font-bold text-sm">Add (Append)</div>
                <div className="text-[11px] text-[var(--muted)] mt-1">Add new rows, skip emails that already exist.</div>
              </button>
              <button
                className={`p-3 border text-left ${mode === "replace" ? "border-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)]" : "border-[var(--border)]"}`}
                onClick={() => setMode("replace")}
                data-testid="mode-replace"
              >
                <div className="font-display font-bold text-sm flex items-center gap-1">Replace All <Warning size={12} /></div>
                <div className="text-[11px] text-[var(--muted)] mt-1">Wipe roster + insert. Permanent admins are preserved.</div>
              </button>
            </div>
          </div>

          <div>
            <div className="text-[10px] tracking-overline text-[var(--muted)] mb-2">File (.xlsx, .csv)</div>
            <input type="file" ref={ref} className="hidden" accept=".xlsx,.csv" onChange={(e) => setFile(e.target.files?.[0])} data-testid="upload-file-input" />
            <div className="flex items-center gap-2">
              <button className="btn-secondary text-xs" onClick={() => ref.current?.click()} data-testid="upload-file-pick">Choose file</button>
              <span className="text-xs text-[var(--muted)] truncate flex-1">{file ? `${file.name} · ${(file.size / 1024).toFixed(1)} KB` : "No file selected"}</span>
            </div>
            <div className="text-[10px] text-[var(--muted)] mt-2 leading-relaxed">
              <strong>Columns (header row 1):</strong> Employee No, Email ID, Status, Joining Date, Exit Date,
              Employement Type, Employee Name, Role (as per Zoho), L1 Manager, Location, Department,
              Sub Department, <strong className="text-[var(--gold)]">Password</strong>, <strong className="text-[var(--gold)]">Roles</strong>.
              <br />The <em>Roles</em> column must match an existing workspace role name (case-insensitive).
              The <em>Password</em> column creates / updates the login credential.
            </div>
          </div>

          {mode === "replace" && (
            <div className="text-[11px] text-[var(--warning)] bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] p-2 border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] flex items-start gap-1">
              <Warning size={12} weight="bold" className="mt-0.5" />
              Replace mode wipes the entire employee roster. The two permanent admins (Rohit Kataria & Tushar Sukhija) are protected and won't be removed.
            </div>
          )}

          {err && <div className="text-xs text-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] p-2 border border-[var(--danger)]">{err}</div>}
          {result && (
            <div className="text-xs bg-[var(--surface-2)] p-3 border border-[var(--border)]" data-testid="upload-result">
              <div>Mode: <span className="font-mono">{result.mode}</span></div>
              <div>Total rows: <span className="font-mono">{result.total_rows}</span></div>
              <div>Saved: <span className="font-mono text-[var(--success)]">{result.saved}</span></div>
              <div>Failed: <span className="font-mono text-[var(--danger)]">{result.failed}</span></div>
              {result.failures?.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[var(--muted)]">Failures</summary>
                  <pre className="font-mono text-[10px] whitespace-pre-wrap mt-1">{JSON.stringify(result.failures, null, 2)}</pre>
                </details>
              )}
            </div>
          )}
        </div>
        <div className="p-5 border-t border-[var(--border)] flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>{result ? "Close" : "Cancel"}</button>
          <button
            className={mode === "replace" ? "btn-primary" : "btn-primary"}
            onClick={submit}
            disabled={busy || !file}
            data-testid="upload-submit-btn"
          >
            {busy ? "Uploading…" : mode === "replace" ? "Replace All" : "Upload & Append"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FormField({ label, value, onChange, required, type = "text", placeholder, testid, disabled }) {
  return (
    <div>
      <label className="block text-[10px] tracking-overline text-[var(--muted)] mb-1.5">
        {label} {required && <span className="text-[var(--gold)]">*</span>}
      </label>
      <input
        className="input"
        type={type}
        value={value || ""}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testid}
      />
    </div>
  );
}

function SelectField({ label, value, options, onChange, testid }) {
  return (
    <div>
      <label className="block text-[10px] tracking-overline text-[var(--muted)] mb-1.5">{label}</label>
      <select className="input" value={value || ""} onChange={(e) => onChange(e.target.value)} data-testid={testid}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}
