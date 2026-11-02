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
const SchedulePage        = lazy(() => import('./pages/SchedulePage'))
const CommitteePage       = lazy(() => import('./pages/CommitteePage'))
const CommitteePrintPage  = lazy(() => import('./pages/CommitteePrintPage'))
const CommitteeAssignmentsPage = lazy(() => import('./pages/CommitteeAssignmentsPage'))
const SigningPage         = lazy(() => import('./pages/SigningPage'))
const VerifyDocumentPage  = lazy(() => import('./pages/VerifyDocumentPage'))
const RoomScanPage        = lazy(() => import('./pages/RoomScanPage'))
const MyAttendancePage    = lazy(() => import('./pages/MyAttendancePage'))
const MySchedulePage      = lazy(() => import('./pages/MySchedulePage'))
const RoomQrPrintPage     = lazy(() => import('./pages/RoomQrPrintPage'))
const RoomsSettingsPage   = lazy(() => import('./pages/RoomsSettingsPage'))
const RecordsPage         = lazy(() => import('./pages/RecordsPage'))
const RecordDetailPage    = lazy(() => import('./pages/RecordDetailPage'))
const CreateRecordPage    = lazy(() => import('./pages/CreateRecordPage'))
const EditRecordPage      = lazy(() => import('./pages/EditRecordPage'))
const UsersPage           = lazy(() => import('./pages/UsersPage'))
const UsersSectionPage    = lazy(() => import('./pages/UsersSectionPage'))
const PersonCardPage      = lazy(() => import('./pages/PersonCardPage'))
const LdapUsersPage       = lazy(() => import('./pages/LdapUsersPage'))
const SystemSettingsPage  = lazy(() => import('./pages/SystemSettingsPage'))
const AuditLogsPage       = lazy(() => import('./pages/AuditLogsPage'))
const RatingTemplatesPage = lazy(() => import('./pages/RatingTemplatesPage'))
const CatalogsPage        = lazy(() => import('./pages/CatalogsPage'))
const AcademicYearsPage   = lazy(() => import('./pages/AcademicYearsPage'))
const PeerVisitsPage      = lazy(() => import('./pages/PeerVisitsPage'))
const PeerVisitDetailPage = lazy(() => import('./pages/PeerVisitDetailPage'))
const PeerVisitFormPage   = lazy(() => import('./pages/PeerVisitFormPage'))
const PlatonusCatalogPage = lazy(() => import('./pages/PlatonusCatalogPage'))
const MyViolationsPage    = lazy(() => import('./pages/MyViolationsPage'))
const PeerVisitSchedulePage = lazy(() => import('./pages/PeerVisitSchedulePage'))
const PeerVisitSchedulePrintPage = lazy(() => import('./pages/PeerVisitSchedulePrintPage'))


function RoleGuard({ allowedRoles, children }) {
  const { isAuthenticated, authLoading, hasRole } = useAuth()
  if (authLoading) return null
  if (!isAuthenticated) return <Navigate to="/login" replace />
  // Нет прав — на стартовую страницу роли (у деканата нет доступа к /records)
  if (!hasRole(allowedRoles)) return <Navigate to="/" replace />
  return children
}


