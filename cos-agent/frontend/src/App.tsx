import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout.tsx";
import { ProtectedRoute } from "./components/ProtectedRoute.tsx";
import { RequireAdmin } from "./components/RequireAdmin.tsx";
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
import { ConnectionsPage } from "./pages/settings/Connections.tsx";
import { EmailStylePage } from "./pages/settings/EmailStyle.tsx";
import { SettingsLearningsPage } from "./pages/settings/Learnings.tsx";
import { SettingsSchedulesPage } from "./pages/settings/Schedules.tsx";
import { SettingsPage } from "./pages/settings/SettingsPage.tsx";

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
        <Route element={<Layout />}>
          <Route path="chat" element={<ChatPage />} />
          <Route path="documents" element={<DocumentListPage />} />
          <Route path="documents/:id" element={<DocumentDetailPage />} />
          <Route path="settings" element={<SettingsPage />} />
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
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
