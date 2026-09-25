import React, { useEffect, useRef, useState } from "react";

/**
 * A button with a dropdown panel that closes on an outside click or Escape.
 *   button(open, toggle)  renders the trigger (keeps each caller's own look and test ids)
 *   open / onOpenChange   optional, to control it from outside (e.g. close after picking an item)
 *   align                 "right" (default) or "left" edge of the trigger
 */
export default function Popover({ button, children, open: openProp, onOpenChange, align = "right", panelClassName = "", panelTestid,
                                  className = "relative" }) {
  const [own, setOwn] = useState(false);
  const open = openProp ?? own;
  const setOpen = (v) => { if (openProp === undefined) setOwn(v); onOpenChange?.(v); };
  const ref = useRef(null);
  const setRef = useRef(setOpen);
  setRef.current = setOpen;
  useEffect(() => {
    if (!open) return undefined;
    const outside = (e) => { if (ref.current && !ref.current.contains(e.target)) setRef.current(false); };
    const esc = (e) => { if (e.key === "Escape") setRef.current(false); };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div className={className} ref={ref}>
      {button(open, () => setOpen(!open))}
      {open && (
        <div className={`absolute ${align === "left" ? "left-0" : "right-0"} ${panelClassName}`} data-testid={panelTestid}>
          {typeof children === "function" ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  );
}
