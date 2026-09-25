import React from "react";

/**
 * Page title bar. Default: the workspace header (breadcrumb, large title, stripe). `compact`: the tight AOP / admin
 * header (icon + title + subtitle + inline actions on one line).
 */
export default function PageHeader({ title, subtitle, actions, breadcrumb, testid, watermark = false, compact = false, icon: Icon }) {
  if (compact) {
    return (
      <div className="px-5 py-2.5 border-b border-[var(--border)] bg-[var(--surface)] flex items-center gap-3" data-testid={testid || "aop-header"}>
        {Icon && <Icon size={20} weight="duotone" className="text-[var(--gold)] shrink-0" />}
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-lg font-bold leading-tight truncate">{title}</h1>
          {subtitle && <div className="text-[11px] text-[var(--muted)] truncate">{subtitle}</div>}
        </div>
        {actions && <div className="flex items-center gap-1.5">{actions}</div>}
      </div>
    );
  }
  return (
    <div
      className={`relative px-8 py-6 border-b border-[var(--border)] bg-[var(--surface)] airline-stripe ${watermark ? "aviation-watermark" : ""}`}
      data-testid={testid || "page-header"}
    >
      {breadcrumb && <div className="text-[11px] tracking-overline text-[var(--muted)] mb-2">{breadcrumb}</div>}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-[var(--text)]">{title}</h1>
          {subtitle && <p className="text-sm text-[var(--muted)] mt-1">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap justify-end">{actions}</div>}
      </div>
    </div>
  );
}
