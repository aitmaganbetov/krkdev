import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../context/AuthContext'
import { SapaMark, SapaWordmark } from './brand/SapaLogo'
import Icon from './ui/Icon'
import Tooltip from './ui/Tooltip'
import { cn } from './ui/cn'
import { roleAllowed } from '../utils/roles'
import { getSigningList } from '../services/api'

/*
 * Навигация. Порядок: от ежедневных задач к редким настройкам.
 *  Обзор — дашборд (руководство, инспекторы);
 *  Работа — документы на подпись ЭЦП (только если они есть у пользователя), записи КРК, взаимопосещение занятий и его график (деканат — только своего факультета),
 *    ситуационный мониторинг (руководство, инспекторы; члены комитета КРК — только просмотр),
 *    комитет ректорского контроля (приказ и состав), мои нарушения (сотрудники и пользователи: нарушения,
 *    зафиксированные на их занятиях);
 *  Администрирование — справочник, пользователи, LDAP, кабинеты и камеры, настройки системы, журнал аудита.
 */
export const NAV_GROUPS = [
  {
    id: 'overview',
    items: [
      // Дашборд — у всех ролей, каждому только его данные (pages/DashboardPage)
      { to: '/dashboard', labelKey: 'nav.dashboard', icon: 'dashboard', roles: ['admin', 'dean', 'inspector', 'peer_inspector', 'staff', 'committee', 'user', 'teacher', 'student'] },
    ],
  },
  {
    id: 'workspace',
    items: [
      // signing: виден только подписанту, пока есть документы на подпись (роль не важна)
      { to: '/signing', labelKey: 'nav.signing', icon: 'key', signing: true },
      { to: '/schedule', labelKey: 'nav.schedule', icon: 'clock', roles: ['admin', 'inspector', 'peer_inspector', 'staff', 'committee', 'dean'] },
      { to: '/records', labelKey: 'nav.records', icon: 'records', roles: ['admin', 'inspector', 'staff', 'committee', 'dean'] },
      // exclude: вложенный раздел со своим пунктом меню не подсвечивает родительский
      { to: '/peer-visits', labelKey: 'nav.peerVisits', icon: 'user-check', roles: ['admin', 'peer_inspector', 'staff', 'committee', 'dean', 'user', 'teacher'], exclude: '/peer-visits/schedule' },
      { to: '/peer-visits/schedule', labelKey: 'nav.peerVisitSchedule', icon: 'calendar', roles: ['admin', 'peer_inspector', 'dean'] },
      { to: '/monitoring', labelKey: 'nav.monitoring', icon: 'monitor', roles: ['admin', 'dean', 'committee'] },
      { to: '/committee', labelKey: 'nav.committee', icon: 'shield', roles: ['admin', 'inspector', 'dean', 'committee'] },
      { to: '/my-violations', labelKey: 'nav.myViolations', icon: 'alert', roles: ['staff', 'committee', 'user', 'teacher'] },
      // only: личный раздел студента — суперадминистратору не показывается
      { to: '/my-schedule', labelKey: 'nav.mySchedule', icon: 'calendar', roles: ['student'], only: true },
      { to: '/my-attendance', labelKey: 'nav.myAttendance', icon: 'check-circle', roles: ['student'], only: true },
    ],
  },
  {
    id: 'administration',
    items: [
      { to: '/catalogs', labelKey: 'nav.catalogs', icon: 'book', roles: ['admin', 'inspector'] },
      { to: '/users', labelKey: 'nav.users', icon: 'users', roles: ['admin'] },
      { to: '/ldap-users', labelKey: 'nav.ldapUsers', icon: 'directory', roles: ['superadmin'] },
      { to: '/rooms-settings', labelKey: 'nav.rooms', icon: 'camera', roles: ['admin'] },
      { to: '/settings', labelKey: 'nav.settings', icon: 'settings', roles: ['superadmin'] },
      { to: '/audit-logs', labelKey: 'nav.auditLogs', icon: 'audit', roles: ['superadmin'] },
    ],
  },
]

export function Brand({ compact = false }) {
  const { t } = useTranslation()
  return (
    <div className="flex min-w-0 items-center gap-3">
      <SapaMark size={36} title={compact ? 'Sapa Monitoring' : undefined} />
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
  const { pathname } = useLocation()
  const isExcluded = (item) => Boolean(item.exclude && pathname.startsWith(item.exclude))
  // Документы на подпись: число перечитывается при переходах в раздел подписания (после подписи пункт исчезает)
  const [signingCount, setSigningCount] = useState(0)
  const inSigning = pathname.startsWith('/signing')
  useEffect(() => {
    let active = true
    getSigningList().then((items) => { if (active) setSigningCount(items.length) }).catch(() => {})
    return () => { active = false }
  }, [inSigning])
  const visible = (item) => {
    if (item.signing) return signingCount > 0 || inSigning
    return item.only ? item.roles.includes(role) : roleAllowed(role, item.roles)
  }
  return (
    <nav aria-label={t('sidebar.mainNavigation')} className="flex flex-col gap-5">
      {NAV_GROUPS.map((group) => {
        const items = group.items.filter(visible)
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
                    isActive && !isExcluded(item)
                      ? 'bg-primary-subtle text-primary-subtle-fg before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-r-full before:bg-primary'
                      : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
                  )}
                >
                  <Icon name={item.icon} size={20} />
                  {!collapsed && <span className="min-w-0 flex-1 leading-5">{label}</span>}
                  {item.signing && signingCount > 0 && (
                    <span className={cn('rounded-full bg-primary px-1.5 text-xs font-semibold leading-5 text-primary-on tabular', collapsed && 'absolute right-1 top-1 px-1 text-[10px] leading-4')}>
                      {signingCount}
                    </span>
                  )}
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
