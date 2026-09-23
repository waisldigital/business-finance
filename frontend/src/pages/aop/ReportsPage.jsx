import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "@/lib/api";
import Header from "@/aop/Header";
import ColumnSettings, { usePersistedColumns } from "@/aop/ColumnSettings";
import PoDrawer from "@/aop/PoDrawer";
import { fmtAmount, fmtPct, download } from "@/aop/format";
import { ChartBar, CaretRight, CaretDown, DownloadSimple, ArrowClockwise, WarningCircle, CheckCircle } from "@phosphor-icons/react";

const TABS = [
  { key: "margin", label: "Airport margin profile" },
  { key: "opex", label: "Opex budget vs forecast" },
  { key: "overheads", label: "Overheads by department" },
  { key: "wbs", label: "WBS" },
];

export default function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("r") || "margin";
  const [unit, setUnit] = useState("cr");
  return (
    <div data-testid="aop-reports">
      <Header icon={ChartBar} title="Reports" subtitle="Built on the same datasets and single actual source as the P&L"
              actions={<div className="seg"><button className={unit === "cr" ? "on" : ""} onClick={() => setUnit("cr")}>₹ Cr</button>
                <button className={unit === "lakh" ? "on" : ""} onClick={() => setUnit("lakh")}>₹ L</button></div>} />
      <div className="px-3 pt-2 flex gap-1 border-b border-[var(--border)] bg-[var(--surface)]">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setParams({ r: t.key })} data-testid={`report-tab-${t.key}`}
                  className={`px-3 py-1.5 text-xs border-b-2 -mb-px ${tab === t.key ? "border-[var(--gold)] font-semibold" : "border-transparent text-[var(--muted)]"}`}>{t.label}</button>
        ))}
      </div>
      <div className="p-3">
        {tab === "margin" && <Margin unit={unit} />}
        {tab === "opex" && <Opex unit={unit} />}
        {tab === "overheads" && <Overheads unit={unit} />}
        {tab === "wbs" && <Wbs unit={unit} />}
      </div>
    </div>
  );
}

