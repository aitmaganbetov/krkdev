import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
})

// Backward compatibility: attach bearer token when backend cookie auth is not yet enabled.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Redirect to login on 401
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const requestUrl = String(error.config?.url || '')
      const isAuthProbe = requestUrl.includes('/auth/me')
      const isLoginPage = typeof window !== 'undefined' && window.location.pathname === '/login'
      const token = localStorage.getItem('token') || ''

      if (!isAuthProbe && !isLoginPage && typeof window !== 'undefined') {
        fetch('/api/auth/logout', {
          method: 'POST',
          credentials: 'include',
          keepalive: true,
          headers: {
            'X-Logout-Reason': 'frontend_401',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        }).catch(() => {})
      }

      localStorage.removeItem('token')
      localStorage.removeItem('username')
      localStorage.removeItem('role')

      // Avoid infinite reload loop on /login caused by /auth/me returning 401.
      if (!isAuthProbe && !isLoginPage && typeof window !== 'undefined') {
        window.location.replace('/login')
      }
    }
    return Promise.reject(error)
  }
)

// Auth
export const login = (username, password) =>
  api.post('/auth/login', { username, password }).then((r) => r.data)

export const logout = () =>
  api.post('/auth/logout').then((r) => r.data)

export const getMe = () =>
  api.get('/auth/me').then((r) => r.data)

// Records
export const getRecords = (params) =>
  api.get('/records', { params }).then((r) => r.data)

export const getRecordFilterOptions = (params) =>
  api.get('/records/filter-options', { params }).then((r) => r.data)

export const getDashboardFacultyComparison = (params) =>
  api.get('/records/dashboard/faculty-comparison', { params }).then((r) => r.data)

export const getBasicInfoCatalog = () =>
  api.get('/catalogs/basic-info').then((r) => r.data)

export const getPlatonusStatus = () =>
  api.get('/catalogs/platonus-status').then((r) => r.data)

export const syncPlatonusCatalogs = () =>
  api.post('/catalogs/platonus-sync').then((r) => r.data)

export const getLdapSettings = () =>
  api.get('/settings/ldap').then((r) => r.data)

export const saveLdapSettings = (data) =>
  api.put('/settings/ldap', data).then((r) => r.data)

export const testLdapSettings = (data) =>
  api.post('/settings/ldap/test', data).then((r) => r.data)

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

export const testRoomCamera = (id) =>
  api.post(`/rooms/${id}/camera/test`).then((r) => r.data)

export const getViolations = () =>
  api.get('/violations').then((r) => r.data)

export const createViolation = (data) =>
  api.post('/violations', data).then((r) => r.data)

export const reviewViolation = (id, status, comment = '') =>
  api.patch(`/violations/${id}/review`, { status, comment }).then((r) => r.data)

export const uploadViolationAct = (id, file) => {
  const form = new FormData()
  form.append('file', file)
  return api.post(`/violations/${id}/act`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then((r) => r.data)
}

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

export const updateLocalUserRole = (username, role) =>
  api.patch(`/users/local/${encodeURIComponent(username)}/role`, { role }).then((r) => r.data)

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

// Справочник вопросов по учебным годам
export const getRatingTemplates = () =>
  api.get('/rating-templates').then((r) => r.data)

export const createRatingTemplate = (data) =>
  api.post('/rating-templates', data).then((r) => r.data)

export const updateRatingTemplate = (academicYear, data) =>
  api.put(`/rating-templates/${encodeURIComponent(academicYear)}`, data).then((r) => r.data)

export const deleteRatingTemplate = (academicYear) =>
  api.delete(`/rating-templates/${encodeURIComponent(academicYear)}`)

// Справочник учебных годов
export const getAcademicYears = () =>
  api.get('/academic-years').then((r) => r.data)

export const createAcademicYear = (name) =>
  api.post('/academic-years', { name }).then((r) => r.data)

export const deleteAcademicYear = (name) =>
  api.delete(`/academic-years/${encodeURIComponent(name)}`)

// name = null — по умолчанию снова текущий учебный год по дате
export const setDefaultAcademicYear = (name) =>
  api.put('/academic-years/default', { name }).then((r) => r.data)

// Dashboard
export const getDashboardStats = (params) =>
  api.get('/records/dashboard', { params }).then((r) => r.data)

export default api
