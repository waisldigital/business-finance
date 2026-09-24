import React, { useEffect, useState } from "react";
import api, { formatApiErrorDetail } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Plus, PencilSimple, Trash, X, Eye, PencilLine, ShieldStar, Warning, UploadSimple } from "@phosphor-icons/react";

const SECTIONS = [
  { key: "dashboard",        label: "Dashboard" },
  { key: "pipeline",         label: "Pipeline" },
  { key: "projects",         label: "Projects" },
  { key: "change_requests",  label: "Change Requests" },
  { key: "customer_profile", label: "Customer Profile" },
  { key: "wbs_budget",       label: "WBS and Budget" },
  { key: "aop_pnl",          label: "AOP · P&L" },
  { key: "aop_inputs",       label: "AOP · Inputs" },
  { key: "aop_revenue",      label: "AOP · Revenue" },
  { key: "aop_opex",         label: "AOP · Opex & POs" },
  { key: "aop_overheads",    label: "AOP · Overheads" },
  { key: "aop_payroll",      label: "AOP · Payroll (confidential)" },
  { key: "aop_capex",        label: "AOP · Capex" },
  { key: "aop_reports",      label: "AOP · Reports" },
];

const EMPTY_PERMS = SECTIONS.reduce((acc, s) => {
  acc[s.key] = { can_view: false, can_edit: false, can_upload: false };
  return acc;
}, {});

