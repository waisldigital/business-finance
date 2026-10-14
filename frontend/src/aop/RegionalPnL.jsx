import React, { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { DownloadSimple, ArrowClockwise, Info, LockSimple, GearSix, ArrowCounterClockwise } from "@phosphor-icons/react";
import { fmtAmount, fmtPct, unitDiv, unitLabel } from "./format";
import { agg, useTree, csvDownload, usePref, periodPrefix } from "./mis";
import { TreeLabel, ExpandButtons, PeriodPicker, Popover } from "./MisCommon";
import { SharedDefault } from "./GridSettings";
import { useAuth } from "@/lib/auth";

const DEFAULTS = { measure: "af_plan", period: "fy", month: null, subs: true };

/** Regional P&L — Solutions (MIS slide 5b): India, International and its regions, Total. */
export default function RegionalPnL({ unit, onDrill }) {
  const [pref, setPref, resetPref, sharedPref] = usePref("aop_mis_regional_v1", DEFAULTS);
  const { user } = useAuth() || {};
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const load = () => {
    setErr("");
    api.get("/aop/mis/regional").then((r) => setData(r.data)).catch((e) => setErr(e.response?.data?.detail || e.message));
  };
  useEffect(load, []);

  const rows = useMemo(() => data?.rows || [], [data]);
  const tree = useTree(rows, { defaultOpen: false });
  const byId = useMemo(() => Object.fromEntries(rows.map((r) => [r.id, r])), [rows]);
  const month = pref.month ?? data?.months?.default_month ?? 0;
  const cols = (data?.columns || []).filter((c) => pref.subs || !c.sub);
  const measure = (data?.measures || []).find((x) => x.key === pref.measure) || data?.measures?.[2];

  const val = (r, c) => {
    if (r.kind === "pct") {
      const n = val(byId[r.ratio[0]], c); const d = val(byId[r.ratio[1]], c);
      return n === null || d === null || !d ? null : n / d;
    }
    if (!r.values) return null;
    return agg(r.values[measure.key]?.[c], pref.period, month);
  };
  const show = (r, v) => {
    if (r.masked) return "•••";
    if (v === null || v === undefined) return r.kind === "pct" ? "NA" : "";
    return r.kind === "pct" ? fmtPct(v) : fmtAmount(v, unit);
  };
  const cls = (c) => (c.group === "india" ? "h-cacr" : c.group === "total" ? "h-tot" : c.sub ? "h-sub" : "h-sol");
  const exportCsv = () => {
    const div = unitDiv(unit);
    csvDownload([["Particulars", ...cols.map((c) => c.label)],
                 ...rows.map((r) => [r.label, ...cols.map((c) => { const v = val(r, c.key); return r.masked ? "restricted" : r.kind === "pct" ? v : (v ?? 0) / div; })])],
                `Regional_PnL_${measure?.key}_${pref.period}.csv`);
  };

  return (
    <div className="space-y-2" data-testid="fmt-regional">
      <div className="flex items-center gap-1.5 flex-wrap">
        <div className="seg" title="Year">
          {(data?.measures || []).filter((x) => x.available).map((x) => (
            <button key={x.key} className={measure?.key === x.key ? "on" : ""} onClick={() => setPref({ measure: x.key })} data-testid={`reg-m-${x.key}`}>{x.label}</button>
          ))}
        </div>
        <PeriodPicker period={pref.period} month={month} months={data?.months} onChange={(p) => setPref(p)} testid="reg-period" />
        <label className="flex items-center gap-1 text-[11px] ml-1">
          <input type="checkbox" className="accent-[var(--gold)]" checked={pref.subs} onChange={(e) => setPref({ subs: e.target.checked })} />Regions
        </label>
        <div className="flex-1" />
        <ExpandButtons tree={tree} />
        <button className="icon-btn" onClick={resetPref} title="Return to default view"><ArrowCounterClockwise size={13} /></button>
        {user?.role === "admin" && (
          <Popover icon={<GearSix size={14} />} testid="reg-settings" width="w-72"><SharedDefault shared={sharedPref} testid="reg" /></Popover>
        )}
        <button className="icon-btn" onClick={exportCsv} title="Export (csv)"><DownloadSimple size={13} /></button>
        <button className="icon-btn" onClick={load} title="Refresh"><ArrowClockwise size={13} /></button>
      </div>
      {err && <div className="text-xs text-[var(--danger)]">{String(err)}</div>}
      {data && (
        <>
          <div className="overflow-auto border border-[var(--border)]">
            <table className="mis-table w-max min-w-full" data-testid="regional-table">
              <thead>
                <tr>
                  <th className="lbl h-head">Particulars · {periodPrefix(pref.period, data.months, month)} {measure?.label} ({unitLabel(unit)})</th>
                  {cols.map((c) => <th key={c.key} className={`${cls(c)} !text-right`}>{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.filter(tree.visible).map((r) => {
                  const d = tree.depth(r.id);
                  return (
                    <tr key={r.id} className={`${r.key ? "key" : r.kind === "subtotal" ? "sub" : ""} ${d ? "child" : ""} ${r.kind === "pct" ? "pct" : ""} ${onDrill && ["rev", "gm", "direct"].includes(r.id) ? "dbl" : ""}`}
                        onDoubleClick={onDrill && ["rev", "gm", "direct"].includes(r.id) ? () => onDrill("project_health", {}, "Project health") : undefined}
                        data-testid={`reg-row-${r.id}`}>
                      <td className="lbl"><TreeLabel row={r} tree={tree} depth={d} /></td>
                      {cols.map((c) => {
                        const v = val(r, c.key);
                        return <td key={c.key} className={`num ${c.key === "total" ? "v-tot gl" : c.key === "intl" || c.key === "india" ? "gl" : ""} ${typeof v === "number" && v < 0 && r.kind !== "pct" ? "neg" : ""}`}>{show(r, v)}</td>;
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="text-[10.5px] text-[var(--muted)] flex items-center gap-3 flex-wrap">
            <span className="flex items-center gap-1"><Info size={11} /> Directly attributable expenses are charged to the respective region; common expenses are apportioned across regions in proportion to revenue.</span>
            {rows.some((r) => r.masked) && <span className="flex items-center gap-1"><LockSimple size={11} /> Payroll lines are confidential for your role.</span>}
          </div>
        </>
      )}
    </div>
  );
}