function HomeRedirect() {
  const { authLoading, role } = useAuth()
  if (authLoading) return null
  if (role === 'staff' || role === 'committee' || role === 'inspector') return <Navigate to="/records" replace />
  if (role === 'peer_inspector') return <Navigate to="/peer-visits" replace />
  if (role === 'user' || role === 'teacher') return <Navigate to="/peer-visits" replace />
  if (role === 'student') return <Navigate to="/my-schedule" replace />
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
                {/* Проверка подлинности документа по QR-коду — без входа в систему */}
                <Route path="/verify/:token" element={<VerifyDocumentPage />} />

                {/* Protected routes */}
                <Route element={<Layout />}>
                  <Route index element={<HomeRedirect />} />
                  <Route path="/dashboard"         element={<DashboardPage />} />
                  <Route path="/schedule"          element={<RoleGuard allowedRoles={["admin", "inspector", "peer_inspector", "staff", "committee", "dean"]}><SchedulePage /></RoleGuard>} />
                  <Route path="/monitoring"        element={<RoleGuard allowedRoles={["admin", "dean", "committee"]}><MonitoringPage /></RoleGuard>} />
                  <Route path="/rooms-settings"    element={<RoleGuard allowedRoles={["admin"]}><RoomsSettingsPage /></RoleGuard>} />
                  <Route path="/records"           element={<RoleGuard allowedRoles={["admin", "inspector", "staff", "committee", "dean"]}><RecordsPage /></RoleGuard>} />
                  <Route path="/records/new"       element={<RoleGuard allowedRoles={["admin", "inspector", "staff", "committee", "dean"]}><CreateRecordPage /></RoleGuard>} />
                  <Route path="/records/:id"       element={<RoleGuard allowedRoles={["admin", "inspector", "staff", "committee", "dean"]}><RecordDetailPage /></RoleGuard>} />
                  <Route path="/records/:id/edit"  element={<RoleGuard allowedRoles={["admin", "inspector", "staff", "committee", "dean"]}><EditRecordPage /></RoleGuard>} />
                  <Route path="/peer-visits"           element={<PeerVisitsPage />} />
                  <Route path="/peer-visits/schedule"  element={<RoleGuard allowedRoles={["admin", "peer_inspector", "dean"]}><PeerVisitSchedulePage /></RoleGuard>} />
                  <Route path="/peer-visits/schedule/print" element={<RoleGuard allowedRoles={["admin", "peer_inspector", "dean"]}><PeerVisitSchedulePrintPage /></RoleGuard>} />
                  <Route path="/peer-visits/new"       element={<RoleGuard allowedRoles={["admin", "peer_inspector", "staff", "committee", "user", "teacher", "dean"]}><PeerVisitFormPage /></RoleGuard>} />
                  <Route path="/peer-visits/:id"       element={<PeerVisitDetailPage />} />
                  <Route path="/peer-visits/:id/edit"  element={<PeerVisitFormPage />} />
                  <Route path="/committee"            element={<RoleGuard allowedRoles={["admin", "inspector", "dean", "committee"]}><CommitteePage /></RoleGuard>} />
                  <Route path="/committee/print/:id"  element={<RoleGuard allowedRoles={["admin"]}><CommitteePrintPage /></RoleGuard>} />
                  <Route path="/committee/:id/assignments" element={<RoleGuard allowedRoles={["admin", "inspector"]}><CommitteeAssignmentsPage /></RoleGuard>} />
                  {/* Документы на подпись ЭЦП: подписант определяется сервером по логину, роль не важна */}
                  <Route path="/signing"               element={<SigningPage />} />
                  <Route path="/signing/:id"           element={<SigningPage />} />
                  <Route path="/signing/schedule/:id"  element={<SigningPage kind="schedule" />} />
                  <Route path="/my-violations"         element={<MyViolationsPage />} />
                  {/* QR-код на двери аудитории: открыт всем вошедшим, содержимое зависит от роли */}
                  <Route path="/room/:code"            element={<RoomScanPage />} />
                  <Route path="/my-schedule"           element={<RoleGuard allowedRoles={["student"]}><MySchedulePage /></RoleGuard>} />
                  <Route path="/my-attendance"         element={<RoleGuard allowedRoles={["student"]}><MyAttendancePage /></RoleGuard>} />
                  <Route path="/rooms-settings/qr"     element={<RoleGuard allowedRoles={["admin"]}><RoomQrPrintPage /></RoleGuard>} />
                  <Route path="/catalogs"          element={<RoleGuard allowedRoles={["admin", "inspector"]}><CatalogsPage /></RoleGuard>}>
                    <Route index element={<Navigate to="questions" replace />} />
                    <Route path="questions"        element={<RatingTemplatesPage />} />
                    <Route path="academic-years"   element={<AcademicYearsPage />} />
                    <Route path="faculties"        element={<RoleGuard allowedRoles={["admin"]}><PlatonusCatalogPage kind="faculties" /></RoleGuard>} />
                    <Route path="cafedras"         element={<RoleGuard allowedRoles={["admin"]}><PlatonusCatalogPage kind="cafedras" /></RoleGuard>} />
                    <Route path="specializations"  element={<RoleGuard allowedRoles={["admin"]}><PlatonusCatalogPage kind="specializations" /></RoleGuard>} />
                    <Route path="groups"           element={<RoleGuard allowedRoles={["admin"]}><PlatonusCatalogPage kind="groups" /></RoleGuard>} />
                  </Route>
                  <Route path="/rating-templates"  element={<Navigate to="/catalogs/questions" replace />} />
                  <Route path="/users"             element={<RoleGuard allowedRoles={["admin"]}><UsersSectionPage /></RoleGuard>}>
                    <Route index element={<Navigate to="accounts" replace />} />
                    <Route path="accounts"         element={<UsersPage />} />
                    <Route path="tutors"           element={<PlatonusCatalogPage kind="tutors" />} />
                    <Route path="tutors/:id"       element={<PersonCardPage kind="tutors" />} />
                    <Route path="students"         element={<PlatonusCatalogPage kind="students" />} />
                    <Route path="students/:id"     element={<PersonCardPage kind="students" />} />
                  </Route>
                  <Route path="/ldap-users"        element={<RoleGuard allowedRoles={["superadmin"]}><LdapUsersPage /></RoleGuard>} />
                  <Route path="/settings"          element={<RoleGuard allowedRoles={["superadmin"]}><SystemSettingsPage /></RoleGuard>} />
                  <Route path="/audit-logs"        element={<RoleGuard allowedRoles={["superadmin"]}><AuditLogsPage /></RoleGuard>} />
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
