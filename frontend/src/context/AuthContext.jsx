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
  const storedUsername = localStorage.getItem('username') || ''
  const storedRole = (localStorage.getItem('role') || '').toLowerCase()
  const currentUser = normalizeIdentity(storedUsername)
  const role = storedRole || 'staff'

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
        setCurrentUser('')
        setRole('staff')
        setIsAuthenticated(false)
        localStorage.removeItem('username')
        localStorage.removeItem('role')
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

    localStorage.setItem('username', canonicalUser)
    localStorage.setItem('role', roleFromToken)
    setCurrentUser(canonicalUser)
    setRole(roleFromToken)
    setIsAuthenticated(true)
  }, [])

  const logout = useCallback(() => {
    logoutApi().catch(() => {})
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
