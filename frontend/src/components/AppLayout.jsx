import React, { useState, useEffect } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import api from "@/lib/api";
import { useCurrency } from "@/lib/currency";
import { useTheme } from "@/lib/theme";
import { usePermissions } from "@/lib/permissions";
import {
  Database, UploadSimple, GavelIcon, ClockCounterClockwise, SignOut, Truck, UserCircle, Palette,
  Gear, CaretDoubleLeft, CaretDoubleRight, Table, Gauge, FileArrowUp, CheckSquareOffset,
  PresentationChart, Stamp, ListMagnifyingGlass, GearSix, LockSimple, CaretDown, CaretRight,
} from "@phosphor-icons/react";
import { useApprovalsInbox } from "@/lib/approvals";
import { SECTIONS, GROUPS, AOP_SECTION_KEYS } from "@/config/sections";
import NotificationBell from "./NotificationBell";
import Popover from "@/components/common/Popover";
import BrandMark from "@/components/common/BrandMark";
import Modal from "@/components/common/Modal";
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
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("fs_sidebar_collapsed") === "1");

  // Sidebar sections (Projects and CR, Annual Operating Plan, …) fold open / shut independently
  const [closedGroups, setClosedGroups] = useState(() => {
    try { return JSON.parse(localStorage.getItem("fs_sidebar_closed_groups") || "[]"); } catch { return []; }
  });

  useEffect(() => {
    localStorage.setItem("fs_sidebar_collapsed", collapsed ? "1" : "0");
  }, [collapsed]);
  useEffect(() => {
    localStorage.setItem("fs_sidebar_closed_groups", JSON.stringify(closedGroups));
  }, [closedGroups]);
  const toggleGroup = (t) => setClosedGroups((c) => (c.includes(t) ? c.filter((x) => x !== t) : [...c, t]));

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
              <button type="button" onClick={() => toggleGroup(g.title)} aria-expanded={!closedGroups.includes(g.title)}
                      className={`nav-section-label w-full flex items-center gap-1.5 px-4 py-1.5 ${gi ? "mt-3" : ""} text-[10px] tracking-overline text-left hover:text-white/70`}
                      style={{ color: "rgba(255,255,255,0.4)" }} data-testid={`sidebar-group-${gi}`}>
                <span className="flex-1">{g.title}</span>
                {closedGroups.includes(g.title) ? <CaretRight size={10} weight="bold" /> : <CaretDown size={10} weight="bold" />}
              </button>
              {(collapsed || !closedGroups.includes(g.title)) && g.items.map((n) => (
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

        <div className="border-t shrink-0" style={{ borderColor: "rgba(255,255,255,0.1)" }}>
          {!collapsed && (
            <div className="px-4 pt-3 min-w-0">
              <div className="text-sm font-semibold truncate" data-testid="sidebar-user-name">{user?.name}</div>
              <div className="text-[11px] capitalize" style={{ color: "rgba(255,255,255,0.5)" }}>{user?.role}</div>
            </div>
          )}
          <button
            className={`w-full flex items-center gap-2 text-xs py-2.5 hover:bg-white/5 ${collapsed ? "justify-center" : "px-4"}`}
            style={{ color: "rgba(255,255,255,0.6)" }}
            onClick={() => setCollapsed((v) => !v)}
            data-testid="sidebar-collapse-btn"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <CaretDoubleRight size={14} weight="bold" /> : <><CaretDoubleLeft size={14} weight="bold" /><span>Collapse</span></>}
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="h-12 px-5 border-b border-[var(--border)] bg-[var(--surface)] flex items-center justify-between gap-3" data-testid="app-topbar">
          <div className="flex items-center gap-2 text-xs min-w-0">
            {portal === "admin" && (
              <span className="px-1.5 py-0.5 text-[10px] font-semibold border shrink-0 tracking-overline border-[var(--danger)] text-[var(--danger)]" data-testid="portal-badge">
                ADMIN PORTAL
              </span>
            )}
            <Breadcrumb groups={portal === "admin" ? ADMIN_NAV : USER_NAV} />
          </div>

          <div className="flex items-center gap-3">
            {/* Number format: ₹ Crore · ₹ Lakh · $ Million — drives every screen */}
            <div className="flex items-center bg-[var(--surface-2)] border border-[var(--border)] p-0.5" data-testid="currency-toggle">
              {[["cr", "₹ Cr", "currency-inr-btn"], ["lakh", "₹ Lakh", "currency-lakh-btn"], ["usd", "$ Mn", "currency-usd-btn"]].map(([u, label, tid]) => (
                <button key={u}
                  className={`px-3 py-1 text-xs font-semibold transition-colors ${unit === u ? "bg-[var(--surface)] border border-[var(--gold)] text-[var(--gold)]" : "text-[var(--muted)]"}`}
                  onClick={() => setUnit(u)} data-testid={tid}>
                  {label}
                </button>
              ))}
            </div>

            <NotificationBell />

            <UserMenu user={user} theme={theme} themes={themes} setTheme={setTheme} onLogout={() => setConfirmLogout(true)} />
          </div>
        </div>
        {confirmLogout && (
          <Modal title="Sign out?" subtitle="WAISL FINSIGHT" size="sm" onClose={() => setConfirmLogout(false)} testid="logout-confirm"
                 footer={<>
                   <button className="btn-secondary" onClick={() => setConfirmLogout(false)}>Cancel</button>
                   <button className="btn-primary" onClick={async () => { setConfirmLogout(false); await logout(); navigate("/login"); }} data-testid="logout-confirm-btn">
                     <SignOut size={14} weight="bold" className="inline -mt-0.5 mr-1" />Sign out
                   </button>
                 </>}>
            <div className="px-5 py-4 text-sm">You'll need to sign in again to continue. Unsaved edits in open grids are still saving in the background — wait for them to finish first.</div>
          </Modal>
        )}
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

// Top-bar breadcrumb: the sidebar group and entry for the current page (deeper pages add "Details")
function Breadcrumb({ groups }) {
  const { pathname } = useLocation();
  let best = null;
  for (const g of groups) {
    for (const n of g.items) {
      const hit = n.end ? pathname === n.to : pathname === n.to || pathname.startsWith(`${n.to}/`);
      if (hit && (!best || n.to.length > best.n.to.length)) best = { g, n };
    }
  }
  const parts = best ? [best.g.title, best.n.label, ...(pathname.length > best.n.to.length + 1 && !best.n.end ? ["Details"] : [])] : [];
  return (
    <nav className="flex items-center gap-1.5 min-w-0 text-[var(--muted)]" aria-label="Breadcrumb" data-testid="topbar-breadcrumb">
      {parts.map((p, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="opacity-50">›</span>}
          <span className={`truncate ${i === parts.length - 1 ? "text-[var(--text)] font-semibold" : ""}`}>{p}</span>
        </React.Fragment>
      ))}
    </nav>
  );
}

const initialsOf = (user) => (user?.name || user?.email || "?").split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

/** The user's photo, or their initials on the gold tile. */
export function Avatar({ user, size = 32 }) {
  return user?.avatar
    ? <img src={user.avatar} alt="" className="object-cover shrink-0" style={{ width: size, height: size }} data-testid="user-avatar-img" />
    : <span className="flex items-center justify-center shrink-0 font-bold text-[#0A1628]"
            style={{ width: size, height: size, background: "var(--gold)", fontSize: Math.round(size * 0.36) }}>{initialsOf(user)}</span>;
}

// Avatar menu: who is signed in, their profile, the theme picker and sign out
function UserMenu({ user, theme, themes, setTheme, onLogout }) {
  const [showThemes, setShowThemes] = useState(false);
  const [profile, setProfile] = useState(false);
  return (
    <>
    <Popover panelClassName="mt-2 w-64 bg-[var(--surface)] border border-[var(--border)] z-50 shadow-lg" panelTestid="user-menu"
             button={(open, toggle) => (
               <button className={`p-0.5 border ${open ? "border-[var(--gold)]" : "border-[var(--border)]"} bg-[var(--surface)]`}
                       onClick={toggle} data-testid="user-menu-btn" title={user?.name} aria-label={`${user?.name || "User"} menu`}>
                 <Avatar user={user} size={30} />
               </button>
             )}>
      {(close) => (
        <>
          <div className="px-3 py-2.5 border-b border-[var(--border)]">
            <div className="text-sm font-semibold truncate">{user?.name}</div>
            <div className="text-[11px] text-[var(--muted)] truncate">{user?.email}</div>
            <div className="text-[10px] tracking-overline text-[var(--gold)] mt-0.5">{user?.role === "admin" ? "SYSTEM ADMIN" : "WORKSPACE USER"}</div>
          </div>
          <button className="w-full px-3 py-2 text-left text-xs flex items-center gap-2 hover:bg-[var(--row-hover)]"
                  onClick={() => { close(); setProfile(true); }} data-testid="profile-btn">
            <UserCircle size={14} weight="duotone" /><span className="flex-1">My profile</span>
          </button>
          <button className="w-full px-3 py-2 text-left text-xs flex items-center gap-2 hover:bg-[var(--row-hover)]"
                  onClick={() => setShowThemes((v) => !v)} data-testid="theme-toggle-btn">
            <Palette size={14} weight="duotone" /><span className="flex-1">Theme</span>
            <span className="text-[var(--muted)] capitalize">{themes.find((t) => t.key === theme)?.label}</span>
          </button>
          {showThemes && (
            <div className="border-y border-[var(--border)]" data-testid="theme-menu">
              <ThemeOptions theme={theme} themes={themes} onPick={(k) => { setTheme(k); setShowThemes(false); }} />
            </div>
          )}
          <button className="w-full px-3 py-2 text-left text-xs flex items-center gap-2 hover:bg-[var(--row-hover)] text-[var(--danger)]"
                  onClick={() => { close(); onLogout(); }} data-testid="logout-btn">
            <SignOut size={14} weight="bold" /> Sign out
          </button>
        </>
      )}
    </Popover>
    {profile && <ProfileModal user={user} onClose={() => setProfile(false)} />}
    </>
  );
}

// Small profile window: who you are, and your photo (resized in the browser before upload)
function ProfileModal({ user, onClose }) {
  const { refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const input = React.useRef(null);
  const shrink = (file) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const n = 160; const c = document.createElement("canvas"); c.width = n; c.height = n;
      const side = Math.min(img.width, img.height);
      c.getContext("2d").drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, n, n);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => reject(new Error("That file isn't an image the browser can read"));
    img.src = URL.createObjectURL(file);
  });
  const upload = async (file) => {
    if (!file) return;
    setBusy(true); setErr("");
    try { await api.put("/me/avatar", { image: await shrink(file) }); await refresh(); }
    catch (e) { setErr(e.response?.data?.detail || e.message); } finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true); setErr("");
    try { await api.delete("/me/avatar"); await refresh(); } catch (e) { setErr(e.response?.data?.detail || e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title="My profile" size="sm" onClose={onClose} testid="profile-modal">
      <div className="px-5 py-4 flex items-center gap-4">
        <Avatar user={user} size={72} />
        <div className="min-w-0 text-sm">
          <div className="font-semibold truncate">{user?.name}</div>
          <div className="text-xs text-[var(--muted)] truncate">{user?.email}</div>
          <div className="text-[10px] tracking-overline text-[var(--gold)] mt-0.5">{user?.role === "admin" ? "SYSTEM ADMIN" : "WORKSPACE USER"}</div>
        </div>
      </div>
      <div className="px-5 pb-4 flex items-center gap-2 flex-wrap">
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
               onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} data-testid="profile-photo-input" />
        <button className="btn-primary text-xs" disabled={busy} onClick={() => input.current?.click()} data-testid="profile-photo-btn">
          {busy ? "Saving…" : user?.avatar ? "Change photo" : "Upload photo"}
        </button>
        {user?.avatar && <button className="btn-secondary text-xs" disabled={busy} onClick={remove} data-testid="profile-photo-remove">Remove photo</button>}
        {err && <span className="text-xs text-[var(--danger)] w-full">{String(err)}</span>}
      </div>
    </Modal>
  );
}
