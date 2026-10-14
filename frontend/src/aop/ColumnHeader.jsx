import React, { useEffect, useMemo, useRef, useState } from "react";
import { Funnel, SortAscending, SortDescending, CaretDown, X } from "@phosphor-icons/react";
import { distinctValues, isNumeric } from "./gridView";

const TEXT_OPS = [["", "—"], ["contains", "Contains"], ["ncontains", "Does not contain"], ["begins", "Begins with"],
                  ["ends", "Ends with"], ["eq", "Equals"], ["ne", "Does not equal"]];
const NUM_OPS = [["", "—"], ["gt", ">"], ["gte", "≥"], ["lt", "<"], ["lte", "≤"], ["eq", "="], ["ne", "≠"], ["between", "Between"], ["top10", "Top N"]];

/**
 * Column header content: label, sort on click (asc → desc → off) and, when filters are on, an Excel-style
 * filter menu — sort A→Z / Z→A, search, (Select all) value list with counts, and a text / number condition.
 */
export default function ColumnHeader({ col, rows, view, update, align = "left", testid }) {
  const sort = view.sort?.key === col.key ? view.sort.dir : null;
  const flt = view.filters?.[col.key];
  const active = !!(flt && (flt.values || flt.cond?.op));
  const cycle = () => update({ sort: sort === "asc" ? { key: col.key, dir: "desc" } : sort === "desc" ? null : { key: col.key, dir: "asc" } });
  return (
    <span className={`inline-flex items-center gap-1 w-full ${align === "right" ? "justify-end" : ""}`}>
      <button className="inline-flex items-center gap-0.5 hover:text-[var(--gold)] truncate" onClick={cycle} title="Sort" data-testid={testid ? `${testid}-sort` : undefined}>
        <span className="truncate">{col.label}</span>
        {sort === "asc" && <SortAscending size={11} className="text-[var(--gold)] shrink-0" />}
        {sort === "desc" && <SortDescending size={11} className="text-[var(--gold)] shrink-0" />}
      </button>
      {view.filtersOn && <FilterMenu col={col} rows={rows} flt={flt} active={active} view={view} update={update} testid={testid} />}
    </span>
  );
}

