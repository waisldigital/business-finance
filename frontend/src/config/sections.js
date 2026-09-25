// The workspace sections — one list for the sidebar, the landing page, route guards, the empty permission set
// and the roles editor. Keys match the backend (backend/sections.py).
//   label     — the roles editor / permission name       nav   — the sidebar entry (omit: no entry of its own)
//   path      — where the section lives                  landing — order tried when picking a user's home page
//   group     — sidebar group                            confidential — shown with a lock in the sidebar
import {
  ChartLineUp, FunnelSimple, FolderSimple, ArrowsClockwise, UsersThree, Stack, PresentationChart, SlidersHorizontal,
  TrendUp, Receipt, Buildings, LockKey, HardDrives,
} from "@phosphor-icons/react";

export const GROUPS = { workspace: "Workspace", aop: "Annual Operating Plan" };

export const SECTIONS = [
  { key: "dashboard", label: "Dashboard", path: "/app/dashboard", group: "workspace", landing: 1,
    nav: { label: "Dashboard", icon: ChartLineUp, testid: "sidebar-dashboard" } },
  { key: "pipeline", label: "Pipeline", path: "/app/pipeline", group: "workspace", landing: 10,
    nav: { label: "Pipeline", icon: FunnelSimple, testid: "sidebar-pipeline" } },
  { key: "projects", label: "Projects", path: "/app/projects", group: "workspace", landing: 11,
    nav: { label: "Projects", icon: FolderSimple, testid: "sidebar-projects" } },
  { key: "change_requests", label: "Change Requests", path: "/app/change-requests", group: "workspace", landing: 12,
    nav: { label: "Change Requests", icon: ArrowsClockwise, testid: "sidebar-change-requests" } },
  { key: "customer_profile", label: "Customer Profile", path: "/app/customers", group: "workspace", landing: 13,
    nav: { label: "Customer Profile", icon: UsersThree, testid: "sidebar-customers" } },
  { key: "wbs_budget", label: "WBS and Budget", path: "/app/wbs-budget", group: "workspace", landing: 14,
    nav: { label: "WBS and Budget", icon: Stack, testid: "sidebar-wbs-budget" } },
  // AOP — the reports page serves both the P&L and the reports sections
  { key: "aop_pnl", label: "AOP · P&L", path: "/app/aop/reports", group: "aop", landing: 2,
    nav: { label: "AOP reports", icon: PresentationChart, testid: "sidebar-aop-reports", sections: ["aop_pnl", "aop_reports"] } },
  { key: "aop_inputs", label: "AOP · Inputs", path: "/app/aop/inputs", group: "aop", landing: 3,
    nav: { label: "AOP Inputs", icon: SlidersHorizontal, testid: "sidebar-aop-inputs" } },
  { key: "aop_revenue", label: "AOP · Revenue", path: "/app/aop/revenue", group: "aop", landing: 4,
    nav: { label: "Revenue", icon: TrendUp, testid: "sidebar-aop-revenue" } },
  { key: "aop_opex", label: "AOP · Opex & POs", path: "/app/aop/opex", group: "aop", landing: 5,
    nav: { label: "Opex & POs", icon: Receipt, testid: "sidebar-aop-opex" } },
  { key: "aop_overheads", label: "AOP · Overheads", path: "/app/aop/overheads", group: "aop", landing: 6,
    nav: { label: "Overheads", icon: Buildings, testid: "sidebar-aop-overheads" } },
  { key: "aop_payroll", label: "AOP · Payroll (confidential)", path: "/app/aop/payroll", group: "aop", landing: 7, confidential: true,
    nav: { label: "Payroll", icon: LockKey, testid: "sidebar-aop-payroll" } },
  { key: "aop_capex", label: "AOP · Capex", path: "/app/aop/capex", group: "aop", landing: 8,
    nav: { label: "Capex", icon: HardDrives, testid: "sidebar-aop-capex" } },
  { key: "aop_reports", label: "AOP · Reports", path: "/app/aop/reports", group: "aop", landing: 9 },
];

export const SECTION_KEYS = SECTIONS.map((s) => s.key);
export const AOP_SECTION_KEYS = SECTIONS.filter((s) => s.group === "aop").map((s) => s.key);

/** Home pages in the order a user's first permitted one is chosen: [path, section]. */
export const LANDING = [...SECTIONS].sort((a, b) => a.landing - b.landing).map((s) => [s.path, s.key]);

export const PERMISSION_FLAGS = ["can_view", "can_edit", "can_upload", "can_delete"];

/** A permission set with nothing granted, in the shape the API returns. */
export const emptyPermissions = () => Object.fromEntries(SECTION_KEYS.map((k) => [k, Object.fromEntries(PERMISSION_FLAGS.map((f) => [f, false]))]));
