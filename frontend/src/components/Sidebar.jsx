import { NavLink, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'

const navItems = [
  {
    to: '/dashboard',
    labelKey: 'nav.dashboard',
    roles: ['admin', 'inspector'],
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    to: '/records',
    labelKey: 'nav.records',
    roles: ['admin', 'inspector', 'staff'],
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      </svg>
    ),
  },
  {
    to: '/records/new',
    labelKey: 'nav.addRecord',
    roles: ['admin', 'inspector', 'staff'],
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M12 4v16m8-8H4" />
      </svg>
    ),
  },
  {
    to: '/users',
    labelKey: 'nav.users',
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
    to: '/audit-logs',
    labelKey: 'nav.auditLogs',
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
  const { logout, role } = useAuth()
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
    `flex items-center ${collapsed ? 'lg:justify-center' : ''} gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
      isActive
        ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 shadow-sm'
        : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100'
    }`

  const sidebarBody = (
    <>
      <div className="px-4 py-4 border-b border-indigo-100/70 dark:border-gray-800 flex items-center justify-between gap-2">
        <div className={`min-w-0 ${collapsed ? 'lg:hidden' : ''}`}>
          <span className="text-lg font-bold text-primary-600 dark:text-primary-400 tracking-tight">
            KRK Monitor
          </span>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{t('sidebar.subtitle')}</p>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={onToggleCollapse}
            className="hidden lg:inline-flex p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
            title={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {collapsed
                ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />}
            </svg>
          </button>
          <button
            onClick={onMobileClose}
            className="lg:hidden inline-flex p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label={t('sidebar.closeMenu')}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => (
          item.roles.includes(role) ? (
          <NavLink key={item.to} to={item.to} onClick={handleNavigate} className={navLinkClass} title={collapsed ? t(item.labelKey) : undefined}>
            {item.icon}
            <span className={collapsed ? 'lg:hidden' : ''}>{t(item.labelKey)}</span>
          </NavLink>
          ) : null
        ))}
      </nav>

      <div className="px-3 py-4 border-t border-indigo-100/70 dark:border-gray-800 space-y-1">
        <button
          onClick={toggle}
          className={`flex items-center ${collapsed ? 'lg:justify-center' : ''} gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100 transition-colors`}
          title={collapsed ? (dark ? t('sidebar.lightTheme') : t('sidebar.darkTheme')) : undefined}
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

        <div className={`flex items-center ${collapsed ? 'lg:hidden' : ''} gap-1 px-3 py-1`}>
          {['ru', 'kz', 'en'].map((lng) => (
            <button
              key={lng}
              onClick={() => changeLang(lng)}
              className={`flex-1 py-1 rounded-lg text-xs font-semibold uppercase transition-colors ${
                i18n.language === lng
                  ? 'bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300'
                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              {lng}
            </button>
          ))}
        </div>

        <button
          onClick={handleLogout}
          className={`flex items-center ${collapsed ? 'lg:justify-center' : ''} gap-3 w-full px-3 py-2.5 rounded-xl text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors`}
          title={collapsed ? t('sidebar.logout') : undefined}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          <span className={collapsed ? 'lg:hidden' : ''}>{t('sidebar.logout')}</span>
        </button>
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

      <aside className={`lg:hidden fixed inset-y-0 left-0 z-40 w-72 bg-white dark:bg-gray-900 border-r border-indigo-100/80 dark:border-gray-800 shadow-[0_20px_40px_rgba(79,70,229,0.25)] transform transition-transform duration-300 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="h-full flex flex-col">{sidebarBody}</div>
      </aside>

      <aside className={`hidden lg:flex lg:flex-col min-h-screen m-3 rounded-3xl border border-indigo-100/80 dark:border-gray-800 bg-white/95 dark:bg-gray-900/95 backdrop-blur shadow-[0_12px_35px_rgba(79,70,229,0.12)] transition-all duration-300 ${collapsed ? 'w-20' : 'w-72'}`}>
        {sidebarBody}
      </aside>
    </>
  )
}
