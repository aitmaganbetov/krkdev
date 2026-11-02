import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
})

// Сессия — httpOnly-cookie того же origin (nginx / Vite proxy), браузер отправляет её сам.
// Redirect to login on 401
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const requestUrl = String(error.config?.url || '')
      const isAuthProbe = requestUrl.includes('/auth/me') || requestUrl.includes('/auth/logout')
      const isLoginPage = typeof window !== 'undefined' && window.location.pathname === '/login'

      if (!isAuthProbe && !isLoginPage && typeof window !== 'undefined') {
        fetch('/api/auth/logout', {
          method: 'POST',
          credentials: 'include',
          keepalive: true,
          headers: { 'X-Logout-Reason': 'frontend_401' },
        }).catch(() => {})
      }

      try {
        localStorage.removeItem('username')
        localStorage.removeItem('role')
      } catch { /* private mode */ }

      // Avoid infinite reload loop on /login caused by /auth/me returning 401.
      if (!isAuthProbe && !isLoginPage && typeof window !== 'undefined') {
        window.location.replace('/login')
      }
    }
    return Promise.reject(error)
  }
)

// Текст ошибки API для показа пользователю. FastAPI отдаёт detail строкой
// или (422) массивом объектов { msg, loc, ... } — объект нельзя рендерить в React.
export function apiErrorText(err, fallback) {
  const detail = err?.response?.data?.detail
  if (typeof detail === 'string' && detail) return detail
  if (Array.isArray(detail)) {
    return detail
      .map((item) => String((item && item.msg) || '').replace(/^Value error, /, ''))
      .filter(Boolean)
      .join('; ') || fallback
  }
  return fallback
}

// Auth
// Быстрый вход под ролями — только dev: на проде маршрута нет (404), и панель на странице входа не показывается
export const getDevLoginOptions = () =>
  api.get('/auth/dev-login').then((r) => r.data)

export const devLogin = (role, facultyId) =>
  api.post('/auth/dev-login', { role, faculty_id: facultyId ?? null }).then((r) => r.data)

export const login = (username, password) =>
  api.post('/auth/login', { username, password }).then((r) => r.data)

// Вход по ЭЦП: nonce подписывается в NCALayer (services/ncalayer.js), CMS проверяет бэкенд
export const getEcpStatus = () =>
  api.get('/auth/ecp').then((r) => r.data)

export const getEcpChallenge = () =>
  api.post('/auth/ecp/challenge').then((r) => r.data)

export const ecpLogin = (cms) =>
  api.post('/auth/ecp/login', { cms }).then((r) => r.data)

// Таймаут: зависший запрос не должен блокировать выход из интерфейса
export const logout = () =>
  api.post('/auth/logout', null, { timeout: 5000 }).then((r) => r.data)

export const getMe = () =>
  api.get('/auth/me').then((r) => r.data)

// Records
export const getRecords = (params) =>
  api.get('/records', { params }).then((r) => r.data)

export const getRecordFilterOptions = (params) =>
  api.get('/records/filter-options', { params }).then((r) => r.data)

export const getDashboardFacultyComparison = (params) =>
  api.get('/records/dashboard/faculty-comparison', { params }).then((r) => r.data)

// Справочники, которые загружают сразу несколько страниц, — общий запрос на 2 минуты вместо повторного
// при каждом переходе. Сбрасываются при изменениях в этой вкладке (синхронизация, учебные годы, шаблоны).
// Ответ не изменяется страницами: один объект можно отдавать всем.
function sharedRequest(ttlMs, fetcher) {
  let entry = null
  const get = () => {
    if (!entry || Date.now() - entry.at > ttlMs) {
      const promise = fetcher()
      entry = { at: Date.now(), promise }
      // Ошибку не кешируем: следующий вызов повторит запрос
      promise.catch(() => { if (entry?.promise === promise) entry = null })
    }
    return entry.promise
  }
  get.invalidate = () => { entry = null }
  return get
}

export const getBasicInfoCatalog = sharedRequest(120_000, () => api.get('/catalogs/basic-info').then((r) => r.data))

// «Пользователи → Преподаватели / Студенты»: люди из Platonus с учётной записью КРК (только чтение)
export const getCatalogTutors = (params) =>
  api.get('/catalogs/tutors', { params }).then((r) => r.data)

export const getCatalogStudents = (params) =>
  api.get('/catalogs/students', { params }).then((r) => r.data)

