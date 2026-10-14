import React, { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { useCurrency } from "@/lib/currency";
import { ArrowClockwise, CaretRight, CaretDown, Info } from "@phosphor-icons/react";
import { fmtAmount, fmtPct, unitLabel } from "./format";
import ColumnSettings, { usePersistedColumns } from "./ColumnSettings";

const DEFAULT_COLS = {
  show: { a_base: false, b_base: false, b_plan: false, spend_td: true, balance: true, utilisation: true, af_plan: true, b_draft: true },
  months: {},
};

export default function CapexSummary() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const { unit } = useCurrency();
  const [open, setOpen] = useState({});
  const [cfg, setCfg, reset] = usePersistedColumns("aop_capex_columns_v1", DEFAULT_COLS);
  const load = () => api.get("/aop/capex/summary").then((r) => setData(r.data)).catch((e) => setErr(e.response?.data?.detail || e.message));
  useEffect(() => { load(); }, []);

  const m = data?.meta || {};
  const COLS = useMemo(() => [
    { key: "a_base", label: `A ${m.base_fy || ""}` },
    { key: "b_base", label: `B ${m.base_fy || ""}` },
    { key: "b_plan", label: `B ${m.plan_fy || ""}` },
    { key: "spend_td", label: `Spend till date${m.spend_till ? ` (to ${m.spend_till})` : ""}`, strong: true },
    { key: "balance", label: "Balance to spend" },
    { key: "utilisation", label: "Utilised %", pct: true },
    { key: "af_plan", label: `${m.plan_fy || ""} A/F` },
    { key: "b_draft", label: `B ${m.draft_fy || ""}`, strong: true },
  ], [m.base_fy, m.plan_fy, m.draft_fy, m.spend_till]);
  const cols = COLS.filter((c) => cfg.show[c.key]);
  const total = useMemo(() => {
    const t = {};
    (data?.rows || []).forEach((r) => COLS.forEach((c) => { if (!c.pct) t[c.key] = (t[c.key] || 0) + (Number(r[c.key]) || 0); }));
    t.utilisation = t.b_plan ? t.spend_td / t.b_plan : null;
    return t;
  }, [data, COLS]);

  const fmt = (c, v) => (c.pct ? (v === null || v === undefined ? "" : fmtPct(v)) : fmtAmount(v, unit));

  return (
    <div className="space-y-2" data-testid="capex-summary">
      <div className="flex items-center gap-1.5">
        <span className="text-[10.5px] text-[var(--muted)] flex items-center gap-1"><Info size={11} />
          Spend = capex GRNs from the PO register (single actual source) · {m.af_rule}
        </span>
        <div className="flex-1" />
        <ColumnSettings blocks={COLS.map((c) => ({ key: c.key, label: c.label }))} value={cfg} onChange={setCfg} onReset={reset} testid="capex-columns" />
        <button className="icon-btn" onClick={load} title="Refresh"><ArrowClockwise size={13} /></button>
      </div>
      {err && <div className="text-xs text-[var(--danger)]">{String(err)}</div>}
      {data && (
        <div className="overflow-auto border border-[var(--border)] bg-[var(--surface)]">
          <table className="pnl-table text-[12px] w-max min-w-full border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="lbl text-left">Location ({unitLabel(unit)})</th>
                <th className="text-right">Lines</th>
                {cols.map((c) => <th key={c.key} className={`text-right ${c.strong ? "!text-[var(--gold)]" : ""}`}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <React.Fragment key={r.location}>
                  <tr data-testid={`capex-row-${r.location}`}>
                    <td className="lbl">
                      <span className="inline-flex items-center gap-1">
                        {r.children?.length ? (
                          <button onClick={() => setOpen((o) => ({ ...o, [r.location]: !o[r.location] }))} className="text-[var(--muted)]">
                            {open[r.location] ? <CaretDown size={11} /> : <CaretRight size={11} />}
                          </button>
                        ) : <span className="w-[11px]" />}
                        {r.location}
                      </span>
                    </td>
                    <td className="num text-[var(--muted)]">{r.lines}</td>
                    {cols.map((c) => (
                      <td key={c.key} className={`num ${c.strong ? "font-semibold" : ""} ${c.key === "balance" && r.balance < 0 ? "text-[var(--danger)]" : ""}`}>{fmt(c, r[c.key])}</td>
                    ))}
                  </tr>
                  {open[r.location] && r.children.map((ch) => (
                    <tr key={ch} className="pct"><td className="lbl" style={{ paddingLeft: 30 }}>{ch}</td><td /><td colSpan={cols.length} className="text-[10.5px]">programme within {r.location} (history in Capex history)</td></tr>
                  ))}
                </React.Fragment>
              ))}
              <tr className="total">
                <td className="lbl">Total</td>
                <td className="num">{data.rows.reduce((a, r) => a + (r.lines || 0), 0)}</td>
                {cols.map((c) => <td key={c.key} className="num">{fmt(c, total[c.key])}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
