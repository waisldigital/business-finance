import React, { useEffect, useRef, useState } from "react";
import { GearSix, ArrowCounterClockwise, DotsSixVertical, Eye, EyeSlash, Funnel, CalendarBlank, TreeStructure, UsersThree } from "@phosphor-icons/react";
import { useAuth } from "@/lib/auth";

/**
 * Settings icon for any grid: show / hide and drag to reorder columns, pivot on the leading columns,
 * switch the Excel-style column filters and the 12-month view on or off, and return to the default layout.
 * cols: arranged columns ({key, label, hiddenByUser}); view / update / reset from useGridView.
 */
export default function GridSettings({ cols, view, update, reset, shared, hasMonths = true, pivotable = true, align = "right", testid = "grid-settings" }) {
  const [open, setOpen] = useState(false);
  const { user } = useAuth() || {};
  const isAdmin = user?.role === "admin" && !!shared;
  const [drag, setDrag] = useState(null);
  const [q, setQ] = useState("");
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const keys = cols.map((c) => c.key);
  const hidden = new Set(view.hidden || []);
  const move = (from, to) => {
    if (from === to || from < 0 || to < 0) return;
    const next = [...keys];
    const [k] = next.splice(from, 1);
    next.splice(to, 0, k);
    update({ order: next });
  };
  const toggle = (k) => update({ hidden: hidden.has(k) ? [...hidden].filter((x) => x !== k) : [...hidden, k] });
  const visibleCount = cols.filter((c) => !hidden.has(c.key)).length;
  return (
    <div className="relative" ref={ref}>
      <button className={`icon-btn ${open ? "!border-[var(--gold)] !text-[var(--gold)]" : ""}`} onClick={() => setOpen((o) => !o)}
              title="Columns, pivot, filters, 12M" data-testid={testid}>
        <GearSix size={14} />
        {view.pivot ? <TreeStructure size={11} className="text-[var(--gold)]" /> : null}
        {view.filtersOn ? <Funnel size={11} className="text-[var(--gold)]" /> : null}
      </button>
      {open && (
        <div className={`absolute ${align === "left" ? "left-0" : "right-0"} mt-1 z-50 w-72 bg-[var(--surface)] border border-[var(--border)] shadow-lg text-xs`} data-testid={`${testid}-panel`}>
          <div className="px-3 py-2 border-b border-[var(--border)] space-y-2">
            <div className="flex items-center gap-2">
              {hasMonths && (
                <button className={`icon-btn !h-7 ${view.twelveM ? "!border-[var(--gold)] !text-[var(--gold)]" : ""}`} onClick={() => update({ twelveM: !view.twelveM })}
                        title="Show every month" data-testid={`${testid}-12m`}>
                  <CalendarBlank size={12} /><span>12M</span>
                </button>
              )}
              <button className={`icon-btn !h-7 ${view.filtersOn ? "!border-[var(--gold)] !text-[var(--gold)]" : ""}`}
                      onClick={() => update({ filtersOn: !view.filtersOn, filters: view.filtersOn ? {} : view.filters })}
                      title="Column filters (Excel style)" data-testid={`${testid}-filters`}>
                <Funnel size={12} /><span>Filters</span>
              </button>
              <div className="flex-1" />
              <button className="icon-btn !h-7" onClick={() => { reset(); setQ(""); }} title="Return to default" data-testid={`${testid}-reset`}>
                <ArrowCounterClockwise size={12} /><span>Default</span>
              </button>
            </div>
            {pivotable && (
              <label className="flex items-center gap-2">
                <TreeStructure size={13} className="text-[var(--muted)]" />
                <span className="flex-1">Pivot on the first</span>
                <select className="input-sm" value={view.pivot || 0} onChange={(e) => update({ pivot: Number(e.target.value) })} data-testid={`${testid}-pivot`}>
                  {[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n ? `${n} column${n > 1 ? "s" : ""}` : "— (flat list)"}</option>)}
                </select>
              </label>
            )}
            {pivotable && view.pivot > 0 && (
              <div className="flex items-center gap-3 pl-5">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" className="accent-[var(--gold)]" checked={!!view.subtotals} onChange={(e) => update({ subtotals: e.target.checked })} data-testid={`${testid}-subtotals`} />
                  Subtotals
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" className="accent-[var(--gold)]" checked={view.repeatLabels !== false} onChange={(e) => update({ repeatLabels: e.target.checked })} data-testid={`${testid}-repeat`} />
                  Repeat item labels
                </label>
              </div>
            )}
            {pivotable && <div className="text-[10px] text-[var(--muted)] leading-snug">Drag a column to the top to group by it. Click a group label to close it (one summed row) or open it again.</div>}
          </div>
          {isAdmin && <SharedDefault shared={shared} testid={testid} />}
          <div className="px-3 py-1.5 flex items-center gap-2 border-b border-[var(--border)]">
            <span className="text-[10px] tracking-overline text-[var(--muted)] flex-1">Columns · {visibleCount}/{cols.length}</span>
            <input className="input-sm w-28" placeholder="Find…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="max-h-80 overflow-auto py-1">
            {cols.map((c, i) => {
              if (q && !String(c.label).toLowerCase().includes(q.toLowerCase())) return null;
              const isHidden = hidden.has(c.key);
              const isPivot = !isHidden && view.pivot && cols.filter((x) => !hidden.has(x.key)).slice(0, view.pivot).some((x) => x.key === c.key);
              return (
                <div key={c.key} draggable onDragStart={() => setDrag(i)} onDragOver={(e) => e.preventDefault()}
                     onDrop={() => { move(drag, i); setDrag(null); }}
                     className={`flex items-center gap-1.5 px-2 py-1 hover:bg-[var(--row-hover)] ${drag === i ? "opacity-40" : ""}`}
                     data-testid={`${testid}-col-${c.key}`}>
                  <DotsSixVertical size={12} className="text-[var(--muted)] cursor-grab shrink-0" />
                  <button onClick={() => toggle(c.key)} title={isHidden ? "Show" : "Hide"} className="shrink-0">
                    {isHidden ? <EyeSlash size={12} className="text-[var(--muted)]" /> : <Eye size={12} className="text-[var(--gold)]" />}
                  </button>
                  <span className={`flex-1 truncate ${isHidden ? "text-[var(--muted)] line-through" : ""}`}>{c.label}</span>
                  {isPivot ? <TreeStructure size={11} className="text-[var(--gold)]" title="Pivot level" /> : null}
                  <button className="text-[var(--muted)] hover:text-[var(--gold)] px-0.5" disabled={i === 0} onClick={() => move(i, 0)} title="Move to first">⇤</button>
                  <button className="text-[var(--muted)] hover:text-[var(--gold)] px-0.5" disabled={i === 0} onClick={() => move(i, i - 1)} title="Move up">↑</button>
                  <button className="text-[var(--muted)] hover:text-[var(--gold)] px-0.5" disabled={i === cols.length - 1} onClick={() => move(i, i + 1)} title="Move down">↓</button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Admin: make the current layout (visible / hidden columns, order, pivot, 12M, filters on, sort) everyone's default
export function SharedDefault({ shared, testid }) {
  const [msg, setMsg] = useState("");
  const run = (fn, done) => fn().then(() => setMsg(done)).catch((e) => setMsg(e.response?.data?.detail || e.message));
  return (
    <div className="px-3 py-2 border-b border-[var(--border)] bg-[var(--surface-2)] space-y-1" data-testid={`${testid}-shared`}>
      <div className="flex items-center gap-1.5">
        <UsersThree size={13} className="text-[var(--gold)]" />
        <span className="flex-1 text-[10.5px] font-semibold">Default for everyone {shared.hasDefault ? "· set" : "· not set"}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <button className="icon-btn !h-7" onClick={() => run(shared.save, "Saved — users start from this layout")} data-testid={`${testid}-save-default`}>
          Save current as default
        </button>
        {shared.hasDefault && (
          <button className="icon-btn !h-7" onClick={() => run(shared.clear, "Cleared — standard layout")} data-testid={`${testid}-clear-default`}>Clear</button>
        )}
      </div>
      <div className="text-[10px] text-[var(--muted)] leading-snug">{msg || "Columns shown / hidden, order, pivot, 12M and sort. Users can still change their own view; Default returns them here."}</div>
    </div>
  );
}