// Карточки: данные Platonus и правки КРК; fields — { ключ: значение | null (вернуть значение Platonus) }
export const getTutorCard = (id) =>
  api.get(`/catalogs/tutors/${id}`).then((r) => r.data)

export const updateTutorCard = (id, fields) =>
  api.patch(`/catalogs/tutors/${id}`, { fields }).then((r) => r.data)

export const getStudentCard = (id) =>
  api.get(`/catalogs/students/${id}`).then((r) => r.data)

export const updateStudentCard = (id, fields) =>
  api.patch(`/catalogs/students/${id}`, { fields }).then((r) => r.data)

// Справочники Platonus для вкладок «Справочника» (только чтение)
export const getCatalogFaculties = (params) =>
  api.get('/catalogs/faculties', { params }).then((r) => r.data)

export const getCatalogCafedras = (params) =>
  api.get('/catalogs/cafedras', { params }).then((r) => r.data)

export const getCatalogSpecializations = (params) =>
  api.get('/catalogs/specializations', { params }).then((r) => r.data)

export const getCatalogGroups = (params) =>
  api.get('/catalogs/groups', { params }).then((r) => r.data)

export const getPlatonusStatus = () =>
  api.get('/catalogs/platonus-status').then((r) => r.data)

export const syncPlatonusCatalogs = () =>
  api.post('/catalogs/platonus-sync').then((r) => {
    getBasicInfoCatalog.invalidate()
    return r.data
  })

export const getLdapSettings = () =>
  api.get('/settings/ldap').then((r) => r.data)

export const saveLdapSettings = (data) =>
  api.put('/settings/ldap', data).then((r) => r.data)

export const testLdapSettings = (data) =>
  api.post('/settings/ldap/test', data).then((r) => r.data)

export const getCameraSettings = () =>
  api.get('/settings/cameras').then((r) => r.data)

export const saveCameraSettings = (data) =>
  api.put('/settings/cameras', data).then((r) => r.data)

export const getAiSettings = () =>
  api.get('/ai/settings').then((r) => r.data)

export const saveAiSettings = (data) =>
  api.patch('/ai/settings', data).then((r) => r.data)

export const testAiProvider = (provider) =>
  api.post(`/ai/test/${provider}`).then((r) => r.data)

export const improveViolationText = (text) =>
  api.post('/ai/improve', { text }).then((r) => r.data)

export const getRooms = () =>
  api.get('/rooms').then((r) => r.data)

export const createRoom = (data) =>
  api.post('/rooms', data).then((r) => r.data)

export const updateRoom = (id, data) =>
  api.patch(`/rooms/${id}`, data).then((r) => r.data)

export const deleteRoom = (id) =>
  api.delete(`/rooms/${id}`)

export const getScheduleLessons = (date) =>
  api.get('/schedule/lessons', { params: { date } }).then((r) => r.data)

export const syncScheduleFromPlatonus = () =>
  api.post('/schedule/platonus-sync').then((r) => r.data)

export const syncRoomsFromPlatonus = () =>
  api.post('/rooms/platonus-sync').then((r) => r.data)

// QR-код аудитории: информация для сотрудника, отметка посещаемости для студента
export const getRoomScan = (code) =>
  api.get(`/scan/${encodeURIComponent(code)}`).then((r) => r.data)

export const markRoomAttendance = (code) =>
  api.post(`/scan/${encodeURIComponent(code)}/attendance`).then((r) => r.data)

export const getLessonAttendance = (lessonId, date) =>
  api.get(`/scan/attendance/${lessonId}`, { params: { date } }).then((r) => r.data)

export const removeAttendanceMark = (attendanceId) =>
  api.delete(`/scan/attendance/mark/${attendanceId}`).then((r) => r.data)

export const getMySchedule = (date) =>
  api.get('/scan/my/schedule', { params: { date } }).then((r) => r.data)

export const getMyAttendance = () =>
  api.get('/scan/my/attendance').then((r) => r.data)

// Оснащение и инвентаризация кабинета
export const getRoomInventory = (roomId) =>
  api.get(`/rooms/${roomId}/inventory`).then((r) => r.data)

export const addRoomInventoryItem = (roomId, data) =>
  api.post(`/rooms/${roomId}/inventory`, data).then((r) => r.data)

export const updateRoomInventoryItem = (itemId, data) =>
  api.patch(`/rooms/inventory/${itemId}`, data).then((r) => r.data)

export const deleteRoomInventoryItem = (itemId) =>
  api.delete(`/rooms/inventory/${itemId}`)

