import { NavLink, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'

const navItems = [
  {
    to: '/dashboard',
    labelKey: 'nav.dashboard',
    group: 'overview',
    roles: ['admin', 'inspector'],
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    to: '/monitoring',
    labelKey: 'nav.monitoring',
    group: 'overview',
    roles: ['admin', 'inspector'],
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M4 19V9m5 10V5m5 14v-7m5 7V3" />
      </svg>
    ),
  },
  {
    to: '/records',
    labelKey: 'nav.records',
    group: 'workspace',
    roles: ['admin', 'inspector', 'staff'],
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      </svg>
    ),
  },
  {
    to: '/users',
    labelKey: 'nav.users',
    group: 'administration',
    roles: ['admin'],
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M17 20h5V18a4 4 0 00-5-3.87M17 20H7m10 0v-2c0-.653-.084-1.286-.24-1.87M7 20H2V18a4 4 0 015-3.87M7 20v-2c0-.653.084-1.286.24-1.87m0 0a5 5 0 019.52 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    ),
  },
  {
    to: '/ldap-users',
    labelKey: 'nav.ldapUsers',
    group: 'administration',
    roles: ['admin'],
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M4 7h16M4 12h16M4 17h10" />
        <circle cx="18" cy="17" r="2" strokeWidth={2} />
      </svg>
    ),
  },
  {
    to: '/settings',
    labelKey: 'nav.settings',
    group: 'administration',
    roles: ['admin'],
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M11.049 2.927c.3-1.14 1.603-1.14 1.902 0l.294 1.117a1 1 0 00.95.69h1.175c1.2 0 1.7 1.54.74 2.26l-.942.706a1 1 0 00-.364 1.118l.36 1.108c.37 1.136-.92 2.08-1.89 1.38l-.95-.69a1 1 0 00-1.176 0l-.95.69c-.97.7-2.26-.244-1.89-1.38l.36-1.108a1 1 0 00-.364-1.118l-.942-.706c-.96-.72-.46-2.26.74-2.26h1.175a1 1 0 00.95-.69l.294-1.117z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
      </svg>
    ),
  },
  {
    to: '/rooms-settings',
    labelKey: 'nav.rooms',
    group: 'administration',
    roles: ['admin'],
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M3 21h18M5 21V5a2 2 0 012-2h7a2 2 0 012 2v16M9 8h3m-3 4h3m-3 4h3m7-7h-3m3 4h-3m3 4h-3" />
      </svg>
    ),
  },
  {
    to: '/audit-logs',
    labelKey: 'nav.auditLogs',
    group: 'administration',
    roles: ['admin'],
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
]