function FilterMenu({ col, rows, flt, active, view, update, testid }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const num = isNumeric(col);
  const [search, setSearch] = useState("");
  const all = useMemo(() => (open ? distinctValues(rows, col) : []), [open, rows, col]);
  const [picked, setPicked] = useState(null);
  const [touched, setTouched] = useState(false);
  const [cond, setCond] = useState(flt?.cond || { op: "", a: "", b: "" });
  useEffect(() => {
    if (open) { setPicked(flt?.values ? new Set(flt.values) : null); setCond(flt?.cond || { op: "", a: "", b: "" }); setSearch(""); setTouched(false); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const shown = all.filter(([v]) => !search || v.toLowerCase().includes(search.toLowerCase()));
  const isOn = (v) => !picked || picked.has(v);
  const toggle = (v) => {
    setTouched(true);
    const base = picked ? new Set(picked) : new Set(all.map(([x]) => x));
    base.has(v) ? base.delete(v) : base.add(v);
    setPicked(base.size === all.length ? null : base);
  };
  const selectAll = (on) => {
    setTouched(true);
    if (!search) { setPicked(on ? null : new Set()); return; }
    const base = picked ? new Set(picked) : new Set(all.map(([x]) => x));
    shown.forEach(([v]) => (on ? base.add(v) : base.delete(v)));
    setPicked(base.size === all.length ? null : base);
  };
  const apply = () => {
    // as in Excel: a search followed straight by OK keeps just the matching values
    const values = search && !touched ? shown.map(([v]) => v) : picked ? [...picked] : null;
    const c = cond.op ? cond : null;
    update({ filters: { ...(view.filters || {}), [col.key]: values || c ? { values, cond: c } : undefined } });
    setOpen(false);
  };
  const clear = () => { update({ filters: { ...(view.filters || {}), [col.key]: undefined } }); setOpen(false); };
  return (
    <span className="relative" ref={ref}>
      <button className={`px-0.5 ${active ? "text-[var(--gold)]" : "text-[var(--muted)] hover:text-[var(--text)]"}`} onClick={() => setOpen((o) => !o)}
              title="Filter" data-testid={testid ? `${testid}-filter` : undefined}>
        {active ? <Funnel size={11} weight="fill" /> : <CaretDown size={10} />}
      </button>
      {open && (
        <div className="absolute left-0 top-5 z-50 w-60 bg-[var(--surface)] border border-[var(--border)] shadow-xl text-[11px] text-[var(--text)] font-normal text-left normal-case tracking-normal"
             onClick={(e) => e.stopPropagation()} data-testid={testid ? `${testid}-filter-panel` : undefined}>
          <div className="p-1.5 border-b border-[var(--border)] flex gap-1">
            <button className="icon-btn !h-6 flex-1" onClick={() => { update({ sort: { key: col.key, dir: "asc" } }); setOpen(false); }}>
              <SortAscending size={11} />{num ? "Smallest first" : "A → Z"}
            </button>
            <button className="icon-btn !h-6 flex-1" onClick={() => { update({ sort: { key: col.key, dir: "desc" } }); setOpen(false); }}>
              <SortDescending size={11} />{num ? "Largest first" : "Z → A"}
            </button>
          </div>
          <div className="p-1.5 border-b border-[var(--border)] space-y-1">
            <div className="flex gap-1">
              <select className="input-sm flex-1" value={cond.op} onChange={(e) => setCond({ ...cond, op: e.target.value })}>
                {(num ? NUM_OPS : TEXT_OPS).map(([k, l]) => <option key={k} value={k}>{num ? `Number: ${l}` : `Text: ${l}`}</option>)}
              </select>
            </div>
            {cond.op && (
              <div className="flex gap-1">
                <input className="input-sm flex-1 min-w-0" value={cond.a} placeholder={cond.op === "top10" ? "N (e.g. 10)" : "value"} onChange={(e) => setCond({ ...cond, a: e.target.value })} />
                {cond.op === "between" && <input className="input-sm flex-1 min-w-0" value={cond.b} placeholder="and" onChange={(e) => setCond({ ...cond, b: e.target.value })} />}
              </div>
            )}
          </div>
          <div className="p-1.5">
            <input className="input-sm w-full" placeholder="Search values…" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
          </div>
          <div className="max-h-52 overflow-auto px-1.5 pb-1">
            <label className="flex items-center gap-1.5 py-0.5 font-semibold">
              <input type="checkbox" className="accent-[var(--gold)]" checked={shown.every(([v]) => isOn(v))} onChange={(e) => selectAll(e.target.checked)} />
              (Select all{search ? " search results" : ""})
            </label>
            {shown.slice(0, 500).map(([v, n]) => (
              <label key={v} className="flex items-center gap-1.5 py-0.5 cursor-pointer">
                <input type="checkbox" className="accent-[var(--gold)]" checked={isOn(v)} onChange={() => toggle(v)} />
                <span className="flex-1 truncate">{v}</span>
                <span className="text-[var(--muted)] tabular-nums">{n}</span>
              </label>
            ))}
            {shown.length > 500 && <div className="text-[var(--muted)] py-1">…{shown.length - 500} more — refine the search</div>}
          </div>
          <div className="p-1.5 border-t border-[var(--border)] flex gap-1 justify-end">
            <button className="icon-btn !h-6" onClick={clear}><X size={11} />Clear</button>
            <button className="icon-btn primary !h-6" onClick={apply} data-testid={testid ? `${testid}-filter-ok` : undefined}>OK</button>
          </div>
        </div>
      )}
    </span>
  );
}