export const testRoomCamera = (id) =>
  api.post(`/rooms/${id}/camera/test`).then((r) => r.data)

export const getViolations = () =>
  api.get('/violations').then((r) => r.data)

export const getMyViolations = () =>
  api.get('/violations/my').then((r) => r.data)

// Уведомления текущего пользователя
export const getNotifications = () =>
  api.get('/notifications').then((r) => r.data)

export const markNotificationRead = (id) =>
  api.post(`/notifications/${id}/read`).then((r) => r.data)

export const markAllNotificationsRead = () =>
  api.post('/notifications/read-all').then((r) => r.data)

export const createViolation = (data) =>
  api.post('/violations', data).then((r) => r.data)

// Отчетность по наблюдению (форма 16-02): { status, comment, schedule_check, repeat_observation_at, onsite_verification, tech_ticket }
export const reviewViolation = (id, data) =>
  api.patch(`/violations/${id}/review`, data).then((r) => r.data)

// Подпись нарушения ЭЦП (CMS строки sign_data) — после неё преподаватель получает уведомление
export const signViolation = (id, cms) =>
  api.post(`/violations/${id}/sign`, { cms }).then((r) => r.data)

// Пояснение преподавателя: FormData { kind, method: ecp | scan, text, cms?, file? }
export const addViolationResponse = (id, form) =>
  api.post(`/violations/${id}/responses`, form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data)

// Снять нарушение по пояснению преподавателя
export const justifyViolation = (id, comment) =>
  api.patch(`/violations/${id}/justify`, { comment }).then((r) => r.data)

export const captureRoomPhoto = (id) =>
  api.post(`/rooms/${id}/camera/photo`).then((r) => r.data)

export const recordRoomVideo = (id, duration = 10) =>
  api.post(`/rooms/${id}/camera/video`, null, { params: { duration } }).then((r) => r.data)

export const getLdapUsers = () =>
  api.get('/users/ldap').then((r) => r.data)

export const getLocalUsers = () =>
  api.get('/users/local').then((r) => r.data)

export const createLocalUser = (payload) =>
  api.post('/users/local', payload).then((r) => r.data)

export const updateLocalUser = (username, payload) =>
  api.patch(`/users/local/${encodeURIComponent(username)}`, payload).then((r) => r.data)

export const deleteLocalUser = (username) =>
  api.delete(`/users/local/${encodeURIComponent(username)}`).then((r) => r.data)

// facultyId — только для роли dean (деканат работает с данными своего факультета)
export const updateLocalUserRole = (username, role, facultyId = null) =>
  api.patch(`/users/local/${encodeURIComponent(username)}/role`, { role, faculty_id: facultyId }).then((r) => r.data)

export const blockLocalUser = (username, payload = {}) =>
  api.post(`/users/local/${encodeURIComponent(username)}/block`, payload).then((r) => r.data)

export const unblockLocalUser = (username) =>
  api.post(`/users/local/${encodeURIComponent(username)}/unblock`).then((r) => r.data)

export const getRecord = (id) =>
  api.get(`/records/${id}`).then((r) => r.data)

export const createRecord = (data) =>
  api.post('/records', data).then((r) => r.data)

export const updateRecord = (id, data) =>
  api.patch(`/records/${id}`, data).then((r) => r.data)

export const deleteRecord = (id) =>
  api.delete(`/records/${id}`)

export const submitRecord = (id) =>
  api.post(`/records/${id}/submit`).then((r) => r.data)

export const sendRecordToRework = (id) =>
  api.post(`/records/${id}/send-to-rework`).then((r) => r.data)

export const acceptRecord = (id) =>
  api.post(`/records/${id}/accept`).then((r) => r.data)

// Взаимопосещение занятий
export const getPeerVisits = (params) =>
  api.get('/peer-visits', { params }).then((r) => r.data)

export const getPeerVisit = (id) =>
  api.get(`/peer-visits/${id}`).then((r) => r.data)

export const createPeerVisit = (data) =>
  api.post('/peer-visits', data).then((r) => r.data)

export const updatePeerVisit = (id, data) =>
  api.patch(`/peer-visits/${id}`, data).then((r) => r.data)

export const deletePeerVisit = (id) =>
  api.delete(`/peer-visits/${id}`)

export const submitPeerVisit = (id) =>
  api.post(`/peer-visits/${id}/submit`).then((r) => r.data)

export const sendPeerVisitToRework = (id) =>
  api.post(`/peer-visits/${id}/send-to-rework`).then((r) => r.data)

