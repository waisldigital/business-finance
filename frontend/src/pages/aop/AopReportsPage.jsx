import React, { useEffect, useState } from "react";
import api from "@/lib/api";
import { useCurrency } from "@/lib/currency";
import Header from "@/aop/Header";
import { PresentationChart, Stack, CaretUp, CaretDown, X, EyeSlash } from "@phosphor-icons/react";
import { Popover } from "@/aop/MisCommon";
import { usePref } from "@/aop/mis";
import FullPnL from "@/aop/FullPnL";
import PnLView from "@/aop/PnLView";
import RevenuePerformance from "@/aop/RevenuePerformance";
import RegionalPnL from "@/aop/RegionalPnL";
import { Margin, Opex, Overheads, Wbs } from "@/aop/LegacyReports";

const BODIES = {
  full_pnl: FullPnL, detailed_pnl: PnLView, revenue_performance: RevenuePerformance, regional_pnl: RegionalPnL,
  margin_profile: Margin, opex_forecast: Opex, overheads: Overheads, wbs: Wbs,
};

/**
 * AOP reports: pick one or more report formats from the dropdown; each selected format renders as its own page,
 * stacked in the order chosen. The admin decides which formats users can see (Plan settings → Report formats).
 */
export default function AopReportsPage({ admin = false }) {
  const { unit } = useCurrency();
  const [catalog, setCatalog] = useState(null);
  const [err, setErr] = useState("");
  const [pref, setPref] = usePref(admin ? "aop_reports_admin_v1" : "aop_reports_v1", { selected: ["full_pnl"] });
  useEffect(() => {
    api.get("/aop/mis/formats").then((r) => setCatalog(r.data.formats)).catch((e) => setErr(e.response?.data?.detail || e.message));
  }, []);

  const byKey = Object.fromEntries((catalog || []).map((f) => [f.key, f]));
  const selected = pref.selected.filter((k) => byKey[k]);
  const toggle = (k, on) => setPref((p) => ({ selected: on ? [...p.selected.filter((x) => x !== k), k] : p.selected.filter((x) => x !== k) }));
  const move = (k, d) => setPref((p) => {
    const a = p.selected.filter((x) => byKey[x]); const i = a.indexOf(k); const j = i + d;
    if (j < 0 || j >= a.length) return {};
    [a[i], a[j]] = [a[j], a[i]];
    return { selected: a };
  });
  const groups = [["aop_pnl", "P&L formats"], ["aop_reports", "Analysis"]];

  return (
    <div data-testid="aop-reports-page">
      <Header icon={PresentationChart} title="AOP reports"
              subtitle="MIS and AOP report formats on the single actual source — pick one or more formats; each opens as its own page below"
              actions={<>
                <Popover icon={<Stack size={14} />} label={<span className="text-[11px]">Formats · {selected.length}</span>} testid="format-picker" width="w-80">
                  {groups.map(([sec, title]) => {
                    const items = (catalog || []).filter((f) => f.section === sec);
                    if (!items.length) return null;
                    return (
                      <div key={sec}>
                        <div className="px-3 py-1.5 border-b border-[var(--border)] text-[10px] tracking-overline text-[var(--muted)]">{title}</div>
                        {items.map((f) => (
                          <label key={f.key} className="flex items-start gap-2 px-3 py-1.5 cursor-pointer hover:bg-[var(--row-hover)]">
                            <input type="checkbox" className="accent-[var(--gold)] mt-0.5" checked={selected.includes(f.key)}
                                   onChange={(e) => toggle(f.key, e.target.checked)} data-testid={`fmt-${f.key}`} />
                            <span className="flex-1 min-w-0">
                              <span className={`block ${selected.includes(f.key) ? "font-semibold" : ""}`}>{f.label}</span>
                              {f.description && <span className="block text-[10px] text-[var(--muted)] truncate">{f.description}</span>}
                            </span>
                            {!f.enabled && <span className="chip !text-[9.5px] text-[var(--warning)]" title="Hidden from users"><EyeSlash size={10} />off</span>}
                            <span className="chip !text-[9.5px]">{f.ref}</span>
                          </label>
                        ))}
                      </div>
                    );
                  })}
                </Popover>
              </>} />
      <div className="p-3 space-y-4">
        {err && <div className="text-xs text-[var(--danger)]">{String(err)}</div>}
        {catalog && !selected.length && (
          <div className="text-xs text-[var(--muted)] border border-dashed border-[var(--border)] p-6 text-center">
            {catalog.length ? "Pick a report format from the Formats menu." : "No report formats are enabled for your role — ask an administrator."}
          </div>
        )}
        {selected.map((k, i) => {
          const f = byKey[k];
          const Body = BODIES[k];
          if (!Body) return null;
          return (
            <section key={k} className="mis mis-card" data-testid={`report-${k}`}>
              <div className="mis-title">
                <span className="text-[10px] tracking-overline opacity-70">{f.ref}</span>
                <span className="text-sm font-semibold">{f.label}</span>
                {!f.enabled && <span className="chip !text-[9.5px] !bg-transparent !text-amber-300 !border-amber-300/50"><EyeSlash size={10} />Hidden from users</span>}
                <div className="flex-1" />
                <button className="text-white/70 hover:text-white disabled:opacity-30" disabled={i === 0} onClick={() => move(k, -1)} title="Move up"><CaretUp size={13} /></button>
                <button className="text-white/70 hover:text-white disabled:opacity-30" disabled={i === selected.length - 1} onClick={() => move(k, 1)} title="Move down"><CaretDown size={13} /></button>
                <button className="text-white/70 hover:text-white" onClick={() => toggle(k, false)} title="Close"><X size={13} /></button>
              </div>
              <div className="p-2"><Body unit={unit} /></div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
