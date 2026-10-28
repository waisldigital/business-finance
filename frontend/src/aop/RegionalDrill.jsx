import React, { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { DownloadSimple, MagnifyingGlass, Info, ArrowSquareOut, Database, FileXls } from "@phosphor-icons/react";
import { csvDownload } from "./mis";
import { fmtPct } from "./format";

// Detail amounts are small next to P&L lines, so this screen has its own unit (rupees by default).
const UNITS = { inr: { label: "₹", div: 1, d: 0 }, lakh: { label: "₹ Lakh", div: 1e5, d: 2 }, cr: { label: "₹ Cr", div: 1e7, d: 3 } };
const money = (v, u) => {
  if (v === null || v === undefined || v === "" || Number.isNaN(Number(v))) return "";
  const k = UNITS[u];
  const n = Number(v) / k.div;
  if (Math.abs(n) < 0.5 * 10 ** -k.d) return "–";
  const s = new Intl.NumberFormat("en-IN", { minimumFractionDigits: k.d, maximumFractionDigits: k.d }).format(Math.abs(n));
  return n < 0 ? `(${s})` : s;
};
const KIND = { A: "Act", F: "Fcst", B: "AOP" };
const RULE = {
  solutions: "Charged to Solutions in full",
  ca_cr: "CA+CR only — not part of the Solutions P&L",
  common: "Common — split between CA+CR and Solutions, then across regions, in proportion to revenue",
};

/**
 * What is behind one cell of the Regional P&L: the Financial Reporting Package rows (with the cell each month was read
 * from) for revenue, the SAP expense dump (FBL3H) lines for expenses, and the allocation rule for shared overheads.
 * Every list is built by the same engine calls the report uses, so it adds up to the cell.
 */
export default function RegionalDrill({ row, col, measure, period, month, onOpenRow }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [u, setU] = useState("lakh");
  useEffect(() => {
    setData(null); setErr("");
    api.get("/aop/mis/regional/drill", { params: { row, col, measure, period, month } })
      .then((r) => setData(r.data)).catch((e) => setErr(e.response?.data?.detail || e.message));
  }, [row, col, measure, period, month]);

  if (err) return <div className="text-xs text-[var(--danger)] p-3" data-testid="rdrill-error">{String(err)}</div>;
  if (!data) return <div className="text-xs text-[var(--muted)] p-3">Loading…</div>;
  const ratio = data.kind === "derived" && data.ratio;
  return (
    <div className="space-y-3" data-testid="regional-drill">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="chip">{data.col.label}</span>
        <span className="chip">{data.measure.label}</span>
        <span className="chip">{data.months.length === 12 ? "Full year" : `${data.months[0].label} – ${data.months[data.months.length - 1].label}`}</span>
        {!ratio && <span className="text-sm font-semibold ml-1" data-testid="rdrill-value">{data.row.label}: {money(data.value, u)} <span className="text-[10.5px] font-normal text-[var(--muted)]">{UNITS[u].label}</span></span>}
        <div className="flex-1" />
        <div className="seg" title="Unit" data-testid="rdrill-unit">
          {Object.entries(UNITS).map(([k, x]) => <button key={k} className={u === k ? "on" : ""} onClick={() => setU(k)}>{x.label}</button>)}
        </div>
      </div>
      {data.kind === "derived" && <Derived data={data} u={u} onOpenRow={onOpenRow} />}
      {data.parts && data.parts.map((p) => (
        <div key={p.title} className="space-y-2">
          <div className="text-[11px] font-semibold tracking-overline text-[var(--muted)] border-b border-[var(--border)] pb-0.5">
            {p.title.toUpperCase()} · {money(p.value, u)}
          </div>
          <Sections sections={p.sections} u={u} value={p.value} />
        </div>
      ))}
      {data.sections?.length > 0 && <Sections sections={data.sections} u={u} value={data.value} />}
      {data.cards && <Cards cards={data.cards} u={u} />}
    </div>
  );
}

function Derived({ data, u, onOpenRow }) {
  const c = data.components;
  const ratio = data.ratio;
  return (
    <div className="overflow-auto border border-[var(--border)]" data-testid="rdrill-derived">
      <table className="mis-table w-full">
        <thead><tr><th className="lbl h-head">{data.row.label} is made of</th><th className="h-tot !text-right">{ratio ? "Amount" : `${UNITS[u].label}`}</th><th className="h-head" /></tr></thead>
        <tbody>
          {c.map((x, i) => (
            <tr key={x.id}>
              <td className="lbl">{ratio ? (i === 0 ? "Numerator — " : "Divided by — ") : x.sign < 0 ? "less  " : i ? "plus  " : ""}{x.label}</td>
              <td className={`num ${x.value < 0 ? "neg" : ""}`}>{money(x.value, u)}</td>
              <td><button className="icon-btn !h-6 !text-[10.5px]" onClick={() => onOpenRow(x.id)} data-testid={`rdrill-open-${x.id}`}><ArrowSquareOut size={11} />Open</button></td>
            </tr>
          ))}
          <tr className="key">
            <td className="lbl">{data.row.label}</td>
            <td className="num">{ratio ? (c[1].value ? fmtPct(c[0].value / c[1].value) : "NA") : money(data.value, u)}</td><td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Cards({ cards, u }) {
  if (!cards.length) return <div className="text-xs text-[var(--muted)] p-3">Nothing booked for these departments in the period.</div>;
  return cards.map((c) => (
    <div key={`${c.block}|${c.kind}`} className="border border-[var(--border)]" data-testid={`rdrill-card-${c.block}-${c.kind}`}>
      <div className="px-2 py-1.5 bg-[var(--surface-2)] flex items-center gap-2 flex-wrap border-b border-[var(--border)]">
        <span className="text-[12px] font-semibold">{c.block}</span>
        <span className="chip">{c.kind === "tp" ? "TP overheads" : "Resources"}</span>
        <span className="text-[10.5px] text-[var(--muted)] flex items-center gap-1"><Info size={11} />{RULE[c.rule] || c.rule}</span>
        <div className="flex-1" />
        <span className="text-[11px]">Department total <b>{money(c.block_total, u)}</b> → this cell <b>{money(c.to_cell, u)}</b>{c.block_total ? <span className="text-[var(--muted)]"> ({fmtPct(c.share)})</span> : null}</span>
      </div>
      <div className="p-2 space-y-2"><Sections sections={c.sections} u={u} /></div>
    </div>
  ));
}

function Sections({ sections, u, value }) {
  const groups = sections.filter((s) => s.kind === "groups");
  const ledger = sections.find((s) => s.kind === "ledger");
  return (
    <>
      {sections.map((s) => (s.kind === "ledger" ? <Ledger key={s.id} s={s} u={u} /> : <GroupsTable key={s.id} s={s} u={u} />))}
      {value !== undefined && groups.length > 0 && <Reconcile value={value} groups={groups} ledger={ledger} u={u} />}
    </>
  );
}

function SourceNote({ icon, text, source }) {
  if (!text && !source) return null;
  return (
    <div className="text-[10.5px] text-[var(--muted)] flex items-start gap-1.5">
      {icon}<span>{source && <b className="text-[var(--text)] font-semibold">{source}. </b>}{text}</span>
    </div>
  );
}

function GroupsTable({ s, u }) {
  const hasSap = s.rows.some((r) => r.sap_total !== undefined);
  const hasFile = s.rows.some((r) => r.file_total !== undefined);
  const exportCsv = () => csvDownload([
    ["Item", "Detail", ...s.months.map((m) => m.label), "Total", "Package cell(s)", "Source"],
    ...s.rows.map((r) => [r.label, r.sub, ...s.months.map((m) => r.months[m.p] ?? 0), r.total, r.cells, r.source])], `${s.id}.csv`);
  return (
    <div className="space-y-1" data-testid={`rdrill-${s.id}`}>
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold flex-1">{s.title}</span>
        <button className="icon-btn" onClick={exportCsv} title="Export (csv)"><DownloadSimple size={13} /></button>
      </div>
      <SourceNote icon={<FileXls size={12} className="mt-px shrink-0" />} source={s.source} text={s.note} />
      {s.rows.some((r) => !r.residual && /Reporting Package/.test(r.source) && !r.cells) && (
        <div className="text-[10.5px] text-[var(--warning)]">Package cell references are recorded when the package is uploaded — upload it again to see them here.</div>
      )}
      {!s.rows.length ? <div className="text-xs text-[var(--muted)] p-2">Nothing in these months.</div> : (
        <div className="overflow-auto border border-[var(--border)]" style={{ maxHeight: "46vh" }}>
          <table className="mis-table w-max min-w-full">
            <thead>
              <tr>
                <th className="lbl h-head">Item</th>
                {s.months.map((m) => <th key={m.p} className={`${m.kind === "A" ? "h-cacr" : "h-sol"} !text-right`}>{m.label}<span className="block text-[9px] opacity-80 font-normal">{KIND[m.kind]}</span></th>)}
                <th className="h-tot !text-right">Total</th>
                {hasSap && <><th className="h-cacr !text-right" title="Same project in the SAP expense dump (FBL3H)">SAP dump</th><th className="h-cacr !text-right">Δ</th></>}
                {hasFile && <><th className="h-cacr !text-right" title="Resource cost file">Cost file</th><th className="h-cacr !text-right">Δ</th></>}
                <th className="h-head !text-left">Package cell(s) / source</th>
              </tr>
            </thead>
            <tbody>
              {s.rows.map((r) => (
                <tr key={r.id} className={r.residual ? "pct" : ""} data-testid={`rdrill-row-${r.id}`}>
                  <td className="lbl"><span>{r.label}</span>{r.sub && <span className="ml-1.5 text-[10px] text-[var(--muted)]">{r.sub}</span>}</td>
                  {s.months.map((m) => <td key={m.p} className={`num ${(r.months[m.p] || 0) < 0 ? "neg" : ""}`}>{money(r.months[m.p], u)}</td>)}
                  <td className="num v-tot gl font-semibold">{money(r.total, u)}</td>
                  {hasSap && <><td className="num gl">{r.residual ? "" : money(r.sap_total, u)}</td><td className="num">{r.residual ? "" : money(r.sap_total - r.total, u)}</td></>}
                  {hasFile && <><td className="num gl">{r.residual ? "" : money(r.file_total, u)}</td><td className="num">{r.residual ? "" : money(r.file_total - r.total, u)}</td></>}
                  <td className="text-[10.5px] text-[var(--muted)] gl" title={r.cells}><span className="font-mono">{r.cells}</span>{r.cells ? " · " : ""}{r.source}</td>
                </tr>
              ))}
              <tr className="key">
                <td className="lbl">Total</td>
                {s.months.map((m) => <td key={m.p} className="num">{money(s.monthly[m.p], u)}</td>)}
                <td className="num v-tot gl">{money(s.total, u)}</td>
                {hasSap && <><td className="num gl">{money(s.rows.reduce((a, r) => a + (r.sap_total || 0), 0), u)}</td><td /></>}
                {hasFile && <><td className="num gl">{money(s.rows.reduce((a, r) => a + (r.file_total || 0), 0), u)}</td><td /></>}
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Ledger({ s, u }) {
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(200);
  const lines = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? s.lines.filter((l) => Object.values(l).some((v) => v !== null && v !== undefined && String(v).toLowerCase().includes(t))) : s.lines;
  }, [s.lines, q]);
  const total = lines.reduce((a, l) => a + l.amount, 0);
  const exportCsv = () => csvDownload([
    ["Period", "Posting date", "Document no.", "G/L", "G/L text", "Vendor", "WBS", "PO", "Cost centre", "Text", "Project", "Amount (₹)"],
    ...lines.map((l) => [l.period, l.date, l.doc, l.gl, l.gl_text, l.vendor, l.wbs, l.po, l.cost_centre, l.text, l.project, l.amount])], `${s.id}.csv`);
  return (
    <div className="space-y-1" data-testid={`rdrill-${s.id}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-semibold">{s.title}</span>
        <span className="chip">{s.count} line{s.count === 1 ? "" : "s"}</span>
        <div className="flex-1" />
        {s.count > 0 && (
          <span className="relative">
            <MagnifyingGlass size={12} className="absolute left-2 top-2 text-[var(--muted)]" />
            <input className="input-sm w-48" style={{ paddingLeft: 24 }} placeholder="Search vendor, document, GL…" value={q} onChange={(e) => setQ(e.target.value)} data-testid={`rdrill-${s.id}-search`} />
          </span>
        )}
        <button className="icon-btn" onClick={exportCsv} title="Export (csv)" disabled={!s.count}><DownloadSimple size={13} /></button>
      </div>
      <SourceNote icon={<Database size={12} className="mt-px shrink-0" />} text={s.note} />
      {s.count > 0 && (
        <div className="overflow-auto border border-[var(--border)]" style={{ maxHeight: "46vh" }}>
          <table className="mis-table w-max min-w-full">
            <thead>
              <tr>
                {["Posting date", "Document no.", "G/L", "G/L text", "Vendor", "WBS", "PO", "Cost centre", "Text"].map((h) => <th key={h} className="h-head !text-left">{h}</th>)}
                <th className="h-tot !text-right">Amount ({UNITS[u].label})</th>
              </tr>
            </thead>
            <tbody>
              {lines.slice(0, shown).map((l, i) => (
                <tr key={i}>
                  <td>{String(l.date || l.period).slice(0, 10)}</td><td className="font-mono">{l.doc}</td><td className="font-mono">{l.gl}</td><td>{l.gl_text}</td>
                  <td>{l.vendor}</td><td className="font-mono">{l.wbs}</td><td className="font-mono">{l.po}</td><td>{l.cost_centre}</td>
                  <td className="max-w-[260px] truncate" title={l.text || ""}>{l.text}</td>
                  <td className={`num ${l.amount < 0 ? "neg" : ""}`}>{money(l.amount, u)}</td>
                </tr>
              ))}
              <tr className="key"><td className="lbl" colSpan={9}>Total{q ? " (filtered)" : ""}</td><td className="num">{money(total, u)}</td></tr>
            </tbody>
          </table>
        </div>
      )}
      {lines.length > shown && <button className="icon-btn" onClick={() => setShown((n) => n + 500)}>Show more ({lines.length - shown} left)</button>}
      {s.truncated && <div className="text-[10.5px] text-[var(--warning)]">Showing the first {s.lines.length} of {s.count} lines.</div>}
    </div>
  );
}

function Reconcile({ value, groups, ledger, u }) {
  const pkg = groups[0].total;
  const diff = value - pkg;
  return (
    <div className="text-[11px] border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 flex gap-x-5 gap-y-0.5 flex-wrap" data-testid="rdrill-reconcile">
      <span>Report cell <b>{money(value, u)}</b></span>
      <span>Lines listed above <b>{money(pkg, u)}</b></span>
      <span className={Math.abs(diff) > 1 ? "text-[var(--warning)]" : "text-[var(--success)]"}>{Math.abs(diff) > 1 ? `Not itemised ${money(diff, u)}` : "Ties to the report ✓"}</span>
      {ledger && ledger.count > 0 && <span>SAP dump lines <b>{money(ledger.total, u)}</b> · difference to the report <b>{money(ledger.total - pkg, u)}</b>
        <span className="text-[var(--muted)]"> (the package is the reconciled MIS; the dump is the raw booking — differences are reclassifications, timing or WBS the mapping does not assign)</span></span>}
    </div>
  );
}
