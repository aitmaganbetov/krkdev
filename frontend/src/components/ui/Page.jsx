import { Link } from 'react-router-dom'
import { cn } from './cn'
import Icon from './Icon'

/**
 * Заголовок страницы. Действия справа; на узком экране переносятся под заголовок (flex-wrap + gap),
 * поэтому длинный заголовок никогда не наезжает на кнопки.
 */
export function PageHeader({ title, description, actions, back, eyebrow, className, children }) {
  return (
    <header className={cn('flex min-w-0 flex-wrap items-end justify-between gap-x-6 gap-y-4', className)}>
      <div className="min-w-0 flex-1 basis-72">
        {back && (
          <Link to={back.to} onClick={back.onClick}
            className="mb-2 inline-flex min-h-8 items-center gap-1.5 rounded-md text-sm font-medium text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
            <Icon name="arrow-left" size={16} />
            {back.label}
          </Link>
        )}
        {eyebrow && <p className="mb-1 text-sm font-medium text-accent">{eyebrow}</p>}
        <h1 className="text-2xl font-semibold text-fg">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-fg-muted">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

/** Вертикальный ритм страницы. */
export function PageStack({ className, children }) {
  return <div className={cn('flex min-w-0 flex-col gap-6', className)}>{children}</div>
}

/** Панель фильтров: адаптивная сетка, поля сами переносятся на новую строку. */
export function FilterBar({ children, className, actions, title, ariaLabel }) {
  return (
    <section aria-label={ariaLabel || title} className={cn('min-w-0 rounded-lg border border-line bg-surface-muted p-3 sm:p-4', className)}>
      {title && <h2 className="mb-3 text-sm font-semibold text-fg">{title}</h2>}
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]">
        {children}
      </div>
      {actions && <div className="mt-3 flex flex-wrap items-center justify-end gap-2">{actions}</div>}
    </section>
  )
}

const KPI_TONE = {
  neutral: 'text-fg',
  primary: 'text-primary',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
}

/** KPI-карточка дашборда. */
export function StatCard({ label, value, hint, icon, tone = 'neutral', footer, className }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-3 rounded-lg border border-line bg-surface p-4 shadow-1 sm:p-5', className)}>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <p className="min-w-0 text-sm font-medium text-fg-muted">{label}</p>
        {icon && (
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-muted text-fg-subtle">
            <Icon name={icon} size={18} />
          </span>
        )}
      </div>
      <p className={cn('text-3xl font-semibold tabular', KPI_TONE[tone])}>{value}</p>
      {hint && <p className="text-xs text-fg-subtle">{hint}</p>}
      {footer}
    </div>
  )
}

/** Сетка «подпись — значение» для карточек деталей. */
export function DescriptionList({ items, className, columns = 2 }) {
  return (
    <dl className={cn('grid min-w-0 gap-x-6 gap-y-4', columns === 2 ? 'sm:grid-cols-2' : columns === 3 ? 'sm:grid-cols-2 lg:grid-cols-3' : '', className)}>
      {items.filter(Boolean).map((it) => (
        <div key={it.label} className={cn('min-w-0', it.full && 'sm:col-span-full')}>
          <dt className="text-xs font-medium text-fg-subtle">{it.label}</dt>
          <dd className="mt-1 min-w-0 text-sm text-fg">{it.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Секция формы: заголовок + описание + поля в сетке. */
export function FormSection({ title, description, children, className, columns = 2 }) {
  return (
    <fieldset className={cn('min-w-0', className)}>
      {(title || description) && (
        <div className="mb-4">
          {title && <legend className="text-base font-semibold text-fg">{title}</legend>}
          {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
        </div>
      )}
      <div className={cn('grid min-w-0 gap-4', columns === 2 && 'sm:grid-cols-2', columns === 3 && 'sm:grid-cols-2 lg:grid-cols-3')}>
        {children}
      </div>
    </fieldset>
  )
}
