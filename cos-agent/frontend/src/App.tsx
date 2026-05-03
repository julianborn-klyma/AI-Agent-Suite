import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout.tsx";
import { OnboardingGuard } from "./components/OnboardingGuard.tsx";
import { ProtectedRoute } from "./components/ProtectedRoute.tsx";
import { RequireAdmin } from "./components/RequireAdmin.tsx";
import { RequireSuperAdmin } from "./components/RequireSuperAdmin.tsx";
import { isLoggedIn } from "./lib/auth.ts";
import { AdminLayout } from "./pages/admin/AdminLayout.tsx";
import { ConfigsPage } from "./pages/admin/ConfigsPage.tsx";
import { CostsPage } from "./pages/admin/CostsPage.tsx";
import { SchedulesPage } from "./pages/admin/SchedulesPage.tsx";
import { UserDetailPage } from "./pages/admin/UserDetailPage.tsx";
import { UsersPage } from "./pages/admin/UsersPage.tsx";
import { ChatPage } from "./pages/Chat.tsx";
import { DocumentDetailPage } from "./pages/documents/DocumentDetail.tsx";
import { DocumentListPage } from "./pages/documents/DocumentList.tsx";
import { LoginPage } from "./pages/Login.tsx";
import { OnboardingFlow } from "./pages/onboarding/OnboardingFlow.tsx";
import { ChangePasswordPage } from "./pages/settings/ChangePassword.tsx";
import { ConnectionsPage } from "./pages/settings/Connections.tsx";
import { EmailStylePage } from "./pages/settings/EmailStyle.tsx";
import { SettingsLearningsPage } from "./pages/settings/Learnings.tsx";
import { SettingsSchedulesPage } from "./pages/settings/Schedules.tsx";
import { SettingsPage } from "./pages/settings/SettingsPage.tsx";
import { TaskDetailPage } from "./pages/tasks/TaskDetail.tsx";
import { TaskListPage } from "./pages/tasks/TaskList.tsx";
import { WorkspacePage } from "./pages/workspace/WorkspacePage.tsx";
import { WorkspaceWikiPage } from "./pages/workspace/WorkspaceWikiPage.tsx";
import { WorkspaceWikiReadPage } from "./pages/workspace/WorkspaceWikiReadPage.tsx";
import { WorkspaceWorkTaskDetailPage } from "./pages/workspace/WorkspaceWorkTaskDetailPage.tsx";
import { AuditLogPage } from "./pages/superadmin/AuditLogPage.tsx";
import { SuperAdminLayout } from "./pages/superadmin/SuperAdminLayout.tsx";
import { SystemStatusPage } from "./pages/superadmin/SystemStatusPage.tsx";
import { TenantDetailPage } from "./pages/superadmin/TenantDetailPage.tsx";
import { TenantsPage } from "./pages/superadmin/TenantsPage.tsx";

function RootRedirect() {
  return <Navigate to={isLoggedIn() ? "/chat" : "/login"} replace />;
}

function LoginRoute() {
  if (isLoggedIn()) {
    return <Navigate to="/chat" replace />;
  }
  return <LoginPage />;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<LoginRoute />} />
      <Route element={<ProtectedRoute />}>
        <Route path="onboarding" element={<OnboardingFlow />} />
        <Route element={<OnboardingGuard />}>
          <Route element={<Layout />}>
          <Route path="chat" element={<ChatPage />} />
          <Route path="tasks" element={<TaskListPage />} />
          <Route path="tasks/:id" element={<TaskDetailPage />} />
          <Route path="workspace/work-tasks/:id" element={<WorkspaceWorkTaskDetailPage />} />
          <Route path="workspace" element={<WorkspacePage />} />
          <Route path="workspace/wiki/:slug" element={<WorkspaceWikiReadPage />} />
          <Route path="workspace/wiki" element={<WorkspaceWikiPage />} />
          <Route path="documents" element={<DocumentListPage />} />
          <Route path="documents/:id" element={<DocumentDetailPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="settings/password" element={<ChangePasswordPage />} />
          <Route path="settings/connections" element={<ConnectionsPage />} />
          <Route path="settings/schedules" element={<SettingsSchedulesPage />} />
          <Route path="settings/learnings" element={<SettingsLearningsPage />} />
          <Route path="settings/email-style" element={<EmailStylePage />} />
          <Route path="admin" element={<RequireAdmin />}>
            <Route element={<AdminLayout />}>
              <Route index element={<Navigate to="users" replace />} />
              <Route path="users" element={<UsersPage />} />
              <Route path="users/:id" element={<UserDetailPage />} />
              <Route path="configs" element={<ConfigsPage />} />
              <Route path="schedules" element={<SchedulesPage />} />
              <Route path="costs" element={<CostsPage />} />
            </Route>
          </Route>
          </Route>
        </Route>
        <Route element={<RequireSuperAdmin />}>
          <Route path="superadmin" element={<SuperAdminLayout />}>
            <Route index element={<Navigate to="tenants" replace />} />
            <Route path="tenants" element={<TenantsPage />} />
            <Route path="tenants/:id" element={<TenantDetailPage />} />
            <Route path="audit-log" element={<AuditLogPage />} />
            <Route path="status" element={<SystemStatusPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
