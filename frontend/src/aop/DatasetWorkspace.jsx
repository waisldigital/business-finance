import React, { useCallback, useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import {
  MagnifyingGlass, CaretLeft, CaretRight, Columns, UploadSimple, DownloadSimple, Trash, ArrowClockwise,
  ClipboardText, HourglassMedium, CheckCircle, WarningCircle,
} from "@phosphor-icons/react";
import DataGrid from "./DataGrid";
import ColumnManager from "./ColumnManager";
import UploadDialog from "./UploadDialog";
import PoDrawer from "./PoDrawer";
import { download } from "./format";

const PO_COLUMNS = ["po", "old_po", "new_po", "mapped_new_pos", "po_ref", "purchase_order", "dims.po"];
const PAGE = 200;

// Column groups are plan versions (F26 = FY26 forecast, B27 = FY27 budget …); "" = descriptive fields.
const groupLabel = (g) => {
  if (!g) return "Details";
  const m = /^([ABF])(\d{2})([AT]?)$/.exec(g);
  if (!m) return g;
  const kind = { A: "Actual", B: "Budget", F: "Forecast" }[m[1]];
  const sub = m[3] === "A" ? " · active" : m[3] === "T" ? " · to hire" : "";
  return `${kind} FY${m[2]}${sub}`;
};

export default function DatasetWorkspace({ dataset, admin = false, onChanged }) {
  const [columns, setColumns] = useState([]);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);
  const [showCols, setShowCols] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [po, setPo] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [groups, setGroups] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, r] = await Promise.all([
        api.get(`/aop/datasets/${dataset.key}/columns`),
        api.get(`/aop/datasets/${dataset.key}/rows`, { params: { q: query || undefined, limit: PAGE, offset } }),
      ]);
      setColumns(c.data);
      setRows(r.data.rows);
      setTotal(r.data.total);
    } catch (e) {
      setMsg({ tone: "err", text: e.response?.data?.detail || e.message });
    } finally { setLoading(false); }
  }, [dataset.key, query, offset]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setOffset(0); setSelected(new Set()); setGroups(null); setQ(""); setQuery(""); }, [dataset.key]);

  const allGroups = useMemo(() => Array.from(new Set(columns.map((c) => c.group || ""))), [columns]);
  useEffect(() => {
    if (groups === null && allGroups.length) {
      const plan = allGroups.filter(Boolean);
      setGroups(new Set(["", ...(plan.length ? [plan[plan.length - 1]] : [])]));
    }
  }, [allGroups, groups]);
  const shown = useMemo(() => columns.filter((c) => !groups || groups.has(c.group || "")), [columns, groups]);

  const canEdit = useCallback((c) => admin || !!c.user_editable, [admin]);

  const onCommit = async (edits) => {
    try {
      const { data } = await api.patch(`/aop/datasets/${dataset.key}/rows`, edits);
      const parts = [];
      if (data.applied) parts.push(`${data.applied} saved`);
      if (data.queued) parts.push(`${data.queued} sent for approval`);
      if (data.rejected?.length) parts.push(`${data.rejected.length} not allowed (${data.rejected[0].reason})`);
      setMsg({ tone: data.rejected?.length ? "warn" : "ok", text: parts.join(" · ") || "No change" });
      await load();
      onChanged?.();
    } catch (e) {
      setMsg({ tone: "err", text: e.response?.data?.detail || e.message });
    }
  };

  const doDownload = async (fmt) => {
    const res = await api.get(`/aop/datasets/${dataset.key}/download`, { params: { fmt }, responseType: "blob" });
    download(res.data, `${dataset.key}.${fmt}`);
  };

  const doDelete = async () => {
    if (!selected.size || !window.confirm(`Delete ${selected.size} row(s)? This cannot be undone.`)) return;
    await api.delete(`/aop/datasets/${dataset.key}/rows`, { data: Array.from(selected) });
    setSelected(new Set());
    load(); onChanged?.();
  };

  const editableCount = columns.filter((c) => c.user_editable).length;

  return (
    <div className="space-y-2" data-testid={`dataset-${dataset.key}`}>
      <div className="flex items-center gap-1.5 flex-wrap">
        <form className="relative" onSubmit={(e) => { e.preventDefault(); setOffset(0); setQuery(q); }}>
          <MagnifyingGlass size={12} className="absolute left-2 top-2 text-[var(--muted)]" />
          <input className="input-sm pl-6 w-56" placeholder="Search key, PO, vendor, AOP code…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="ds-search" />
        </form>
        <div className="seg" title="Column groups">
          {allGroups.map((g) => (
            <button key={g || "details"} className={groups?.has(g) ? "on" : ""}
                    onClick={() => setGroups((s) => { const n = new Set(s || []); n.has(g) ? n.delete(g) : n.add(g); return n; })}>
              {groupLabel(g)}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <span className="text-[11px] text-[var(--muted)] tabular-nums">
          {total ? `${offset + 1}–${Math.min(offset + PAGE, total)} of ${total.toLocaleString("en-IN")}` : "0 rows"}
        </span>
        <button className="icon-btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))} title="Previous page"><CaretLeft size={13} /></button>
        <button className="icon-btn" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)} title="Next page"><CaretRight size={13} /></button>
        <button className="icon-btn" onClick={load} title="Reload"><ArrowClockwise size={13} className={loading ? "animate-spin" : ""} /></button>
        {admin && (
          <>
            <span className="w-px h-5 bg-[var(--border)] mx-0.5" />
            <button className="icon-btn" onClick={() => setShowCols(true)} title="Manage columns" data-testid="ds-columns"><Columns size={14} /></button>
            <button className="icon-btn" onClick={() => setShowUpload(true)} title="Upload (add / replace / modify)" data-testid="ds-upload"><UploadSimple size={14} /></button>
            <button className="icon-btn" onClick={() => doDownload("xlsx")} title="Download all (xlsx)" data-testid="ds-download"><DownloadSimple size={14} />xlsx</button>
            <button className="icon-btn" onClick={() => doDownload("csv")} title="Download all (csv)"><DownloadSimple size={14} />csv</button>
            <button className="icon-btn danger" disabled={!selected.size} onClick={doDelete} title="Delete selected rows"><Trash size={14} />{selected.size || ""}</button>
          </>
        )}
      </div>

      <div className="flex items-center gap-3 text-[10.5px] text-[var(--muted)] min-h-[18px]">
        {!admin && (
          <span className="flex items-center gap-1">
            <ClipboardText size={12} />
            {editableCount ? `${editableCount} editable column${editableCount > 1 ? "s" : ""} (tinted) · type, or paste a block copied from Excel` : "Read-only — no editable columns for you here"}
          </span>
        )}
        {admin && <span className="flex items-center gap-1"><ClipboardText size={12} /> Admin: every cell is editable · paste blocks from Excel · Ctrl+C copies selection</span>}
        <span className="flex items-center gap-1"><HourglassMedium size={11} className="text-[var(--warning)]" /> pending approval</span>
        {msg && (
          <span className={`flex items-center gap-1 ml-auto ${msg.tone === "err" ? "text-[var(--danger)]" : msg.tone === "warn" ? "text-[var(--warning)]" : "text-[var(--success)]"}`}>
            {msg.tone === "ok" ? <CheckCircle size={12} /> : <WarningCircle size={12} />}{String(msg.text)}
          </span>
        )}
      </div>

      <DataGrid
        columns={shown}
        rows={rows}
        canEdit={canEdit}
        onCommit={onCommit}
        linkColumns={PO_COLUMNS}
        onCellLink={(c, row) => setPo(String(row.fields[c.key]).split(/[,;/\s]+/)[0])}
        selectable={admin}
        selected={selected}
        onSelect={setSelected}
      />

      {showCols && <ColumnManager dataset={dataset} columns={columns} keyFields={dataset.key_fields} onClose={() => setShowCols(false)} onSaved={load} />}
      {showUpload && <UploadDialog dataset={dataset} keyFields={dataset.key_fields} onClose={() => setShowUpload(false)} onDone={() => { load(); onChanged?.(); }} />}
      {po && <PoDrawer po={po} onClose={() => setPo(null)} onOpenPo={setPo} />}
    </div>
  );
}
