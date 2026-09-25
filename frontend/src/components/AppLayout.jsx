import React, { useState, useEffect } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useCurrency } from "@/lib/currency";
import { useTheme } from "@/lib/theme";
import { usePermissions } from "@/lib/permissions";
import {
  ChartLineUp, FolderSimple, Database, UploadSimple, GavelIcon,
  ClockCounterClockwise, SignOut, Wallet, UsersThree, Truck, UserCircle,
  Palette, Gear, FunnelSimple, ArrowsClockwise, CaretLeft, CaretRight, Stack, 
  Table, SlidersHorizontal, TrendUp, Receipt, Buildings, LockKey, HardDrives, Gauge, FileArrowUp, CheckSquareOffset,
  PresentationChart, Stamp,
} from "@phosphor-icons/react";
import { useApprovalsInbox } from "@/lib/approvals";
import NotificationBell from "./NotificationBell";
import { useResizableColumns } from "@/lib/resizableColumns";

// Two portals, split by path: /app (users — gated by section permissions) and /admin (system admin only)
const USER_NAV = [
  { title: "Workspace", items: [
    { to: "/app/approvals",       label: "My approvals",     icon: Stamp,           testid: "sidebar-my-approvals",    approvals: true },
    { to: "/app/dashboard",       label: "Dashboard",        icon: ChartLineUp,     testid: "sidebar-dashboard",       section: "dashboard" },
    { to: "/app/pipeline",        label: "Pipeline",         icon: FunnelSimple,    testid: "sidebar-pipeline",        section: "pipeline" },
    { to: "/app/projects",        label: "Projects",         icon: FolderSimple,    testid: "sidebar-projects",        section: "projects" },
    { to: "/app/change-requests", label: "Change Requests",  icon: ArrowsClockwise, testid: "sidebar-change-requests", section: "change_requests" },
    { to: "/app/customers",       label: "Customer Profile", icon: UsersThree,      testid: "sidebar-customers",       section: "customer_profile" },
    { to: "/app/wbs-budget",      label: "WBS and Budget",   icon: Stack,           testid: "sidebar-wbs-budget",      section: "wbs_budget" },
  ]},
  { title: "Annual Operating Plan", items: [
    { to: "/app/aop/reports",   label: "AOP reports", icon: PresentationChart, testid: "sidebar-aop-reports", sections: ["aop_pnl", "aop_reports"] },
    { to: "/app/aop/inputs",    label: "AOP Inputs", icon: SlidersHorizontal, testid: "sidebar-aop-inputs", section: "aop_inputs" },
    { to: "/app/aop/revenue",   label: "Revenue",    icon: TrendUp,        testid: "sidebar-aop-revenue",   section: "aop_revenue" },
    { to: "/app/aop/opex",      label: "Opex & POs", icon: Receipt,        testid: "sidebar-aop-opex",      section: "aop_opex" },
    { to: "/app/aop/overheads", label: "Overheads",  icon: Buildings,      testid: "sidebar-aop-overheads", section: "aop_overheads" },
    { to: "/app/aop/payroll",   label: "Payroll",    icon: LockKey,        testid: "sidebar-aop-payroll",   section: "aop_payroll" },
    { to: "/app/aop/capex",     label: "Capex",      icon: HardDrives,     testid: "sidebar-aop-capex",     section: "aop_capex" },
    { to: "/app/aop/changes",   label: "My changes", icon: ClockCounterClockwise, testid: "sidebar-aop-changes", anyAop: true },
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
    { to: "/admin/aop/settings",  label: "Plan settings", icon: SlidersHorizontal, testid: "sidebar-admin-plan" },
  ]},
  { title: "Administration", items: [
    { to: "/admin/approvals", label: "Project approvals", icon: GavelIcon,             testid: "sidebar-approvals" },
    { to: "/admin/employees", label: "Users & employees", icon: UserCircle,            testid: "sidebar-employees" },
    { to: "/admin/suppliers", label: "Suppliers",         icon: Truck,                 testid: "sidebar-suppliers" },
    { to: "/admin/uploads",   label: "Excel upload",      icon: UploadSimple,          testid: "sidebar-uploads" },
    { to: "/admin/audit",     label: "Audit trail",       icon: ClockCounterClockwise, testid: "sidebar-audit" },
    { to: "/admin/settings",  label: "Roles & settings",  icon: Gear,                  testid: "sidebar-settings" },
  ]},
];

const AOP_SECTIONS = ["aop_pnl", "aop_inputs", "aop_revenue", "aop_opex", "aop_overheads", "aop_payroll", "aop_capex", "aop_reports"];

export default function AppLayout({ children, portal = "app" }) {
  const { user, logout } = useAuth();
  useResizableColumns(); // every table on every screen gets drag-to-resize column widths
  const { unit, setUnit } = useCurrency();
  const { theme, setTheme, themes } = useTheme();
  const { permissions } = usePermissions();
  const navigate = useNavigate();
  const [showThemes, setShowThemes] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("cp_sidebar_collapsed") === "1");

  useEffect(() => {
    localStorage.setItem("cp_sidebar_collapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  const asideWidth = collapsed ? "w-16" : "w-64";
  const inbox = useApprovalsInbox({ enabled: portal === "app" });
  const onApprovals = typeof window !== "undefined" && window.location.pathname.startsWith("/app/approvals");
  const canSee = (n) => {
    if (n.approvals) return inbox.count > 0 || onApprovals; // shown while something waits for this user
    if (n.anyAop) return AOP_SECTIONS.some((sec) => permissions?.[sec]?.can_view);
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
            <div className="w-8 h-8 flex items-center justify-center shrink-0" style={{ background: "var(--gold)" }}>
              <Wallet weight="bold" size={18} className="text-black" />
            </div>
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
                  <n.icon size={17} weight="duotone" />
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
            <div className="relative">
              <button
                className="btn-secondary text-xs flex items-center gap-1.5"
                onClick={() => setShowThemes((v) => !v)}
                data-testid="theme-toggle-btn"
                title="Change theme"
              >
                <Palette size={14} weight="duotone" />
                <span className="hidden md:inline capitalize">{themes.find((t) => t.key === theme)?.label}</span>
              </button>
              {showThemes && (
                <div className="absolute right-0 mt-2 w-56 bg-[var(--surface)] border border-[var(--border)] z-50 shadow-lg" data-testid="theme-menu">
                  {themes.map((t) => (
                    <button
                      key={t.key}
                      className={`w-full px-3 py-2 text-left text-sm flex items-center gap-3 hover:bg-[var(--row-hover)] ${theme === t.key ? "text-[var(--gold)] font-semibold" : ""}`}
                      onClick={() => { setTheme(t.key); setShowThemes(false); }}
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
                  ))}
                </div>
              )}
            </div>

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
