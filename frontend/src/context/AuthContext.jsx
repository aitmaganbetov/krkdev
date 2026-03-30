import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { getMe as getMeApi, login as loginApi, logout as logoutApi } from '../services/api'
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
  const token = localStorage.getItem('token') || ''
  const storedUsername = localStorage.getItem('username') || ''
  const storedRole = (localStorage.getItem('role') || '').toLowerCase()
  const payload = parseJwtPayload(token)
  const usernameFromToken = normalizeIdentity(payload?.sub)
  const roleFromToken = String(payload?.role || '').toLowerCase().trim()
  const currentUser = usernameFromToken || normalizeIdentity(storedUsername)
  const role = roleFromToken || storedRole || 'staff'

  if (currentUser) {
    localStorage.setItem('username', currentUser)
    localStorage.setItem('role', role)
  }

  return {
    currentUser,
    role,
  }
}

export function AuthProvider({ children }) {
  const [initial] = useState(() => getInitialAuthState())
  const [authLoading, setAuthLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [currentUser, setCurrentUser] = useState(initial.currentUser)
  const [role, setRole] = useState(initial.role)

  useEffect(() => {
    let mounted = true
    getMeApi()
      .then((ctx) => {
        if (!mounted) return
        const user = normalizeIdentity(ctx?.username)
        const nextRole = String(ctx?.role || 'staff').toLowerCase()
        setCurrentUser(user)
        setRole(nextRole)
        setIsAuthenticated(Boolean(user))
        if (user) localStorage.setItem('username', user)
        localStorage.setItem('role', nextRole)
      })
      .catch(() => {
        if (!mounted) return
        // Backward compatibility for backends without /auth/me cookie endpoint.
        const token = localStorage.getItem('token') || ''
        const payload = parseJwtPayload(token)
        const user = normalizeIdentity(payload?.sub) || normalizeIdentity(localStorage.getItem('username') || '')
        const nextRole = String(payload?.role || localStorage.getItem('role') || 'staff').toLowerCase()
        if (user) {
          setCurrentUser(user)
          setRole(nextRole)
          setIsAuthenticated(true)
          localStorage.setItem('username', user)
          localStorage.setItem('role', nextRole)
        } else {
          setCurrentUser('')
          setRole('staff')
          setIsAuthenticated(false)
          localStorage.removeItem('username')
          localStorage.removeItem('role')
        }
      })
      .finally(() => {
        if (mounted) setAuthLoading(false)
      })

    return () => {
      mounted = false
    }
  }, [])

  const login = useCallback(async (username, password) => {
    const data = await loginApi(username, password)
    const payload = parseJwtPayload(data.access_token)
    const canonicalUser = normalizeIdentity(payload?.sub) || normalizeIdentity(username)
    const roleFromToken = String(payload?.role || data.role || 'staff').toLowerCase()

    localStorage.setItem('token', data.access_token)
    localStorage.setItem('username', canonicalUser)
    localStorage.setItem('role', roleFromToken)
    setCurrentUser(canonicalUser)
    setRole(roleFromToken)
    setIsAuthenticated(true)
  }, [])

  const logout = useCallback(() => {
    logoutApi().catch(() => {})
    localStorage.removeItem('token')
    localStorage.removeItem('username')
    localStorage.removeItem('role')
    setCurrentUser('')
    setRole('staff')
    setIsAuthenticated(false)
  }, [])

  const hasRole = useCallback((allowedRoles = []) => {
    const normalized = allowedRoles.map((item) => String(item || '').toLowerCase())
    return normalized.includes(String(role || '').toLowerCase())
  }, [role])

  return (
    <AuthContext.Provider value={{ isAuthenticated, authLoading, currentUser, role, hasRole, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
