import React, { useEffect, useRef, useState } from "react";
import { GearSix, CalendarBlank, ArrowCounterClockwise } from "@phosphor-icons/react";

/**
 * Gear-icon popover to pick which column blocks (and their month breakdown) are shown.
 * blocks: [{key, label, hasMonths}] · value: {show: {key: bool}, months: {key: bool}} · onChange(value)
 */
export default function ColumnSettings({ blocks, value, onChange, onReset, testid = "col-settings" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const set = (part, key, v) => onChange({ ...value, [part]: { ...value[part], [key]: v } });
  const shown = blocks.filter((b) => value.show?.[b.key]).length;
  return (
    <div className="relative" ref={ref}>
      <button className={`icon-btn ${open ? "!border-[var(--gold)] !text-[var(--gold)]" : ""}`} onClick={() => setOpen((o) => !o)}
              title="Choose columns" data-testid={testid}>
        <GearSix size={14} /><span className="text-[10.5px] tabular-nums">{shown}</span>
      </button>
      {open && (
        <div className="absolute right-0 mt-1 z-40 w-64 bg-[var(--surface)] border border-[var(--border)] shadow-lg text-xs" data-testid={`${testid}-panel`}>
          <div className="px-3 py-1.5 border-b border-[var(--border)] flex items-center">
            <span className="text-[10px] tracking-overline text-[var(--muted)] flex-1">Columns</span>
            {onReset && <button className="icon-btn !h-6 !min-w-6 !px-1" onClick={onReset} title="Reset to default"><ArrowCounterClockwise size={11} /></button>}
          </div>
          {blocks.map((b) => (
            <div key={b.key} className="flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--row-hover)]">
              <label className="flex items-center gap-2 flex-1 cursor-pointer">
                <input type="checkbox" className="accent-[var(--gold)]" checked={!!value.show?.[b.key]}
                       onChange={(e) => set("show", b.key, e.target.checked)} data-testid={`${testid}-${b.key}`} />
                <span className={value.show?.[b.key] ? "font-semibold" : "text-[var(--muted)]"}>{b.label}</span>
              </label>
              {b.hasMonths && (
                <button className={`icon-btn !h-6 !px-1.5 ${value.months?.[b.key] ? "!border-[var(--gold)] !text-[var(--gold)]" : ""}`}
                        disabled={!value.show?.[b.key]} onClick={() => set("months", b.key, !value.months?.[b.key])} title="Show months">
                  <CalendarBlank size={11} /><span className="text-[10px]">12M</span>
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Persisted per browser; falls back to defaults if storage is unavailable.
export function usePersistedColumns(storageKey, defaults) {
  const [value, setValue] = useState(() => {
    try {
      const v = JSON.parse(localStorage.getItem(storageKey) || "null");
      return v ? { show: { ...defaults.show, ...v.show }, months: { ...defaults.months, ...v.months } } : defaults;
    } catch { return defaults; }
  });
  const update = (v) => { setValue(v); try { localStorage.setItem(storageKey, JSON.stringify(v)); } catch { /* ignore */ } };
  return [value, update, () => update(defaults)];
}
