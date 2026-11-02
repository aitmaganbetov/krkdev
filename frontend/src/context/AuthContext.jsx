import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { devLogin as devLoginApi, ecpLogin as ecpLoginApi, getMe as getMeApi, login as loginApi, logout as logoutApi } from '../services/api'
import { normalizeIdentity } from '../utils/identity'
import { roleAllowed } from '../utils/roles'

const AuthContext = createContext(null)

// Сессия живёт в httpOnly-cookie, JWT в браузере не хранится. В localStorage кэшируются только
// несекретные username/role для мгновенной первой отрисовки; источник истины — GET /auth/me.
function readCachedAuth() {
  try {
    // Старые версии хранили JWT в localStorage — удаляем его.
    localStorage.removeItem('token')
    return {
      currentUser: normalizeIdentity(localStorage.getItem('username') || ''),
      role: (localStorage.getItem('role') || 'user').toLowerCase(),
    }
  } catch {
    return { currentUser: '', role: 'user' }
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
  // Факультет деканата (faculties.FacultyID); у остальных ролей — null
  const [facultyId, setFacultyId] = useState(null)
  // ФИО из учётной записи — только для показа (шапка, меню); идентификатор пользователя — currentUser
  const [displayName, setDisplayName] = useState('')

  const applySession = useCallback((user, nextRole, nextFacultyId = null, nextDisplayName = '') => {
    setCurrentUser(user)
    setDisplayName(user ? nextDisplayName || '' : '')
    setRole(nextRole)
    setFacultyId(nextRole === 'dean' ? nextFacultyId : null)
    setIsAuthenticated(Boolean(user))
    cacheAuth(user, nextRole)
  }, [])

  useEffect(() => {
    let mounted = true
    getMeApi()
      .then((ctx) => {
        if (!mounted) return
        applySession(normalizeIdentity(ctx?.username), String(ctx?.role || 'user').toLowerCase(), ctx?.faculty_id ?? null, ctx?.display_name)
      })
      .catch(() => {
        if (mounted) applySession('', 'user')
      })
      .finally(() => {
        if (mounted) setAuthLoading(false)
      })

    return () => {
      mounted = false
    }
  }, [applySession])

  // Сессия после успешного входа: каноническое имя и актуальная роль — из /auth/me
  const finishLogin = useCallback(async (data, usernameHint) => {
    let user = normalizeIdentity(usernameHint)
    let nextRole = String(data?.role || 'user').toLowerCase()
    let nextFacultyId = null
    let nextDisplayName = ''
    try {
      // Каноническое имя (например, LDAP-логин без домена) и актуальная роль — из /auth/me.
      const ctx = await getMeApi()
      user = normalizeIdentity(ctx?.username) || user
      nextRole = String(ctx?.role || nextRole).toLowerCase()
      nextFacultyId = ctx?.faculty_id ?? null
      nextDisplayName = ctx?.display_name || ''
    } catch { /* остаёмся на данных ответа логина */ }
    applySession(user, nextRole, nextFacultyId, nextDisplayName)
  }, [applySession])

  const login = useCallback(async (username, password) => {
    await finishLogin(await loginApi(username, password), username)
  }, [finishLogin])

  // Вход по ЭЦП: CMS с подписанным nonce; имя пользователя — из /auth/me
  const ecpLogin = useCallback(async (cms) => {
    await finishLogin(await ecpLoginApi(cms), '')
  }, [finishLogin])

  // Только dev: быстрый вход под ролью (routers/dev_login.py)
  const devLogin = useCallback(async (role, facultyId) => {
    const data = await devLoginApi(role, facultyId)
    await finishLogin(data, data?.username)
  }, [finishLogin])

  const logout = useCallback(async () => {
    // Сначала просим сервер сбросить cookie, затем чистим локальное состояние.
    try {
      await logoutApi()
    } catch { /* сессия могла уже истечь */ }
    applySession('', 'user')
  }, [applySession])

  // Суперадминистратор проходит любую проверку ролей (utils/roles.js)
  const hasRole = useCallback((allowedRoles = []) => roleAllowed(role, allowedRoles), [role])

  return (
    <AuthContext.Provider value={{ isAuthenticated, authLoading, currentUser, displayName, role, facultyId, hasRole, login, ecpLogin, devLogin, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
