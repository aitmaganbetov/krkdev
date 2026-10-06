import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { SapaMark, SapaWordmark } from './brand/SapaLogo'
import Icon from './ui/Icon'
import Tooltip from './ui/Tooltip'
import { cn } from './ui/cn'

/*
 * Навигация. Порядок: от ежедневных задач к редким настройкам.
 *  Обзор — дашборд и онлайн-мониторинг (руководство, инспекторы);
 *  Работа — записи (все роли);
 *  Администрирование — справочник, пользователи, LDAP, кабинеты и камеры, настройки системы, журнал аудита.
 */
export const NAV_GROUPS = [
  {
    id: 'overview',
    items: [
      { to: '/dashboard', labelKey: 'nav.dashboard', icon: 'dashboard', roles: ['admin', 'inspector'] },
      { to: '/monitoring', labelKey: 'nav.monitoring', icon: 'monitor', roles: ['admin', 'inspector'] },
    ],
  },
  {
    id: 'workspace',
    items: [
      { to: '/records', labelKey: 'nav.records', icon: 'records', roles: ['admin', 'inspector', 'staff'] },
    ],
  },
  {
    id: 'administration',
    items: [
      { to: '/catalogs', labelKey: 'nav.catalogs', icon: 'book', roles: ['admin'] },
      { to: '/users', labelKey: 'nav.users', icon: 'users', roles: ['admin'] },
      { to: '/ldap-users', labelKey: 'nav.ldapUsers', icon: 'directory', roles: ['admin'] },
      { to: '/rooms-settings', labelKey: 'nav.rooms', icon: 'camera', roles: ['admin'] },
      { to: '/settings', labelKey: 'nav.settings', icon: 'settings', roles: ['admin'] },
      { to: '/audit-logs', labelKey: 'nav.auditLogs', icon: 'audit', roles: ['admin'] },
    ],
  },
]

export function Brand({ compact = false }) {
  const { t } = useTranslation()
  return (
    <div className="flex min-w-0 items-center gap-3">
      <SapaMark size={36} title={compact ? 'Sapa' : undefined} />
      {!compact && (
        <div className="min-w-0">
          <SapaWordmark height={20} className="text-brand-navy dark:text-white" />
          <p className="mt-1 text-xs leading-4 text-fg-subtle">{t('sidebar.productSubtitle')}</p>
        </div>
      )}
    </div>
  )
}

/** Список пунктов меню с группами. collapsed — только иконки (подписи во всплывающих подсказках). */
export function NavList({ collapsed = false, onNavigate }) {
  const { t } = useTranslation()
  const { role } = useAuth()
  return (
    <nav aria-label={t('sidebar.mainNavigation')} className="flex flex-col gap-5">
      {NAV_GROUPS.map((group) => {
        const items = group.items.filter((i) => i.roles.includes(role))
        if (!items.length) return null
        return (
          <div key={group.id} className="flex flex-col gap-0.5">
            {collapsed ? (
              <div className="mx-auto mb-1 h-px w-6 bg-line" aria-hidden="true" />
            ) : (
              <p className="mb-1 px-3 text-xs font-medium text-fg-subtle">{t(`sidebar.groups.${group.id}`)}</p>
            )}
            {items.map((item) => {
              const label = t(item.labelKey)
              const link = (
                <NavLink
                  to={item.to}
                  onClick={onNavigate}
                  aria-label={collapsed ? label : undefined}
                  className={({ isActive }) => cn(
                    'relative flex min-h-10 min-w-0 items-center gap-3 rounded-md text-sm font-medium transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                    collapsed ? 'justify-center px-0' : 'px-3',
                    isActive
                      ? 'bg-primary-subtle text-primary-subtle-fg before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-r-full before:bg-primary'
                      : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
                  )}
                >
                  <Icon name={item.icon} size={20} />
                  {!collapsed && <span className="min-w-0 flex-1 leading-5">{label}</span>}
                </NavLink>
              )
              return collapsed ? <Tooltip key={item.to} content={label} placement="right">{link}</Tooltip> : <div key={item.to}>{link}</div>
            })}
          </div>
        )
      })}
    </nav>
  )
}

/** Боковое меню для ≥ lg. */
export default function Sidebar({ collapsed, onToggleCollapse }) {
  const { t } = useTranslation()
  const toggleLabel = collapsed ? t('shell.expandSidebar') : t('shell.collapseSidebar')
  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-sidebar hidden flex-col border-r border-line bg-surface-muted transition-[width] duration-200 lg:flex print:hidden',
        collapsed ? 'w-sidebar-collapsed' : 'w-sidebar',
      )}
    >
      <div className={cn('flex h-header shrink-0 items-center border-b border-line', collapsed ? 'justify-center px-2' : 'px-4')}>
        <Brand compact={collapsed} />
      </div>
      <div className={cn('scrollbar-thin min-h-0 flex-1 overflow-y-auto py-4', collapsed ? 'px-2' : 'px-3')}>
        <NavList collapsed={collapsed} />
      </div>
      <div className={cn('shrink-0 border-t border-line p-2', collapsed && 'flex justify-center')}>
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={toggleLabel}
          title={toggleLabel}
          className={cn(
            'flex min-h-10 cursor-pointer items-center gap-3 rounded-md text-sm font-medium text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
            collapsed ? 'w-10 justify-center' : 'w-full px-3',
          )}
        >
          <Icon name={collapsed ? 'chevron-right' : 'chevron-left'} size={18} />
          {!collapsed && <span className="min-w-0 flex-1 text-left leading-5">{toggleLabel}</span>}
        </button>
      </div>
    </aside>
  )
}
