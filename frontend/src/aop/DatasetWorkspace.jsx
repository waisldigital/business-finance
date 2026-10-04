import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "@/lib/api";
import {
  MagnifyingGlass, CaretLeft, CaretRight, Columns, UploadSimple, DownloadSimple, Trash, ArrowClockwise,
  ClipboardText, HourglassMedium, CheckCircle, WarningCircle, Plus, CalendarBlank, CaretDown, CloudArrowDown,
} from "@phosphor-icons/react";
import DataGrid from "./DataGrid";
import PivotTable from "./PivotTable";
import GridSettings from "./GridSettings";
import ColumnHeader from "./ColumnHeader";
import { useGridView, arrangeColumns, applyView, cellValue, isMonthCol, monthsOpen } from "./gridView";
import { csvDownload } from "./mis";
import ColumnManager from "./ColumnManager";
import UploadDialog from "./UploadDialog";
import PoDrawer, { reviewBase } from "./PoDrawer";
import PoHistoryDrawer from "./PoHistoryDrawer";
import { download } from "./format";
import Modal from "@/components/common/Modal";
import Popover from "@/components/common/Popover";

const PO_COLUMNS = ["po", "latest_po", "previous_po", "merged_into_po", "purchase_order", "linked_old_po", "linked_forecast_s_no", "linked_lines", "dims.po"];
// the ZMM sheet: rows come from SAP; only the mapping and the corrections are typed here
const SHEET_DATASETS = new Set(["po_items", "po_register"]);
// clicks that open a line's PO history instead of a single PO
const HISTORY_COLUMNS = { opex_tracker: ["po", "previous_po"], opex_lines: ["po", "previous_po"],
                          po_register: ["linked_old_po", "linked_forecast_s_no"], po_items: ["linked_lines"],
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

/**
 * One dataset's grid. ``filter`` {field, value, label} shows one slice of it (e.g. the PAX lines of the CUTE drivers)
 * with its own view; ``preview`` is the users' view for an admin (read-only); ``manage`` adds the admin's table tools
 * (columns, add / delete rows) to that preview.
 */
export default function DatasetWorkspace({ dataset, admin = false, onChanged, focusVersion, preview = false, manage = false, filter = null }) {
  const [columns, setColumns] = useState([]);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);
  const [showCols, setShowCols] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [po, setPo] = useState(null);
  const [hist, setHist] = useState(null);
  const [review, setReview] = useState(null);
  useEffect(() => {
    if (dataset.key !== "opex_tracker" || !admin) return;
    api.get("/aop/review/summary").then((r) => setReview(r.data)).catch(() => {});
  }, [dataset.key, admin]);
  const openLink = (c, row) => {
    const f = row.fields || {};
    const first = (v) => String(v ?? "").split(/[,;/\s]+/).filter(Boolean)[0];
    if ((HISTORY_COLUMNS[dataset.key] || []).includes(c.key)) {
      if (dataset.key === "opex_tracker" || dataset.key === "opex_lines") return setHist({ lineId: row.key, po: first(f[c.key]) });
      if (dataset.key === "po_links") return setHist({ lineId: f.line_id, po: f.po });
      if (dataset.key === "po_items") { const l = first(f.linked_lines); return l ? setHist({ lineId: l, po: f.po }) : undefined; }
      const lid = first(f.linked_forecast_s_no);
      if (lid) return setHist({ lineId: lid, po: c.key === "linked_old_po" ? first(f.linked_old_po) : f.purchase_order });
    }
    const p = first(f[c.key]);
    if (p) setPo(p);
  };
  const [selected, setSelected] = useState(new Set());
  const [view, updateView, resetView, sharedView] = useGridView(`aop_grid_${dataset.key}${filter ? `_${String(filter.value).replace(/[^0-9a-zA-Z]+/g, "")}` : ""}_v1`, {});
  const canUpload = !preview && (admin || !!dataset.can_upload);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, r] = await Promise.all([
        api.get(`/aop/datasets/${dataset.key}/columns`),
        api.get(`/aop/datasets/${dataset.key}/rows`, { params: { q: query || undefined, limit: PAGE, offset, ...(filter ? { filter_field: filter.field, filter_value: filter.value } : {}) } }),
      ]);
      setColumns(c.data);
      setRows(r.data.rows);
      setTotal(r.data.total);
    } catch (e) {
      setMsg({ tone: "err", text: e.response?.data?.detail || e.message });
    } finally { setLoading(false); }
  }, [dataset.key, query, offset, filter?.field, filter?.value]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setOffset(0); setSelected(new Set()); setQ(""); setQuery(""); }, [dataset.key]);

  const allGroups = useMemo(() => Array.from(new Set(columns.map((c) => c.group || ""))), [columns]);
  // FY blocks shown (saved with the view): every FY side by side, each folded to one total column until its own 12M
  // is switched on; the report data panel opens on the draft year's budget
  const groups = useMemo(() => {
    if (!allGroups.length) return null;
    const plan = allGroups.filter(Boolean);
    if (!view.groupsOff && focusVersion && plan.includes(focusVersion)) return new Set(["", focusVersion]);
    const off = new Set(view.groupsOff || []);
    return new Set(allGroups.filter((g) => !off.has(g)));
  }, [allGroups, view.groupsOff, focusVersion]);
  const toggleGroup = (g) => updateView((v) => {
    const shownNow = groups || new Set(allGroups);
    const off = new Set(allGroups.filter((x) => !shownNow.has(x)));
    off.has(g) ? off.delete(g) : off.add(g);
    return { groupsOff: [...off] };
  });
  const periodSummary = useMemo(() => {
    const on = allGroups.filter((g) => g && groups?.has(g));
    if (!on.length) return "Period";
    const m = on.filter((g) => monthsOpen(view, g)).map(groupLabel);
    const years = on.length <= 2 ? on.map(groupLabel).join(", ") : `${on.length === allGroups.filter(Boolean).length ? "All " : ""}${on.length} years`;
    return `${years}${m.length ? ` · 12M ${m.join(", ")}` : ""}`;
  }, [allGroups, groups, view]);
  const groupMonths = (g) => columns.some((c) => isMonthCol(c) && c.group === g);
  const toggle12 = (g) => updateView((v) => {
    const cur = v.twelveM === true ? Object.fromEntries(allGroups.filter(groupMonths).map((x) => [x, true])) : { ...(v.twelveM || {}) };
    if (cur[g]) delete cur[g]; else cur[g] = true;
    return { twelveM: cur };
  });
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
  const canEdit = useCallback((c) => (preview || c.actual ? false : c.virtual ? monthsOf(c.version).some((m) => !m.actual && (admin || !!m.user_editable))
    : SHEET_DATASETS.has(dataset.key) ? admin && c.role === "input" // ZMM sheet: mapping + correctable SAP columns only
    : admin || !!c.user_editable), [admin, monthsOf, preview, dataset.key]);
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
  const loadDraftsRef = useRef(null);
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
      if (data.applied) parts.push(`${data.applied} saved${data.mapping ? ` · ${data.mapping} mapping` : ""}${data.correction ? ` · ${data.correction} correction (Review → Corrections)` : ""}`);
      if (data.queued) parts.push(`${data.queued} kept as draft — submit for approval when ready`);
      if (data.rejected?.length) parts.push(`${data.rejected.length} not allowed (${data.rejected[0].reason})`);
      setMsg({ tone: data.rejected?.length ? "warn" : "ok", text: parts.join(" · ") || "No change" });
      const keys = [...new Set(batch.map((e) => e.key))];
      if (!queue.current.some((e) => keys.includes(e.key))) { // don't overwrite lines the user is still editing
        const { data: fresh } = await api.get(`/aop/datasets/${dataset.key}/rows`, { params: { keys: keys.join("\u0001"), limit: keys.length } });
        const byKey = Object.fromEntries(fresh.rows.map((r) => [r.key, r]));
        setRows((rs) => rs.map((r) => byKey[r.key] || r));
      }
      changedCb.current?.();
      if (data.queued) loadDraftsRef.current?.();
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

  // the user's own edits in "with approval" sections: drafts until submitted as one batch
  const [drafts, setDrafts] = useState({ drafts: 0, submitted: 0 });
  const loadDrafts = useCallback(() => {
    if (admin) return;
    api.get("/aop/changes/drafts").then((r) => setDrafts({ drafts: r.data.by_dataset?.[dataset.key] || 0, submitted: r.data.submitted || 0 })).catch(() => {});
  }, [admin, dataset.key]);
  useEffect(() => { loadDrafts(); }, [loadDrafts]);
  loadDraftsRef.current = loadDrafts;
  const submitDrafts = async () => {
    const note = window.prompt(`Submit ${drafts.drafts} change(s) for approval? Add a note for the approver (optional):`, "");
    if (note === null) return;
    try {
      const { data } = await api.post("/aop/changes/submit", { dataset: dataset.key, note });
      setMsg({ tone: "ok", text: `Submitted ${data.count} change(s) as ${data.number} — the numbers stay yours, marked pending, until approved` });
      loadDrafts(); load();
    } catch (e) { setMsg({ tone: "err", text: e.response?.data?.detail || e.message }); }
  };
  const discardDrafts = async () => {
    if (!window.confirm(`Discard ${drafts.drafts} unsubmitted change(s)? The approved values come back.`)) return;
    await api.post("/aop/changes/discard", { dataset: dataset.key });
    loadDrafts(); load();
  };

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
        <Popover align="left" panelClassName="mt-1 z-50 w-64 bg-[var(--surface)] border border-[var(--border)] shadow-lg text-xs" panelTestid="ds-years-panel"
                 button={(open, toggle) => (
                   <button className={`icon-btn ${open ? "!border-[var(--gold)] !text-[var(--gold)]" : ""}`} onClick={toggle} data-testid="ds-years"
                           title="Periods: which years are shown, and which open month by month (12M)">
                     <CalendarBlank size={13} />
                     <span className="max-w-[260px] truncate">{periodSummary}</span>
                     <CaretDown size={10} />
                   </button>
                 )}>
          <div className="px-3 py-1.5 border-b border-[var(--border)] text-[10px] tracking-overline text-[var(--muted)] flex items-center">
            <span className="flex-1">Period</span><span className="w-10 text-center">12M</span>
          </div>
          {allGroups.map((g) => (
            <div key={g || "details"} className="flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--row-hover)]">
              <label className="flex-1 flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="accent-[var(--gold)]" checked={!!groups?.has(g)} onChange={() => toggleGroup(g)} data-testid={`ds-year-${g || "details"}`} />
                <span className={groups?.has(g) ? "font-semibold" : "text-[var(--muted)]"}>{groupLabel(g)}</span>
              </label>
              <span className="w-10 flex justify-center">
                {g && groupMonths(g) && (
                  <input type="checkbox" className="accent-[var(--gold)]" disabled={!groups?.has(g)} checked={monthsOpen(view, g)}
                         onChange={() => toggle12(g)} title={`${groupLabel(g)}: show the 12 months`} data-testid={`ds-12m-${g}`} />
                )}
              </span>
            </div>
          ))}
          <div className="px-3 py-1.5 border-t border-[var(--border)] flex items-center gap-2">
            <button className="underline text-[var(--muted)]" onClick={() => updateView({ groupsOff: [] })}>All years</button>
            <button className="underline text-[var(--muted)]" onClick={() => updateView({ twelveM: false })}>All as FY totals</button>
          </div>
        </Popover>
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
        {canUpload && dataset.key === "fx_rates" && <FxFetch onDone={(m) => { setMsg(m); load(); onChanged && onChanged(); }} />}
        {canUpload && (
          <>
            <button className="icon-btn" onClick={() => setShowUpload(true)} title="Bulk upload (add / modify / replace) — rows matched on the unique line id" data-testid="ds-upload"><UploadSimple size={14} /></button>
            <button className="icon-btn" onClick={() => doDownload("xlsx")} title="Download all rows with line ids (xlsx) — edit and upload back" data-testid="ds-download"><DownloadSimple size={14} />xlsx</button>
          </>
        )}
        {(admin && !preview) || manage ? (
          <>
            <button className="icon-btn" onClick={() => setShowAdd(true)} title="Add a line" data-testid="ds-add-row"><Plus size={14} /></button>
            <button className="icon-btn" onClick={() => setShowCols(true)} title="Manage columns (add fields, types, user-editable)" data-testid="ds-columns"><Columns size={14} /></button>
            <button className="icon-btn danger" disabled={!selected.size} onClick={doDelete} title="Delete selected rows"><Trash size={14} />{selected.size || ""}</button>
          </>
        ) : null}
      </div>

      <div className="flex items-center gap-3 text-[10.5px] text-[var(--muted)] min-h-[18px]">
        {admin && !preview && !SHEET_DATASETS.has(dataset.key) && <span className="flex items-center gap-1"><ClipboardText size={12} /> Admin: every cell is editable · paste blocks from Excel · Ctrl+C copies selection{(dataset.key === "opex_lines" || dataset.key === "opex_tracker") && " · New PO(s) mapped: type the POs (4200000218, 4400000018_9700001103, PO/item) or a status in words"}</span>}
        {admin && !preview && SHEET_DATASETS.has(dataset.key) && <span className="flex items-center gap-1"><ClipboardText size={12} /> {dataset.key === "po_items" ? "Opex line(s)" : "Linked Forecast S.No"}: type S. No., TRK-… or OPX-… to map · type over a SAP value (period, WBS, value…) to correct it — SAP's value is kept and shown in “Corrected” until SAP is fixed · or download, edit in Excel, upload back</span>}
        {(drafts.drafts > 0 || drafts.submitted > 0) && <span className="flex items-center gap-1"><HourglassMedium size={11} className="text-[var(--warning)]" /> pending approval (your numbers until approved)</span>}
        {drafts.drafts > 0 && (
          <span className="flex items-center gap-1.5 text-[var(--text)]" data-testid="ds-drafts">
            <b>{drafts.drafts}</b> change{drafts.drafts > 1 ? "s" : ""} not submitted
            <button className="icon-btn primary !h-6" onClick={submitDrafts} data-testid="ds-submit">Submit for approval</button>
            <button className="icon-btn !h-6" onClick={discardDrafts}>Discard</button>
          </span>
        )}
        {!drafts.drafts && drafts.submitted > 0 && <span>{drafts.submitted} change{drafts.submitted > 1 ? "s" : ""} awaiting the admin's approval</span>}
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
        totals={["aop_opex", "aop_overheads"].includes(dataset.section)}
        renderHeader={(c) => <ColumnHeader col={c} rows={rowsV} view={view} update={updateView} align={c.type === "number" || c.type === "percent" ? "right" : "left"} testid={`ds-h-${c.key}`} />}
        canEdit={canEdit}
        onCommit={onCommit}
        linkColumns={[...PO_COLUMNS, ...(HISTORY_COLUMNS[dataset.key] || [])]}
        onCellLink={openLink}
        selectable={(admin && !preview) || manage}
        selected={selected}
        onSelect={setSelected}
      />
      )}

      {showAdd && <AddRowDialog dataset={dataset} columns={columns} filter={filter} onClose={() => setShowAdd(false)}
                                onDone={() => { setShowAdd(false); load(); onChanged?.(); }} />}
      {showCols && <ColumnManager dataset={dataset} columns={columns} keyFields={dataset.key_fields} onClose={() => setShowCols(false)} onSaved={load} />}
      {showUpload && <UploadDialog dataset={dataset} keyFields={dataset.key_fields} admin={admin} onClose={() => setShowUpload(false)} onDone={() => { load(); onChanged?.(); }} />}
      {po && <PoDrawer po={po} onClose={() => setPo(null)} onOpenPo={setPo} onOpenLine={(lineId, p) => { setPo(null); setHist({ lineId, po: p }); }} />}
      {hist && <PoHistoryDrawer lineId={hist.lineId} po={hist.po} onClose={() => setHist(null)} />}
    </div>
  );
}

