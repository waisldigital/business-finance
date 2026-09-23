import React from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth, homeFor } from "@/lib/auth";
import { CurrencyProvider } from "@/lib/currency";
import { ThemeProvider } from "@/lib/theme";
import { PermissionsProvider, usePermissions } from "@/lib/permissions";
import AppLayout from "@/components/AppLayout";
import LoginPage from "@/pages/LoginPage";
import DashboardPage from "@/pages/DashboardPage";
import ProjectsPage from "@/pages/ProjectsPage";
import ProjectDetailPage from "@/pages/ProjectDetailPage";
import MasterPage from "@/pages/MasterPage";
import CustomerProfilePage from "@/pages/CustomerProfilePage";
import UploadsPage from "@/pages/UploadsPage";
import ApprovalsPage from "@/pages/ApprovalsPage";
import AuditPage from "@/pages/AuditPage";
import SettingsPage from "@/pages/SettingsPage";
import PipelinePage from "@/pages/PipelinePage";
import ChangeRequestsPage from "@/pages/ChangeRequestsPage";
import WBSBudgetPage from "@/pages/WBSBudgetPage";
import EmployeesPage from "@/pages/EmployeesPage";
import PnLPage from "@/pages/aop/PnLPage";
import AopSectionPage from "@/pages/aop/AopSectionPage";
import MyChangesPage from "@/pages/aop/MyChangesPage";
import AopReportsPage from "@/pages/aop/AopReportsPage";
import AdminHome from "@/pages/admin/AdminHome";
import AdminDataPage from "@/pages/admin/AdminDataPage";
import AdminImportsPage from "@/pages/admin/AdminImportsPage";
import AdminAopApprovals from "@/pages/admin/AdminAopApprovals";
import AdminPlanSettings from "@/pages/admin/AdminPlanSettings";

const Loading = () => (
  <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]">
    <div className="text-[var(--muted)] tracking-overline text-xs">Loading…</div>
  </div>
);

// User workspace sections in landing order: (path, section)
const USER_HOMES = [
  ["/app/dashboard", "dashboard"], ["/app/aop/reports", "aop_pnl"], ["/app/aop/inputs", "aop_inputs"],
  ["/app/aop/revenue", "aop_revenue"], ["/app/aop/opex", "aop_opex"], ["/app/aop/overheads", "aop_overheads"],
  ["/app/aop/payroll", "aop_payroll"], ["/app/aop/capex", "aop_capex"], ["/app/aop/reports", "aop_reports"], ["/app/pipeline", "pipeline"],
  ["/app/projects", "projects"], ["/app/change-requests", "change_requests"], ["/app/customers", "customer_profile"],
  ["/app/wbs-budget", "wbs_budget"],
];

// /admin/* — system admin only. Anyone else is sent to their workspace.
function AdminRoute({ children }) {
  const { user } = useAuth();
  if (user === null) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin") return <Navigate to="/app" replace />;
  return <AppLayout portal="admin">{children}</AppLayout>;
}

// /app/* — workspace sections gated by the role's can_view. Admins use the admin portal instead.
function UserRoute({ section, sections, anyAop, children }) {
  const { user } = useAuth();
  const { permissions, loading } = usePermissions();
  if (user === null || loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === "admin") return <Navigate to="/admin" replace />;
  const allowed = anyAop
    ? Object.keys(permissions || {}).some((k) => k.startsWith("aop_") && permissions[k]?.can_view)
    : sections ? sections.some((s) => permissions?.[s]?.can_view) : !!permissions?.[section]?.can_view;
  if (!allowed) {
    const first = USER_HOMES.find(([, s]) => permissions?.[s]?.can_view);
    return <Navigate to={first ? first[0] : "/app"} replace />;
  }
  return <AppLayout portal="app">{children}</AppLayout>;
}

function UserHome() {
  const { user } = useAuth();
  const { permissions, loading } = usePermissions();
  if (user === null || loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === "admin") return <Navigate to="/admin" replace />;
  const first = USER_HOMES.find(([, s]) => permissions?.[s]?.can_view);
  if (first) return <Navigate to={first[0]} replace />;
  return (
    <AppLayout portal="app">
      <div className="p-8 text-sm text-[var(--muted)]">Your role has no sections assigned yet — ask an administrator to grant access.</div>
    </AppLayout>
  );
}

function RootRedirect() {
  const { user } = useAuth();
  if (user === null) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={homeFor(user)} replace />;
}

// Old (pre-split) URLs keep working, including links stored in notifications.
function Legacy({ to }) {
  const loc = useLocation();
  return <Navigate to={`${to}${loc.pathname}${loc.search}`} replace />;
}