// ---------- shared table ----------
function useReport(url, params) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const key = JSON.stringify(params || {});
  const load = () => { setErr(""); api.get(url, { params }).then((r) => setData(r.data)).catch((e) => setErr(e.response?.data?.detail || e.message)); };
  useEffect(load, [url, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return [data, err, load];
}

function Table({ cols, rows, unit, rowKey, expand, total, name }) {
  const [open, setOpen] = useState({});
  const fmt = (c, v) => (v === null || v === undefined ? "" : c.pct ? fmtPct(v) : c.text ? String(v) : c.int ? v : fmtAmount(v, unit));
  const csv = () => {
    const div = unit === "cr" ? 1e7 : 1e5;
    const lines = [cols.map((c) => c.label), ...rows.map((r) => cols.map((c) => (c.text || c.pct || c.int ? r[c.key] : (r[c.key] ?? 0) / div)))];
    download(new Blob([lines.map((l) => l.map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv" }), `${name}.csv`);
  };
  return (
    <div className="border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex justify-end p-1 border-b border-[var(--border)]">
        <button className="icon-btn" onClick={csv} title="Export (csv)"><DownloadSimple size={13} /></button>
      </div>
      <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 250px)" }}>
        <table className="pnl-table text-[12px] w-max min-w-full border-separate border-spacing-0">
          <thead><tr>{cols.map((c, i) => <th key={c.key} className={`${i === 0 ? "lbl text-left" : c.text ? "text-left" : "text-right"} ${c.strong ? "!text-[var(--gold)]" : ""}`}>{c.label}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => {
              const k = rowKey(r);
              return (
                <React.Fragment key={k}>
                  <tr className={r._total ? "total" : ""}>
                    {cols.map((c, i) => (
                      <td key={c.key} className={`${i === 0 ? "lbl" : c.text ? "" : "num"} ${c.strong ? "font-semibold" : ""} ${c.neg && r[c.key] < 0 ? "text-[var(--danger)]" : ""}`}>
                        {i === 0 && expand ? (
                          <span className="inline-flex items-center gap-1">
                            <button className="text-[var(--muted)]" onClick={() => setOpen((o) => ({ ...o, [k]: !o[k] }))}>{open[k] ? <CaretDown size={11} /> : <CaretRight size={11} />}</button>
                            {fmt(c, r[c.key])}
                          </span>
                        ) : c.render ? c.render(r) : fmt(c, r[c.key])}
                      </td>
                    ))}
                  </tr>
                  {expand && open[k] && (
                    <tr><td colSpan={cols.length} className="!p-0 bg-[var(--surface-2)]">{expand(r)}</td></tr>
                  )}
                </React.Fragment>
              );
            })}
            {total && <tr className="total">{cols.map((c, i) => <td key={c.key} className={i === 0 ? "lbl" : c.text ? "" : "num"}>{i === 0 ? "Total" : fmt(c, total[c.key])}</td>)}</tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const sum = (rows, key) => rows.reduce((a, r) => a + (Number(r[key]) || 0), 0);

// ---------- margin profile ----------
function Margin({ unit }) {
  const [block, setBlock] = useState("af_plan");
  const [data, err, load] = useReport("/aop/reports/margin", { block });
  const cols = [
    { key: "tag", label: "Airport / tag", text: true },
    { key: "cute", label: "CUTE" }, { key: "non_cute", label: "Non-CUTE" }, { key: "change_request", label: "CR" },
    { key: "projects", label: "Projects" }, { key: "revenue", label: "Revenue", strong: true },
    { key: "revenue_share", label: "Rev share" }, { key: "resource_cost_ca", label: "Resource CA" }, { key: "tp_opex_ca", label: "TP opex CA" },
    { key: "total_cost_cr", label: "Cost CR" }, { key: "total_cost_projects", label: "Cost projects" },
    { key: "direct_cost", label: "Direct cost" }, { key: "gross_margin", label: "Gross margin", strong: true, neg: true },
    { key: "gm_pct", label: "GM %", pct: true },
  ];
  const rows = (data?.rows || []).map((r) => (r.tag === "Total" ? { ...r, _total: true } : r));
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <div className="seg">
          {[["a_base", "A FY26"], ["b_plan", "B FY27"], ["af_plan", "FY27 A/F"], ["b_draft", "B FY28"]].map(([k, l]) => (
            <button key={k} className={block === k ? "on" : ""} onClick={() => setBlock(k)}>{data && block === k ? data.label : l}</button>
          ))}
        </div>
        <span className="text-[10.5px] text-[var(--muted)]">Direct costs only — enabling overheads are not allocated to airports. Shared services are allocated with the Assumptions split.</span>
        <div className="flex-1" /><button className="icon-btn" onClick={load} title="Refresh"><ArrowClockwise size={13} /></button>
      </div>
      {err && <div className="text-xs text-[var(--danger)]">{String(err)}</div>}
      {data && <Table cols={cols} rows={rows} unit={unit} rowKey={(r) => r.tag} name={`margin_${block}`} />}
    </div>
  );
}

// ---------- opex budget vs forecast ----------
function Opex({ unit }) {
  const [groupBy, setGroupBy] = useState("aop_code");
  const [data, err, load] = useReport("/aop/reports/opex", { group_by: groupBy });
  const [po, setPo] = useState(null);
  const fy = data?.plan_fy || "";
  const cols = [
    { key: "group", label: groupBy.replace("_", " "), text: true },
    { key: "lines", label: "Lines", int: true }, { key: "budget", label: `B ${fy}` }, { key: "forecast", label: `${fy} forecast`, strong: true },
    { key: "variance", label: "Budget − forecast", neg: true }, { key: "new_po_mapped", label: "New PO mapped", int: true },
    { key: "not_migrated", label: "Not migrated", int: true }, { key: "recurring", label: "Recurring", int: true }, { key: "one_time", label: "One-time", int: true },
  ];
  const rows = data?.rows || [];
  const total = { budget: sum(rows, "budget"), forecast: sum(rows, "forecast"), variance: sum(rows, "variance"), lines: sum(rows, "lines"),
                  new_po_mapped: sum(rows, "new_po_mapped"), not_migrated: sum(rows, "not_migrated"), recurring: sum(rows, "recurring"), one_time: sum(rows, "one_time") };
  const L = (v) => fmtAmount(v, unit);
  const expand = (r) => (
    <table className="w-full text-[11px]">
      <thead className="text-[var(--muted)]"><tr>{["Line", "Old PO", "New PO", "Vendor", "AOP code", "Tag", "Nature", "Budget", "Forecast", ""].map((h) => <th key={h} className="text-left px-2 py-1">{h}</th>)}</tr></thead>
      <tbody>{r.items.map((i) => (
        <tr key={i.line_id} className="border-t border-[var(--border-soft)]">
          <td className="px-2 font-mono">{i.line_id}</td>
          <td className="px-2">{i.old_po && <button className="text-[var(--gold)] underline decoration-dotted" onClick={() => setPo(String(i.old_po))}>{i.old_po}</button>}</td>
          <td className="px-2">{i.new_po && /\d/.test(String(i.new_po)) ? <button className="text-[var(--gold)] underline decoration-dotted" onClick={() => setPo(String(i.new_po).split(/[,;/\s]+/)[0])}>{i.new_po}</button> : i.new_po}</td>
          <td className="px-2">{i.vendor}</td><td className="px-2">{i.aop_code}</td><td className="px-2">{i.tag}</td><td className="px-2">{i.recurring}</td>
          <td className="px-2 text-right tabular-nums">{L(i.budget)}</td><td className="px-2 text-right tabular-nums">{L(i.forecast)}</td>
          <td className="px-2">{i.override && <span className="chip">override</span>}</td>
        </tr>))}</tbody>
    </table>
  );
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <span className="text-[10.5px] text-[var(--muted)]">Group by</span>
        <div className="seg">{[["aop_code", "AOP code"], ["vendor", "Vendor"], ["category", "Category"], ["tag", "Airport"], ["recurring", "Nature"], ["package_l1", "Package"]].map(([k, l]) => (
          <button key={k} className={groupBy === k ? "on" : ""} onClick={() => setGroupBy(k)}>{l}</button>))}</div>
        <span className="text-[10.5px] text-[var(--muted)]">Forecast = override → new PO → old PO → recurring gap at budget rate (recalculated on every edit)</span>
        <div className="flex-1" /><button className="icon-btn" onClick={load} title="Refresh"><ArrowClockwise size={13} /></button>
      </div>
      {err && <div className="text-xs text-[var(--danger)]">{String(err)}</div>}
      {data && <Table cols={cols} rows={rows} unit={unit} rowKey={(r) => r.group} expand={expand} total={total} name={`opex_${groupBy}`} />}
      {po && <PoDrawer po={po} onClose={() => setPo(null)} onOpenPo={setPo} />}
    </div>
  );
}

// ---------- overheads ----------
const OH_DEFAULT = { show: { a_base: false, b_plan: false, b_draft: true, growth: true }, months: {} };
function Overheads({ unit }) {
  const [data, err, load] = useReport("/aop/reports/overheads");
  const [cfg, setCfg, reset] = usePersistedColumns("aop_rep_oh_cols_v1", OH_DEFAULT);
  const all = useMemo(() => [
    { key: "a_base", label: `A ${data?.base_fy || ""}` }, { key: "b_plan", label: `B ${data?.plan_fy || ""} (WBS / AOP head)` },
    { key: "b_draft", label: `B ${data?.draft_fy || ""} (CC + GL)`, strong: true }, { key: "growth", label: "Growth %", pct: true },
  ], [data]);
  const cols = [{ key: "department", label: "Department", text: true }, ...all.filter((c) => cfg.show[c.key])];
  const rows = data?.rows || [];
  const total = { a_base: sum(rows, "a_base"), b_plan: sum(rows, "b_plan"), b_draft: sum(rows, "b_draft") };
  total.growth = total.b_plan ? (total.b_draft - total.b_plan) / total.b_plan : null;
  const expand = (r) => (
    <table className="w-full text-[11px]">
      <thead className="text-[var(--muted)]"><tr>{["Line", "Cost centre", "GL", "Description", `B ${data?.draft_fy}`].map((h) => <th key={h} className="text-left px-2 py-1">{h}</th>)}</tr></thead>
      <tbody>{r.plan_lines.map((l) => (
        <tr key={l.line_id} className="border-t border-[var(--border-soft)]"><td className="px-2 font-mono">{l.line_id}</td><td className="px-2">{l.cost_centre}</td>
          <td className="px-2">{l.gl}</td><td className="px-2">{l.description}</td><td className="px-2 text-right tabular-nums">{fmtAmount(l.amount, unit)}</td></tr>))}
        {!r.plan_lines.length && <tr><td colSpan={5} className="px-2 py-2 text-[var(--muted)]">No Cost centre + GL lines yet</td></tr>}
      </tbody>
    </table>
  );
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <span className="text-[10.5px] text-[var(--muted)]">Original budget kept on WBS / AOP head; next year planned on Cost centre + GL (expand a department).</span>
        <div className="flex-1" />
        <ColumnSettings blocks={all.map((c) => ({ key: c.key, label: c.label }))} value={cfg} onChange={setCfg} onReset={reset} testid="oh-columns" />
        <button className="icon-btn" onClick={load} title="Refresh"><ArrowClockwise size={13} /></button>
      </div>
      {err && <div className="text-xs text-[var(--danger)]">{String(err)}</div>}
      {data && <Table cols={cols} rows={rows} unit={unit} rowKey={(r) => r.department} expand={expand} total={total} name="overheads" />}
    </div>
  );
}

// ---------- WBS ----------
function Wbs({ unit }) {
  const [data, err, load] = useReport("/aop/reports/wbs");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const cols = [
    { key: "wbs", label: "WBS element", text: true },
    { key: "name", label: "Name", text: true },
    { key: "in_master", label: "In WBS master", text: true, render: (r) => (r.in_master ? <CheckCircle size={13} className="text-[var(--success)]" /> : <WarningCircle size={13} className="text-[var(--warning)]" />) },
    { key: "lines", label: "Opex lines", int: true },
    { key: "opex_budget", label: `Opex B ${data?.plan_fy || ""}` }, { key: "opex_draft", label: `Opex B ${data?.draft_fy || ""}`, strong: true },
    { key: "actual_opex", label: "Actual opex" }, { key: "actual_overhead", label: "Actual overheads" }, { key: "actual_capex", label: "Actual capex" },
    { key: "actual_total", label: "Actual total", strong: true },
  ];
  const rows = (data?.rows || []).filter((r) => !onlyMissing || !r.in_master);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[10.5px] text-[var(--muted)]">
        {data && <span>{data.rows.length} WBS used in the AOP · WBS master has {data.master_count} · <span className="text-[var(--warning)]">{data.not_in_master} not in master</span></span>}
        <label className="flex items-center gap-1"><input type="checkbox" className="accent-[var(--gold)]" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />Only missing from master</label>
        <div className="flex-1" /><button className="icon-btn" onClick={load} title="Refresh"><ArrowClockwise size={13} /></button>
      </div>
      {err && <div className="text-xs text-[var(--danger)]">{String(err)}</div>}
      {data && <Table cols={cols} rows={rows} unit={unit} rowKey={(r) => r.wbs} name="wbs" />}
    </div>
  );
}
