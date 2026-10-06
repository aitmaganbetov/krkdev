import { cn } from './cn'
import Icon from './Icon'

const TONES = {
  neutral: 'bg-neutral-subtle text-neutral',
  primary: 'bg-primary-subtle text-primary-subtle-fg',
  success: 'bg-success-subtle text-success',
  warning: 'bg-warning-subtle text-warning',
  danger: 'bg-danger-subtle text-danger',
  info: 'bg-info-subtle text-info',
}
const DOT = {
  neutral: 'bg-neutral', primary: 'bg-primary', success: 'bg-success',
  warning: 'bg-warning', danger: 'bg-danger', info: 'bg-info',
}

/** Бейдж растёт под текст; длинный текст переносится, а не обрезается (wrap) — или truncate с title. */
export default function Badge({ tone = 'neutral', icon, dot = false, truncate = false, className, children, title, ...rest }) {
  return (
    <span
      title={title ?? (truncate && typeof children === 'string' ? children : undefined)}
      className={cn(
        'inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium leading-5',
        TONES[tone],
        className,
      )}
      {...rest}
    >
      {dot && <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOT[tone])} aria-hidden="true" />}
      {icon && <Icon name={icon} size={14} />}
      <span className={cn('min-w-0', truncate ? 'truncate' : 'break-words')}>{children}</span>
    </span>
  )
}
