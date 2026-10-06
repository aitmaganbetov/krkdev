import { Outlet, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import Sidebar, { Brand, NavList } from './Sidebar'
import { Button, Drawer, Icon, Menu, SegmentedControl, cn } from './ui'

const LANGS = [
  { value: 'ru', label: 'RU', title: 'Русский' },
  { value: 'kz', label: 'KZ', title: 'Қазақша' },
  { value: 'en', label: 'EN', title: 'English' },
]

const readCollapsed = () => {
  try { return localStorage.getItem('sapa-sidebar-collapsed') === '1' } catch { return false }
}

export function useLanguage() {
  const { i18n } = useTranslation()
  const change = (lng) => {
    i18n.changeLanguage(lng)
    try { localStorage.setItem('lang', lng) } catch { /* private mode */ }
    document.documentElement.lang = lng === 'kz' ? 'kk' : lng
  }
  return [i18n.language, change]
}

function ThemeToggle({ className }) {
  const { t } = useTranslation()
  const { dark, toggle } = useTheme()
  const label = dark ? t('shell.lightTheme') : t('shell.darkTheme')
  return <Button variant="ghost" iconOnly icon={dark ? 'sun' : 'moon'} aria-label={label} onClick={toggle} className={className} />
}

function UserMenu() {
  const { t } = useTranslation()
  const { currentUser, role, logout } = useAuth()
  const navigate = useNavigate()
  const initials = (currentUser || '?').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase() || '?'
  const roleLabel = t(`shell.roles.${role || 'staff'}`)
  return (
    <Menu
      header={
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-fg" title={currentUser}>{currentUser || '—'}</p>
          <p className="text-xs text-fg-subtle">{roleLabel}</p>
        </div>
      }
      items={[{ label: t('sidebar.logout'), icon: 'logout', tone: 'danger', onClick: () => { logout(); navigate('/login') } }]}
      trigger={(p) => (
        <button {...p} type="button" aria-label={t('shell.account')}
          className="flex min-h-10 min-w-0 cursor-pointer items-center gap-2 rounded-md py-1 pl-1 pr-2 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-on">{initials}</span>
          <span className="hidden min-w-0 md:block">
            <span className="block max-w-[12rem] truncate text-sm font-medium leading-5 text-fg" title={currentUser}>{currentUser || '—'}</span>
            <span className="block text-xs leading-4 text-fg-subtle">{roleLabel}</span>
          </span>
          <Icon name="chevron-down" size={16} className="hidden text-fg-subtle md:block" />
        </button>
      )}
    />
  )
}

export default function Layout() {
  const { isAuthenticated, authLoading, currentUser, role, logout } = useAuth()
  const { t } = useTranslation()
  const [lang, setLang] = useLanguage()
  const location = useLocation()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(readCollapsed)

  useEffect(() => { setMobileOpen(false) }, [location.pathname])
  useEffect(() => { document.documentElement.lang = lang === 'kz' ? 'kk' : lang }, [lang])

  const toggleCollapsed = () => setCollapsed((v) => {
    try { localStorage.setItem('sapa-sidebar-collapsed', v ? '0' : '1') } catch { /* private mode */ }
    return !v
  })

  if (authLoading) return null
  if (!isAuthenticated) return <Navigate to="/login" replace />

  return (
    <div className="min-h-screen bg-canvas">
      <a href="#main-content"
        className="fixed left-4 top-4 z-skiplink -translate-y-24 rounded-md bg-primary px-4 py-3 text-sm font-medium text-primary-on shadow-3 transition-transform focus:translate-y-0">
        {t('common.skipToContent')}
      </a>

      <Sidebar collapsed={collapsed} onToggleCollapse={toggleCollapsed} />

      <div className={cn('flex min-h-screen min-w-0 flex-col transition-[padding] duration-200', collapsed ? 'lg:pl-sidebar-collapsed' : 'lg:pl-sidebar')}>
        <header className="sticky top-0 z-header flex h-header shrink-0 items-center gap-3 border-b border-line bg-surface px-4 sm:px-6 print:hidden">
          <Button variant="ghost" iconOnly icon="menu" aria-label={t('shell.openMenu')} onClick={() => setMobileOpen(true)}
            className="-ml-2 lg:hidden" aria-expanded={mobileOpen} aria-controls="mobile-nav" />
          <div className="min-w-0 lg:hidden"><Brand compact /></div>
          <p className="hidden min-w-0 truncate text-sm text-fg-subtle lg:block" title={t('common.system')}>{t('common.system')}</p>
          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
            <SegmentedControl size="sm" options={LANGS} value={lang} onChange={setLang} ariaLabel={t('shell.language')} className="hidden sm:inline-flex" />
            <ThemeToggle className="hidden sm:inline-flex" />
            <UserMenu />
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 outline-none">
          <div className="mx-auto w-full min-w-0 max-w-[96rem] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <Outlet />
          </div>
        </main>
      </div>

      <Drawer open={mobileOpen} onClose={() => setMobileOpen(false)} side="left" id="mobile-nav" title={t('common.menu')}
        ariaLabel={t('sidebar.mainNavigation')}
        footer={
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <SegmentedControl options={LANGS} value={lang} onChange={setLang} ariaLabel={t('shell.language')} className="flex-1" />
              <ThemeToggle />
            </div>
            <div className="flex min-w-0 items-center gap-3 rounded-md border border-line p-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-fg" title={currentUser}>{currentUser || '—'}</p>
                <p className="text-xs text-fg-subtle">{t(`shell.roles.${role || 'staff'}`)}</p>
              </div>
              <Button variant="danger-ghost" size="sm" icon="logout" onClick={() => { logout(); navigate('/login') }}>
                {t('sidebar.logout')}
              </Button>
            </div>
          </div>
        }
      >
        <div className="border-b border-line px-4 py-3"><Brand /></div>
        <div className="px-3 py-4"><NavList onNavigate={() => setMobileOpen(false)} /></div>
      </Drawer>
    </div>
  )
}