/** Admin: add a line — its key fields and descriptive columns; plan values are typed in the grid afterwards. */
function AddRowDialog({ dataset, columns, filter, onClose, onDone }) {
  const keys = dataset.key_fields || [];
  const fields = columns.filter((c) => !isMonthCol(c) && !c.actual && c.role !== "computed" && !/__(annual|total|sum)$/.test(c.key)
                                 && c.type !== "number" && c.type !== "percent").slice(0, 14);
  const ordered = [...keys.map((k) => fields.find((c) => c.key === k) || { key: k, label: k }), ...fields.filter((c) => !keys.includes(c.key))];
  const [f, setF] = useState(() => (filter ? { [filter.field]: filter.value } : {}));
  const [err, setErr] = useState("");
  const save = async () => {
    try {
      const { data } = await api.post(`/aop/datasets/${dataset.key}/rows`, [f]);
      if (data.errors?.length) return setErr(data.errors[0].reason);
      if (!data.added) return setErr("A line with this key already exists");
      onDone();
    } catch (e) { setErr(e.response?.data?.detail || e.message); }
  };
  return (
    <Modal title={`Add a line · ${dataset.label}${filter ? ` · ${filter.label}` : ""}`} size="md" onClose={onClose}
           footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} data-testid="add-row-save">Add</button></>}>
      <div className="px-5 py-4 grid grid-cols-2 gap-2 text-xs">
        {ordered.map((c) => (
          <label key={c.key} className="flex flex-col gap-0.5">
            <span className="text-[10px] text-[var(--muted)]">{c.label}{keys.includes(c.key) ? " · key" : ""}</span>
            <input className="input-sm" value={f[c.key] ?? ""} disabled={filter?.field === c.key}
                   onChange={(e) => setF({ ...f, [c.key]: e.target.value })} data-testid={`add-${c.key}`} />
          </label>
        ))}
        <div className="col-span-2 text-[var(--muted)]">{keys.length ? `Unique key: ${keys.join(" + ")}` : "A line id is assigned automatically"} · enter the months / FY values in the grid after adding.</div>
        {err && <div className="col-span-2 text-[var(--danger)]">{String(err)}</div>}
      </div>
    </Modal>
  );
}