export default function Sidebar({ mobileOpen, onMobileClose, collapsed, onToggleCollapse }) {
  const { logout, role, currentUser } = useAuth()
  const { dark, toggle } = useTheme()
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()

  const changeLang = (lng) => {
    i18n.changeLanguage(lng)
    localStorage.setItem('lang', lng)
  }

  const handleLogout = () => {
    logout()
    onMobileClose()
    navigate('/login')
  }

  const handleNavigate = () => {
    onMobileClose()
  }

  const navLinkClass = ({ isActive }) =>
    `group flex min-h-11 cursor-pointer items-center ${collapsed ? 'lg:justify-center' : ''} gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-[background-color,color,box-shadow] duration-200 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 dark:focus:ring-cyan-400 dark:focus:ring-offset-[#0b1220] ${
      isActive
        ? '[background:var(--md-sys-color-primary)] [color:var(--md-sys-color-on-primary)] shadow-[0_6px_16px_rgba(28,71,120,0.24)]'
        : '[color:var(--md-sys-color-on-surface-variant)] hover:[background:var(--md-sys-color-surface-container)] hover:[color:var(--md-sys-color-on-surface)]'
    }`

  const visibleItems = navItems.filter((item) => item.roles.includes(role))
  const groups = ['overview', 'workspace', 'administration']
  const initials = (currentUser || 'KR').trim().slice(0, 2).toUpperCase()

  const sidebarBody = (
    <>
      <div className={`flex min-h-[82px] items-center gap-2 border-b border-slate-200/80 dark:border-[#24344d] ${collapsed ? 'px-4 lg:justify-center lg:px-2' : 'justify-between px-4'}`}>
        <div className={`min-w-0 items-center gap-3 ${collapsed ? 'flex lg:hidden' : 'flex'}`}>
          <div className="md3-brand-mark grid h-11 w-11 shrink-0 place-items-center rounded-xl text-sm font-extrabold">KR</div>
          <div className={`min-w-0 ${collapsed ? 'lg:hidden' : ''}`}>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-700 dark:text-primary-300">KRK • UNIVERSITY</p>
            <span className="mt-0.5 block truncate text-sm font-bold tracking-tight text-slate-950 dark:text-white">{t('sidebar.productName')}</span>
            <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-[#8294af]">{t('sidebar.productSubtitle')}</p>
          </div>
        </div>

        <div className={`flex items-center gap-1 ${collapsed ? 'lg:w-full lg:justify-center' : ''}`}>
          <button
            onClick={onToggleCollapse}
            className="hidden min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 dark:hover:bg-[#142033] lg:inline-flex"
            title={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}
            aria-label={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {collapsed
                ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />}
            </svg>
          </button>
          <button
            onClick={onMobileClose}
            className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600 dark:hover:bg-[#142033] lg:hidden"
            aria-label={t('sidebar.closeMenu')}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3" aria-label={t('sidebar.mainNavigation')}>
        {groups.map((group, groupIndex) => {
          const items = visibleItems.filter((item) => item.group === group)
          if (!items.length) return null
          return (
            <div key={group} className={groupIndex ? 'mt-3' : ''}>
              <p className={`px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-[#71839e] ${collapsed ? 'lg:hidden' : ''}`}>
                {t(`sidebar.groups.${group}`)}
              </p>
              <div className="space-y-1">
                {items.map((item) => (
                  <NavLink key={item.to} to={item.to} onClick={handleNavigate} className={navLinkClass} title={collapsed ? t(item.labelKey) : undefined}>
                    <span className="shrink-0 transition-transform duration-200 group-hover:translate-x-0.5">{item.icon}</span>
                    <span className={`min-w-0 truncate ${collapsed ? 'lg:hidden' : ''}`}>{t(item.labelKey)}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          )
        })}
      </nav>

      <div className="shrink-0 space-y-1.5 border-t border-slate-200/80 p-3 dark:border-[#24344d]">
        <button
          onClick={toggle}
          className={`flex min-h-11 w-full cursor-pointer items-center ${collapsed ? 'lg:justify-center' : ''} gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-600 dark:text-slate-400 dark:hover:bg-[#142033] dark:hover:text-white`}
          title={collapsed ? (dark ? t('sidebar.lightTheme') : t('sidebar.darkTheme')) : undefined}
          aria-label={dark ? t('sidebar.lightTheme') : t('sidebar.darkTheme')}
        >
          {dark ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          )}
          <span className={collapsed ? 'lg:hidden' : ''}>{dark ? t('sidebar.lightTheme') : t('sidebar.darkTheme')}</span>
        </button>

        <div className={`grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-[#111c2e] ${collapsed ? 'lg:hidden' : ''}`} aria-label={t('sidebar.language')}>
          {['ru', 'kz', 'en'].map((lng) => (
            <button
              key={lng}
              onClick={() => changeLang(lng)}
              className={`min-h-9 cursor-pointer rounded-md text-[11px] font-bold uppercase transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600 ${
                i18n.language === lng
                  ? 'bg-white text-blue-700 shadow-sm dark:bg-[#24344d] dark:text-cyan-300'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
              aria-pressed={i18n.language === lng}
            >
              {lng}
            </button>
          ))}
        </div>

        <div className={`flex min-w-0 items-center gap-2 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-[#24344d] dark:bg-[#111c2e] ${collapsed ? 'lg:justify-center lg:border-0 lg:bg-transparent lg:p-0 dark:lg:bg-transparent' : ''}`}>
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-900 text-xs font-bold text-white dark:bg-cyan-400 dark:text-slate-950">{initials}</div>
          <div className={`min-w-0 flex-1 ${collapsed ? 'lg:hidden' : ''}`}>
            <p className="truncate text-xs font-bold text-slate-900 dark:text-white" title={currentUser || undefined}>{currentUser || '—'}</p>
            <p className="mt-0.5 truncate text-[10px] uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">{role || 'staff'}</p>
          </div>
          <button onClick={handleLogout}
            className={`grid min-h-11 min-w-11 shrink-0 cursor-pointer place-items-center rounded-lg text-red-600 transition-colors hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500 dark:text-red-400 dark:hover:bg-red-950/40 ${collapsed ? 'lg:hidden' : ''}`}
            title={t('sidebar.logout')} aria-label={t('sidebar.logout')}>
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
        {collapsed && (
          <button onClick={handleLogout}
            className="hidden min-h-11 w-full cursor-pointer items-center justify-center rounded-lg text-red-600 transition-colors hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 dark:text-red-400 dark:hover:bg-red-950/30 lg:flex"
            title={t('sidebar.logout')} aria-label={t('sidebar.logout')}>
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        )}
      </div>
    </>
  )

  return (
    <>
      {mobileOpen && (
        <button
          className="lg:hidden fixed inset-0 z-30 bg-black/45 backdrop-blur-[1px]"
          onClick={onMobileClose}
          aria-label={t('sidebar.closeMenu')}
        />
      )}

      <aside id="mobile-sidebar" className={`fixed inset-y-0 left-0 z-40 w-[min(20rem,88vw)] overflow-hidden border-r [border-color:var(--md-sys-color-outline-variant)] [background:var(--md-sys-color-surface-container-low)] shadow-[0_20px_50px_rgba(2,6,23,0.3)] transition-transform duration-300 lg:hidden ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-full min-h-0 flex-col">{sidebarBody}</div>
      </aside>

      <aside className={`fixed bottom-3 left-3 top-3 hidden overflow-hidden rounded-[22px] border [border-color:var(--md-sys-color-outline-variant)] [background:var(--md-sys-color-surface-container-low)] shadow-[var(--md-sys-elevation-2)] transition-all duration-300 lg:flex ${collapsed ? 'w-20' : 'w-80'}`}>
        <div className="flex h-full min-h-0 flex-col">{sidebarBody}</div>
      </aside>
    </>
  )
}
