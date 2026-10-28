import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { useCurrency } from "@/lib/currency";
import { unitDiv, unitLabel, fmtPct } from "@/aop/format";
import StatTile, { InfoRow } from "@/components/common/StatTile";
import { LockSimple, Info, LinkSimple } from "@phosphor-icons/react";

const sumTo = (v, n) => v.slice(0, n).reduce((a, x) => a + (x || 0), 0);

/**
 * A project's AOP, actual and actual + forecast by month — revenue, TP opex, direct resource cost and gross margin —
 * read from the same sources as the AOP reports (the package's Project Summary and the SAP dump for actuals, the
 * approved plan for AOP), so it agrees with Project health and the Regional P&L.
 */
export default function ProjectFinancials({ project, canSync, onSynced }) {
  const { unit } = useCurrency();
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => {
    setErr("");
    api.get(`/aop/projects/${project.id}/financials`).then((r) => setData(r.data)).catch((e) => setErr(e.response?.data?.detail || e.message));
  };
  useEffect(load, [project.id, project.aop_project_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const sync = async () => {
    setBusy(true);
    try { await api.post("/aop/projects/sync"); onSynced?.(); load(); } catch (e) { setErr(e.response?.data?.detail || e.message); } finally { setBusy(false); }
  };

  if (err) return <div className="text-xs text-[var(--danger)]" data-testid="fin-error">{String(err)}</div>;
  if (!data) return <div className="text-sm text-[var(--muted)]">Loading…</div>;

  const div = unitDiv(unit);
  const n = data.actual_months;
  const money = (v) => {
    if (v === null || v === undefined) return "";
    const x = v / div;
    if (Math.abs(x) < 0.005) return "–";
    const s = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(x));
    return x < 0 ? `(${s})` : s;
  };
  const by = Object.fromEntries(data.lines.map((l) => [l.key, l]));
  const rev = by.revenue;
  const gm = by.gm;
  const revYtdAct = sumTo(rev.af, n);
  const gmYtdAct = gm.masked ? null : sumTo(gm.af, n);

  return (
    <div className="space-y-5" data-testid="project-financials">
      {!data.linked && (
        <div className="tile p-5 flex items-start gap-3" data-testid="fin-not-linked">
          <LinkSimple size={20} className="text-[var(--gold)] mt-0.5" />
          <div className="text-sm">
            <div className="font-semibold mb-1">Not linked to an AOP / package project yet</div>
            <div className="text-[var(--muted)] text-xs max-w-2xl">
              AOP and actual figures are linked by the AOP project id, the WBS element or the project name. Projects that appear in the AOP workbook or
              the Financial Reporting Package are linked automatically when those files are uploaded{canSync ? "; or run the sync now." : "."}
            </div>
            {canSync && <button className="btn-secondary text-xs mt-3" onClick={sync} disabled={busy} data-testid="fin-sync-btn">{busy ? "Syncing…" : "Sync projects from AOP"}</button>}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatTile label={`${data.plan_fy} AOP revenue`} value={`${money(rev.aop[12])} ${unitLabel(unit)}`} testid="fin-aop-rev" />
        <StatTile label="AOP revenue · YTD" value={`${money(sumTo(rev.aop, n))} ${unitLabel(unit)}`} />
        <StatTile label="Actual revenue · YTD" value={`${money(revYtdAct)} ${unitLabel(unit)}`} accent testid="fin-act-rev" />
        <StatTile label={`${data.plan_fy} actual + forecast`} value={`${money(rev.af[12])} ${unitLabel(unit)}`} />
        <StatTile label="Gross margin · YTD actual" value={gm.masked ? "restricted" : revYtdAct ? fmtPct(gmYtdAct / revYtdAct) : "NA"} danger={!gm.masked && revYtdAct > 0 && gmYtdAct / revYtdAct < 0.15} />
      </div>

      <div className="mis overflow-auto border border-[var(--border)] bg-[var(--surface)]" data-testid="fin-table-wrap">
        <table className="mis-table w-max min-w-full" data-testid="fin-table">
          <thead>
            <tr>
              <th className="lbl h-head">{data.plan_fy} · {unitLabel(unit)}</th>
              <th className="h-head !text-left">Basis</th>
              {data.months.map((m) => <th key={m.p} className={`${m.actual ? "h-cacr" : "h-sol"} !text-right`}>{m.label}<span className="block text-[9px] font-normal opacity-80">{m.actual ? "Act" : "Fcst"}</span></th>)}
              <th className="h-tot !text-right">YTD</th>
              <th className="h-tot !text-right">{data.plan_fy}</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l) => {
              if (l.masked) {
                return (
                  <tr key={l.key}><td className="lbl"><span className="inline-flex items-center gap-1"><LockSimple size={11} />{l.label}</span></td>
                    <td colSpan={data.months.length + 3} className="text-[11px] text-[var(--muted)]">Restricted for your role</td></tr>
                );
              }
              const sign = l.sign;
              const varr = (i) => sign * ((l.af[i] || 0) - (l.aop[i] || 0));
              const strong = l.key === "gm" ? "key" : "sub";
              return (
                <React.Fragment key={l.key}>
                  <tr className={strong} data-testid={`fin-line-${l.key}`}>
                    <td className="lbl" rowSpan={3}>{l.label}{!l.linked && l.key !== "gm" && <span className="block text-[10px] font-normal text-[var(--muted)]">no figures linked</span>}</td>
                    <td className="text-[10.5px]">AOP</td>
                    {l.aop.slice(0, 12).map((v, i) => <td key={i} className="num">{money(v)}</td>)}
                    <td className="num v-tot gl">{money(sumTo(l.aop, n))}</td><td className="num v-tot">{money(l.aop[12])}</td>
                  </tr>
                  <tr>
                    <td className="text-[10.5px]">Actual / Fcst</td>
                    {l.af.slice(0, 12).map((v, i) => <td key={i} className={`num ${i < n ? "font-semibold" : "text-[var(--muted)] italic"}`}>{money(v)}</td>)}
                    <td className="num v-tot gl font-semibold">{money(sumTo(l.af, n))}</td><td className="num v-tot">{money(l.af[12])}</td>
                  </tr>
                  <tr className="pct">
                    <td className="text-[10.5px]">Var</td>
                    {Array.from({ length: 12 }).map((_, i) => <td key={i} className={`num ${varr(i) < -0.5 ? "neg" : ""}`}>{money(varr(i))}</td>)}
                    <td className={`num v-tot gl ${sign * (sumTo(l.af, n) - sumTo(l.aop, n)) < 0 ? "neg" : ""}`}>{money(sign * (sumTo(l.af, n) - sumTo(l.aop, n)))}</td>
                    <td className={`num v-tot ${varr(12) < 0 ? "neg" : ""}`}>{money(varr(12))}</td>
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="text-[10.5px] text-[var(--muted)] flex items-start gap-1.5"><Info size={12} className="mt-px shrink-0" />{data.note} Variance: positive is favourable.</div>

      {Object.keys(data.master).length > 0 && (
        <div className="tile p-4" data-testid="fin-master">
          <div className="text-[10px] tracking-overline text-[var(--muted)] mb-2">AOP project master</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
            {Object.entries(data.master).map(([k, v]) => <InfoRow key={k} k={k.replace(/_/g, " ")} v={typeof v === "number" ? (v / div).toFixed(2) + " " + unitLabel(unit) : String(v)} />)}
          </div>
        </div>
      )}
    </div>
  );
}