const U = (section, el) => <UserRoute section={section}>{el}</UserRoute>;
const A = (el) => <AdminRoute>{el}</AdminRoute>;

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <AuthProvider>
          <ThemeProvider>
            <CurrencyProvider>
              <PermissionsProvider>
                <Routes>
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/" element={<RootRedirect />} />

                  {/* ---------- user workspace ---------- */}
                  <Route path="/app" element={<UserHome />} />
                  <Route path="/app/dashboard" element={U("dashboard", <DashboardPage />)} />
                  <Route path="/app/projects" element={U("projects", <ProjectsPage />)} />
                  <Route path="/app/projects/:id" element={U("projects", <ProjectDetailPage />)} />
                  <Route path="/app/pipeline" element={U("pipeline", <PipelinePage />)} />
                  <Route path="/app/change-requests" element={U("change_requests", <ChangeRequestsPage />)} />
                  <Route path="/app/wbs-budget" element={U("wbs_budget", <WBSBudgetPage />)} />
                  <Route path="/app/customers" element={U("customer_profile", <MasterPage entityKey="customers" />)} />
                  <Route path="/app/customers/:id" element={U("customer_profile", <CustomerProfilePage />)} />
                  <Route path="/app/aop/pnl" element={<Navigate to="/app/aop/reports" replace />} />
                  <Route path="/app/aop/inputs" element={U("aop_inputs", <AopSectionPage section="aop_inputs" />)} />
                  <Route path="/app/aop/revenue" element={U("aop_revenue", <AopSectionPage section="aop_revenue" />)} />
                  <Route path="/app/aop/opex" element={U("aop_opex", <AopSectionPage section="aop_opex" />)} />
                  <Route path="/app/aop/overheads" element={U("aop_overheads", <AopSectionPage section="aop_overheads" />)} />
                  <Route path="/app/aop/payroll" element={U("aop_payroll", <AopSectionPage section="aop_payroll" />)} />
                  <Route path="/app/aop/capex" element={U("aop_capex", <AopSectionPage section="aop_capex" />)} />
                  <Route path="/app/aop/reports" element={<UserRoute sections={["aop_pnl", "aop_reports"]}><AopReportsPage /></UserRoute>} />
                  <Route path="/app/aop/changes" element={<UserRoute anyAop><MyChangesPage /></UserRoute>} />

                  {/* ---------- admin portal ---------- */}
                  <Route path="/admin" element={A(<AdminHome />)} />
                  <Route path="/admin/aop/data" element={A(<AdminDataPage />)} />
                  <Route path="/admin/aop/imports" element={A(<AdminImportsPage />)} />
                  <Route path="/admin/aop/approvals" element={A(<AdminAopApprovals />)} />
                  <Route path="/admin/aop/pnl" element={A(<PnLPage admin />)} />
                  <Route path="/admin/aop/reports" element={A(<AopReportsPage admin />)} />
                  <Route path="/admin/aop/settings" element={A(<AdminPlanSettings />)} />
                  <Route path="/admin/approvals" element={A(<ApprovalsPage />)} />
                  <Route path="/admin/employees" element={A(<EmployeesPage />)} />
                  <Route path="/admin/suppliers" element={A(<MasterPage entityKey="suppliers" />)} />
                  <Route path="/admin/uploads" element={A(<UploadsPage />)} />
                  <Route path="/admin/audit" element={A(<AuditPage />)} />
                  <Route path="/admin/settings" element={A(<SettingsPage />)} />
                  <Route path="/admin/users" element={<Navigate to="/admin/employees" replace />} />
                  <Route path="/admin/approval-matrix" element={<Navigate to="/admin/settings?tab=approval" replace />} />
                  <Route path="/admin/roles" element={<Navigate to="/admin/settings?tab=roles" replace />} />

                  {/* ---------- legacy paths ---------- */}
                  {["/dashboard", "/projects/*", "/projects", "/pipeline", "/change-requests/*", "/change-requests", "/wbs-budget", "/customers/*", "/customers"].map((p) => (
                    <Route key={p} path={p} element={<Legacy to="/app" />} />
                  ))}
                  {["/suppliers", "/employees", "/uploads", "/approvals", "/audit"].map((p) => (
                    <Route key={p} path={p} element={<Legacy to="/admin" />} />
                  ))}
                  <Route path="*" element={<RootRedirect />} />
                </Routes>
              </PermissionsProvider>
            </CurrencyProvider>
          </ThemeProvider>
        </AuthProvider>
      </BrowserRouter>
    </div>
  );
}

export default App;
