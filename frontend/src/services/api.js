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
      localStorage.removeItem('token')
      localStorage.removeItem('username')
      localStorage.removeItem('role')
      window.location.href = '/login'
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

export const getRecordFilterOptions = () =>
  api.get('/records/filter-options').then((r) => r.data)

export const getDashboardFacultyComparison = (params) =>
  api.get('/records/dashboard/faculty-comparison', { params }).then((r) => r.data)

export const getBasicInfoCatalog = () =>
  api.get('/catalogs/basic-info').then((r) => r.data)

export const getLdapSettings = () =>
  api.get('/settings/ldap').then((r) => r.data)

export const saveLdapSettings = (data) =>
  api.put('/settings/ldap', data).then((r) => r.data)

export const testLdapSettings = (data) =>
  api.post('/settings/ldap/test', data).then((r) => r.data)

export const getLdapUsers = () =>
  api.get('/users/ldap').then((r) => r.data)

export const getLocalUsers = () =>
  api.get('/users/local').then((r) => r.data)

export const createLocalUser = (payload) =>
  api.post('/users/local', payload).then((r) => r.data)

export const updateLocalUser = (username, payload) =>
  api.patch(`/users/local/${encodeURIComponent(username)}`, payload).then((r) => r.data)

export const updateLocalUserRole = (username, role) =>
  api.patch(`/users/local/${encodeURIComponent(username)}/role`, { role }).then((r) => r.data)

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

// Dashboard
export const getDashboardStats = (params) =>
  api.get('/records/dashboard', { params }).then((r) => r.data)

export default api
