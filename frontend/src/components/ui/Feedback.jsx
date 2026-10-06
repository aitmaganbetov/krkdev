import { useTranslation } from 'react-i18next'
import { cn } from './cn'
import Icon from './Icon'

const ALERT = {
  info: { cls: 'border-info/30 bg-info-subtle text-fg', icon: 'info', iconCls: 'text-info' },
  success: { cls: 'border-success/30 bg-success-subtle text-fg', icon: 'check-circle', iconCls: 'text-success' },
  warning: { cls: 'border-warning/30 bg-warning-subtle text-fg', icon: 'alert', iconCls: 'text-warning' },
  danger: { cls: 'border-danger/30 bg-danger-subtle text-fg', icon: 'alert-circle', iconCls: 'text-danger' },
}

/** Встроенное сообщение (ошибка загрузки, предупреждение). */
export function Alert({ tone = 'info', title, children, action, className, onClose, closeLabel }) {
  const { t } = useTranslation()
  const s = ALERT[tone]
  const close = closeLabel || t('ui.close')
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('flex min-w-0 items-start gap-3 rounded-md border px-4 py-3 text-sm', s.cls, className)}>
      <Icon name={s.icon} size={18} className={cn('mt-0.5', s.iconCls)} />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn('text-fg-muted', title && 'mt-0.5')}>{children}</div>}
        {action && <div className="mt-2 flex flex-wrap gap-2">{action}</div>}
      </div>
      {onClose && (
        <button type="button" onClick={onClose} aria-label={close} title={close}
          className="-m-1 rounded-md p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
          <Icon name="x" size={16} />
        </button>
      )}
    </div>
  )
}

/** Пустое состояние: иконка, заголовок, пояснение, действие. */
export function EmptyState({ icon = 'inbox', title, description, action, className, compact = false }) {
  return (
    <div className={cn('flex min-w-0 flex-col items-center justify-center text-center', compact ? 'gap-2 px-4 py-8' : 'gap-3 px-6 py-14', className)}>
      <span className="grid h-12 w-12 place-items-center rounded-full bg-surface-muted text-fg-subtle">
        <Icon name={icon} size={22} />
      </span>
      {title && <p className="text-base font-semibold text-fg">{title}</p>}
      {description && <p className="max-w-md text-sm text-fg-muted">{description}</p>}
      {action && <div className="mt-1 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  )
}

/** Скелетон-заглушка на время загрузки. */
export function Skeleton({ className, rounded = 'rounded-md' }) {
  return (
    <span aria-hidden="true" className={cn('relative block overflow-hidden bg-surface-hover', rounded, className)}>
      <span className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-fg/5 to-transparent" />
    </span>
  )
}

export function SkeletonText({ lines = 3, className }) {
  return (
    <div className={cn('flex flex-col gap-2', className)} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn('h-3.5', i === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  )
}