/** Fetch exchange rates from the internet into "FX rates by date": for the PO dates (default) or a date range. */
function FxFetch({ onDone }) {
  const [busy, setBusy] = useState(false);
  const [range, setRange] = useState({ start: "", end: "", currencies: "", overwrite: false });
  const run = async (body, close) => {
    setBusy(true);
    try {
      const { data } = await api.post("/aop/fx-rates/fetch", body);
      const per = Object.entries(data.by_currency || {}).map(([c, n]) => `${c} ${n}`).join(", ");
      onDone({ tone: data.errors?.length ? "warn" : "ok",
               text: `FX rates: ${data.saved} new / updated${per ? ` (${per})` : ""}${data.errors?.length ? ` · ${data.errors.join("; ")}` : ""}` +
                     (data.saved ? " · re-upload the ZMM report (or wait for the next e-mail run) to re-convert POs" : "") });
      close && close();
    } catch (e) { onDone({ tone: "err", text: e.response?.data?.detail || e.message }); } finally { setBusy(false); }
  };
  return (
    <>
      <button className="icon-btn primary" disabled={busy} onClick={() => run({})} data-testid="fx-fetch"
              title="Fetch from the internet the rate of every foreign currency on the POs for each PO date (ECB reference rates; other currencies from daily market rates). Rates typed by hand are kept.">
        <CloudArrowDown size={14} className={busy ? "animate-pulse" : ""} />{busy ? "Fetching…" : "Fetch rates"}
      </button>
      <Popover align="right" panelClassName="mt-1 z-50 w-72 bg-[var(--surface)] border border-[var(--border)] shadow-lg text-xs p-3 space-y-2"
               button={(open, toggle) => <button className="icon-btn" onClick={toggle} title="Fetch a date range" data-testid="fx-fetch-range"><CaretDown size={10} /></button>}>
        {(close) => (
          <>
            <div className="font-semibold">Fetch a date range</div>
            <label className="flex items-center gap-2">From<input type="date" className="input-sm flex-1" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} /></label>
            <label className="flex items-center gap-2">To<input type="date" className="input-sm flex-1" value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} /></label>
            <input className="input-sm w-full" placeholder="Currencies, e.g. USD, EUR (blank = those on the POs)" value={range.currencies}
                   onChange={(e) => setRange({ ...range, currencies: e.target.value })} />
            <label className="flex items-center gap-1"><input type="checkbox" className="accent-[var(--gold)]" checked={range.overwrite}
                   onChange={(e) => setRange({ ...range, overwrite: e.target.checked })} />Refresh rates fetched earlier (hand-entered rates are kept)</label>
            <button className="icon-btn primary w-full justify-center" disabled={busy}
                    onClick={() => run({ start: range.start || null, end: range.end || null, currencies: range.currencies, overwrite: range.overwrite }, close)}>
              <CloudArrowDown size={13} />Fetch{range.start || range.end ? "" : " last 30 days"}
            </button>
          </>
        )}
      </Popover>
    </>
  );
}
