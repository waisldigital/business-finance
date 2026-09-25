import React, { useState, useEffect } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useCurrency } from "@/lib/currency";
import { useTheme } from "@/lib/theme";
import { usePermissions } from "@/lib/permissions";
import {
  Database, UploadSimple, GavelIcon, ClockCounterClockwise, SignOut, Truck, UserCircle, Palette,
  Gear, CaretLeft, CaretRight, Table, Gauge, FileArrowUp, CheckSquareOffset,
  PresentationChart, Stamp, ListMagnifyingGlass, GearSix, LockSimple,
} from "@phosphor-icons/react";
import { useApprovalsInbox } from "@/lib/approvals";
import { SECTIONS, GROUPS, AOP_SECTION_KEYS } from "@/config/sections";
import NotificationBell from "./NotificationBell";
import Popover from "@/components/common/Popover";
import BrandMark from "@/components/common/BrandMark";
import { useResizableColumns } from "@/lib/resizableColumns";

// Two portals, split by path: /app (users — gated by section permissions) and /admin (system admin only)
// Workspace sidebar: built from the section registry, plus the approvals inbox and the AOP change log
const navItem = (x) => ({ to: x.path, label: x.nav.label, icon: x.nav.icon, testid: x.nav.testid,
                          ...(x.nav.sections ? { sections: x.nav.sections } : { section: x.key }), confidential: x.confidential });
const USER_NAV = [
  { title: GROUPS.workspace, items: [
    { to: "/app/approvals", label: "My approvals", icon: Stamp, testid: "sidebar-my-approvals", approvals: true },
    ...SECTIONS.filter((x) => x.group === "workspace" && x.nav).map(navItem),
  ]},
  { title: GROUPS.aop, items: [
    ...SECTIONS.filter((x) => x.group === "aop" && x.nav).map(navItem),
    { to: "/app/aop/changes", label: "My changes", icon: ClockCounterClockwise, testid: "sidebar-aop-changes", anyAop: true },
  ]},
];

const ADMIN_NAV = [
  { title: "AOP administration", items: [
    { to: "/admin",               label: "Overview",      icon: Gauge,           testid: "sidebar-admin-home", end: true },
    { to: "/admin/aop/data",      label: "Data manager",  icon: Database,        testid: "sidebar-admin-data" },
    { to: "/admin/aop/imports",   label: "Imports",       icon: FileArrowUp,     testid: "sidebar-admin-imports" },
    { to: "/admin/aop/approvals", label: "AOP approvals", icon: CheckSquareOffset, testid: "sidebar-admin-aop-approvals" },
    { to: "/admin/aop/pnl",       label: "P&L check",     icon: Table,           testid: "sidebar-admin-pnl" },
    { to: "/admin/aop/reports",   label: "AOP reports",   icon: PresentationChart, testid: "sidebar-admin-reports" },
    { to: "/admin/aop/settings",  label: "Plan settings", icon: GearSix,         testid: "sidebar-admin-plan" },
  ]},
  { title: "Administration", items: [
    { to: "/admin/approvals", label: "Project approvals", icon: GavelIcon,             testid: "sidebar-approvals" },
    { to: "/admin/employees", label: "Users & employees", icon: UserCircle,            testid: "sidebar-employees" },
    { to: "/admin/suppliers", label: "Suppliers",         icon: Truck,                 testid: "sidebar-suppliers" },
    { to: "/admin/uploads",   label: "Excel upload",      icon: UploadSimple,          testid: "sidebar-uploads" },
    { to: "/admin/audit",     label: "Audit trail",       icon: ListMagnifyingGlass,   testid: "sidebar-audit" },
    { to: "/admin/settings",  label: "Roles & settings",  icon: Gear,                  testid: "sidebar-settings" },
  ]},
];


