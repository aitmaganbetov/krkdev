import { cloneElement, createContext, forwardRef, isValidElement, useContext, useEffect, useId, useLayoutEffect, useRef } from 'react'
import { cn } from './cn'
import Icon from './Icon'

const FieldContext = createContext(null)

/**
 * Поле формы: подпись над контролом, подсказка и ошибка под ним.
 * Связывает id/aria-describedby/aria-invalid автоматически с дочерним Input/Select/Textarea.
 */
export function Field({ label, hint, error, required, htmlFor, className, children, labelAction }) {
  const autoId = useId()
  const id = htmlFor || autoId
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined
  return (
    <FieldContext.Provider value={{ id, describedBy, invalid: !!error, required }}>
      <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
        {(label || labelAction) && (
          <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            {label && (
              <label htmlFor={id} className="min-w-0 text-sm font-medium text-fg">
                {label}
                {required && <span className="ml-0.5 text-danger" aria-hidden="true">*</span>}
              </label>
            )}
            {labelAction}
          </div>
        )}
        {children}
        {hint && !error && <p id={hintId} className="text-xs text-fg-subtle">{hint}</p>}
        {error && (
          <p id={errorId} role="alert" className="flex items-start gap-1.5 text-xs font-medium text-danger">
            <Icon name="alert-circle" size={14} className="mt-0.5" />
            <span className="min-w-0">{error}</span>
          </p>
        )}
      </div>
    </FieldContext.Provider>
  )
}

function useFieldProps(props) {
  const ctx = useContext(FieldContext)
  if (!ctx) return props
  return {
    ...props,
    id: props.id || ctx.id,
    'aria-describedby': props['aria-describedby'] || ctx.describedBy,
    'aria-invalid': props['aria-invalid'] ?? (ctx.invalid || undefined),
    required: props.required ?? ctx.required,
  }
}

const controlBase =
  'block w-full min-w-0 rounded-md border bg-surface text-sm text-fg transition-colors duration-150 ' +
  'placeholder:text-fg-subtle hover:border-fg-subtle ' +
  'focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-focus/25 ' +
  'disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-fg-subtle disabled:hover:border-line-strong ' +
  'aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/20'

const SIZE = { sm: 'min-h-8 px-2.5 py-1', md: 'min-h-10 px-3 py-2', lg: 'min-h-12 px-3.5 py-2.5 text-base' }

export const Input = forwardRef(function Input({ className, size = 'md', icon, ...props }, ref) {
  const p = useFieldProps(props)
  // Значение или плейсхолдер, не поместившиеся в поле, доступны в подсказке
  const hint = p.title ?? ((typeof p.value === 'string' && p.value) || (typeof p.placeholder === 'string' ? p.placeholder : undefined))
  const input = (
    <input
      ref={ref}
      title={hint}
      className={cn(controlBase, 'border-line-strong', SIZE[size], icon && 'pl-9', className)}
      {...p}
    />
  )
  if (!icon) return input
  return (
    <div className="relative min-w-0">
      <Icon name={icon} size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
      {input}
    </div>
  )
})

export const SearchInput = forwardRef(function SearchInput(props, ref) {
  return <Input ref={ref} type="search" icon="search" autoComplete="off" {...props} />
})

/** Многострочное поле. autoGrow — высота подстраивается под текст (ничего не обрезается). */
export const Textarea = forwardRef(function Textarea({ className, autoGrow = true, rows = 3, maxRows = 16, ...props }, ref) {
  const p = useFieldProps(props)
  const inner = useRef(null)
  const setRef = (node) => {
    inner.current = node
    if (typeof ref === 'function') ref(node)
    else if (ref) ref.current = node
  }
  const resize = () => {
    const el = inner.current
    if (!autoGrow || !el) return
    el.style.height = 'auto'
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 20
    const max = lh * maxRows + 24
    const capped = el.scrollHeight + 2 > max
    el.style.height = `${Math.min(el.scrollHeight + 2, max)}px`
    el.style.overflowY = capped ? 'auto' : 'hidden'
    el.dataset.capped = String(capped)
  }
  const resizeRef = useRef(resize)
  resizeRef.current = resize
  useLayoutEffect(resize)
  // Пересчёт после загрузки веб-шрифта и при изменении ширины поля — иначе высота устаревает и текст обрезается
  useEffect(() => {
    const el = inner.current
    if (!autoGrow || !el) return undefined
    let width = el.clientWidth
    const ro = new ResizeObserver(() => {
      if (el.clientWidth !== width) { width = el.clientWidth; resizeRef.current() }
    })
    ro.observe(el)
    document.fonts?.ready.then(() => resizeRef.current())
    return () => ro.disconnect()
  }, [autoGrow])
  return (
    <textarea
      ref={setRef}
      rows={rows}
      className={cn(controlBase, 'border-line-strong px-3 py-2 leading-relaxed', autoGrow ? 'resize-none' : 'resize-y', className)}
      {...p}
    />
  )
})

// Стрелка селекта — класс .select-chevron в index.css (светлая и тёмная тема)
const chevron = 'select-chevron'

/**
 * Нативный select (доступен с клавиатуры и на мобильных). options: [{value,label}] или children.
 * Длинное значение обрезается многоточием, полный текст — в title.
 */
export const Select = forwardRef(function Select({ className, size = 'md', options, placeholder, children, ...props }, ref) {
  const p = useFieldProps(props)
  const inner = useRef(null)
  const setRef = (node) => {
    inner.current = node
    if (typeof ref === 'function') ref(node)
    else if (ref) ref.current = node
  }
  // Полный текст выбранного пункта — в title (длинные названия в узком поле обрезаются многоточием)
  useLayoutEffect(() => {
    const el = inner.current
    if (el && !p.title) el.title = el.selectedOptions?.[0]?.text || ''
  })
  return (
    <select
      ref={setRef}
      title={p.title}
      className={cn(controlBase, 'cursor-pointer appearance-none truncate border-line-strong pr-9', chevron, SIZE[size], className)}
      {...p}
    >
      {placeholder != null && <option value="">{placeholder}</option>}
      {options
        ? options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))
        : children}
    </select>
  )
})

export const Checkbox = forwardRef(function Checkbox({ label, description, className, ...props }, ref) {
  const id = useId()
  const inputId = props.id || id
  return (
    <div className={cn('flex min-w-0 items-start gap-2.5', className)}>
      <input
        ref={ref}
        id={inputId}
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded-sm border-line-strong accent-[rgb(var(--primary))] focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed"
        {...props}
      />
      {(label || description) && (
        <label htmlFor={inputId} className="min-w-0 cursor-pointer text-sm text-fg">
          {label}
          {description && <span className="mt-0.5 block text-xs text-fg-subtle">{description}</span>}
        </label>
      )}
    </div>
  )
})

/** Обёртка, чтобы передать в Field произвольный контрол (например, сторонний). */
export function FieldControl({ children }) {
  const ctx = useContext(FieldContext)
  if (!ctx || !isValidElement(children)) return children
  return cloneElement(children, { id: children.props.id || ctx.id, 'aria-describedby': ctx.describedBy })
}
