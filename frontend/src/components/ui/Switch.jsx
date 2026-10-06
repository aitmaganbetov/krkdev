import { cn } from './cn'

/** Переключатель (role=switch). Зона нажатия ≥ 32px, подпись и описание переносятся. */
export default function Switch({ checked, onChange, label, description, disabled, className }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'inline-flex min-h-8 min-w-0 max-w-full cursor-pointer items-start gap-3 rounded-md py-1 text-left',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
    >
      <span aria-hidden="true" className={cn('relative mt-0.5 inline-flex h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-primary' : 'bg-line-strong')}>
        <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow-1 transition-transform', checked ? 'translate-x-[1.125rem]' : 'translate-x-0.5')} />
      </span>
      {(label || description) && (
        <span className="min-w-0">
          {label && <span className="block text-sm font-medium text-fg">{label}</span>}
          {description && <span className="mt-0.5 block text-xs text-fg-subtle">{description}</span>}
        </span>
      )}
    </button>
  )
}
