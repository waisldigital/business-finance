import React, { useEffect, useState } from "react";
import api, { formatApiErrorDetail } from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import { Plus, PencilSimple, Trash, X, Eye, PencilLine, ShieldStar, Warning } from "@phosphor-icons/react";

const SECTIONS = [
  { key: "dashboard",        label: "Dashboard" },
  { key: "pipeline",         label: "Pipeline" },
  { key: "projects",         label: "Projects" },
  { key: "change_requests",  label: "Change Requests" },
  { key: "customer_profile", label: "Customer Profile" },
  { key: "wbs_budget",       label: "WBS and Budget" },
];

const EMPTY_PERMS = SECTIONS.reduce((acc, s) => {
  acc[s.key] = { can_view: false, can_edit: false };
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
  const [perms, setPerms] = useState(() => {
    const base = { ...EMPTY_PERMS };
    if (role?.permissions) {
      for (const k of Object.keys(role.permissions)) {
        base[k] = {
          can_view: !!role.permissions[k]?.can_view,
          can_edit: !!role.permissions[k]?.can_edit,
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
      if (action === "can_view" && !value) next[sectionKey].can_edit = false;
      return next;
    });
  };

  const submit = async () => {
    if (!name.trim()) { setErr("Role name is required"); return; }
    setBusy(true); setErr("");
    try {
      const payload = { name: name.trim(), description, permissions: perms };
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
            <div className="text-[10px] tracking-overline text-[var(--muted)] mb-2">Workspace Section Permissions</div>
            <div className="border border-[var(--border)] overflow-hidden">
              <table className="w-full tbl">
                <thead>
                  <tr>
                    <th>Section</th>
                    <th className="text-center w-32">View</th>
                    <th className="text-center w-32">Edit (Create + Modify)</th>
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
