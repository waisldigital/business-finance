import React from "react";

// Compact page header for AOP / admin screens (tight spacing, icon + title + inline actions)
export default function Header({ icon: Icon, title, subtitle, actions, testid }) {
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