export default function RolesPage({ embedded = false }) {
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [err, setErr] = useState("");

  const load = async () => {
    try {
      const { data } = await api.get("/roles");
      setRows(data);
    } catch (e) {
      setErr(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    }
  };
  useEffect(() => { load(); }, []);

  const onDelete = async (r) => {
    if (r.is_system) { setErr("System roles cannot be deleted."); return; }
    if (!window.confirm(`Delete role "${r.name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/roles/${r.id}`);
      load();
    } catch (e) {
      setErr(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    }
  };

  return (
    <div data-testid="roles-page">
      {!embedded && (
        <PageHeader
          title="Roles & Permissions"
          subtitle="Define workspace-section access per role · View / Edit only · Delete is reserved for Admin"
          breadcrumb="HOME · ADMINISTRATION · ROLES"
          actions={
            <button className="btn-primary flex items-center gap-2" onClick={() => setShowCreate(true)} data-testid="roles-add-btn">
              <Plus size={14} weight="bold" /> New Role
            </button>
          }
        />
      )}

      <div className={embedded ? "space-y-5" : "px-8 py-6 space-y-5"}>
        {embedded && (
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-display text-lg font-bold">Roles &amp; Permissions</h3>
              <div className="text-xs text-[var(--muted)]">Define workspace-section access per role · View / Edit only · Delete is reserved for Admin</div>
            </div>
            <button className="btn-primary flex items-center gap-2" onClick={() => setShowCreate(true)} data-testid="roles-add-btn">
              <Plus size={14} weight="bold" /> New Role
            </button>
          </div>
        )}
        <div className="tile p-4 text-[12px] text-[var(--muted)] flex items-start gap-2">
          <ShieldStar size={16} weight="duotone" className="text-[var(--gold)] mt-0.5" />
          <div>
            Roles control which workspace sections a non-admin user can <strong>View</strong> or <strong>Edit</strong> (create + modify).
            <span className="text-[var(--danger)] font-semibold">Delete actions are reserved for Admin users only</span> — regardless of role configuration, custom roles can never delete a project or change request.
            Assign a role to a user from <em>User Management</em>.
          </div>
        </div>

        {err && (
          <div className="text-xs text-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] p-2 border border-[var(--danger)] flex items-center justify-between gap-2">
            <span className="flex items-center gap-1"><Warning size={12} weight="bold" /> {err}</span>
            <button className="btn-ghost" onClick={() => setErr("")}><X size={12} /></button>
          </div>
        )}

        <div className="tile overflow-x-auto">
          <table className="tbl min-w-[1000px]" data-testid="roles-table">
            <thead>
              <tr>
                <th>Role Name</th>
                <th>Description</th>
                {SECTIONS.map((s) => <th key={s.key} className="text-center">{s.label}</th>)}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-testid={`role-row-${r.id}`}>
                  <td className="font-medium">
                    {r.name}
                    {r.is_system && <span className="ml-2 badge badge-gold text-[9px]">SYSTEM</span>}
                  </td>
                  <td className="text-xs text-[var(--muted)]">{r.description || "—"}</td>
                  {SECTIONS.map((s) => {
                    const p = (r.permissions || {})[s.key] || {};
                    return (
                      <td key={s.key} className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          {p.can_view ? <Eye size={13} weight="duotone" className="text-[var(--gold)]" title="View" /> : <span className="text-[var(--muted)]">·</span>}
                          {p.can_edit ? <PencilLine size={13} weight="duotone" className="text-[var(--success)]" title="Edit" /> : null}
                          {p.can_upload ? <UploadSimple size={13} weight="duotone" className="text-[var(--warning)]" title="Bulk upload" /> : null}
                        </div>
                      </td>
                    );
                  })}
                  <td className="text-right whitespace-nowrap">
                    <button className="btn-ghost" title="Edit role" onClick={() => setEditing(r)} disabled={r.is_system} data-testid={`role-edit-${r.id}`}>
                      <PencilSimple size={14} className={r.is_system ? "opacity-30" : "text-[var(--gold)]"} />
                    </button>
                    <button className="btn-ghost ml-1" title={r.is_system ? "System role — cannot delete" : "Delete role"} disabled={r.is_system} onClick={() => onDelete(r)} data-testid={`role-delete-${r.id}`}>
                      <Trash size={14} className={r.is_system ? "opacity-30" : "text-[var(--danger)]"} />
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={SECTIONS.length + 3} className="text-center py-12 text-[var(--muted)]">No custom roles yet — click <span className="text-[var(--gold)] font-semibold">New Role</span> to create one.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {(showCreate || editing) && (
        <RoleModal
          role={editing}
          onClose={() => { setShowCreate(false); setEditing(null); }}
          onSaved={() => { setShowCreate(false); setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function RoleModal({ role, onClose, onSaved }) {
  const isEdit = !!role?.id;
  const [name, setName] = useState(role?.name || "");
  const [description, setDescription] = useState(role?.description || "");
  const [aopTags, setAopTags] = useState((role?.aop_tags || []).join(", "));
  const [deptScope, setDeptScope] = useState(role?.aop_dept_scope || "all");
  const [depts, setDepts] = useState(role?.aop_departments || []);
  const [perms, setPerms] = useState(() => {
    const base = { ...EMPTY_PERMS };
    if (role?.permissions) {
      for (const k of Object.keys(role.permissions)) {
        base[k] = {
          can_view: !!role.permissions[k]?.can_view,
          can_edit: !!role.permissions[k]?.can_edit,
          can_upload: !!role.permissions[k]?.can_upload,
        };
      }
    }
    return base;
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const setPerm = (sectionKey, action, value) => {
    setPerms((p) => {
      const next = { ...p, [sectionKey]: { ...p[sectionKey], [action]: value } };
      // If can_edit becomes true, can_view should also be true
      if (action === "can_edit" && value) next[sectionKey].can_view = true;
      // If can_view becomes false, can_edit should also be false
      if (action === "can_view" && !value) { next[sectionKey].can_edit = false; next[sectionKey].can_upload = false; }
      if (action === "can_upload" && value) next[sectionKey].can_view = true;
      return next;
    });
  };

  const submit = async () => {
    if (!name.trim()) { setErr("Role name is required"); return; }
    setBusy(true); setErr("");
    try {
      const aop_tags = aopTags.split(",").map((t) => t.trim()).filter(Boolean);
      const payload = { name: name.trim(), description, permissions: perms, aop_tags, aop_dept_scope: deptScope, aop_departments: depts };
      if (isEdit) {
        await api.put(`/roles/${role.id}`, payload);
      } else {
        await api.post("/roles", payload);
      }
      onSaved();
    } catch (e) {
      setErr(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" data-testid="role-modal">
      <div className="bg-[var(--surface)] w-full max-w-2xl max-h-[92vh] overflow-y-auto border border-[var(--border)]">
        <div className="flex items-center justify-between p-5 border-b border-[var(--border)]">
          <div>
            <div className="text-[10px] tracking-overline text-[var(--muted)]">{isEdit ? "EDIT" : "NEW"} ROLE</div>
            <h2 className="font-display text-xl font-bold">{role?.name || "Custom Role"}</h2>
          </div>
          <button className="btn-ghost" onClick={onClose} data-testid="role-modal-close"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] tracking-overline text-[var(--muted)] mb-1.5">Role Name <span className="text-[var(--gold)]">*</span></label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sales Viewer" data-testid="role-name" />
            </div>
            <div>
              <label className="block text-[10px] tracking-overline text-[var(--muted)] mb-1.5">Description</label>
              <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short description" data-testid="role-description" />
            </div>
          </div>

          <div>
            <label className="block text-[10px] tracking-overline text-[var(--muted)] mb-1.5">AOP data scope (reporting tags / airports)</label>
            <input className="input" value={aopTags} onChange={(e) => setAopTags(e.target.value)}
                   placeholder="Leave empty for all — e.g. DIAL, GHIAL" data-testid="role-aop-tags" />
            <div className="text-[10px] text-[var(--muted)] mt-1">Limits the P&L and AOP lines this role can see to these airports / entities.</div>
          </div>

          <DepartmentScope scope={deptScope} setScope={setDeptScope} depts={depts} setDepts={setDepts} />

          <div>
            <div className="text-[10px] tracking-overline text-[var(--muted)] mb-2">Workspace Section Permissions</div>
            <div className="border border-[var(--border)] overflow-hidden">
              <table className="w-full tbl">
                <thead>
                  <tr>
                    <th>Section</th>
                    <th className="text-center w-32">View</th>
                    <th className="text-center w-32">Edit (Create + Modify)</th>
                    <th className="text-center w-32" title="Bulk upload / download of data files (AOP sections)">Upload (bulk)</th>
                    <th className="text-center w-24">Delete</th>
                  </tr>
                </thead>
                <tbody>
                  {SECTIONS.map((s) => (
                    <tr key={s.key}>
                      <td className="font-medium">{s.label}</td>
                      <td className="text-center">
                        <input
                          type="checkbox"
                          className="w-4 h-4 accent-[var(--gold)] cursor-pointer"
                          checked={!!perms[s.key]?.can_view}
                          onChange={(e) => setPerm(s.key, "can_view", e.target.checked)}
                          data-testid={`perm-view-${s.key}`}
                        />
                      </td>
                      <td className="text-center">
                        <input
                          type="checkbox"
                          className="w-4 h-4 accent-[var(--gold)] cursor-pointer"
                          checked={!!perms[s.key]?.can_edit}
                          onChange={(e) => setPerm(s.key, "can_edit", e.target.checked)}
                          data-testid={`perm-edit-${s.key}`}
                        />
                      </td>
                      <td className="text-center">
                        {s.key.startsWith("aop_") ? (
                          <input
                            type="checkbox"
                            className="w-4 h-4 accent-[var(--gold)] cursor-pointer"
                            checked={!!perms[s.key]?.can_upload}
                            onChange={(e) => setPerm(s.key, "can_upload", e.target.checked)}
                            data-testid={`perm-upload-${s.key}`}
                          />
                        ) : <span className="text-[var(--muted)]">·</span>}
                      </td>
                      <td className="text-center">
                        <span className="text-[10px] tracking-overline text-[var(--muted)]" title="Reserved for Admin">ADMIN ONLY</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-[10px] text-[var(--muted)] mt-2">
              • Toggling <strong>Edit</strong> automatically enables <strong>View</strong>.<br />
              • Unchecking <strong>View</strong> automatically disables <strong>Edit</strong>.<br />
              • <strong>Delete</strong> can never be granted to a custom role — it is reserved for users with role = <code>admin</code>.
            </div>
          </div>

          {err && <div className="text-xs text-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] p-2 border border-[var(--danger)]">{err}</div>}
        </div>

        <div className="p-5 border-t border-[var(--border)] flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={busy} data-testid="role-save-btn">{busy ? "Saving…" : "Save Role"}</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Overheads & payroll department scope: every department, the user's own department (from the employee master,
 * matched to the AOP department names — the mapping below is editable) or a fixed list of departments.
 */
function DepartmentScope({ scope, setScope, depts, setDepts }) {
  const [info, setInfo] = useState(null);
  const [aliases, setAliases] = useState({});
  const [saved, setSaved] = useState("");
  useEffect(() => {
    api.get("/aop/departments").then((r) => {
      setInfo(r.data);
      setAliases(Object.fromEntries(Object.entries(r.data.aliases || {}).map(([k, v]) => [k, (v || []).join(", ")])));
    }).catch(() => setInfo({ aop: [], employees: [], mapping: {} }));
  }, []);
  const toggle = (d) => setDepts((x) => (x.includes(d) ? x.filter((y) => y !== d) : [...x, d]));
  const saveAliases = async () => {
    const clean = Object.fromEntries(Object.entries(aliases).map(([k, v]) => [k, String(v || "").split(",").map((x) => x.trim()).filter(Boolean)]));
    await api.put("/aop/config", { dept_aliases: clean });
    const r = await api.get("/aop/departments");
    setInfo(r.data); setSaved("Mapping saved");
    setTimeout(() => setSaved(""), 2500);
  };
  return (
    <div className="border border-[var(--border)] p-3 space-y-2" data-testid="role-dept-scope">
      <div className="text-[10px] tracking-overline text-[var(--muted)]">Overheads &amp; payroll — department scope</div>
      <div className="flex gap-4 flex-wrap text-xs">
        {[["all", "All departments"], ["own", "Own department only (employee master)"], ["list", "Selected departments"]].map(([k, l]) => (
          <label key={k} className="flex items-center gap-1.5 cursor-pointer">
            <input type="radio" name="dept-scope" className="accent-[var(--gold)]" checked={scope === k} onChange={() => setScope(k)} data-testid={`dept-scope-${k}`} />{l}
          </label>
        ))}
      </div>
      <div className="text-[10px] text-[var(--muted)]">
        {scope === "all" && "Users see every department's overheads and payroll (subject to the section permissions below)."}
        {scope === "own" && "Each user sees only the overheads and payroll of the department recorded against them in the employee master — e.g. Admin head / staff see Admin only. Company-wide payroll lines in the P&L stay masked. Tick departments below to add more."}
        {scope === "list" && "Users see only the departments ticked below."}
      </div>
      {scope !== "all" && info && (
        <div className="flex flex-wrap gap-1">
          {info.aop.map((d) => (
            <button type="button" key={d} onClick={() => toggle(d)} data-testid={`dept-${d}`}
                    className={`chip ${depts.includes(d) ? "!border-[var(--gold)] !text-[var(--gold)] font-semibold" : ""}`}>{d}</button>
          ))}
          {!info.aop.length && <span className="text-[10.5px] text-[var(--muted)]">No departments in the overhead / payroll data yet.</span>}
        </div>
      )}
      {scope === "own" && info && info.employees.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-[10.5px] text-[var(--muted)]">Employee-master department → AOP department mapping</summary>
          <table className="w-full tbl mt-1">
            <thead><tr><th>Employee master</th><th>Matches (automatic)</th><th>Also maps to (comma separated)</th></tr></thead>
            <tbody>
              {info.employees.map((e) => (
                <tr key={e}>
                  <td>{e}</td>
                  <td className="text-[var(--muted)]">{(info.mapping[e] || []).join(", ") || "—"}</td>
                  <td>
                    <input className="input-sm w-full" list="aop-depts" value={aliases[e] || ""}
                           onChange={(ev) => setAliases((a) => ({ ...a, [e]: ev.target.value }))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <datalist id="aop-depts">{info.aop.map((d) => <option key={d} value={d} />)}</datalist>
          <div className="flex items-center gap-2 mt-1">
            <button type="button" className="btn-secondary !py-1 !text-[11px]" onClick={saveAliases}>Save mapping</button>
            <span className="text-[10.5px] text-[var(--success)]">{saved}</span>
          </div>
        </details>
      )}
    </div>
  );
}
