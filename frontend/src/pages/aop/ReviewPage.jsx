import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "@/lib/api";
import PageHeader from "@/components/PageHeader";
import Modal from "@/components/common/Modal";
import PoDrawer from "@/aop/PoDrawer";
import PoHistoryDrawer from "@/aop/PoHistoryDrawer";
import { fmtCell, download } from "@/aop/format";
import {
  ListChecks, MapPin, Swap, Flag, CheckSquare, ClockCounterClockwise, CheckCircle, WarningCircle, DownloadSimple,
  UploadSimple, ArrowClockwise, CaretDown, CaretRight, MagnifyingGlass,
} from "@phosphor-icons/react";

const TABS = [
  ["to-map", "To map", MapPin, "to_map"], ["changes", "PO changes", Swap, "changes"], ["corrections", "Corrections", Flag, "corrections"],
  ["checks", "Checks", CheckSquare, "checks"], ["runs", "Upload log", ClockCounterClockwise, null],
];
const L = (v) => (v === null || v === undefined || v === "" ? "—" : (Number(v) / 1e5).toLocaleString("en-IN", { maximumFractionDigits: 2 }));
const err = (e) => e.response?.data?.detail || e.message;
const getFile = (url, name) => api.get(url, { responseType: "blob" }).then((r) => download(r.data, name));

/** Review — all human work on POs: map new POs, review changes on mapped POs, chase corrections, clear checks. */
export default function ReviewPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "to-map";
  const [summary, setSummary] = useState(null);
  const [po, setPo] = useState(null);
  const [hist, setHist] = useState(null);
  const loadSummary = useCallback(() => api.get("/aop/review/summary").then((r) => setSummary(r.data)).catch(() => {}), []);
  useEffect(() => { loadSummary(); }, [loadSummary]);
  const ctx = { openPo: setPo, openLine: (lineId, p) => setHist({ lineId, po: p }), refresh: loadSummary };
  return (
    <div data-testid="aop-review-page">
      <PageHeader compact icon={ListChecks} title="Review"
                  subtitle={`New POs to map, changes on mapped POs, corrections in SAP and data checks${summary?.last_run ? ` · last ZMM ${String(summary.last_run.received_at || "").slice(0, 16).replace("T", " ")} (${summary.last_run.source})` : ""}`} />
      <div className="px-3 pt-2 flex items-center gap-1 border-b border-[var(--border)] bg-[var(--surface)] overflow-x-auto">
        {TABS.map(([k, label, Icon, count]) => (
          <button key={k} onClick={() => setParams({ tab: k })} data-testid={`review-tab-${k}`}
                  className={`px-3 py-1.5 text-xs whitespace-nowrap border-b-2 -mb-px flex items-center gap-1 ${tab === k ? "border-[var(--gold)] text-[var(--text)] font-semibold" : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"}`}>
            <Icon size={13} />{label}
            {count && summary?.[count] > 0 && <span className="text-[10px] font-bold px-1.5 text-black" style={{ background: "var(--gold)" }}>{summary[count]}</span>}
          </button>
        ))}
        {summary?.changes > 0 && <span className="ml-auto text-[11px] text-[var(--muted)] pr-2">Pending FY impact ₹{L(summary.pending_fy_impact)} L</span>}
      </div>
      <div className="p-3 text-xs">
        {tab === "to-map" && <ToMap ctx={ctx} focusPo={params.get("po")} />}
        {tab === "changes" && <Changes ctx={ctx} />}
        {tab === "corrections" && <Corrections ctx={ctx} />}
        {tab === "checks" && <Checks ctx={ctx} />}
        {tab === "runs" && <Runs ctx={ctx} />}
      </div>
      {po && <PoDrawer po={po} onClose={() => setPo(null)} onOpenPo={setPo} onOpenLine={(l, p) => { setPo(null); setHist({ lineId: l, po: p }); }} />}
      {hist && <PoHistoryDrawer lineId={hist.lineId} po={hist.po} onClose={() => setHist(null)} />}
    </div>
  );
}

function Msg({ m }) {
  if (!m) return null;
  return <span className={`flex items-center gap-1 ${m.tone === "err" ? "text-[var(--danger)]" : "text-[var(--success)]"}`}>
    {m.tone === "err" ? <WarningCircle size={12} /> : <CheckCircle size={12} />}{String(m.text)}</span>;
}

const PoBtn = ({ po, open }) => <button className="font-mono text-[var(--gold)] underline decoration-dotted" onClick={() => open(po)}>{po}</button>;