export const acceptPeerVisit = (id) =>
  api.post(`/peer-visits/${id}/accept`).then((r) => r.data)

// Дашборды модулей «Взаимопосещение» и «Ситуационный мониторинг»
export const getPeerVisitsDashboard = (params) =>
  api.get('/peer-visits/dashboard', { params }).then((r) => r.data)

export const getViolationsDashboard = (params) =>
  api.get('/violations/dashboard', { params }).then((r) => r.data)

// График взаимопосещения
export const getPeerVisitSchedule = (params) =>
  api.get('/peer-visit-schedule', { params }).then((r) => r.data)

export const getPeerVisitScheduleSummary = (params) =>
  api.get('/peer-visit-schedule/summary', { params }).then((r) => r.data)

export const getMyPeerVisitSchedule = () =>
  api.get('/peer-visit-schedule/my').then((r) => r.data)

export const getPeerVisitScheduleTutors = (params) =>
  api.get('/peer-visit-schedule/tutors', { params }).then((r) => r.data)

export const createPeerVisitScheduleRow = (data) =>
  api.post('/peer-visit-schedule', data).then((r) => r.data)

export const updatePeerVisitScheduleRow = (id, data) =>
  api.patch(`/peer-visit-schedule/${id}`, data).then((r) => r.data)

export const deletePeerVisitScheduleRow = (id) =>
  api.delete(`/peer-visit-schedule/${id}`)

// Справочник вопросов по учебным годам
export const getRatingTemplates = () =>
  api.get('/rating-templates').then((r) => r.data)

// Учебные годы и справочник (в нём тоже список годов) меняются вместе
const invalidateYears = (result) => {
  getAcademicYears.invalidate()
  getBasicInfoCatalog.invalidate()
  return result
}

// Шаблон нового года добавляет год в список учебных годов
export const createRatingTemplate = (data) =>
  api.post('/rating-templates', data).then((r) => invalidateYears(r.data))

export const updateRatingTemplate = (academicYear, data) =>
  api.put(`/rating-templates/${encodeURIComponent(academicYear)}`, data).then((r) => invalidateYears(r.data))

export const deleteRatingTemplate = (academicYear) =>
  api.delete(`/rating-templates/${encodeURIComponent(academicYear)}`).then(invalidateYears)

// Справочник учебных годов
export const getAcademicYears = sharedRequest(120_000, () => api.get('/academic-years').then((r) => r.data))

export const createAcademicYear = (name) =>
  api.post('/academic-years', { name }).then((r) => invalidateYears(r.data))

export const deleteAcademicYear = (name) =>
  api.delete(`/academic-years/${encodeURIComponent(name)}`).then(invalidateYears)

// name = null — по умолчанию снова текущий учебный год по дате
export const setDefaultAcademicYear = (name) =>
  api.put('/academic-years/default', { name }).then((r) => invalidateYears(r.data))

// Audit logs (admin)
export const getAuditLogs = (params) =>
  api.get('/admin/audit-logs', { params }).then((r) => r.data)

export const getAuditStats = (daysBack) =>
  api.get('/admin/audit-logs/stats', { params: { days_back: daysBack } }).then((r) => r.data)

export const getAuditActions = () =>
  api.get('/admin/audit-logs/actions').then((r) => r.data)

export const getAuditActors = () =>
  api.get('/admin/audit-logs/actors').then((r) => r.data)

// Dashboard
export const getDashboardStats = (params) =>
  api.get('/records/dashboard', { params }).then((r) => r.data)

export default api

