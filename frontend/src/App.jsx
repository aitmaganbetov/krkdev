import { lazy, Suspense } from 'react'
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
} from 'react-router-dom'
import { useAuth } from './context/AuthContext'

import { AuthProvider } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import { UIProvider } from './components/ui/UIProvider'

import Layout           from './components/Layout'
import LoginPage        from './pages/LoginPage'
import { LoadingBlock } from './components/ui'

// Страницы грузятся отдельными чанками по первому заходу на маршрут;
// индикатор загрузки внутри оболочки — Suspense в Layout и CatalogsPage.
const DashboardPage       = lazy(() => import('./pages/DashboardPage'))
const MonitoringPage      = lazy(() => import('./pages/MonitoringPage'))
const RoomsSettingsPage   = lazy(() => import('./pages/RoomsSettingsPage'))
const RecordsPage         = lazy(() => import('./pages/RecordsPage'))
const RecordDetailPage    = lazy(() => import('./pages/RecordDetailPage'))
const CreateRecordPage    = lazy(() => import('./pages/CreateRecordPage'))
const EditRecordPage      = lazy(() => import('./pages/EditRecordPage'))
const UsersPage           = lazy(() => import('./pages/UsersPage'))
const LdapUsersPage       = lazy(() => import('./pages/LdapUsersPage'))
const SystemSettingsPage  = lazy(() => import('./pages/SystemSettingsPage'))
const AuditLogsPage       = lazy(() => import('./pages/AuditLogsPage'))
const RatingTemplatesPage = lazy(() => import('./pages/RatingTemplatesPage'))
const CatalogsPage        = lazy(() => import('./pages/CatalogsPage'))
const AcademicYearsPage   = lazy(() => import('./pages/AcademicYearsPage'))


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
        <UIProvider>
          <BrowserRouter>
            <Suspense fallback={<LoadingBlock className="min-h-screen" />}>
              <Routes>
                <Route path="/login" element={<LoginPage />} />

                {/* Protected routes */}
                <Route element={<Layout />}>
                  <Route index element={<HomeRedirect />} />
                  <Route path="/dashboard"         element={<RoleGuard allowedRoles={["admin", "inspector"]}><DashboardPage /></RoleGuard>} />
                  <Route path="/monitoring"        element={<RoleGuard allowedRoles={["admin", "inspector"]}><MonitoringPage /></RoleGuard>} />
                  <Route path="/rooms-settings"    element={<RoleGuard allowedRoles={["admin"]}><RoomsSettingsPage /></RoleGuard>} />
                  <Route path="/records"           element={<RecordsPage />} />
                  <Route path="/records/new"       element={<CreateRecordPage />} />
                  <Route path="/records/:id"       element={<RecordDetailPage />} />
                  <Route path="/records/:id/edit"  element={<RoleGuard allowedRoles={["admin", "inspector", "staff"]}><EditRecordPage /></RoleGuard>} />
                  <Route path="/catalogs"          element={<RoleGuard allowedRoles={["admin"]}><CatalogsPage /></RoleGuard>}>
                    <Route index element={<Navigate to="questions" replace />} />
                    <Route path="questions"        element={<RatingTemplatesPage />} />
                    <Route path="academic-years"   element={<AcademicYearsPage />} />
                  </Route>
                  <Route path="/rating-templates"  element={<Navigate to="/catalogs/questions" replace />} />
                  <Route path="/users"             element={<RoleGuard allowedRoles={["admin"]}><UsersPage /></RoleGuard>} />
                  <Route path="/ldap-users"        element={<RoleGuard allowedRoles={["admin"]}><LdapUsersPage /></RoleGuard>} />
                  <Route path="/settings"          element={<RoleGuard allowedRoles={["admin"]}><SystemSettingsPage /></RoleGuard>} />
                  <Route path="/audit-logs"        element={<RoleGuard allowedRoles={["admin"]}><AuditLogsPage /></RoleGuard>} />
                </Route>

                {/* Fallback */}
                <Route path="*" element={<HomeRedirect />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </UIProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}
