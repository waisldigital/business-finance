import React, { useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import { Globe, AirplaneTilt, Prohibit, CalendarBlank, ListBullets, ListDashes, LockSimple, ArrowClockwise, DownloadSimple } from "@phosphor-icons/react";
import { fmtAmount, fmtPct, download } from "./format";

export default function PnLView() {
  const [filters, setFilters] = useState({ geo: ["All", "India", "International"], tags: ["All"] });
  const [geo, setGeo] = useState("All");
  const [tag, setTag] = useState("All");
  const [exclude, setExclude] = useState([]);
  const [unit, setUnit] = useState("cr");
  const [showBaseMonths, setShowBaseMonths] = useState(false);
  const [showPlanMonths, setShowPlanMonths] = useState(true);
  const [detail, setDetail] = useState(true);
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

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

  const cols = useMemo(() => {
    if (!data) return [];
    return data.columns.filter((c) => {
      if (c.fy === data.meta.base_fy) return showBaseMonths;
      if (c.fy === data.meta.plan_fy) return showPlanMonths;
      return true;
    });
  }, [data, showBaseMonths, showPlanMonths]);

  const rows = useMemo(() => (data?.rows || []).filter((r) => detail || r.level <= 1 || r.pct), [data, detail]);

  const exportCsv = () => {
    const head = ["Particular", ...cols.map((c) => c.label)];
    const lines = [head, ...rows.map((r) => [r.label, ...cols.map((c) => (r.values ? (r.pct || c.key === "growth" ? r.values[c.key] : (r.values[c.key] ?? 0) / (unit === "cr" ? 1e7 : 1e5)) : "restricted"))])];
    download(new Blob([lines.map((l) => l.map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv" }),
             `PnL_${geo}_${tag}.csv`);
  };

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
        <div className="seg" title="Month columns">
          <button className={showBaseMonths ? "on" : ""} onClick={() => setShowBaseMonths((v) => !v)}><CalendarBlank size={11} />{data?.meta.base_fy || "Base"}</button>
          <button className={showPlanMonths ? "on" : ""} onClick={() => setShowPlanMonths((v) => !v)}><CalendarBlank size={11} />{data?.meta.plan_fy || "Plan"}</button>
        </div>
        <div className="seg" title="Rows">
          <button className={!detail ? "on" : ""} onClick={() => setDetail(false)} title="Summary"><ListDashes size={12} /></button>
          <button className={detail ? "on" : ""} onClick={() => setDetail(true)} title="Detail"><ListBullets size={12} /></button>
        </div>
        <div className="seg" title="Units">
          <button className={unit === "cr" ? "on" : ""} onClick={() => setUnit("cr")}>₹ Cr</button>
          <button className={unit === "lakh" ? "on" : ""} onClick={() => setUnit("lakh")}>₹ L</button>
        </div>
        <button className="icon-btn" onClick={exportCsv} title="Export view (csv)"><DownloadSimple size={13} /></button>
        <button className="icon-btn" onClick={load} title="Refresh"><ArrowClockwise size={13} className={loading ? "animate-spin" : ""} /></button>
      </div>

      {err && <div className="text-xs text-[var(--danger)]">{String(err)}</div>}
      {data && !data.meta.payroll_visible && (
        <div className="text-[10.5px] text-[var(--muted)] flex items-center gap-1"><LockSimple size={11} /> Resource-cost lines are confidential for your role; totals still include them.</div>
      )}

      {data && (
        <div className="overflow-auto border border-[var(--border)] bg-[var(--surface)]" style={{ maxHeight: "calc(100vh - 205px)" }}>
          <table className="pnl-table text-[12px] w-max min-w-full border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="lbl text-left">Particular ({unit === "cr" ? "INR Cr" : "INR Lakh"})</th>
                {cols.map((c) => (
                  <th key={c.fy ? `${c.fy}-${c.key}` : c.key} className={`text-right ${!c.fy && c.key !== "growth" ? "tot" : ""}`}>
                    <div>{c.label}</div>
                    {c.fy && <div className="text-[9px] font-normal opacity-70">{c.kind === "actual" ? "Act" : c.kind === "forecast" ? "Fcst" : "Bud"}</div>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={`${r.kind === "total" ? "total" : r.kind === "subtotal" ? "subtotal" : ""} ${r.pct ? "pct" : ""}`} data-testid={`pnl-row-${r.id}`}>
                  <td className="lbl" style={{ paddingLeft: 8 + (r.level || 0) * 14 }}>
                    <span className="inline-flex items-center gap-1">{r.masked && <LockSimple size={10} className="text-[var(--muted)]" />}{r.label}</span>
                  </td>
                  {cols.map((c) => {
                    const v = r.values?.[c.key];
                    const txt = r.masked ? "•••" : c.key === "growth" ? (v === null || v === undefined ? "" : fmtPct(v)) : r.pct ? fmtPct(v) : fmtAmount(v, unit);
                    return (
                      <td key={c.fy ? `${c.fy}-${c.key}` : c.key}
                          className={`num ${c.kind === "forecast" ? "fc" : ""} ${!c.fy && c.key !== "growth" ? "tot" : ""} ${typeof v === "number" && v < 0 && !r.pct ? "text-[var(--danger)]" : ""}`}>
                        {txt}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
