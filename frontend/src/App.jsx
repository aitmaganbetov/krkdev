import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
} from 'react-router-dom'
import { useAuth } from './context/AuthContext'

import { AuthProvider } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'

import Layout           from './components/Layout'
import LoginPage        from './pages/LoginPage'
import DashboardPage    from './pages/DashboardPage'
import RecordsPage      from './pages/RecordsPage'
import RecordDetailPage from './pages/RecordDetailPage'
import CreateRecordPage from './pages/CreateRecordPage'
import EditRecordPage   from './pages/EditRecordPage'
import UsersPage        from './pages/UsersPage'
import LdapUsersPage    from './pages/LdapUsersPage'
import SystemSettingsPage from './pages/SystemSettingsPage'
import AuditLogsPage    from './pages/AuditLogsPage'


function RoleGuard({ allowedRoles, children }) {
  const { isAuthenticated, authLoading, hasRole } = useAuth()
  if (authLoading) return null
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (!hasRole(allowedRoles)) return <Navigate to="/records" replace />
  return children
}


function HomeRedirect() {
  const { authLoading, role } = useAuth()
  if (authLoading) return null
  if (role === 'staff') return <Navigate to="/records" replace />
  return <Navigate to="/dashboard" replace />
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />

            {/* Protected routes */}
            <Route element={<Layout />}>
              <Route index element={<HomeRedirect />} />
              <Route path="/dashboard"         element={<RoleGuard allowedRoles={["admin", "inspector"]}><DashboardPage /></RoleGuard>} />
              <Route path="/records"           element={<RecordsPage />} />
              <Route path="/records/new"       element={<CreateRecordPage />} />
              <Route path="/records/:id"       element={<RecordDetailPage />} />
              <Route path="/records/:id/edit"  element={<RoleGuard allowedRoles={["admin", "inspector", "staff"]}><EditRecordPage /></RoleGuard>} />
              <Route path="/users"             element={<RoleGuard allowedRoles={["admin"]}><UsersPage /></RoleGuard>} />
              <Route path="/ldap-users"        element={<RoleGuard allowedRoles={["admin"]}><LdapUsersPage /></RoleGuard>} />
              <Route path="/settings"          element={<RoleGuard allowedRoles={["admin"]}><SystemSettingsPage /></RoleGuard>} />
              <Route path="/audit-logs"        element={<RoleGuard allowedRoles={["admin"]}><AuditLogsPage /></RoleGuard>} />
            </Route>

            {/* Fallback */}
            <Route path="*" element={<HomeRedirect />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  )
}
