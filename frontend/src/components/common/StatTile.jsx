import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "@phosphor-icons/react";

const ACCENTS = { gold: "var(--gold)", success: "var(--success, #22c55e)", danger: "var(--danger)" };

/**
 * A labelled figure. size: "lg" (page stats), "md" (form summaries), "sm" (compact drawers).
 *   accent  true | "gold" | "success" | "danger" — colours the value;  danger — shorthand for accent="danger"
 *   tone    extra classes for the value (sm) or icon (link tiles);  onClick / to — clickable tile
 *   icon, sub — link tiles on the admin overview
 */
export default function StatTile({ label, value, sub, icon: Icon, onClick, to, accent, danger, tone, size = "lg", testid }) {
  const color = ACCENTS[accent === true ? "gold" : accent] || (danger ? ACCENTS.danger : undefined);
  if (to) {
    return (
      <Link to={to} className="border border-[var(--border)] bg-[var(--surface)] p-3 hover:border-[var(--gold)] flex items-start gap-3" data-testid={testid}>
        {Icon && <Icon size={22} weight="duotone" className={tone || "text-[var(--gold)]"} />}
        <div className="min-w-0">
          <div className="text-[10px] tracking-overline text-[var(--muted)]">{label}</div>
          <div className="text-lg font-bold tabular-nums leading-tight">{value}</div>
          {sub && <div className="text-[10.5px] text-[var(--muted)] truncate">{sub}</div>}
        </div>
      </Link>
    );
  }
  if (size === "sm") {
    return (
      <div className="border border-[var(--border)] px-2.5 py-1.5" data-testid={testid}>
        <div className="text-[10px] tracking-overline text-[var(--muted)]">{label}</div>
        <div className={`text-sm font-semibold tabular-nums ${tone || ""}`} style={{ color }}>{value}</div>
      </div>
    );
  }
  const clickable = !!onClick;
  return (
    <div className={`tile ${size === "md" ? "p-3" : "p-4"} ${clickable ? "cursor-pointer transition-all hover:border-[var(--gold)] hover:translate-y-[-1px]" : ""}`}
         onClick={onClick} data-testid={testid}>
      <div className="text-[10px] tracking-overline text-[var(--muted)] flex items-center gap-1">
        {label}
        {clickable && <ArrowRight size={10} weight="bold" className="text-[var(--gold)] opacity-70" />}
      </div>
      <div className={size === "md" ? "text-lg font-display font-bold mt-1" : "font-mono font-semibold text-xl mt-1"} style={{ color: color || "var(--text)" }}>
        {value}
      </div>
      {sub && <div className="text-[10.5px] text-[var(--muted)] mt-0.5">{sub}</div>}
    </div>
  );
}

/** A small label over a value (detail panels). */
export function InfoRow({ k, v, fallback = "—" }) {
  return (
    <div>
      <div className="text-[9px] tracking-overline text-[var(--muted)]">{k}</div>
      <div className="font-medium text-[var(--text)]">{v || v === 0 ? v : fallback}</div>
    </div>
  );
}