// Комитет ректорского контроля (routers/committee.py)
export const getCommittee = () => api.get('/committee').then((r) => r.data)
export const getCommitteeOrder = (id) => api.get(`/committee/orders/${id}`).then((r) => r.data)
export const getCommitteeTutors = () => api.get('/committee/tutors').then((r) => r.data)
export const createCommitteeOrder = (data) => api.post('/committee/orders', data).then((r) => r.data)
export const updateCommitteeOrder = (id, data) => api.patch(`/committee/orders/${id}`, data).then((r) => r.data)
export const activateCommitteeOrder = (id) => api.post(`/committee/orders/${id}/activate`).then((r) => r.data)
export const refreshCommitteeMembers = (id) => api.post(`/committee/orders/${id}/refresh`).then((r) => r.data)
export const sendCommitteeOrder = (id) => api.post(`/committee/orders/${id}/send`).then((r) => r.data)
export const deactivateCommitteeOrder = (id) => api.post(`/committee/orders/${id}/deactivate`).then((r) => r.data)
export const recallCommitteeOrder = (id) => api.post(`/committee/orders/${id}/recall`).then((r) => r.data)
// Подписание ЭЦП: документы на подпись текущего пользователя и проверка подлинности по QR-коду (без входа)
// Меню (основное и мобильное) и страница подписания запрашивают список одновременно — один запрос на всех;
// без кеша: после подписи следующий вызов получает свежий список
let signingListRequest = null
export const getSigningList = () => {
  if (!signingListRequest) {
    signingListRequest = api.get('/signing').then((r) => r.data)
      .finally(() => { signingListRequest = null })
  }
  return signingListRequest
}
// «Мои показатели» на дашборде — только данные текущего пользователя
export const getMyDashboard = (params) => api.get('/dashboard/me', { params }).then((r) => r.data)
export const getSigningDocument = (id) => api.get(`/committee/signing/${id}`).then((r) => r.data)
export const signCommitteeOrder = (id, cms) => api.post(`/committee/signing/${id}`, { cms }).then((r) => r.data)
// PDF документов формирует сервер (services/committee_pdf.py, services/schedule_pdf.py)
async function getPdf(url, params) {
  const response = await api.get(url, { params, responseType: 'blob' })
  const match = /filename\*=UTF-8''([^;]+)/.exec(response.headers['content-disposition'] || '')
  return { blob: response.data, name: match ? decodeURIComponent(match[1]) : 'document.pdf' }
}
export const getCommitteePdf = (id, { signing = false, languages = 'ru' } = {}) =>
  getPdf(signing ? `/committee/signing/${id}/pdf` : `/committee/orders/${id}/pdf`, { languages })

// Утверждение графика взаимопосещения ЭЦП: заведующие кафедрами → согласующие → утверждающий
export const getScheduleApproval = (params) => api.get('/peer-visit-schedule/approval', { params }).then((r) => r.data)
export const saveScheduleApproval = (data) => api.put('/peer-visit-schedule/approval', data).then((r) => r.data)
export const sendScheduleApproval = (id) => api.post(`/peer-visit-schedule/approval/${id}/send`).then((r) => r.data)
export const recallScheduleApproval = (id) => api.post(`/peer-visit-schedule/approval/${id}/recall`).then((r) => r.data)
export const getScheduleApprovalPdf = (id) => getPdf(`/peer-visit-schedule/approval/${id}/pdf`)
export const getScheduleSigningDocument = (id) => api.get(`/signing/schedule/${id}`).then((r) => r.data)
export const signScheduleApproval = (id, cms) => api.post(`/signing/schedule/${id}`, { cms }).then((r) => r.data)
export const getScheduleSigningPdf = (id) => getPdf(`/signing/schedule/${id}/pdf`)
export const verifyDocument = (token) => api.get(`/verify/${token}`).then((r) => r.data)
export const deleteCommitteeOrder = (id) => api.delete(`/committee/orders/${id}`)
export const committeeOrderFileUrl = (id) => `/api/committee/orders/${id}/file`
export const uploadCommitteeOrderFile = (id, file) => {
  const form = new FormData()
  form.append('file', file)
  return api.post(`/committee/orders/${id}/file`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then((r) => r.data)
}
export const addCommitteeMember = (orderId, data) => api.post(`/committee/orders/${orderId}/members`, data).then((r) => r.data)
export const updateCommitteeMember = (id, data) => api.patch(`/committee/members/${id}`, data).then((r) => r.data)
export const deleteCommitteeMember = (id) => api.delete(`/committee/members/${id}`).then((r) => r.data)
// Распределение проверок по преподавателям между членами комитета (services/committee_assignments.py)
export const getCommitteeAssignments = (orderId, term) => api.get(`/committee/orders/${orderId}/assignments`, { params: { term } }).then((r) => r.data)
export const distributeCommitteeAssignments = (orderId, term) => api.post(`/committee/orders/${orderId}/assignments/distribute`, null, { params: { term } }).then((r) => r.data)
export const setCommitteeAssignment = (orderId, data) => api.put(`/committee/orders/${orderId}/assignments`, data).then((r) => r.data)
export const clearCommitteeAssignments = (orderId, term) => api.delete(`/committee/orders/${orderId}/assignments`, { params: { term } }).then((r) => r.data)
export const setCommitteeInspectorExcluded = (orderId, tutorId, term, excluded) => api.put(`/committee/orders/${orderId}/assignments/inspectors/${tutorId}`, { excluded }, { params: { term } }).then((r) => r.data)
