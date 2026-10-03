import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "@/lib/api";
import {
  MagnifyingGlass, CaretLeft, CaretRight, Columns, UploadSimple, DownloadSimple, Trash, ArrowClockwise,
  ClipboardText, HourglassMedium, CheckCircle, WarningCircle,
} from "@phosphor-icons/react";
import DataGrid from "./DataGrid";
import PivotTable from "./PivotTable";
import GridSettings from "./GridSettings";
import ColumnHeader from "./ColumnHeader";
import { useGridView, arrangeColumns, applyView, cellValue, isMonthCol } from "./gridView";
import { csvDownload } from "./mis";
import ColumnManager from "./ColumnManager";
import UploadDialog from "./UploadDialog";
import PoDrawer, { reviewBase } from "./PoDrawer";
import PoHistoryDrawer from "./PoHistoryDrawer";
import { download } from "./format";

const PO_COLUMNS = ["po", "latest_po", "previous_po", "merged_into_po", "purchase_order", "linked_old_po", "linked_forecast_s_no", "dims.po"];
// clicks that open a line's PO history instead of a single PO
const HISTORY_COLUMNS = { opex_tracker: ["po", "previous_po"], po_register: ["linked_old_po", "linked_forecast_s_no"],
                          po_links: ["line_id"] };
const PAGE = 5000; // datasets up to this size load whole, so sort / filter / pivot work on every row

// Column groups are plan versions (F26 = FY26 forecast, B27 = FY27 budget …); "" = descriptive fields.
const groupLabel = (g) => {
  if (!g) return "Details";
  const m = /^([ABF])(\d{2})([AT]?)$/.exec(g);
  if (!m) return g;
  // FY'27 A = actual, FY'27 B = budget, FY'26 F = forecast
  const sub = m[3] === "A" ? " · active" : m[3] === "T" ? " · to hire" : "";
  return `FY'${m[2]} ${m[1]}${sub}`;
};

