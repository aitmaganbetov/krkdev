import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { getMe as getMeApi, login as loginApi, logout as logoutApi } from '../services/api'
import { normalizeIdentity } from '../utils/identity'

const AuthContext = createContext(null)

// Сессия живёт в httpOnly-cookie, JWT в браузере не хранится. В localStorage кэшируются только
// несекретные username/role для мгновенной первой отрисовки; источник истины — GET /auth/me.
function readCachedAuth() {
  try {
    // Старые версии хранили JWT в localStorage — удаляем его.
    localStorage.removeItem('token')
    return {
      currentUser: normalizeIdentity(localStorage.getItem('username') || ''),
      role: (localStorage.getItem('role') || 'staff').toLowerCase(),
    }
  } catch {
    return { currentUser: '', role: 'staff' }
  }
}

function cacheAuth(user, role) {
  try {
    if (user) {
      localStorage.setItem('username', user)
      localStorage.setItem('role', role)
    } else {
      localStorage.removeItem('username')
      localStorage.removeItem('role')
    }
  } catch { /* private mode */ }
}

export function AuthProvider({ children }) {
  const [initial] = useState(readCachedAuth)
  const [authLoading, setAuthLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [currentUser, setCurrentUser] = useState(initial.currentUser)
  const [role, setRole] = useState(initial.role)

  const applySession = useCallback((user, nextRole) => {
    setCurrentUser(user)
    setRole(nextRole)
    setIsAuthenticated(Boolean(user))
    cacheAuth(user, nextRole)
  }, [])

  useEffect(() => {
    let mounted = true
    getMeApi()
      .then((ctx) => {
        if (!mounted) return
        applySession(normalizeIdentity(ctx?.username), String(ctx?.role || 'staff').toLowerCase())
      })
      .catch(() => {
        if (mounted) applySession('', 'staff')
      })
      .finally(() => {
        if (mounted) setAuthLoading(false)
      })

    return () => {
      mounted = false
    }
  }, [applySession])

  const login = useCallback(async (username, password) => {
    const data = await loginApi(username, password)
    let user = normalizeIdentity(username)
    let nextRole = String(data?.role || 'staff').toLowerCase()
    try {
      // Каноническое имя (например, LDAP-логин без домена) и актуальная роль — из /auth/me.
      const ctx = await getMeApi()
      user = normalizeIdentity(ctx?.username) || user
      nextRole = String(ctx?.role || nextRole).toLowerCase()
    } catch { /* остаёмся на данных ответа логина */ }
    applySession(user, nextRole)
  }, [applySession])

  const logout = useCallback(async () => {
    // Сначала просим сервер сбросить cookie, затем чистим локальное состояние.
    try {
      await logoutApi()
    } catch { /* сессия могла уже истечь */ }
    applySession('', 'staff')
  }, [applySession])

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