export default function AppLayout({ children, portal = "app" }) {
  const { user, logout } = useAuth();
  useResizableColumns(); // every table on every screen gets drag-to-resize column widths
  const { unit, setUnit } = useCurrency();
  const { theme, setTheme, themes } = useTheme();
  const { permissions } = usePermissions();
  const navigate = useNavigate();
  const [showThemes, setShowThemes] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("fs_sidebar_collapsed") === "1");

  useEffect(() => {
    localStorage.setItem("fs_sidebar_collapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  const asideWidth = collapsed ? "w-16" : "w-64";
  const inbox = useApprovalsInbox({ enabled: portal === "app" });
  const onApprovals = typeof window !== "undefined" && window.location.pathname.startsWith("/app/approvals");
  const canSee = (n) => {
    if (n.approvals) return inbox.count > 0 || onApprovals; // shown while something waits for this user
    if (n.anyAop) return AOP_SECTION_KEYS.some((sec) => permissions?.[sec]?.can_view);
    if (n.sections) return n.sections.some((sec) => permissions?.[sec]?.can_view);
    return !!permissions?.[n.section]?.can_view;
  };
  const groups = portal === "admin"
    ? ADMIN_NAV
    : USER_NAV.map((g) => ({ ...g, items: g.items.filter(canSee) })).filter((g) => g.items.length);
  return (
    <div className="flex min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <aside
        className={`${asideWidth} flex flex-col transition-all duration-200 sticky top-0 h-screen self-start ${collapsed ? "sidebar-collapsed" : ""}`}
        style={{ backgroundColor: "var(--sidebar)", color: "var(--sidebar-text)" }}
        data-testid="app-sidebar"
      >
        <button
          className="sidebar-collapse-btn"
          onClick={() => setCollapsed((v) => !v)}
          data-testid="sidebar-collapse-btn"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <CaretRight size={12} weight="bold" /> : <CaretLeft size={12} weight="bold" />}
        </button>

        <div className={`${collapsed ? "px-3 py-5" : "px-6 py-6"} border-b shrink-0`} style={{ borderColor: "rgba(255,255,255,0.1)" }}>
          <div className="flex items-center gap-2">
            <BrandMark size={32} />
            {!collapsed && (
              <div>
                <div className="font-display text-lg font-bold tracking-tight">WAISL FinSight</div>
                <div className="text-[10px] tracking-overline" style={{ color: "rgba(255,255,255,0.5)" }}>Business Finance &amp; FP&amp;A</div>
              </div>
            )}
          </div>
        </div>

        <nav className="flex-1 py-3 overflow-y-auto">
          {groups.map((g, gi) => (
            <React.Fragment key={g.title}>
              <div className={`nav-section-label px-4 py-1.5 ${gi ? "mt-3" : ""} text-[10px] tracking-overline`} style={{ color: "rgba(255,255,255,0.4)" }}>{g.title}</div>
              {g.items.map((n) => (
                <NavLink key={n.to} to={n.to} end={!!n.end} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`} data-testid={n.testid} title={collapsed ? n.label : undefined}>
                  <span className="relative inline-flex shrink-0">
                    <n.icon size={17} weight="duotone" />
                    {n.confidential && <LockSimple size={9} weight="fill" className="absolute -bottom-1 -right-1 text-[var(--gold)]" aria-label="Confidential" />}
                  </span>
                  <span className="nav-label">{n.label}</span>
                  {n.approvals && inbox.count > 0 && (
                    <span className="ml-auto text-[10px] font-bold px-1.5 min-w-[18px] text-center text-black" style={{ background: "var(--gold)" }}
                          data-testid="my-approvals-badge">{inbox.count}</span>
                  )}
                </NavLink>
              ))}
            </React.Fragment>
          ))}
        </nav>

        <div className={`${collapsed ? "px-2 py-3" : "px-4 py-4"} border-t shrink-0`} style={{ borderColor: "rgba(255,255,255,0.1)" }}>
          {collapsed ? (
            <button
              className="btn-ghost w-full flex items-center justify-center"
              style={{ color: "rgba(255,255,255,0.7)" }}
              onClick={async () => { await logout(); navigate("/login"); }}
              title={`Logout (${user?.name || ""})`}
              data-testid="logout-btn"
            >
              <SignOut size={18} weight="bold" />
            </button>
          ) : (
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate" data-testid="sidebar-user-name">{user?.name}</div>
                <div className="text-[11px] capitalize" style={{ color: "rgba(255,255,255,0.5)" }}>{user?.role}</div>
              </div>
              <button className="btn-ghost" style={{ color: "rgba(255,255,255,0.7)" }} onClick={async () => { await logout(); navigate("/login"); }} data-testid="logout-btn">
                <SignOut size={18} weight="bold" />
              </button>
            </div>
          )}
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="h-12 px-5 border-b border-[var(--border)] bg-[var(--surface)] flex items-center justify-between" data-testid="app-topbar">
          <div className="flex items-center gap-2 text-xs text-[var(--muted)] tracking-overline">
            <span className={`px-1.5 py-0.5 text-[10px] font-semibold border ${portal === "admin" ? "border-[var(--danger)] text-[var(--danger)]" : "border-[var(--gold)] text-[var(--gold)]"}`} data-testid="portal-badge">
              {portal === "admin" ? "ADMIN PORTAL" : "WORKSPACE"}
            </span>
            WAISL FinSight · Business Finance &amp; FP&amp;A
          </div>

          <div className="flex items-center gap-3">
            {/* In-app notifications */}
            <NotificationBell />

            {/* Theme picker */}
            <Popover open={showThemes} onOpenChange={setShowThemes} panelClassName="mt-2 w-56 bg-[var(--surface)] border border-[var(--border)] z-50 shadow-lg"
                     panelTestid="theme-menu" button={(open, toggle) => (
              <button
                className="btn-secondary text-xs flex items-center gap-1.5"
                onClick={toggle}
                data-testid="theme-toggle-btn"
                title="Change theme"
              >
                <Palette size={14} weight="duotone" />
                <span className="hidden md:inline capitalize">{themes.find((t) => t.key === theme)?.label}</span>
              </button>
            )}>
              <ThemeOptions theme={theme} themes={themes} onPick={(k) => { setTheme(k); setShowThemes(false); }} />
            </Popover>

            {/* Number format: ₹ Crore · ₹ Lakh · $ Million — drives every screen */}
            <div className="flex items-center bg-[var(--surface-2)] border border-[var(--border)] p-0.5" data-testid="currency-toggle">
              {[["cr", "₹ Crore", "currency-inr-btn"], ["lakh", "₹ Lakh", "currency-lakh-btn"], ["usd", "$ Million", "currency-usd-btn"]].map(([u, label, tid]) => (
                <button key={u}
                  className={`px-3 py-1 text-xs font-semibold transition-colors ${unit === u ? "bg-[var(--surface)] border border-[var(--gold)] text-[var(--gold)]" : "text-[var(--muted)]"}`}
                  onClick={() => setUnit(u)} data-testid={tid}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}

function ThemeOptions({ theme, themes, onPick }) {
  return themes.map((t) => (
    <button
      key={t.key}
      className={`w-full px-3 py-2 text-left text-sm flex items-center gap-3 hover:bg-[var(--row-hover)] ${theme === t.key ? "text-[var(--gold)] font-semibold" : ""}`}
      onClick={() => onPick(t.key)}
      data-testid={`theme-option-${t.key}`}
    >
      <div className="flex h-5 w-10">
        {t.swatch.map((c, i) => <div key={i} style={{ background: c, flex: 1 }} />)}
      </div>
      <div className="flex-1">
        <div>{t.label}</div>
        <div className="text-[10px] tracking-overline text-[var(--muted)]">{t.mode}</div>
      </div>
    </button>
  ));
}
