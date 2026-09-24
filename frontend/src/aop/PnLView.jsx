import React, { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { useCurrency } from "@/lib/currency";
import { Globe, AirplaneTilt, Prohibit, LockSimple, ArrowClockwise, DownloadSimple, Info } from "@phosphor-icons/react";
import { fmtAmount, fmtPct, download, unitDiv, unitLabel } from "./format";
import ColumnSettings, { usePersistedColumns } from "./ColumnSettings";
import { useTree } from "./mis";
import { TreeLabel, ExpandButtons, Modal } from "./MisCommon";
import RevenuePerformance from "./RevenuePerformance";

// Headline ratios stay visible when the P&L is collapsed to its consolidated view
const HEADLINE = new Set(["gm_pct", "ebitda_pct", "pat_pct", "cash_pct"]);
const pinned = (r) => HEADLINE.has(r.id);

// Default view: current-year actual/forecast and next year's budget; prior-year actuals and the
// approved budget are one click away in the gear menu.
const DEFAULT_COLS = {
  show: { b_base: false, a_base: false, b_plan: false, af_plan: true, b_draft: true, var: true },
  months: { a_base: false, b_plan: false, af_plan: false, b_draft: true },
};

export default function PnLView({ unit: unitProp }) {
  const [filters, setFilters] = useState({ geo: ["All", "India", "International"], tags: ["All"] });
  const [geo, setGeo] = useState("All");
  const [tag, setTag] = useState("All");
  const [exclude, setExclude] = useState([]);
  const { unit: ctxUnit } = useCurrency();
  const unit = unitProp || ctxUnit;
  const [drill, setDrill] = useState(false);
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [colCfg, setColCfg, resetCols] = usePersistedColumns("aop_pnl_columns_v2", DEFAULT_COLS);

  useEffect(() => {
    api.get("/aop/pnl/filters").then((r) => {
      setFilters(r.data);
      if (!r.data.tags.includes("All") && r.data.tags.length) setTag(r.data.tags[0]);
    }).catch((e) => setErr(e.response?.data?.detail || e.message));
  }, []);

  const load = async () => {
    setLoading(true); setErr("");
    try {
      const { data } = await api.get("/aop/pnl", { params: { geo, tag, exclude: exclude.join(",") || undefined } });
      setData(data);
    } catch (e) { setErr(e.response?.data?.detail || e.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [geo, tag, exclude.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const blocks = useMemo(() => (data?.blocks || []).filter((b) => colCfg.show[b.key]).map((b) => ({
    ...b, columns: b.columns.filter((c) => !c.month || colCfg.months[b.key]),
  })), [data, colCfg]);
  const cols = blocks.flatMap((b) => b.columns.map((c, i) => ({ ...c, block: b, first: i === 0 })));
  const allRows = useMemo(() => data?.rows || [], [data]);
  const tree = useTree(allRows, { byLevel: true, defaultOpen: true, pinned });
  const rows = allRows.filter(tree.visible);

  const cell = (r, c) => {
    const v = r.values?.[c.key];
    if (r.masked) return "•••";
    if (c.kind === "pct" || (r.pct && c.kind !== "variance")) return v === null || v === undefined ? "" : fmtPct(v);
    if (r.pct) return "";
    return fmtAmount(v, unit);
  };

  const exportCsv = () => {
    const head = ["Particular", ...cols.map((c) => `${c.block.label} ${c.month ? c.label : ""}`.trim())];
    const div = unitDiv(unit);
    const lines = [head, ...allRows.map((r) => [r.label, ...cols.map((c) => {
      const v = r.values?.[c.key];
      if (!r.values) return "restricted";
      return c.kind === "pct" || r.pct ? v : (v ?? 0) / div;
    })])];
    download(new Blob([lines.map((l) => l.map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv" }),
             `PnL_${geo}_${tag}.csv`);
  };

  const settingsBlocks = (data?.blocks || []).map((b) => ({ key: b.key, label: b.label, hasMonths: b.columns.some((c) => c.month) }));

  return (
    <div className="space-y-2" data-testid="pnl-view">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="chip"><Globe size={11} /></span>
        <div className="seg">
          {filters.geo.map((g) => <button key={g} className={geo === g ? "on" : ""} onClick={() => setGeo(g)} data-testid={`pnl-geo-${g}`}>{g}</button>)}
        </div>
        <span className="chip ml-1"><AirplaneTilt size={11} /></span>
        <select className="input-sm" value={tag} onChange={(e) => setTag(e.target.value)} data-testid="pnl-tag">
          {filters.tags.map((t) => <option key={t}>{t}</option>)}
        </select>
        <span className="chip ml-1" title="Exclude"><Prohibit size={11} /></span>
        <select className="input-sm" value="" onChange={(e) => e.target.value && setExclude((x) => Array.from(new Set([...x, e.target.value])))} data-testid="pnl-exclude">
          <option value="">Exclude…</option>
          {filters.tags.filter((t) => t !== "All" && !exclude.includes(t)).map((t) => <option key={t}>{t}</option>)}
        </select>
        {exclude.map((x) => <button key={x} className="chip hover:border-[var(--danger)]" onClick={() => setExclude((e) => e.filter((y) => y !== x))} title="Remove">{x} ×</button>)}
        <div className="flex-1" />
        <ExpandButtons tree={tree} />
        <ColumnSettings blocks={settingsBlocks} value={colCfg} onChange={setColCfg} onReset={resetCols} testid="pnl-columns" />
        <button className="icon-btn" onClick={exportCsv} title="Export view (csv)"><DownloadSimple size={13} /></button>
        <button className="icon-btn" onClick={load} title="Refresh"><ArrowClockwise size={13} className={loading ? "animate-spin" : ""} /></button>
      </div>

      {err && <div className="text-xs text-[var(--danger)]">{String(err)}</div>}
      <div className="flex items-center gap-3 text-[10.5px] text-[var(--muted)]">
        {data && !data.meta.payroll_visible && <span className="flex items-center gap-1"><LockSimple size={11} /> Resource-cost lines are confidential for your role; totals still include them.</span>}
        {data && !data.meta.draft_ready && <span className="flex items-center gap-1 text-[var(--warning)]"><Info size={11} /> B {data.meta.draft_fy} not generated yet — admin: Plan settings → Generate draft.</span>}
        {data && <span className="ml-auto">Actuals to {data.meta.cutoffs?.default} · shaded months are forecast</span>}
      </div>

      {data && (
        <div className="overflow-auto border border-[var(--border)] bg-[var(--surface)]" style={{ maxHeight: "calc(100vh - 215px)" }}>
          <table className="pnl-table text-[12px] w-max min-w-full border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="lbl text-left" rowSpan={2}>Particular ({unitLabel(unit)})</th>
                {blocks.map((b) => (
                  <th key={b.key} colSpan={b.columns.length} className={`tot text-center !border-b ${b.key === "b_draft" ? "!text-[var(--gold)]" : ""}`}>{b.label}</th>
                ))}
              </tr>
              <tr>
                {cols.map((c) => (
                  <th key={c.key} className={`text-right ${c.first ? "tot" : ""} ${c.kind === "total" ? "font-bold" : ""}`} style={{ top: 22 }}>
                    <div>{c.month ? c.label : c.kind === "total" ? "Total" : c.label}</div>
                    {c.month && <div className="text-[9px] font-normal opacity-70">{c.kind === "actual" ? "Act" : c.kind === "forecast" ? "Fcst" : "Bud"}</div>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isRev = r.id === "revenue" || tree.parentOf[r.id] === "revenue";
                return (
                <tr key={r.id} className={`${r.kind === "total" ? "total" : r.kind === "subtotal" ? "subtotal" : ""} ${r.pct ? "pct" : ""} ${isRev ? "cursor-zoom-in" : ""}`}
                    onDoubleClick={isRev ? () => setDrill(true) : undefined} data-testid={`pnl-row-${r.id}`}>
                  <td className="lbl">
                    <TreeLabel row={r} tree={tree} depth={pinned(r) ? 1 : tree.depth(r.id)} title={isRev ? "Double-click for revenue performance" : undefined} />
                  </td>
                  {cols.map((c) => {
                    const v = r.values?.[c.key];
                    return (
                      <td key={c.key}
                          className={`num ${c.kind === "forecast" ? "fc" : ""} ${c.first ? "tot" : ""} ${c.kind === "total" ? "font-semibold" : ""} ${typeof v === "number" && v < 0 && !r.pct && c.kind !== "pct" ? "text-[var(--danger)]" : ""}`}>
                        {cell(r, c)}
                      </td>
                    );
                  })}
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {drill && (
        <Modal title="Revenue performance — Actuals vs AOP" onClose={() => setDrill(false)} testid="revenue-drill">
          <RevenuePerformance unit={unit} geo={geo} tag={tag} embedded />
        </Modal>
      )}
    </div>
  );
}
