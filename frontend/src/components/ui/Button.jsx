import { forwardRef } from 'react'
import { cn } from './cn'
import Icon from './Icon'
import Spinner from './Spinner'

const VARIANTS = {
  primary: 'border-transparent bg-primary text-primary-on hover:bg-primary-hover',
  secondary: 'border-line-strong bg-surface text-fg hover:bg-surface-hover',
  ghost: 'border-transparent bg-transparent text-fg-muted hover:bg-surface-hover hover:text-fg',
  danger: 'border-transparent bg-danger-solid text-danger-on hover:opacity-90',
  'danger-ghost': 'border-transparent bg-transparent text-danger hover:bg-danger-subtle',
  success: 'border-transparent bg-success-solid text-success-on hover:opacity-90',
  link: 'border-transparent bg-transparent px-0 text-accent underline-offset-4 hover:underline',
}

const SIZES = {
  sm: 'min-h-8 gap-1.5 px-3 py-1 text-sm',
  md: 'min-h-10 gap-2 px-4 py-2 text-sm',
  lg: 'min-h-12 gap-2 px-5 py-2.5 text-base',
}
const ICON_ONLY = { sm: 'h-8 w-8', md: 'h-10 w-10', lg: 'h-12 w-12' }
const ICON_SIZE = { sm: 16, md: 18, lg: 20 }

/**
 * Кнопка. Растёт под текст (нет фиксированной ширины), иконка и подпись разведены gap.
 * iconOnly — квадратная кнопка с иконкой; обязательно передавать aria-label (используется и как title).
 * as — другой элемент/компонент (например, Link из react-router).
 */
const Button = forwardRef(function Button(
  { as: Comp = 'button', variant = 'primary', size = 'md', icon, iconRight, iconOnly = false, loading = false,
    disabled, block = false, className, children, type, ...rest },
  ref,
) {
  const isButton = Comp === 'button'
  const iconSize = ICON_SIZE[size]
  return (
    <Comp
      ref={ref}
      type={isButton ? type || 'button' : undefined}
      disabled={isButton ? disabled || loading : undefined}
      aria-disabled={!isButton && disabled ? true : undefined}
      aria-busy={loading || undefined}
      title={iconOnly ? rest['aria-label'] : rest.title}
      className={cn(
        'inline-flex max-w-full shrink-0 cursor-pointer select-none items-center justify-center rounded-md border font-medium',
        'transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
        'disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
        VARIANTS[variant],
        iconOnly ? cn(ICON_ONLY[size], 'p-0') : SIZES[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={iconSize} /> : icon && <Icon name={icon} size={iconSize} />}
      {!iconOnly && children != null && <span className="min-w-0 break-words text-center leading-5">{children}</span>}
      {!iconOnly && iconRight && <Icon name={iconRight} size={iconSize} />}
    </Comp>
  )
})

export default Button
