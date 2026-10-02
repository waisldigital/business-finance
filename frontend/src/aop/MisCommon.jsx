import CommonModal from "@/components/common/Modal";
import CommonPopover from "@/components/common/Popover";
import React, { createContext, useContext, useEffect, useState } from "react";
import api from "@/lib/api";
import { Globe, AirplaneTilt, CalendarBlank, ArrowsInLineVertical, ArrowsOutLineVertical, LockSimple, X } from "@phosphor-icons/react";
import { PERIODS } from "./mis";

// "+" / "−" tree toggle with the row label, indented by depth
export function TreeLabel({ row, tree, depth, onDoubleClick, title }) {
  const kids = tree.hasKids.has(row.id);
  return (
    <span className="inline-flex items-center gap-1.5" style={{ paddingLeft: depth * 14 }} onDoubleClick={onDoubleClick} title={title}>
      {kids ? (
        <button className="tree-btn" onClick={() => tree.toggle(row.id)} data-testid={`tree-${row.id}`}
                aria-label={tree.isOpen(row.id) ? "Collapse" : "Expand"}>{tree.isOpen(row.id) ? "−" : "+"}</button>
      ) : <span className="w-[14px] shrink-0" />}
      {row.masked && <LockSimple size={10} className="text-[var(--muted)]" />}
      <span>{row.label}</span>
    </span>
  );
}

// Extra toolbar control a host page injects just before the row buttons (AOP reports: the Formats picker)
export const ToolbarExtra = createContext(null);

export function ExpandButtons({ tree }) {
  const extra = useContext(ToolbarExtra);
  return (
    <>
    {extra}
    <div className="seg" title="Rows">
      <button onClick={tree.collapseAll} title="Consolidated view (collapse all)" data-testid="collapse-all"><ArrowsInLineVertical size={12} /></button>
      <button onClick={tree.expandAll} title="Expand all" data-testid="expand-all"><ArrowsOutLineVertical size={12} /></button>
    </div>
    </>
  );
}

export function PeriodPicker({ period, month, months, onChange, testid = "period" }) {
  return (
    <>
      <div className="seg" title="Period" data-testid={testid}>
        {PERIODS.map(([k, l]) => (
          <button key={k} className={period === k ? "on" : ""} onClick={() => onChange({ period: k })} data-testid={`${testid}-${k}`}>{l}</button>
        ))}
      </div>
      {period !== "fy" && months && (
        <span className="inline-flex items-center gap-1">
          <CalendarBlank size={12} className="text-[var(--muted)]" />
          <select className="input-sm" value={month} onChange={(e) => onChange({ month: Number(e.target.value) })} data-testid={`${testid}-month`}>
            {months.labels.map((l, i) => <option key={l} value={i}>{period === "ytd" ? `Apr – ${l}` : l}</option>)}
          </select>
        </span>
      )}
    </>
  );
}

export function Popover({ icon, label, children, testid, width = "w-64" }) {
  return (
    <CommonPopover panelClassName={`mt-1 z-40 ${width} bg-[var(--surface)] border border-[var(--border)] shadow-lg text-xs`} panelTestid={`${testid}-panel`}
                   button={(open, toggle) => (
                     <button className={`icon-btn ${open ? "!border-[var(--gold)] !text-[var(--gold)]" : ""}`} onClick={toggle} data-testid={testid}
                             title={typeof label === "string" ? label : undefined}>
                       {icon}{label && typeof label !== "string" ? label : null}
                     </button>
                   )}>
      {children}
    </CommonPopover>
  );
}

export function Check({ checked, onChange, disabled, children, testid, note }) {
  return (
    <label className={`flex items-center gap-2 px-3 py-1.5 ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-[var(--row-hover)]"}`} title={note}>
      <input type="checkbox" className="accent-[var(--gold)]" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} data-testid={testid} />
      <span className={checked ? "font-semibold" : "text-[var(--muted)]"}>{children}</span>
    </label>
  );
}

// Geo / airport filter shared by the P&L formats (same filters and data scope as the P&L)
export function useFilters() {
  const [filters, setFilters] = useState({ geo: ["All", "India", "International"], tags: ["All"] });
  const [geo, setGeo] = useState("All");
  const [tag, setTag] = useState("All");
  useEffect(() => {
    api.get("/aop/pnl/filters").then((r) => {
      setFilters(r.data);
      if (!r.data.tags.includes("All") && r.data.tags.length) setTag(r.data.tags[0]);
    }).catch(() => {});
  }, []);
  return { filters, geo, setGeo, tag, setTag };
}

export function FilterBar({ f }) {
  return (
    <>
      <span className="chip"><Globe size={11} /></span>
      <div className="seg">
        {f.filters.geo.map((g) => <button key={g} className={f.geo === g ? "on" : ""} onClick={() => f.setGeo(g)}>{g}</button>)}
      </div>
      <span className="chip"><AirplaneTilt size={11} /></span>
      <select className="input-sm" value={f.tag} onChange={(e) => f.setTag(e.target.value)}>
        {f.filters.tags.map((t) => <option key={t}>{t}</option>)}
      </select>
    </>
  );
}

// MIS-styled dialog (drill-downs over a report) on the shared Modal
export function MisModal({ title, onClose, children, testid }) {
  return (
    <CommonModal onClose={onClose} closeOnOverlay panelTestid={testid}
                 className="mis mis-card w-full max-w-[1200px] max-h-[94vh] overflow-auto shadow-2xl">
      <div className="mis-title">
        <span className="text-sm font-semibold flex-1">{title}</span>
        <button onClick={onClose} className="text-white/80 hover:text-white" title="Close (Esc)"><X size={14} /></button>
      </div>
      <div className="p-2"><ToolbarExtra.Provider value={null}>{children}</ToolbarExtra.Provider></div>
    </CommonModal>
  );
}