// ============================================================================================ To map
function ToMap({ ctx, focusPo }) {
  const [data, setData] = useState(null);
  const [q, setQ] = useState(focusPo || "");
  const [sel, setSel] = useState(new Set());
  const [lineFor, setLineFor] = useState({});
  const [open, setOpen] = useState(focusPo || null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api.get("/aop/review/to-map", { params: { q: q || undefined } }).then((r) => setData(r.data)).catch((e) => setMsg({ tone: "err", text: err(e) }));
  }, [q]);
  useEffect(() => { load(); }, [load]);
  const rows = data?.rows || [];
  const decide = async (decisions) => {
    setBusy(true); setMsg(null);
    try {
      const r = await api.post("/aop/review/to-map/decide", { decisions });
      const e = r.data.errors || [];
      setMsg({ tone: e.length ? "err" : "ok", text: `${r.data.decided} PO(s) decided, ${r.data.links} link(s)${e.length ? ` · ${e.map((x) => `${x.po}: ${x.reason}`).join("; ")}` : ""}` });
      setSel(new Set()); setOpen(null); load(); ctx.refresh();
    } catch (e) { setMsg({ tone: "err", text: err(e) }); } finally { setBusy(false); }
  };
  const bulk = () => {
    const ds = rows.filter((r) => sel.has(r.po) && r.suggested_type).map((r) => {
      if (r.suggested_type === "Opex") {
        const lid = lineFor[r.po] ?? r.suggestions?.[0]?.line_id;
        return lid ? { po: r.po, type: "Opex", opex_action: "Renewal / replacement", line_id: lid } : null;
      }
      return { po: r.po, type: r.suggested_type };
    }).filter(Boolean);
    const skipped = [...sel].length - ds.length;
    if (!ds.length) return setMsg({ tone: "err", text: "Nothing to confirm — selected POs need a pre-filled type (and a line for Opex)" });
    if (!window.confirm(`Confirm the pre-filled type for ${ds.length} PO(s)?${skipped ? ` ${skipped} without a type / line are skipped.` : ""}`)) return;
    decide(ds);
  };
  const allSel = rows.length && rows.every((r) => sel.has(r.po));
  return (
    <div className="space-y-2" data-testid="review-to-map">
      <div className="flex items-center gap-2 flex-wrap">
        <form className="relative" onSubmit={(e) => { e.preventDefault(); load(); }}>
          <MagnifyingGlass size={12} className="absolute left-2 top-2 text-[var(--muted)]" />
          <input className="input-sm pl-6 w-64" placeholder="PO, supplier, WBS, description…" value={q} onChange={(e) => setQ(e.target.value)} />
        </form>
        <button className="icon-btn primary" disabled={!sel.size || busy} onClick={bulk} data-testid="to-map-bulk"><CheckSquare size={13} />Confirm pre-filled ({sel.size})</button>
        <span className="text-[var(--muted)]">{rows.length} PO(s) · type pre-filled from the WBS prefix (WOIN / WSIN Opex · WCIN Capex · VHDC / WSEG / UOVD Overheads); deleted / blocked POs are set to Mapping not required automatically</span>
        <Msg m={msg} />
      </div>
      <div className="border border-[var(--border)] bg-[var(--surface)] overflow-auto">
        <table className="w-full">
          <thead className="bg-[var(--table-header-bg)] text-[10.5px] text-[var(--muted)]">
            <tr>
              <th className="px-2 py-1 w-6"><input type="checkbox" checked={!!allSel} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.po)) : new Set())} /></th>
              {["", "PO", "Supplier", "WBS", "Items", "Value ₹ L", "FY impact ₹ L", "Period", "Pre-filled type", "Suggested line (Opex)", ""].map((h, i) => <th key={i} className="text-left px-2 py-1 whitespace-nowrap">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <React.Fragment key={r.po}>
                <tr className="border-t border-[var(--border-soft)] hover:bg-[var(--row-hover)]">
                  <td className="px-2"><input type="checkbox" checked={sel.has(r.po)} onChange={(e) => { const n = new Set(sel); e.target.checked ? n.add(r.po) : n.delete(r.po); setSel(n); }} /></td>
                  <td className="px-1"><button onClick={() => setOpen(open === r.po ? null : r.po)}>{open === r.po ? <CaretDown size={12} /> : <CaretRight size={12} />}</button></td>
                  <td className="px-2 py-1"><PoBtn po={r.po} open={ctx.openPo} /></td>
                  <td className="px-2 max-w-[220px] truncate" title={r.supplier_name}>{r.supplier_name}</td>
                  <td className="px-2 font-mono">{r.wbs}</td>
                  <td className="px-2">{r.items.length}</td>
                  <td className="px-2 text-right tabular-nums">{L(r.value_inr)}</td>
                  <td className="px-2 text-right tabular-nums">{L(r.fy_impact_inr)}</td>
                  <td className="px-2 whitespace-nowrap">{fmtCell(r.period_start, "date")} → {fmtCell(r.period_end, "date")}</td>
                  <td className="px-2">{r.suggested_type || (r.mixed_types ? <span className="text-[var(--warning)]">mixed — split by item</span> : <span className="text-[var(--muted)]">—</span>)}
                    {r.awaiting_correction && <span className="chip ml-1 !text-[var(--danger)]">awaiting correction</span>}</td>
                  <td className="px-2">
                    {r.suggested_type === "Opex" && (
                      <select className="input-sm max-w-[260px]" value={lineFor[r.po] ?? r.suggestions?.[0]?.line_id ?? ""} onChange={(e) => setLineFor({ ...lineFor, [r.po]: e.target.value })}>
                        <option value="">— pick in the form —</option>
                        {r.suggestions.map((s) => <option key={s.line_id} value={s.line_id}>{s.line_id} · {s.aop_code || ""} · {s.vendor || ""} ({s.reason})</option>)}
                      </select>
                    )}
                  </td>
                  <td className="px-2"><button className="icon-btn" onClick={() => setOpen(open === r.po ? null : r.po)}>Map…</button></td>
                </tr>
                {open === r.po && <tr><td colSpan={12} className="bg-[var(--surface-2)] p-3"><MapForm row={r} meta={data} busy={busy} onDecide={decide} /></td></tr>}
              </React.Fragment>
            ))}
            {!rows.length && <tr><td colSpan={12} className="px-3 py-8 text-center text-[var(--muted)]">Nothing to map{data ? "" : " (loading…)"} — new PO items appear here after each ZMM run</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LinePicker({ value, onChange, suggestions, testid }) {
  const [opts, setOpts] = useState([]);
  const [q, setQ] = useState("");
  useEffect(() => {
    if (q.length < 2) return setOpts([]);
    const t = setTimeout(() => api.get("/aop/datasets/opex_tracker/rows", { params: { q, limit: 30 } })
      .then((r) => setOpts(r.data.rows.map((x) => ({ line_id: x.key, aop_code: x.fields.aop_code, vendor: x.fields.vendor || x.fields.supplier_name, po: x.fields.po })))).catch(() => {}), 300);
    return () => clearTimeout(t);
  }, [q]);
  const all = [...(suggestions || []), ...opts.filter((o) => !(suggestions || []).some((s) => s.line_id === o.line_id))];
  return (
    <span className="inline-flex items-center gap-1">
      <select className="input-sm max-w-[320px]" value={value || ""} onChange={(e) => onChange(e.target.value)} data-testid={testid}>
        <option value="">— line —</option>
        {value && !all.some((o) => o.line_id === value) && <option value={value}>{value}</option>}
        {all.map((s) => <option key={s.line_id} value={s.line_id}>{s.line_id} · {s.aop_code || ""} · {s.vendor || ""} · old PO {s.po || "—"}{s.reason ? ` (${s.reason})` : ""}</option>)}
      </select>
      <input className="input-sm w-32" placeholder="search lines…" value={q} onChange={(e) => setQ(e.target.value)} />
    </span>
  );
}

function MapForm({ row, meta, busy, onDecide }) {
  const [d, setD] = useState({ type: row.suggested_type || "", opex_action: "Renewal / replacement", line_id: row.suggestions?.[0]?.line_id || "",
                               add_as_new_line: false, budgeted: true, new_line: { aop_code: row.aop_code_suggestion || "", tag: row.location || "", category: row.category || "" },
                               department: row.department || "" });
  const [split, setSplit] = useState(row.mixed_types);
  const [items, setItems] = useState(() => Object.fromEntries(row.items.map((i) => [i.item, { type: i.suggested_type || row.suggested_type || "", line_id: row.suggestions?.[0]?.line_id || "", add_as_new_line: false }])));
  const [ohLines, setOhLines] = useState([]);
  const [capex, setCapex] = useState([]);
  const set = (k, v) => setD((x) => ({ ...x, [k]: v }));
  const setNl = (k, v) => setD((x) => ({ ...x, new_line: { ...x.new_line, [k]: v } }));
  useEffect(() => {
    if (d.type === "Overheads") api.get("/aop/review/overhead-budget-lines", { params: { department: d.department || undefined } }).then((r) => setOhLines(r.data)).catch(() => {});
    if (d.type === "Capex" && !capex.length) api.get("/aop/review/capex-projects").then((r) => setCapex(r.data)).catch(() => {});
  }, [d.type, d.department]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = () => {
    if (split) {
      // one decision per item; Opex renewal items going to lines become material / item-level links
      const ds = row.items.map((i) => {
        const x = items[i.item];
        if (!x.type) return null;
        if (x.type === "Opex") return { po: row.po, items: [i.item], type: "Opex", opex_action: "Renewal / replacement",
                                        rows: [{ line_id: x.line_id, po_item: i.item, add_as_new_line: x.add_as_new_line }] };
        return { po: row.po, items: [i.item], type: x.type, not_required_reason: x.type === "Mapping not required" ? "Other" : undefined };
      }).filter(Boolean);
      return onDecide(ds);
    }
    const out = { po: row.po, ...d };
    if (d.type === "Needs correction") out.needs_correction = true;
    onDecide([out]);
  };
  const T = meta?.types || [];
  return (
    <div className="space-y-2" data-testid={`map-form-${row.po}`}>
      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-1"><input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} /> Split by item</label>
        {!split && (
          <label className="flex items-center gap-1">Type
            <select className="input-sm" value={d.type} onChange={(e) => set("type", e.target.value)} data-testid="map-type">
              <option value="">—</option>{T.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
        )}
        <span className="text-[var(--muted)]">{row.items.map((i) => `${i.item}: ${i.material || ""} ${i.material_description || ""}`).join(" · ")}</span>
      </div>
      {split && (
        <table className="border border-[var(--border)] bg-[var(--surface)]">
          <tbody>
            {row.items.map((i) => (
              <tr key={i.item} className="border-t border-[var(--border-soft)]">
                <td className="px-2 py-1">Item {i.item}</td><td className="px-2 font-mono">{i.material}</td>
                <td className="px-2 max-w-[200px] truncate">{i.material_description}</td><td className="px-2 text-right">₹{L(i.value_inr)} L</td>
                <td className="px-2"><select className="input-sm" value={items[i.item].type} onChange={(e) => setItems({ ...items, [i.item]: { ...items[i.item], type: e.target.value } })}>
                  <option value="">—</option>{T.filter((t) => t !== "Needs correction").map((t) => <option key={t}>{t}</option>)}</select></td>
                <td className="px-2">{items[i.item].type === "Opex" && <LinePicker value={items[i.item].line_id} suggestions={row.suggestions}
                                     onChange={(v) => setItems({ ...items, [i.item]: { ...items[i.item], line_id: v } })} />}</td>
                <td className="px-2">{items[i.item].type === "Opex" && <label className="flex items-center gap-1 whitespace-nowrap"><input type="checkbox" checked={items[i.item].add_as_new_line}
                                     onChange={(e) => setItems({ ...items, [i.item]: { ...items[i.item], add_as_new_line: e.target.checked } })} />Add as a new line</label>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!split && d.type === "Opex" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            {["Renewal / replacement", "New recurring (first time)", "One-time"].map((a) => (
              <label key={a} className="flex items-center gap-1"><input type="radio" checked={d.opex_action === a} onChange={() => set("opex_action", a)} />{a}</label>
            ))}
          </div>
          {d.opex_action === "Renewal / replacement" ? (
            <div className="flex items-center gap-2 flex-wrap">
              <span>Renews line</span><LinePicker value={d.line_id} onChange={(v) => set("line_id", v)} suggestions={row.suggestions} testid="map-line" />
              <label className="flex items-center gap-1"><input type="checkbox" checked={d.add_as_new_line} onChange={(e) => set("add_as_new_line", e.target.checked)} data-testid="map-addon" />
                Add as a new line (adds to cost, doesn't replace)</label>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2 max-w-4xl">
              {d.opex_action === "One-time" && <label className="col-span-4 flex items-center gap-2">Existing one-time line (optional) <LinePicker value={d.line_id} onChange={(v) => set("line_id", v)} suggestions={[]} /></label>}
              {[["aop_code", "AOP code"], ["tag", "Location"], ["category", "Category (CA/CR/Others)"], ["package_l1", "Package L-1"], ["package_l2", "Package L-2"],
                ["package_l3", "Package L-3"], ["nature_of_expense", "Nature of expense"], ["owner", "Ops POC (owner)"]].map(([k, l]) => (
                <label key={k} className="flex flex-col gap-0.5"><span className="text-[10px] text-[var(--muted)]">{l}</span>
                  <input className="input-sm" value={d.new_line[k] || ""} onChange={(e) => setNl(k, e.target.value)} /></label>
              ))}
              <div className="col-span-4 text-[var(--muted)]">Pre-filled from the ZMM: WBS {row.wbs}, supplier {row.supplier_name}, period {row.period_start} → {row.period_end}, ₹{L(row.value_inr)} L. The new line starts with budget 0.</div>
            </div>
          )}
        </div>
      )}
      {!split && d.type === "Overheads" && (
        <div className="flex items-center gap-2 flex-wrap">
          <label className="flex items-center gap-1">Department <input className="input-sm w-40" value={d.department} onChange={(e) => set("department", e.target.value)} /></label>
          <label className="flex items-center gap-1"><input type="radio" checked={d.budgeted} onChange={() => set("budgeted", true)} />Budgeted</label>
          <label className="flex items-center gap-1"><input type="radio" checked={!d.budgeted} onChange={() => set("budgeted", false)} />Unbudgeted</label>
          {d.budgeted ? (
            <select className="input-sm max-w-[420px]" value={d.budget_code || ""} onChange={(e) => set("budget_code", e.target.value)}>
              <option value="">— budget line —</option>
              {ohLines.map((o) => <option key={o.key} value={o.key}>{o.key} · CC {o.cost_centre} · GL {o.gl} · {o.aop_head} · {o.description}</option>)}
            </select>
          ) : (
            [["cost_centre", "Cost centre"], ["gl", "GL"], ["expense_heading", "Expense heading (AOP head)"], ["description", "Description"]].map(([k, l]) => (
              <input key={k} className="input-sm w-40" placeholder={l} value={d[k] || ""} onChange={(e) => set(k, e.target.value)} />
            ))
          )}
        </div>
      )}
      {!split && d.type === "Capex" && (
        <div className="flex items-center gap-2">
          <input className="input-sm w-40" placeholder="Location" value={d.location || row.location || ""} onChange={(e) => set("location", e.target.value)} />
          <select className="input-sm max-w-[360px]" value={d.capex_key || ""} onChange={(e) => set("capex_key", e.target.value)}>
            <option value="">— capex project / category —</option>
            {capex.filter((c) => !d.location || String(c.location).toLowerCase() === String(d.location).toLowerCase()).map((c) => <option key={c.key} value={c.key}>{c.location} · {c.project}</option>)}
          </select>
        </div>
      )}
      {!split && d.type === "Payroll" && (
        <label className="flex items-center gap-1">Department <input className="input-sm w-48" value={d.department} onChange={(e) => set("department", e.target.value)} />
          <span className="text-[var(--muted)]">(the payroll destination is still an open item — the department is recorded for now)</span></label>
      )}
      {!split && d.type === "Mapping not required" && (
        <select className="input-sm" value={d.not_required_reason || ""} onChange={(e) => set("not_required_reason", e.target.value)}>
          <option value="">— reason —</option>{(meta?.not_required_reasons || []).map((t) => <option key={t}>{t}</option>)}
        </select>
      )}
      {!split && d.type === "Needs correction" && (
        <div className="flex items-center gap-2">
          <select className="input-sm" value={d.correction_type || ""} onChange={(e) => set("correction_type", e.target.value)}>
            <option value="">— correction type —</option>{(meta?.correction_types || []).map((t) => <option key={t}>{t}</option>)}
          </select>
          <label className="flex items-center gap-1">then type
            <select className="input-sm" value={d.then_type || ""} onChange={(e) => set("then_type", e.target.value)}>
              <option value="">— stays in To map —</option>{T.filter((t) => !["Needs correction"].includes(t)).map((t) => <option key={t}>{t}</option>)}
            </select></label>
        </div>
      )}
      <div className="flex items-center gap-2">
        <input className="input-sm flex-1 max-w-xl" placeholder="Remarks" value={d.remarks || ""} onChange={(e) => set("remarks", e.target.value)} />
        <button className="icon-btn primary" disabled={busy || (!split && !d.type)} onClick={submit} data-testid="map-submit"><CheckCircle size={13} />Save decision</button>
      </div>
    </div>
  );
}

// ============================================================================================ PO changes
function Changes({ ctx }) {
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState(null);
  const [map, setMap] = useState({});
  const load = useCallback(() => api.get("/aop/review/changes").then((r) => setData(r.data)).catch((e) => setMsg({ tone: "err", text: err(e) })), []);
  useEffect(() => { load(); }, [load]);
  const byPo = useMemo(() => {
    const g = {};
    (data?.rows || []).forEach((c) => { (g[c.po] = g[c.po] || []).push(c); });
    return g;
  }, [data]);
  const decide = async (body) => {
    setMsg(null);
    try {
      const r = await api.post("/aop/review/changes/decide", body);
      setMsg({ tone: "ok", text: `${r.data.decided} change(s) ${body.accept ? "accepted" : "rejected"}${r.data.corrections ? ` · ${r.data.corrections} correction(s) opened` : ""}` });
      load(); ctx.refresh();
    } catch (e) { setMsg({ tone: "err", text: err(e) }); }
  };
  const reject = (body) => {
    const remarks = window.prompt("Reject — the accepted value stays as an override and a correction is opened. Remark:");
    if (remarks) decide({ ...body, accept: false, remarks });
  };
  return (
    <div className="space-y-2" data-testid="review-changes">
      <div className="flex items-center gap-2">
        <span className="text-[var(--muted)]">Changes on mapped PO items since they were last accepted. Mode: <b>{data?.mode === "apply" ? "apply immediately" : "hold until accepted"}</b> — the forecast keeps the accepted values. GRN / invoice / pending changes are never flagged.</span>
        <Msg m={msg} />
      </div>
      {Object.entries(byPo).map(([po, cs]) => (
        <div key={po} className="border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex items-center gap-2 px-2 py-1.5 border-b border-[var(--border-soft)] bg-[var(--table-header-bg)]">
            <PoBtn po={po} open={ctx.openPo} /><span>{cs[0].supplier_name}</span>
            <span className="chip">FY impact ₹{L(cs[0].po_fy_impact)} L</span>
            <span className="text-[var(--muted)]">lines: {(cs[0].lines || []).map((l) => <button key={l} className="underline mr-1" onClick={() => ctx.openLine(l, po)}>{l}</button>)}</span>
            <span className="flex-1" />
            {!cs.some((c) => c.field === "item_added") && <button className="icon-btn primary" onClick={() => decide({ po, accept: true })} data-testid={`accept-po-${po}`}>Accept all</button>}
            <button className="icon-btn" onClick={() => reject({ po })}>Reject all</button>
          </div>
          <table className="w-full">
            <tbody>
              {cs.map((c) => (
                <tr key={c.key} className="border-t border-[var(--border-soft)]">
                  <td className="px-2 py-1 w-16">Item {c.item}</td>
                  <td className="px-2 w-48 font-semibold">{c.label}</td>
                  <td className="px-2">{c.field === "item_added" ? c.new : <>{String(c.old ?? "—")} → <b>{String(c.new ?? "—")}</b> <span className="text-[var(--muted)]">(SAP now · using the old value)</span></>}</td>
                  <td className="px-2">
                    {c.field === "item_added" && (
                      <span className="inline-flex items-center gap-1">
                        <LinePicker value={(map[c.key] || {}).line_id ?? c.prefill?.line_id} suggestions={[]} onChange={(v) => setMap({ ...map, [c.key]: { ...(map[c.key] || {}), line_id: v } })} />
                        <label className="flex items-center gap-1 whitespace-nowrap"><input type="checkbox" checked={!!(map[c.key] || {}).add_as_new_line}
                               onChange={(e) => setMap({ ...map, [c.key]: { ...(map[c.key] || {}), add_as_new_line: e.target.checked } })} />Add as a new line</label>
                      </span>
                    )}
                  </td>
                  <td className="px-2 whitespace-nowrap text-right">
                    <button className="icon-btn primary !h-6" onClick={() => decide({ keys: [c.key], accept: true,
                      mapping: c.field === "item_added" ? { type: c.prefill?.type || "Opex", line_id: (map[c.key] || {}).line_id ?? c.prefill?.line_id, add_as_new_line: (map[c.key] || {}).add_as_new_line } : undefined })}>Accept</button>
                    <button className="icon-btn !h-6 ml-1" onClick={() => reject({ keys: [c.key] })}>Reject</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {data && !data.rows.length && <div className="border border-dashed border-[var(--border)] p-8 text-center text-[var(--muted)]">No pending PO changes</div>}
    </div>
  );
}

// ============================================================================================ Corrections
function Corrections({ ctx }) {
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState(null);
  const [all, setAll] = useState(false);
  const [add, setAdd] = useState(false);
  const load = useCallback(() => api.get("/aop/review/corrections", { params: { status: all ? undefined : "open" } }).then((r) => setData(r.data))
    .catch((e) => setMsg({ tone: "err", text: err(e) })), [all]);
  useEffect(() => { load(); }, [load]);
  const patch = async (key, body) => {
    try { await api.patch(`/aop/review/corrections/${key}`, body); load(); ctx.refresh(); } catch (e) { setMsg({ tone: "err", text: err(e) }); }
  };
  return (
    <div className="space-y-2" data-testid="review-corrections">
      <div className="flex items-center gap-2">
        <button className="icon-btn" onClick={() => setAdd(true)}><Flag size={13} />Flag a PO</button>
        <button className="icon-btn" onClick={() => getFile("/aop/review/corrections?format=xlsx", "po_corrections.xlsx")}><DownloadSimple size={13} />Export to Excel</button>
        <label className="flex items-center gap-1"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />Show resolved</label>
        <span className="text-[var(--muted)]">Each ZMM run sets "Possibly resolved" when the field named by the type changed in SAP. A correction never blocks mapping.</span>
        <Msg m={msg} />
      </div>
      <div className="border border-[var(--border)] bg-[var(--surface)] overflow-auto">
        <table className="w-full">
          <thead className="bg-[var(--table-header-bg)] text-[10.5px] text-[var(--muted)]">
            <tr>{["ID", "PO", "Items", "Supplier", "Type", "Remarks", "Raised to", "Raised on", "Status", "Provisional override", "Source", ""].map((h) => <th key={h} className="text-left px-2 py-1 whitespace-nowrap">{h}</th>)}</tr>
          </thead>
          <tbody>
            {(data?.rows || []).map((c) => (
              <tr key={c.key} className="border-t border-[var(--border-soft)]">
                <td className="px-2 py-1 font-mono">{c.key}</td>
                <td className="px-2"><PoBtn po={c.po} open={ctx.openPo} /></td>
                <td className="px-2">{(c.items || []).join(", ")}</td>
                <td className="px-2 max-w-[160px] truncate">{c.supplier}</td>
                <td className="px-2"><select className="input-sm" value={c.type} onChange={(e) => patch(c.key, { type: e.target.value })}>{(data.types || []).map((t) => <option key={t}>{t}</option>)}</select></td>
                <td className="px-2"><input className="input-sm w-48" defaultValue={c.remarks || ""} onBlur={(e) => e.target.value !== (c.remarks || "") && patch(c.key, { remarks: e.target.value })} /></td>
                <td className="px-2"><input className="input-sm w-36" defaultValue={c.raised_to || ""} onBlur={(e) => e.target.value !== (c.raised_to || "") && patch(c.key, { raised_to: e.target.value })} /></td>
                <td className="px-2"><input type="date" className="input-sm" defaultValue={c.raised_on || ""} onBlur={(e) => e.target.value !== (c.raised_on || "") && patch(c.key, { raised_on: e.target.value })} /></td>
                <td className="px-2"><select className={`input-sm ${c.status === "Possibly resolved" ? "!border-[var(--success)]" : ""}`} value={c.status} onChange={(e) => patch(c.key, { status: e.target.value })}>
                  {(data.statuses || []).map((t) => <option key={t}>{t}</option>)}</select></td>
                <td className="px-2 text-[var(--muted)]">{c.override ? Object.entries(c.override).map(([k, v]) => `${k} = ${v}`).join(", ") : "—"}</td>
                <td className="px-2">{c.source}</td>
                <td className="px-2 text-[var(--muted)] whitespace-nowrap">{c.resolved_on ? `Resolved ${c.resolved_on}` : ""}</td>
              </tr>
            ))}
            {data && !data.rows.length && <tr><td colSpan={12} className="px-3 py-8 text-center text-[var(--muted)]">No corrections</td></tr>}
          </tbody>
        </table>
      </div>
      {add && <FlagDialog types={data?.types || []} onClose={() => setAdd(false)} onDone={() => { setAdd(false); load(); ctx.refresh(); }} />}
    </div>
  );
}

function FlagDialog({ types, onClose, onDone }) {
  const [f, setF] = useState({ po: "", type: "Other", remarks: "", items: "" });
  const [e, setE] = useState("");
  const save = async () => {
    try {
      await api.post("/aop/review/corrections", { po: f.po, type: f.type, remarks: f.remarks, items: f.items.split(/[,\s]+/).filter(Boolean), source: "manual" });
      onDone();
    } catch (x) { setE(err(x)); }
  };
  return (
    <Modal title="Flag a PO for correction" size="sm" onClose={onClose}
           footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!f.po} onClick={save}>Flag</button></>}>
      <div className="px-5 py-4 space-y-2 text-xs">
        <input className="input w-full" placeholder="PO number" value={f.po} onChange={(x) => setF({ ...f, po: x.target.value })} />
        <input className="input w-full" placeholder="Items (optional, e.g. 10, 20)" value={f.items} onChange={(x) => setF({ ...f, items: x.target.value })} />
        <select className="input w-full" value={f.type} onChange={(x) => setF({ ...f, type: x.target.value })}>{types.map((t) => <option key={t}>{t}</option>)}</select>
        <textarea className="input w-full" rows={3} placeholder="What is wrong in SAP?" value={f.remarks} onChange={(x) => setF({ ...f, remarks: x.target.value })} />
        {e && <div className="text-[var(--danger)]">{String(e)}</div>}
      </div>
    </Modal>
  );
}

// ============================================================================================ Checks
function Checks({ ctx }) {
  const [data, setData] = useState(null);
  const [kind, setKind] = useState("");
  const [showAck, setShowAck] = useState(false);
  const [sel, setSel] = useState(new Set());
  const [msg, setMsg] = useState(null);
  const load = useCallback(() => api.get("/aop/review/checks", { params: { include_acknowledged: showAck } }).then((r) => setData(r.data))
    .catch((e) => setMsg({ tone: "err", text: err(e) })), [showAck]);
  useEffect(() => { load(); }, [load]);
  const rows = (data?.rows || []).filter((c) => !kind || c.kind === kind);
  const kinds = [...new Set((data?.rows || []).map((c) => c.kind))];
  const ack = async (ids, confirm) => {
    const remark = confirm ? "split confirmed" : window.prompt("Acknowledge with a remark:");
    if (remark === null) return;
    try { await api.post("/aop/review/checks/ack", { ids, remark, confirm_split: !!confirm }); setSel(new Set()); load(); ctx.refresh(); }
    catch (e) { setMsg({ tone: "err", text: err(e) }); }
  };
  const resplit = async () => {
    try { const r = await api.post("/aop/opex/links/split", {}); setMsg({ tone: "ok", text: `${r.data.reset} auto-split link(s) re-applied` }); load(); }
    catch (e) { setMsg({ tone: "err", text: err(e) }); }
  };
  return (
    <div className="space-y-2" data-testid="review-checks">
      <div className="flex items-center gap-2 flex-wrap">
        <select className="input-sm" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">All checks ({data?.rows?.length || 0})</option>
          {kinds.map((k) => <option key={k} value={k}>{k} ({data.rows.filter((c) => c.kind === k).length})</option>)}
        </select>
        <button className="icon-btn primary" disabled={![...sel].some((i) => i.startsWith("alloc_auto|"))} onClick={() => ack([...sel].filter((i) => i.startsWith("alloc_auto|")), true)}>
          <CheckCircle size={13} />Confirm split ({[...sel].filter((i) => i.startsWith("alloc_auto|")).length})</button>
        <button className="icon-btn" disabled={!sel.size} onClick={() => ack([...sel])}>Acknowledge ({sel.size})</button>
        <button className="icon-btn" onClick={resplit} title="Re-apply the automatic split (auto-split links only)"><ArrowClockwise size={13} />Re-split auto allocations</button>
        <label className="flex items-center gap-1"><input type="checkbox" checked={showAck} onChange={(e) => setShowAck(e.target.checked)} />Show acknowledged</label>
        <Msg m={msg} />
      </div>
      <div className="border border-[var(--border)] bg-[var(--surface)] overflow-auto">
        <table className="w-full">
          <thead className="bg-[var(--table-header-bg)] text-[10.5px] text-[var(--muted)]">
            <tr><th className="px-2 w-6"><input type="checkbox" checked={rows.length > 0 && rows.every((r) => sel.has(r.id))} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /></th>
              {["Check", "Detail", "Line / PO", "Status"].map((h) => <th key={h} className="text-left px-2 py-1">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-t border-[var(--border-soft)]">
                <td className="px-2"><input type="checkbox" checked={sel.has(c.id)} onChange={(e) => { const n = new Set(sel); e.target.checked ? n.add(c.id) : n.delete(c.id); setSel(n); }} /></td>
                <td className="px-2 py-1 whitespace-nowrap font-semibold">{c.kind}{c.informational && <span className="chip ml-1">info</span>}</td>
                <td className="px-2">{c.message}</td>
                <td className="px-2 whitespace-nowrap">
                  {c.line_id && <button className="font-mono underline mr-2" onClick={() => ctx.openLine(c.line_id, c.po)}>{c.line_id}</button>}
                  {c.po && <PoBtn po={c.po} open={ctx.openPo} />}
                </td>
                <td className="px-2 text-[var(--muted)]">{c.acknowledged ? `Acknowledged${c.ack_remark ? ` — ${c.ack_remark}` : ""}` : "Open"}</td>
              </tr>
            ))}
            {data && !rows.length && <tr><td colSpan={5} className="px-3 py-8 text-center text-[var(--muted)]">No checks</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================================ Upload log
function Runs({ ctx }) {
  const [rows, setRows] = useState(null);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const load = useCallback(() => api.get("/aop/review/runs").then((r) => setRows(r.data.rows)).catch((e) => setMsg({ tone: "err", text: err(e) })), []);
  useEffect(() => { load(); }, [load]);
  const run = async () => {
    if (!file) return;
    setBusy(true); setMsg(null);
    try {
      const fd = new FormData(); fd.append("file", file);
      const { data } = await api.post("/aop/import/zmm", fd, { timeout: 600000 });
      setMsg({ tone: "ok", text: `Processed: ${data.po_items} PO items · ${data.to_map} to map · ${data.changes_flagged} changes flagged · forecast Δ ₹${L(data.forecast_delta)} L` });
      setFile(null); load(); ctx.refresh();
    } catch (e) { setMsg({ tone: "err", text: err(e) }); load(); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-2" data-testid="review-runs">
      <div className="flex items-center gap-2 flex-wrap">
        <label className="flex items-center gap-2 border border-dashed border-[var(--border)] px-2 h-7 cursor-pointer hover:border-[var(--gold)]">
          <UploadSimple size={13} className="text-[var(--muted)]" /><span>{file ? file.name : "ZMM PO report (.xlsx)"}</span>
          <input type="file" accept=".xlsx,.xlsm" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} data-testid="zmm-file" />
        </label>
        <button className="icon-btn primary" disabled={!file || busy} onClick={run} data-testid="zmm-run">{busy ? "Processing…" : "Run ZMM"}</button>
        <span className="text-[var(--muted)]">Manual upload and the scheduled e-mail fetch run the same pipeline; the same file twice changes nothing.</span>
        <Msg m={msg} />
      </div>
      <div className="border border-[var(--border)] bg-[var(--surface)] overflow-auto">
        <table className="w-full">
          <thead className="bg-[var(--table-header-bg)] text-[10.5px] text-[var(--muted)]">
            <tr>{["Received", "Source", "File", "Status", "Rows", "PO items", "New POs", "Items +/−", "Changes", "To map", "Forecast Δ ₹ L", ""].map((h) => <th key={h} className="text-left px-2 py-1 whitespace-nowrap">{h}</th>)}</tr>
          </thead>
          <tbody>
            {(rows || []).map((x) => (
              <tr key={x.run_id} className="border-t border-[var(--border-soft)]" title={x.sha256}>
                <td className="px-2 py-1 whitespace-nowrap">{String(x.received_at || "").slice(0, 16).replace("T", " ")}</td>
                <td className="px-2">{x.source}</td>
                <td className="px-2 max-w-[220px] truncate">{x.file_name}</td>
                <td className={`px-2 ${x.status === "failed" ? "text-[var(--danger)]" : ""}`}>{x.status}{x.error ? ` — ${x.error}` : ""}</td>
                <td className="px-2 text-right">{x.rows ?? "—"}</td><td className="px-2 text-right">{x.po_items ?? "—"}</td>
                <td className="px-2 text-right">{x.new_pos ?? "—"}</td><td className="px-2 text-right">{x.items_added ?? 0} / {x.items_deleted ?? 0}</td>
                <td className="px-2 text-right">{x.changes_flagged ?? "—"}</td><td className="px-2 text-right">{x.to_map ?? "—"}</td>
                <td className="px-2 text-right tabular-nums">{L(x.forecast_delta)}</td>
                <td className="px-2">{x.storage_key && <button className="icon-btn !h-6" onClick={() => getFile(`/aop/review/runs/${x.run_id}/file`, x.file_name || "zmm.xlsx")}><DownloadSimple size={12} /></button>}</td>
              </tr>
            ))}
            {rows && !rows.length && <tr><td colSpan={12} className="px-3 py-8 text-center text-[var(--muted)]">No ZMM runs yet</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
