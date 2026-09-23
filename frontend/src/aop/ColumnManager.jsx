import React, { useMemo, useState } from "react";
import api from "@/lib/api";
import { X, ArrowUp, ArrowDown, Trash, Plus, Eye, EyeSlash, PencilSimpleLine, LockSimple, FloppyDisk, MagnifyingGlass } from "@phosphor-icons/react";

const TYPES = ["text", "number", "percent", "date"];

export default function ColumnManager({ dataset, columns, keyFields = [], onClose, onSaved }) {
  const [cols, setCols] = useState(() => columns.map((c) => ({ ...c })));
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [purge, setPurge] = useState(false);
  const removed = useMemo(() => columns.filter((c) => !cols.some((x) => x.key === c.key)), [cols, columns]);

  const set = (i, patch) => setCols((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const moveTo = (i, d) => setCols((cs) => {
    const j = i + d;
    if (j < 0 || j >= cs.length) return cs;
    const n = [...cs];
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });
  const add = () => {
    const label = window.prompt("New column label");
    if (!label) return;
    const key = label.trim().toLowerCase().replace(/[^0-9a-z]+/g, "_").replace(/^_|_$/g, "");
    if (cols.some((c) => c.key === key)) { setErr(`Column ${key} already exists`); return; }
    setCols((cs) => [...cs, { key, label: label.trim(), type: "text", user_editable: true, hidden: false, custom: true }]);
  };
  const save = async () => {
    setBusy(true); setErr("");
    try {
      await api.put(`/aop/datasets/${dataset.key}/columns`, cols, { params: { purge } });
      onSaved?.();
      onClose();
    } catch (e) { setErr(e.response?.data?.detail || e.message); } finally { setBusy(false); }
  };

  const visibleIdx = cols.map((c, i) => i).filter((i) => !q || `${cols[i].key} ${cols[i].label}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" data-testid="aop-column-manager">
      <div className="bg-[var(--surface)] border border-[var(--border)] w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)]">
          <div className="text-sm font-semibold flex-1">Columns · {dataset.label} <span className="chip ml-1">{cols.length}</span></div>
          <div className="relative">
            <MagnifyingGlass size={12} className="absolute left-2 top-2 text-[var(--muted)]" />
            <input className="input-sm pl-6 w-44" placeholder="Find column" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <button className="icon-btn" onClick={add} title="Add column" data-testid="col-add"><Plus size={14} /></button>
          <button className="icon-btn" onClick={onClose} title="Close"><X size={14} /></button>
        </div>
        <div className="overflow-auto flex-1">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-[var(--table-header-bg)] text-[10.5px] text-[var(--muted)]">
              <tr>
                <th className="text-left px-2 py-1.5 w-16">Order</th>
                <th className="text-left px-2">Label</th>
                <th className="text-left px-2">Key</th>
                <th className="text-left px-2 w-24">Type</th>
                <th className="px-2 w-14" title="Users may edit this column"><PencilSimpleLine size={13} /></th>
                <th className="px-2 w-14" title="Visible"><Eye size={13} /></th>
                <th className="px-2 w-10" />
              </tr>
            </thead>
            <tbody>
              {visibleIdx.map((i) => {
                const c = cols[i];
                const isKey = keyFields.includes(c.key) || c.key === "line_id";
                return (
                  <tr key={c.key} className="border-b border-[var(--border-soft)]">
                    <td className="px-2 py-1 whitespace-nowrap">
                      <button className="icon-btn !h-6 !min-w-6 !px-1" onClick={() => moveTo(i, -1)} title="Move up"><ArrowUp size={11} /></button>
                      <button className="icon-btn !h-6 !min-w-6 !px-1 ml-0.5" onClick={() => moveTo(i, 1)} title="Move down"><ArrowDown size={11} /></button>
                    </td>
                    <td className="px-2"><input className="input-sm w-full !h-6" value={c.label} onChange={(e) => set(i, { label: e.target.value })} /></td>
                    <td className="px-2 font-mono text-[10.5px] text-[var(--muted)]">{c.key}{isKey && <LockSimple size={10} className="inline ml-1" />}</td>
                    <td className="px-2">
                      <select className="input-sm !h-6 w-full" value={c.type || "text"} onChange={(e) => set(i, { type: e.target.value })}>
                        {TYPES.map((t) => <option key={t}>{t}</option>)}
                      </select>
                    </td>
                    <td className="text-center"><input type="checkbox" className="accent-[var(--gold)]" disabled={isKey} checked={!!c.user_editable} onChange={(e) => set(i, { user_editable: e.target.checked })} /></td>
                    <td className="text-center">
                      <button className="icon-btn !h-6 !min-w-6 !px-1" onClick={() => set(i, { hidden: !c.hidden })} title={c.hidden ? "Show" : "Hide"}>
                        {c.hidden ? <EyeSlash size={12} /> : <Eye size={12} />}
                      </button>
                    </td>
                    <td className="text-center">
                      {!isKey && <button className="icon-btn danger !h-6 !min-w-6 !px-1" onClick={() => setCols((cs) => cs.filter((_, j) => j !== i))} title="Delete column"><Trash size={12} /></button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center gap-3 px-4 py-2.5 border-t border-[var(--border)] text-xs">
          {removed.length > 0 && (
            <label className="flex items-center gap-1.5 text-[var(--danger)]">
              <input type="checkbox" className="accent-[var(--danger)]" checked={purge} onChange={(e) => setPurge(e.target.checked)} />
              Also erase data of {removed.length} removed column{removed.length > 1 ? "s" : ""}
            </label>
          )}
          {err && <span className="text-[var(--danger)]">{String(err)}</span>}
          <div className="flex-1" />
          <button className="icon-btn primary" onClick={save} disabled={busy} data-testid="col-save"><FloppyDisk size={14} /> {busy ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}