export default function DatasetWorkspace({ dataset, admin = false, onChanged, focusVersion }) {
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
  const [hist, setHist] = useState(null);
  const [review, setReview] = useState(null);
  useEffect(() => {
    if (dataset.key !== "opex_tracker") return;
    api.get("/aop/review/summary").then((r) => setReview(r.data)).catch(() => {});
  }, [dataset.key]);
  const openLink = (c, row) => {
    const f = row.fields || {};
    const first = (v) => String(v ?? "").split(/[,;/\s]+/).filter(Boolean)[0];
    if ((HISTORY_COLUMNS[dataset.key] || []).includes(c.key)) {
      if (dataset.key === "opex_tracker") return setHist({ lineId: row.key, po: first(f[c.key]) });
      if (dataset.key === "po_links") return setHist({ lineId: f.line_id, po: f.po });
      const lid = first(f.linked_forecast_s_no);
      if (lid) return setHist({ lineId: lid, po: c.key === "linked_old_po" ? first(f.linked_old_po) : f.purchase_order });
    }
    const p = first(f[c.key]);
    if (p) setPo(p);
  };
  const [selected, setSelected] = useState(new Set());
  const [groups, setGroups] = useState(null);
  const [view, updateView, resetView, sharedView] = useGridView(`aop_grid_${dataset.key}_v1`, {});
  const canUpload = admin || !!dataset.can_upload;

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
      // every FY side by side (each folds to one total column until 12M is switched on); the report data panel
      // opens on the draft year's budget
      setGroups(new Set(["", ...(focusVersion && plan.includes(focusVersion) ? [focusVersion] : plan)]));
    }
  }, [allGroups, groups, focusVersion]);
  const shown = useMemo(() => columns.filter((c) => !groups || groups.has(c.group || "")), [columns, groups]);
  const hasMonths = useMemo(() => shown.some(isMonthCol), [shown]);

  // columns as the viewer arranged them; 12M off folds each version's months into one total column
  const arranged = useMemo(() => arrangeColumns(shown, view), [shown, view]);
  const visible = useMemo(() => arranged.filter((c) => !c.hiddenByUser), [arranged]);
  const virtual = useMemo(() => visible.filter((c) => c.virtual), [visible]);
  const rowsV = useMemo(() => (virtual.length ? rows.map((r) => ({
    ...r, fields: { ...r.fields, ...Object.fromEntries(virtual.map((c) => [c.key, cellValue(r, c)])) },
  })) : rows), [rows, virtual]);
  const filtered = useMemo(() => applyView(rowsV, arranged, view), [rowsV, arranged, view]);

  // a folded FY total (12M off) is editable when its months are: the value is phased evenly over the months
  const monthsOf = useCallback((v) => columns.filter((c) => isMonthCol(c) && c.key.startsWith(`${v}__`)), [columns]);
  // actual months come from the single actual source and are never typed over
  const canEdit = useCallback((c) => (c.actual ? false : c.virtual ? monthsOf(c.version).some((m) => !m.actual && (admin || !!m.user_editable))
    : admin || !!c.user_editable), [admin, monthsOf]);
  const downloadView = () => {
    csvDownload([visible.map((c) => c.label), ...filtered.map((r) => visible.map((c) => cellValue(r, c)))], `${dataset.key}_view.csv`);
  };

  // ---- background saving: edits show at once, are batched and saved behind the scenes; only the touched lines
  // are re-read afterwards (to pick up server-side totals / phasing), never the whole dataset
  const queue = useRef([]);
  const timer = useRef(null);
  const inFlight = useRef(false);
  const changedCb = useRef(onChanged);
  changedCb.current = onChanged;
  const [saving, setSaving] = useState(0);
  const colType = useMemo(() => Object.fromEntries(columns.map((c) => [c.key, c.type])), [columns]);
  const asValue = (field, v) => {
    if (v === null || v === undefined || v === "") return null;
    if (!["number", "money", "percent"].includes(colType[field]) && !isMonthCol({ key: field })) return v;
    const t = String(v).replace(/[,₹\s]/g, "");
    const pct = t.endsWith("%");
    const n = Number(t.replace(/%$/, "").replace(/^\((.*)\)$/, "-$1"));
    return Number.isNaN(n) ? v : pct ? n / 100 : n;
  };

  const flush = useCallback(async () => {
    if (inFlight.current || !queue.current.length) return;
    inFlight.current = true;
    const batch = Object.values(Object.fromEntries(queue.current.map((e) => [`${e.key}\u0001${e.field}`, e]))); // last edit wins
    queue.current = [];
    try {
      const { data } = await api.patch(`/aop/datasets/${dataset.key}/rows`, batch);
      const parts = [];
      if (data.applied) parts.push(`${data.applied} saved`);
      if (data.queued) parts.push(`${data.queued} sent for approval`);
      if (data.rejected?.length) parts.push(`${data.rejected.length} not allowed (${data.rejected[0].reason})`);
      setMsg({ tone: data.rejected?.length ? "warn" : "ok", text: parts.join(" · ") || "No change" });
      const keys = [...new Set(batch.map((e) => e.key))];
      if (!queue.current.some((e) => keys.includes(e.key))) { // don't overwrite lines the user is still editing
        const { data: fresh } = await api.get(`/aop/datasets/${dataset.key}/rows`, { params: { keys: keys.join("\u0001"), limit: keys.length } });
        const byKey = Object.fromEntries(fresh.rows.map((r) => [r.key, r]));
        setRows((rs) => rs.map((r) => byKey[r.key] || r));
      }
      changedCb.current?.();
    } catch (e) {
      queue.current = [...batch, ...queue.current]; // keep the edits; they go with the next save
      setMsg({ tone: "err", text: `Not saved yet — ${e.response?.data?.detail || e.message}. Retrying…` });
      clearTimeout(timer.current);
      timer.current = setTimeout(() => flush(), 4000);
    } finally {
      inFlight.current = false;
      setSaving(queue.current.length);
      if (queue.current.length) { clearTimeout(timer.current); timer.current = setTimeout(() => flush(), 300); }
    }
  }, [dataset.key]);

  useEffect(() => {
    const warn = (e) => { if (queue.current.length || inFlight.current) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => { window.removeEventListener("beforeunload", warn); clearTimeout(timer.current); flush(); };
  }, [flush]);

  const onCommit = (raw) => {
    const edits = raw.flatMap((e) => {
      const v = /^(.+)__sum$/.exec(e.field)?.[1];
      if (!v) return [{ ...e, value: asValue(e.field, e.value) }];
      const ms = monthsOf(v);
      const n = asValue(`${v}__2000-01`, e.value);
      return ms.map((m) => ({ key: e.key, field: m.key, value: typeof n === "number" ? Math.round((n / ms.length) * 100) / 100 : null }));
    });
    if (!edits.length) return;
    // show the new values straight away
    const byKey = {};
    edits.forEach((e) => { (byKey[e.key] = byKey[e.key] || {})[e.field] = e.value; });
    setRows((rs) => rs.map((r) => (byKey[r.key] ? { ...r, fields: { ...r.fields, ...byKey[r.key] } } : r)));
    queue.current.push(...edits);
    setSaving(queue.current.length);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(), 600);
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
      {review?.changes > 0 && (
        <a href={`${reviewBase()}?tab=changes`} className="flex items-center gap-2 border border-[var(--warning)] bg-[var(--surface)] px-3 py-1.5 text-xs" data-testid="tracker-review-banner">
          <WarningCircle size={14} className="text-[var(--warning)]" />
          <span><b>{review.changes}</b> pending PO change{review.changes > 1 ? "s" : ""}, ₹{((review.pending_fy_impact || 0) / 1e5).toLocaleString("en-IN", { maximumFractionDigits: 2 })} L FY impact — the forecast keeps the accepted values until reviewed</span>
          <span className="ml-auto text-[var(--gold)] font-semibold">Review →</span>
        </a>
      )}
      <div className="flex items-center gap-1.5 flex-wrap">
        <form className="relative" onSubmit={(e) => { e.preventDefault(); setOffset(0); setQuery(q); }}>
          <MagnifyingGlass size={12} className="absolute left-2 top-2 text-[var(--muted)]" />
          <input className="input-sm pl-6 w-56" placeholder="Search key, PO, vendor, AOP code…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="ds-search" />
        </form>
        <GridSettings cols={arranged} view={view} update={updateView} reset={resetView} shared={sharedView} hasMonths={hasMonths} align="left" testid="ds-grid" />
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
          {total ? (filtered.length !== rows.length ? `${filtered.length.toLocaleString("en-IN")} of ${total.toLocaleString("en-IN")} (filtered)` :
            `${offset + 1}–${Math.min(offset + PAGE, total)} of ${total.toLocaleString("en-IN")}`) : "0 rows"}
        </span>
        <button className="icon-btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))} title="Previous page"><CaretLeft size={13} /></button>
        <button className="icon-btn" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)} title="Next page"><CaretRight size={13} /></button>
        <button className="icon-btn" onClick={load} title="Reload"><ArrowClockwise size={13} className={loading ? "animate-spin" : ""} /></button>
        <span className="w-px h-5 bg-[var(--border)] mx-0.5" />
        <button className="icon-btn" onClick={downloadView} title="Download this view (csv) — filters, sort and columns as shown" data-testid="ds-download-view"><DownloadSimple size={14} />view</button>
        {canUpload && (
          <>
            <button className="icon-btn" onClick={() => setShowUpload(true)} title="Bulk upload (add / modify / replace) — rows matched on the unique line id" data-testid="ds-upload"><UploadSimple size={14} /></button>
            <button className="icon-btn" onClick={() => doDownload("xlsx")} title="Download all rows with line ids (xlsx) — edit and upload back" data-testid="ds-download"><DownloadSimple size={14} />xlsx</button>
          </>
        )}
        {admin && (
          <>
            <button className="icon-btn" onClick={() => setShowCols(true)} title="Manage columns (add fields, types, user-editable)" data-testid="ds-columns"><Columns size={14} /></button>
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
        {saving > 0 && <span className="flex items-center gap-1 text-[var(--gold)]" data-testid="ds-saving"><HourglassMedium size={11} />Saving {saving} change{saving > 1 ? "s" : ""} in the background…</span>}
        {msg && (
          <span className={`flex items-center gap-1 ml-auto ${msg.tone === "err" ? "text-[var(--danger)]" : msg.tone === "warn" ? "text-[var(--warning)]" : "text-[var(--success)]"}`}>
            {msg.tone === "ok" ? <CheckCircle size={12} /> : <WarningCircle size={12} />}{String(msg.text)}
          </span>
        )}
      </div>

      {view.pivot > 0 ? (
        <PivotTable key={view.subtotals ? "sub" : "flat"} cols={visible} rows={filtered} allRows={rowsV} view={view} update={updateView} levels={Math.min(view.pivot, visible.length)}
                    testid="ds-pivot" />
      ) : (
      <DataGrid
        columns={visible}
        rows={filtered}
        renderHeader={(c) => <ColumnHeader col={c} rows={rowsV} view={view} update={updateView} align={c.type === "number" || c.type === "percent" ? "right" : "left"} testid={`ds-h-${c.key}`} />}
        canEdit={canEdit}
        onCommit={onCommit}
        linkColumns={[...PO_COLUMNS, ...(HISTORY_COLUMNS[dataset.key] || [])]}
        onCellLink={openLink}
        selectable={admin}
        selected={selected}
        onSelect={setSelected}
      />
      )}

      {showCols && <ColumnManager dataset={dataset} columns={columns} keyFields={dataset.key_fields} onClose={() => setShowCols(false)} onSaved={load} />}
      {showUpload && <UploadDialog dataset={dataset} keyFields={dataset.key_fields} admin={admin} onClose={() => setShowUpload(false)} onDone={() => { load(); onChanged?.(); }} />}
      {po && <PoDrawer po={po} onClose={() => setPo(null)} onOpenPo={setPo} onOpenLine={(lineId, p) => { setPo(null); setHist({ lineId, po: p }); }} />}
      {hist && <PoHistoryDrawer lineId={hist.lineId} po={hist.po} onClose={() => setHist(null)} />}
    </div>
  );
}
