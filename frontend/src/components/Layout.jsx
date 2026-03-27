import { Outlet, Navigate } from 'react-router-dom'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import Sidebar from './Sidebar'

export default function Layout() {
  const { isAuthenticated, currentUser, role } = useAuth()
  const { t } = useTranslation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  if (!isAuthenticated) return <Navigate to="/login" replace />

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-slate-100 via-indigo-50 to-slate-100 dark:from-gray-950 dark:via-gray-950 dark:to-gray-900">
      <Sidebar
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((v) => !v)}
      />
      <main className="flex-1 overflow-auto p-3 sm:p-4 lg:p-6">
        <div className="mb-4 rounded-2xl border border-indigo-100/70 dark:border-indigo-900/30 bg-white/90 dark:bg-gray-900/80 backdrop-blur shadow-[0_10px_30px_rgba(79,70,229,0.08)] px-3 py-2.5 flex items-center justify-between lg:justify-end print:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            className="lg:hidden inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 dark:text-indigo-300 dark:bg-indigo-900/20 dark:hover:bg-indigo-900/40"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            {t('common.menu')}
          </button>
          <div className="flex items-center gap-3">
            <p className="hidden sm:block text-xs sm:text-sm text-gray-500 dark:text-gray-400">{t('common.system')}</p>
            <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-300">
              <span className="text-gray-400 dark:text-gray-500">{t('auth.authorizedAs')}</span>{' '}
              <span className="font-semibold">{currentUser || '—'}</span>
              <span className="text-gray-400 dark:text-gray-500"> ({role || 'staff'})</span>
            </div>
          </div>
        </div>
        <Outlet />
      </main>
    </div>
  )
}
