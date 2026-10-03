import React, { Suspense, lazy } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth, homeFor } from "@/lib/auth";
import { CurrencyProvider } from "@/lib/currency";
import { ThemeProvider } from "@/lib/theme";
import { PermissionsProvider, usePermissions } from "@/lib/permissions";
import AppLayout from "@/components/AppLayout";
import LoginPage from "@/pages/LoginPage";
import { SECTIONS, LANDING, AOP_SECTION_KEYS } from "@/config/sections";

// every screen is its own chunk, loaded on first visit (charts, grids and forms stay out of the first load)
const DashboardPage = lazy(() => import("@/pages/DashboardPage"));
const ProjectsPage = lazy(() => import("@/pages/ProjectsPage"));
const ProjectDetailPage = lazy(() => import("@/pages/ProjectDetailPage"));
const MasterPage = lazy(() => import("@/pages/MasterPage"));
const CustomerProfilePage = lazy(() => import("@/pages/CustomerProfilePage"));
const UploadsPage = lazy(() => import("@/pages/UploadsPage"));
const ApprovalsPage = lazy(() => import("@/pages/ApprovalsPage"));
const MyApprovalsPage = lazy(() => import("@/pages/MyApprovalsPage"));
const CRLinkPage = lazy(() => import("@/pages/CRLinkPage"));
const AuditPage = lazy(() => import("@/pages/AuditPage"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));
const PipelinePage = lazy(() => import("@/pages/PipelinePage"));
const ChangeRequestsPage = lazy(() => import("@/pages/ChangeRequestsPage"));
const WBSBudgetPage = lazy(() => import("@/pages/WBSBudgetPage"));
const EmployeesPage = lazy(() => import("@/pages/EmployeesPage"));
const PnLPage = lazy(() => import("@/pages/aop/PnLPage"));
const AopSectionPage = lazy(() => import("@/pages/aop/AopSectionPage"));
const MyChangesPage = lazy(() => import("@/pages/aop/MyChangesPage"));
const AopReportsPage = lazy(() => import("@/pages/aop/AopReportsPage"));
const ReviewPage = lazy(() => import("@/pages/aop/ReviewPage"));
const AdminHome = lazy(() => import("@/pages/admin/AdminHome"));
const AdminDataPage = lazy(() => import("@/pages/admin/AdminDataPage"));
const AdminImportsPage = lazy(() => import("@/pages/admin/AdminImportsPage"));
const AdminAopApprovals = lazy(() => import("@/pages/admin/AdminAopApprovals"));
const AdminPlanSettings = lazy(() => import("@/pages/admin/AdminPlanSettings"));

// the page each workspace section opens (sections sharing a path share its page and its route guard)
const SECTION_PAGES = {
  dashboard: <DashboardPage />, pipeline: <PipelinePage />, projects: <ProjectsPage />,
  change_requests: <ChangeRequestsPage />, customer_profile: <MasterPage entityKey="customers" />,
  wbs_budget: <WBSBudgetPage />, aop_pnl: <AopReportsPage />, aop_review: <ReviewPage />,
  ...Object.fromEntries(["aop_inputs", "aop_revenue", "aop_opex", "aop_overheads", "aop_payroll", "aop_capex"]
    .map((k) => [k, <AopSectionPage section={k} />])),
};
// Review is also open to roles that edit Opex (the API checks the edit right)
const sectionsAt = (path) => [...SECTIONS.filter((x) => x.path === path).map((x) => x.key),
                              ...(path === "/app/aop/review" ? ["aop_opex"] : [])];

const Loading = () => (
  <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]">
    <div className="text-[var(--muted)] tracking-overline text-xs">Loading…</div>
  </div>
);


// /admin/* — system admin only. Anyone else is sent to their workspace.
function AdminRoute({ children }) {
  const { user } = useAuth();
  if (user === null) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin") return <Navigate to="/app" replace />;
  return <AppLayout portal="admin">{children}</AppLayout>;
}

// /app/* — workspace sections gated by the role's can_view. Admins use the admin portal instead.
// any signed-in user, in their own portal's layout (notification links, the approvals inbox)
function SignedIn({ adminToo = false, children }) {
  const { user } = useAuth();
  const { loading } = usePermissions();
  if (user === null || loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === "admin" && !adminToo) return <Navigate to="/admin" replace />;
  return <AppLayout portal={user.role === "admin" ? "admin" : "app"}>{children}</AppLayout>;
}

function UserRoute({ section, sections, anyAop, children }) {
  const { user } = useAuth();
  const { permissions, loading } = usePermissions();
  if (user === null || loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === "admin") return <Navigate to="/admin" replace />;
  const allowed = anyAop
    ? AOP_SECTION_KEYS.some((k) => permissions?.[k]?.can_view)
    : sections ? sections.some((s) => permissions?.[s]?.can_view) : !!permissions?.[section]?.can_view;
  if (!allowed) {
    const first = LANDING.find(([, s]) => permissions?.[s]?.can_view);
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
  const first = LANDING.find(([, s]) => permissions?.[s]?.can_view);
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
                <Suspense fallback={<Loading />}>
                <Routes>
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/" element={<RootRedirect />} />

                  {/* ---------- user workspace ---------- */}
                  <Route path="/app" element={<UserHome />} />
                  {SECTIONS.filter((x) => SECTION_PAGES[x.key]).map((x) => (
                    <Route key={x.key} path={x.path} element={<UserRoute sections={sectionsAt(x.path)}>{SECTION_PAGES[x.key]}</UserRoute>} />
                  ))}
                  <Route path="/app/projects/:id" element={U("projects", <ProjectDetailPage />)} />
                  <Route path="/app/customers/:id" element={U("customer_profile", <CustomerProfilePage />)} />
                  <Route path="/app/change-requests/:id" element={<SignedIn adminToo><CRLinkPage /></SignedIn>} />
                  <Route path="/app/approvals" element={<SignedIn><MyApprovalsPage /></SignedIn>} />
                  <Route path="/app/aop/pnl" element={<Navigate to="/app/aop/reports" replace />} />
                  <Route path="/app/aop/changes" element={<UserRoute anyAop><MyChangesPage /></UserRoute>} />

                  {/* ---------- admin portal ---------- */}
                  <Route path="/admin" element={A(<AdminHome />)} />
                  <Route path="/admin/aop/data" element={A(<AdminDataPage />)} />
                  <Route path="/admin/aop/imports" element={A(<AdminImportsPage />)} />
                  <Route path="/admin/aop/approvals" element={A(<AdminAopApprovals />)} />
                  <Route path="/admin/aop/pnl" element={A(<PnLPage admin />)} />
                  <Route path="/admin/aop/reports" element={A(<AopReportsPage admin />)} />
                  <Route path="/admin/aop/settings" element={A(<AdminPlanSettings />)} />
                  <Route path="/admin/aop/review" element={A(<ReviewPage />)} />
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
                </Suspense>
              </PermissionsProvider>
            </CurrencyProvider>
          </ThemeProvider>
        </AuthProvider>
      </BrowserRouter>
    </div>
  );
}

export default App;
