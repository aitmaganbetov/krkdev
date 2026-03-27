import { createContext, useContext, useState, useCallback } from 'react'
import { login as loginApi } from '../services/api'
import { normalizeIdentity } from '../utils/identity'

const AuthContext = createContext(null)

function parseJwtPayload(token) {
  if (!token || typeof token !== 'string') return null
  try {
    const part = token.split('.')[1]
    if (!part) return null
    const normalized = part.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    return JSON.parse(atob(padded))
  } catch {
    return null
  }
}

function getInitialAuthState() {
  const token = localStorage.getItem('token')
  const storedUsername = localStorage.getItem('username') || ''
  const storedRole = (localStorage.getItem('role') || '').toLowerCase()
  const payload = parseJwtPayload(token)

  const usernameFromToken = normalizeIdentity(payload?.sub)
  const roleFromToken = String(payload?.role || '').toLowerCase().trim()

  const currentUser = usernameFromToken || normalizeIdentity(storedUsername)
  const role = roleFromToken || storedRole || 'staff'

  if (currentUser) {
    localStorage.setItem('username', currentUser)
  }
  localStorage.setItem('role', role)

  return {
    token,
    currentUser,
    role,
  }
}

export function AuthProvider({ children }) {
  const [initial] = useState(() => getInitialAuthState())
  const [token, setToken] = useState(initial.token)
  const [currentUser, setCurrentUser] = useState(initial.currentUser)
  const [role, setRole] = useState(initial.role)

  const isAuthenticated = Boolean(token)

  const login = useCallback(async (username, password) => {
    const data = await loginApi(username, password)
    const payload = parseJwtPayload(data.access_token)
    const canonicalUser = normalizeIdentity(payload?.sub) || normalizeIdentity(username)

    localStorage.setItem('token', data.access_token)
    localStorage.setItem('username', canonicalUser)
    localStorage.setItem('role', data.role || 'staff')
    setToken(data.access_token)
    setCurrentUser(canonicalUser)
    setRole(data.role || 'staff')
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem('token')
    localStorage.removeItem('username')
    localStorage.removeItem('role')
    setToken(null)
    setCurrentUser('')
    setRole('staff')
  }, [])

  const hasRole = useCallback((allowedRoles = []) => {
    const normalized = allowedRoles.map((item) => String(item || '').toLowerCase())
    return normalized.includes(String(role || '').toLowerCase())
  }, [role])

  return (
    <AuthContext.Provider value={{ isAuthenticated, currentUser, role, hasRole, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
