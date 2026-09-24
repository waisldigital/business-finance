import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LockSimple, HourglassMedium } from "@phosphor-icons/react";
import { fmtCell, parseTSV, toTSV } from "./format";

/**
 * Spreadsheet-like grid.
 *  - click / arrows / Tab to move, Shift+arrows or drag to select a range
 *  - Enter, F2 or just typing edits the active cell; Esc cancels; Delete clears editable cells
 *  - Ctrl/Cmd+C copies the selection as TSV (pastes straight into Excel)
 *  - Ctrl/Cmd+V pastes a block copied from Excel starting at the active cell; a single value pasted
 *    over a selection fills the whole selection. Only editable cells receive values.
 *
 * Props: columns [{key,label,type}], rows [{key, fields, pending}], canEdit(col) → bool,
 *        onCommit([{key, field, value}]) → Promise, onCellLink(col, row) optional (renders links for
 *        columns flagged `link`), selectable (row checkboxes), selected Set, onSelect(Set)
 */
export default function DataGrid({ columns, rows, canEdit, onCommit, onCellLink, linkColumns = [], renderHeader,
                                   selectable = false, selected, onSelect, height = "calc(100vh - 230px)", testid = "data-grid" }) {
  const cols = useMemo(() => columns.filter((c) => !c.hidden), [columns]);
  const [active, setActive] = useState({ r: 0, c: 0 });
  const [anchor, setAnchor] = useState(null);
  const [editing, setEditing] = useState(null); // {r, c, value}
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef(null);
  const dragging = useRef(false);

  const sel = useMemo(() => {
    const a = anchor || active;
    return { r1: Math.min(a.r, active.r), r2: Math.max(a.r, active.r), c1: Math.min(a.c, active.c), c2: Math.max(a.c, active.c) };
  }, [anchor, active]);
  const inSel = (r, c) => r >= sel.r1 && r <= sel.r2 && c >= sel.c1 && c <= sel.c2;

  useEffect(() => {
    if (active.r >= rows.length && rows.length) setActive({ r: rows.length - 1, c: active.c });
  }, [rows.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const value = (r, c) => rows[r]?.fields?.[cols[c]?.key];
  const editable = useCallback((c) => !!cols[c] && canEdit(cols[c]), [cols, canEdit]);

  const commit = useCallback(async (edits) => {
    const ok = edits.filter((e) => e.field && e.key);
    if (!ok.length || !onCommit) return;
    setBusy(true);
    try { await onCommit(ok); } finally { setBusy(false); }
  }, [onCommit]);

  const move = (dr, dc, extend) => {
    setActive((a) => {
      const n = { r: Math.max(0, Math.min(rows.length - 1, a.r + dr)), c: Math.max(0, Math.min(cols.length - 1, a.c + dc)) };
      if (extend) setAnchor((an) => an || a); else setAnchor(null);
      scrollTo(n);
      return n;
    });
  };

  const scrollTo = (n) => {
    const el = wrapRef.current?.querySelector(`[data-cell="${n.r}-${n.c}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  const startEdit = (initial) => {
    if (!editable(active.c) || !rows[active.r]) return;
    const cur = value(active.r, active.c);
    setEditing({ r: active.r, c: active.c, value: initial !== undefined ? initial : (cur ?? "") });
  };

  const finishEdit = async (dr = 0, dc = 0) => {
    if (!editing) return;
    const { r, c, value: v } = editing;
    setEditing(null);
    const old = value(r, c);
    if (String(old ?? "") !== String(v ?? "")) await commit([{ key: rows[r].key, field: cols[c].key, value: v }]);
    wrapRef.current?.focus({ preventScroll: true });
    if (dr || dc) move(dr, dc, false);
  };

  const onKeyDown = (e) => {
    if (editing) return;
    const meta = e.ctrlKey || e.metaKey;
    if (e.key === "ArrowDown") { e.preventDefault(); move(1, 0, e.shiftKey); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1, 0, e.shiftKey); }
    else if (e.key === "ArrowRight") { e.preventDefault(); move(0, 1, e.shiftKey); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); move(0, -1, e.shiftKey); }
    else if (e.key === "Tab") { e.preventDefault(); move(0, e.shiftKey ? -1 : 1, false); }
    else if (e.key === "Enter" || e.key === "F2") { e.preventDefault(); startEdit(); }
    else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      const edits = [];
      for (let r = sel.r1; r <= sel.r2; r++) for (let c = sel.c1; c <= sel.c2; c++) {
        if (editable(c) && value(r, c) !== undefined && value(r, c) !== null) edits.push({ key: rows[r].key, field: cols[c].key, value: null });
      }
      commit(edits);
    } else if (meta && e.key.toLowerCase() === "a") { e.preventDefault(); setAnchor({ r: 0, c: 0 }); setActive({ r: rows.length - 1, c: cols.length - 1 }); }
    else if (!meta && !e.altKey && e.key.length === 1) { e.preventDefault(); startEdit(e.key); }
  };

  const onCopy = (e) => {
    if (editing) return;
    const m = [];
    for (let r = sel.r1; r <= sel.r2; r++) {
      const line = [];
      for (let c = sel.c1; c <= sel.c2; c++) line.push(value(r, c));
      m.push(line);
    }
    e.clipboardData.setData("text/plain", toTSV(m));
    e.preventDefault();
  };

  const onPaste = async (e) => {
    if (editing) return;
    e.preventDefault();
    const matrix = parseTSV(e.clipboardData.getData("text/plain"));
    if (!matrix.length) return;
    const edits = [];
    const single = matrix.length === 1 && matrix[0].length === 1;
    if (single && (sel.r2 > sel.r1 || sel.c2 > sel.c1)) {
      for (let r = sel.r1; r <= sel.r2; r++) for (let c = sel.c1; c <= sel.c2; c++)
        if (editable(c) && rows[r]) edits.push({ key: rows[r].key, field: cols[c].key, value: matrix[0][0] });
    } else {
      matrix.forEach((line, i) => line.forEach((v, j) => {
        const r = active.r + i, c = active.c + j;
        if (rows[r] && cols[c] && editable(c)) edits.push({ key: rows[r].key, field: cols[c].key, value: v });
      }));
      setAnchor({ r: active.r, c: active.c });
      setActive({ r: Math.min(rows.length - 1, active.r + matrix.length - 1), c: Math.min(cols.length - 1, active.c + Math.max(...matrix.map((l) => l.length)) - 1) });
    }
    await commit(edits);
  };

  const allSelected = selectable && rows.length > 0 && rows.every((r) => selected?.has(r.key));

  return (
    <div className="relative border border-[var(--border)] bg-[var(--surface)]" data-testid={testid}>
      {busy && <div className="absolute top-1 right-2 z-30 text-[10px] tracking-overline text-[var(--gold)]">Saving…</div>}
      <div
        ref={wrapRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onCopy={onCopy}
        onPaste={onPaste}
        onMouseUp={() => { dragging.current = false; }}
        className="overflow-auto outline-none aop-grid"
        style={{ maxHeight: height }}
      >
        <table className="border-separate border-spacing-0 text-[12px] w-max min-w-full">
          <thead>
            <tr>
              {selectable && (
                <th className="aop-th sticky left-0 z-20 w-7">
                  <input type="checkbox" className="accent-[var(--gold)]" checked={allSelected}
                         onChange={(e) => onSelect?.(e.target.checked ? new Set(rows.map((r) => r.key)) : new Set())} />
                </th>
              )}
              {cols.map((c, ci) => (
                <th key={c.key} className={`aop-th ${ci === 0 ? "sticky z-20" : "z-10"} ${c.type === "number" || c.type === "percent" ? "text-right" : "text-left"}`}
                    style={{ left: ci === 0 ? (selectable ? 28 : 0) : undefined, minWidth: c.width || (c.type === "number" ? 84 : 64) }}
                    title={c.key}>
                  <span className="inline-flex items-center gap-1">
                    {!canEdit(c) && <LockSimple size={10} className="opacity-40" />}
                    {renderHeader ? renderHeader(c) : c.label}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={row.key}>
                {selectable && (
                  <td className="aop-td sticky left-0 z-10 bg-[var(--surface)] text-center">
                    <input type="checkbox" className="accent-[var(--gold)]" checked={!!selected?.has(row.key)}
                           onChange={(e) => { const n = new Set(selected); e.target.checked ? n.add(row.key) : n.delete(row.key); onSelect?.(n); }} />
                  </td>
                )}
                {cols.map((c, ci) => {
                  const isActive = active.r === r && active.c === ci;
                  const pend = row.pending?.[c.key];
                  const v = row.fields?.[c.key];
                  const isNum = c.type === "number" || c.type === "percent";
                  const cls = [
                    "aop-td",
                    ci === 0 ? "sticky z-10 font-medium" : "",
                    isNum ? "text-right tabular-nums" : "",
                    inSel(r, ci) ? "aop-sel" : "",
                    isActive ? "aop-active" : "",
                    canEdit(c) ? "aop-editable" : "",
                    pend ? "aop-pending" : "",
                  ].join(" ");
                  return (
                    <td key={c.key} data-cell={`${r}-${ci}`} className={cls}
                        style={{ left: ci === 0 ? (selectable ? 28 : 0) : undefined }}
                        title={pend ? `Pending approval: ${pend.value ?? "(blank)"}` : undefined}
                        onMouseDown={(e) => {
                          if (e.target.closest("[data-link]")) return; // let PO links receive their click
                          if (editing && (editing.r !== r || editing.c !== ci)) finishEdit();
                          dragging.current = true;
                          if (e.shiftKey) setAnchor((a) => a || active); else setAnchor(null);
                          setActive({ r, c: ci });
                          wrapRef.current?.focus({ preventScroll: true });
                        }}
                        onMouseEnter={() => { if (dragging.current) { setAnchor((a) => a || active); setActive({ r, c: ci }); } }}
                        onDoubleClick={() => startEdit()}>
                      {editing && editing.r === r && editing.c === ci ? (
                        <input autoFocus className="aop-cell-input" value={editing.value ?? ""}
                               onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                               onBlur={() => finishEdit()}
                               onKeyDown={(e) => {
                                 if (e.key === "Enter") { e.preventDefault(); finishEdit(1, 0); }
                                 else if (e.key === "Tab") { e.preventDefault(); finishEdit(0, e.shiftKey ? -1 : 1); }
                                 else if (e.key === "Escape") { setEditing(null); wrapRef.current?.focus({ preventScroll: true }); }
                               }} />
                      ) : linkColumns.includes(c.key) && v !== null && v !== undefined && v !== "" && onCellLink ? (
                        <button data-link className="text-[var(--gold)] underline decoration-dotted underline-offset-2 hover:decoration-solid"
                                onClick={(e) => { e.stopPropagation(); onCellLink(c, row); }}>{fmtCell(v, c.type)}</button>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          {pend && <HourglassMedium size={10} className="text-[var(--warning)]" />}
                          {fmtCell(v, c.type)}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={cols.length + (selectable ? 1 : 0)} className="text-center py-10 text-[var(--muted)] text-xs">No rows</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
