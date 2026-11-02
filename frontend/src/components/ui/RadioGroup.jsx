import { useId } from 'react'
import { cn } from './cn'
import Icon from './Icon'

/**
 * Группа радиокнопок-карточек (нативные input type="radio": клавиатура и экранные дикторы работают сами).
 * options: [{ value, label, description? }]. columns — колонок на широком экране (1–4 или 5 — шкала уровней).
 * Длинные подписи переносятся, ничего не обрезается.
 * requiredMark={false} — «*» рисует сам legend (например, сразу после заголовка, перед пояснением).
 */
export default function RadioGroup({
  legend, options, value, onChange, name, required, requiredMark = true, error, columns = 2, disabled, className,
}) {
  const autoName = useId()
  const groupName = name || autoName
  const errorId = error ? `${groupName}-error` : undefined
  const cols = { 1: '', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-2 lg:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4', 5: 'sm:grid-cols-2 xl:grid-cols-5' }[columns] ?? 'sm:grid-cols-2'
  return (
    <fieldset className={cn('min-w-0', className)} aria-describedby={errorId}>
      {legend && (
        <legend className="mb-2 flex min-w-0 gap-0.5 text-sm font-medium text-fg">
          <span className="min-w-0">{legend}</span>
          {required && requiredMark && <span className="shrink-0 text-danger" aria-hidden="true">*</span>}
        </legend>
      )}
      <div role="radiogroup" aria-required={required || undefined} aria-invalid={error ? true : undefined}
        className={cn('grid min-w-0 grid-cols-1 gap-2', cols)}>
        {options.map((option) => {
          const checked = value === option.value
          return (
            <label key={String(option.value)}
              className={cn(
                'flex min-h-11 min-w-0 cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm transition-colors',
                'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus',
                checked
                  ? 'border-primary bg-primary-subtle font-medium text-primary-subtle-fg'
                  : error ? 'border-danger bg-surface text-fg hover:bg-surface-hover' : 'border-line bg-surface text-fg hover:bg-surface-hover',
                disabled && 'cursor-not-allowed opacity-60',
              )}>
              <input type="radio" name={groupName} value={String(option.value)} checked={checked} disabled={disabled}
                onChange={() => onChange(option.value)}
                className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[rgb(var(--primary))] focus-visible:outline-none disabled:cursor-not-allowed" />
              <span className="min-w-0 break-words">
                {option.label}
                {option.description && <span className="mt-0.5 block text-xs font-normal text-fg-subtle">{option.description}</span>}
              </span>
            </label>
          )
        })}
      </div>
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-danger">
          <Icon name="alert-circle" size={14} className="mt-0.5" />
          <span className="min-w-0">{error}</span>
        </p>
      )}
    </fieldset>
  )
}
