import { cn } from './cn'

export function Card({ as: Comp = 'section', className, children, padded = false, ...rest }) {
  return (
    <Comp className={cn('min-w-0 rounded-lg border border-line bg-surface shadow-1', padded && 'p-4 sm:p-5', className)} {...rest}>
      {children}
    </Comp>
  )
}

/** Шапка карточки: заголовок + описание слева, действия справа; на узком экране действия переносятся вниз. */
export function CardHeader({ title, description, eyebrow, actions, className, titleAs: Title = 'h2', divider = true }) {
  return (
    <div className={cn('flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-3 px-4 py-4 sm:px-5', divider && 'border-b border-line', className)}>
      <div className="min-w-0 flex-1 basis-56">
        {eyebrow && <p className="mb-1 text-xs font-medium text-fg-subtle">{eyebrow}</p>}
        {title && <Title className="text-base font-semibold text-fg">{title}</Title>}
        {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function CardBody({ className, children }) {
  return <div className={cn('min-w-0 p-4 sm:p-5', className)}>{children}</div>
}

export function CardFooter({ className, children }) {
  return (
    <div className={cn('flex min-w-0 flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3 sm:px-5', className)}>
      {children}
    </div>
  )
}

export default Card
