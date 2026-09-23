import React from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/lib/auth";
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

function Protected({ children, adminOnly }) {
  const { user } = useAuth();
  if (user === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]">
        <div className="text-[var(--muted)] tracking-overline text-xs">Loading…</div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== "admin") return <Navigate to="/dashboard" replace />;
  return <AppLayout>{children}</AppLayout>;
}

// Gate a workspace section by `can_view` permission. Admin always passes.
function SectionProtected({ section, children }) {
  const { user } = useAuth();
  const { is_admin, permissions, loading } = usePermissions();
  if (user === null || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]">
        <div className="text-[var(--muted)] tracking-overline text-xs">Loading…</div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  const allowed = is_admin || user.role === "admin" || !!permissions?.[section]?.can_view;
  if (!allowed) return <Navigate to="/dashboard" replace />;
  return <AppLayout>{children}</AppLayout>;
}

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
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<SectionProtected section="dashboard"><DashboardPage /></SectionProtected>} />
                <Route path="/projects" element={<SectionProtected section="projects"><ProjectsPage /></SectionProtected>} />
                <Route path="/projects/:id" element={<SectionProtected section="projects"><ProjectDetailPage /></SectionProtected>} />
                <Route path="/pipeline" element={<SectionProtected section="pipeline"><PipelinePage /></SectionProtected>} />
                <Route path="/change-requests" element={<SectionProtected section="change_requests"><ChangeRequestsPage /></SectionProtected>} />
                <Route path="/wbs-budget" element={<SectionProtected section="wbs_budget"><WBSBudgetPage /></SectionProtected>} />
                <Route path="/customers" element={<SectionProtected section="customer_profile"><MasterPage entityKey="customers" /></SectionProtected>} />
                <Route path="/customers/:id" element={<SectionProtected section="customer_profile"><CustomerProfilePage /></SectionProtected>} />
                <Route path="/suppliers" element={<Protected adminOnly><MasterPage entityKey="suppliers" /></Protected>} />
                <Route path="/employees" element={<Protected adminOnly><EmployeesPage /></Protected>} />
                <Route path="/uploads" element={<Protected adminOnly><UploadsPage /></Protected>} />
                <Route path="/approvals" element={<Protected adminOnly><ApprovalsPage /></Protected>} />
                <Route path="/audit" element={<Protected adminOnly><AuditPage /></Protected>} />
                {/* Backwards-compatible redirects — User Management is gone; Roles & Approval Matrix moved under Settings */}
                <Route path="/admin/users" element={<Navigate to="/employees" replace />} />
                <Route path="/admin/approval-matrix" element={<Navigate to="/admin/settings?tab=approval" replace />} />
                <Route path="/admin/roles" element={<Navigate to="/admin/settings?tab=roles" replace />} />
                <Route path="/admin/settings" element={<Protected adminOnly><SettingsPage /></Protected>} />
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
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
