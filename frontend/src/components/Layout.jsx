import { Outlet, Navigate } from 'react-router-dom'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import Sidebar from './Sidebar'

export default function Layout() {
  const { isAuthenticated, authLoading, currentUser, role } = useAuth()
  const { t } = useTranslation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const sidebarWidth = collapsed ? '5rem' : '20rem'

  if (authLoading) return null
  if (!isAuthenticated) return <Navigate to="/login" replace />

  return (
    <div
      className="platform-white soc-shell min-h-screen bg-slate-100 dark:bg-slate-950"
      style={{ '--sidebar-width': sidebarWidth }}
    >
      <a href="#main-content" className="fixed left-4 top-4 z-[100] -translate-y-20 rounded-lg bg-blue-700 px-4 py-3 text-sm font-semibold text-white shadow-lg transition-transform focus:translate-y-0">
        {t('common.skipToContent')}
      </a>
      <Sidebar
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((v) => !v)}
      />
      <main id="main-content" tabIndex="-1" className="min-w-0 w-full overflow-auto p-3 outline-none sm:p-4 lg:ml-[calc(var(--sidebar-width)+1.5rem)] lg:w-[calc(100%-var(--sidebar-width)-1.5rem)] lg:p-5">
        <div className="md3-app-bar mb-4 flex min-h-16 items-center justify-between px-3 py-2.5 lg:justify-end print:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full bg-primary-100 px-4 py-2 text-sm font-semibold text-primary-900 transition-colors hover:bg-primary-200 focus:outline-none dark:bg-primary-800 dark:text-primary-100 dark:hover:bg-primary-700 lg:hidden"
            aria-expanded={mobileOpen}
            aria-controls="mobile-sidebar"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            {t('common.menu')}
          </button>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 border-r border-slate-200 pr-3 sm:flex dark:border-slate-700">
              <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.12)]" />
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700 dark:text-emerald-400">Система защищена</p>
            </div>
            <p className="hidden text-xs text-gray-500 dark:text-[#8da0bd] xl:block">{t('common.system')}</p>
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
