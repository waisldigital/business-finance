import React, { useState, useEffect } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useCurrency } from "@/lib/currency";
import { useTheme } from "@/lib/theme";
import { usePermissions } from "@/lib/permissions";
import {
  ChartLineUp, FolderSimple, Database, UploadSimple, GavelIcon,
  ShieldCheck, ClockCounterClockwise, SignOut, Wallet, UsersThree, Truck, UserCircle,
  Palette, Gear, FunnelSimple, ArrowsClockwise, CaretLeft, CaretRight, Stack, IdentificationBadge,
} from "@phosphor-icons/react";
import NotificationBell from "./NotificationBell";

// Workspace nav — each item is gated by per-section `can_view` permission
const NAV = [
  { to: "/dashboard",        label: "Dashboard",        icon: ChartLineUp,    testid: "sidebar-dashboard",        section: "dashboard" },
  { to: "/pipeline",         label: "Pipeline",         icon: FunnelSimple,   testid: "sidebar-pipeline",         section: "pipeline" },
  { to: "/projects",         label: "Projects",         icon: FolderSimple,   testid: "sidebar-projects",         section: "projects" },
  { to: "/change-requests",  label: "Change Requests",  icon: ArrowsClockwise,testid: "sidebar-change-requests",  section: "change_requests" },
  { to: "/customers",        label: "Customer Profile", icon: UsersThree,     testid: "sidebar-customers",        section: "customer_profile" },
  { to: "/wbs-budget",       label: "WBS and Budget",   icon: Stack,          testid: "sidebar-wbs-budget",       section: "wbs_budget" },
];

// Administration nav — visible to admin role ONLY
// (Roles and Approval Matrix moved under Settings; User Management merged into Employees)
const ADMIN_NAV = [
  { to: "/approvals",              label: "Approvals",        icon: GavelIcon,             testid: "sidebar-approvals" },
  { to: "/suppliers",              label: "Suppliers",        icon: Truck,                 testid: "sidebar-suppliers" },
  { to: "/employees",              label: "Employees",        icon: UserCircle,            testid: "sidebar-employees" },
  { to: "/uploads",                label: "Excel Upload",     icon: UploadSimple,          testid: "sidebar-uploads" },
  { to: "/audit",                  label: "Audit Trail",      icon: ClockCounterClockwise, testid: "sidebar-audit" },
  { to: "/admin/settings",         label: "Settings",         icon: Gear,                  testid: "sidebar-settings" },
];

export default function AppLayout({ children }) {
  const { user, logout } = useAuth();
  const { mode, setMode } = useCurrency();
  const { theme, setTheme, themes } = useTheme();
  const { is_admin, permissions } = usePermissions();
  const navigate = useNavigate();
  const [showThemes, setShowThemes] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("cp_sidebar_collapsed") === "1");

  useEffect(() => {
    localStorage.setItem("cp_sidebar_collapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  const asideWidth = collapsed ? "w-16" : "w-64";
  const isAdminUser = is_admin || user?.role === "admin";
  // Admin sees everything in workspace nav. Non-admin sees only sections where can_view is true.
  const navVisible = NAV.filter((n) => isAdminUser || !!permissions?.[n.section]?.can_view);
  const adminVisible = isAdminUser ? ADMIN_NAV : [];

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
                <div className="font-display text-lg font-bold tracking-tight">WAISL · COLM</div>
                <div className="text-[10px] tracking-overline" style={{ color: "rgba(255,255,255,0.5)" }}>Customer Order Lifecycle</div>
              </div>
            )}
          </div>
        </div>

        <nav className="flex-1 py-3 overflow-y-auto">
          <div className="nav-section-label px-4 py-2 text-[10px] tracking-overline" style={{ color: "rgba(255,255,255,0.4)" }}>Workspace</div>
          {navVisible.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`} data-testid={n.testid}>
              <n.icon size={18} weight="duotone" />
              <span className="nav-label">{n.label}</span>
            </NavLink>
          ))}
          {adminVisible.length > 0 && (
            <>
              <div className="nav-section-label px-4 py-2 mt-4 text-[10px] tracking-overline" style={{ color: "rgba(255,255,255,0.4)" }}>Administration</div>
              {adminVisible.map((n) => (
                <NavLink key={n.to} to={n.to} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`} data-testid={n.testid}>
                  <n.icon size={18} weight="duotone" />
                  <span className="nav-label">{n.label}</span>
                </NavLink>
              ))}
            </>
          )}
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
        <div className="h-16 px-8 border-b border-[var(--border)] bg-[var(--surface)] flex items-center justify-between" data-testid="app-topbar">
          <div className="text-xs text-[var(--muted)] tracking-overline">WAISL · Customer Order Lifecycle Management</div>

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

            {/* Currency toggle */}
            <div className="flex items-center bg-[var(--surface-2)] border border-[var(--border)] p-0.5" data-testid="currency-toggle">
              <button
                className={`px-3 py-1 text-xs font-semibold transition-colors ${mode === "INR" ? "bg-[var(--surface)] border border-[var(--gold)] text-[var(--gold)]" : "text-[var(--muted)]"}`}
                onClick={() => setMode("INR")}
                data-testid="currency-inr-btn"
              >
                ₹ Crore
              </button>
              <button
                className={`px-3 py-1 text-xs font-semibold transition-colors ${mode === "USD" ? "bg-[var(--surface)] border border-[var(--gold)] text-[var(--gold)]" : "text-[var(--muted)]"}`}
                onClick={() => setMode("USD")}
                data-testid="currency-usd-btn"
              >
                $ Million
              </button>
            </div>
          </div>
        </div>
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
