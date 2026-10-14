import React, { useEffect, useRef } from "react";
import { X } from "@phosphor-icons/react";

const SIZES = { sm: "max-w-md", md: "max-w-2xl", lg: "max-w-4xl", xl: "max-w-6xl", full: "max-w-[96vw]" };
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const stack = []; // open dialogs, innermost last — only the top one reacts to Escape / Tab

/**
 * The app's dialog: dark overlay, Escape closes it, Tab stays inside, focus returns where it was on close.
 * With `title` / `subtitle` it renders the standard header; otherwise the children are the whole panel.
 *   size        sm | md | lg | xl | full (ignored when `className` sets the panel's own classes)
 *   as          "div" (default) or "form" (with onSubmit) for a panel that is itself the form
 *   className   the panel's classes, replacing the default panel look
 *   z           stacking class for dialogs opened over other dialogs (default z-50)
 *   closeOnOverlay  close when the dark area is clicked (off by default, so a stray click can't lose input)
 */
export default function Modal({ title, subtitle, onClose, size = "md", children, footer, testid, panelTestid,
                                closeOnOverlay = false, className, as: Panel = "div", onSubmit, z = "z-50" }) {
  const panel = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const me = {};
    stack.push(me);
    const before = document.activeElement;
    const el = panel.current;
    const focusables = () => (el ? [...el.querySelectorAll(FOCUSABLE)] : []);
    if (!el?.contains(document.activeElement)) (focusables()[0] || el)?.focus?.({ preventScroll: true });
    const onKey = (e) => {
      if (stack[stack.length - 1] !== me) return;
      if (e.key === "Escape") { e.stopPropagation(); closeRef.current?.(); return; }
      if (e.key !== "Tab") return;
      const f = focusables();
      if (!f.length) return;
      const first = f[0]; const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      stack.splice(stack.indexOf(me), 1);
      if (before && document.contains(before)) before.focus?.({ preventScroll: true });
    };
  }, []);
  const panelClass = className
    || `bg-[var(--surface)] w-full ${SIZES[size] || size} max-h-[92vh] overflow-y-auto border border-[var(--border)]`;
  return (
    <div className={`fixed inset-0 bg-black/60 flex items-center justify-center ${z} p-4`} data-testid={testid}
         onMouseDown={(e) => { if (closeOnOverlay && e.target === e.currentTarget) onClose?.(); }}>
      <Panel ref={panel} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined} tabIndex={-1}
             className={`${panelClass} outline-none`} onSubmit={onSubmit} data-testid={panelTestid}>
        {(title || subtitle) && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
            <div className="min-w-0">
              {subtitle && <div className="text-[10px] tracking-overline text-[var(--muted)]">{subtitle}</div>}
              {title && <h2 className="font-display text-lg font-bold truncate">{title}</h2>}
            </div>
            <button type="button" className="btn-ghost" onClick={onClose} aria-label="Close" data-testid={testid ? `${testid}-close` : undefined}><X size={18} /></button>
          </div>
        )}
        {children}
        {footer && <div className="px-5 py-3 border-t border-[var(--border)] flex justify-end gap-2">{footer}</div>}
      </Panel>
    </div>
  );
}
