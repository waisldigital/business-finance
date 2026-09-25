import React, { useEffect, useRef } from "react";
import { X } from "@phosphor-icons/react";

const SIZES = { sm: "max-w-md", md: "max-w-2xl", lg: "max-w-4xl", xl: "max-w-6xl", full: "max-w-[96vw]" };

/**
 * Shared dialog: dark overlay, Escape and overlay click close it, focus stays inside while it is open and
 * returns to where it was on close. `title` / `subtitle` render the standard header; omit them for a bare panel.
 */
export default function Modal({ title, subtitle, onClose, size = "md", children, footer, testid, closeOnOverlay = true,
                                panelClassName = "" }) {
  const panel = useRef(null);
  useEffect(() => {
    const before = document.activeElement;
    const el = panel.current;
    const focusables = () => el ? [...el.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')] : [];
    (focusables()[0] || el)?.focus?.({ preventScroll: true });
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose?.(); return; }
      if (e.key !== "Tab") return;
      const f = focusables();
      if (!f.length) return;
      const first = f[0]; const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("keydown", onKey, true); before?.focus?.({ preventScroll: true }); };
  }, [onClose]);
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" data-testid={testid}
         onMouseDown={(e) => { if (closeOnOverlay && e.target === e.currentTarget) onClose?.(); }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined} tabIndex={-1}
           className={`bg-[var(--surface)] w-full ${SIZES[size] || size} max-h-[92vh] overflow-y-auto border border-[var(--border)] outline-none ${panelClassName}`}>
        {(title || subtitle) && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
            <div className="min-w-0">
              {subtitle && <div className="text-[10px] tracking-overline text-[var(--muted)]">{subtitle}</div>}
              {title && <h2 className="font-display text-lg font-bold truncate">{title}</h2>}
            </div>
            <button className="btn-ghost" onClick={onClose} aria-label="Close" data-testid={testid ? `${testid}-close` : undefined}><X size={18} /></button>
          </div>
        )}
        {children}
        {footer && <div className="px-5 py-3 border-t border-[var(--border)] flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
