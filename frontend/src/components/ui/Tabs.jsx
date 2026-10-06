import { NavLink } from 'react-router-dom'
import { cn } from './cn'
import useScrollFade from './useScrollFade'
import Icon from './Icon'

const tabCls = (active) => cn(
  'relative inline-flex min-h-10 shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus',
  active ? 'text-primary after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-primary' : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
)

function Count({ value, active }) {
  if (value == null) return null
  return (
    <span className={cn('rounded-full px-1.5 text-xs tabular', active ? 'bg-primary-subtle text-primary-subtle-fg' : 'bg-surface-hover text-fg-subtle')}>
      {value}
    </span>
  )
}

/**
 * Вкладки (role=tablist, стрелки ←/→). Если не помещаются — прокручиваются горизонтально
 * с мягкими тенями по краям, а не обрезаются.
 */
export function Tabs({ items, value, onChange, className, ariaLabel }) {
  const listRef = useScrollFade()
  const onKeyDown = (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const idx = items.findIndex((i) => i.value === value)
    let next = idx
    if (e.key === 'ArrowRight') next = (idx + 1) % items.length
    if (e.key === 'ArrowLeft') next = (idx - 1 + items.length) % items.length
    if (e.key === 'Home') next = 0
    if (e.key === 'End') next = items.length - 1
    onChange(items[next].value)
    listRef.current?.querySelectorAll('[role=tab]')[next]?.focus()
  }
  return (
    <div className={cn('min-w-0 border-b border-line', className)}>
      <div ref={listRef} role="tablist" aria-label={ariaLabel} onKeyDown={onKeyDown}
        className="scroll-fade scrollbar-thin -mb-px flex min-w-0 gap-1 overflow-x-auto">
        {items.map((item) => {
          const active = item.value === value
          return (
            <button key={item.value} type="button" role="tab" aria-selected={active} tabIndex={active ? 0 : -1}
              onClick={() => onChange(item.value)} className={tabCls(active)}>
              {item.icon && <Icon name={item.icon} size={18} />}
              <span>{item.label}</span>
              <Count value={item.count} active={active} />
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Вкладки-ссылки для вложенных маршрутов. */
export function NavTabs({ items, className, ariaLabel }) {
  const listRef = useScrollFade()
  return (
    <nav aria-label={ariaLabel} className={cn('min-w-0 border-b border-line', className)}>
      <div ref={listRef} className="scroll-fade scrollbar-thin -mb-px flex min-w-0 gap-1 overflow-x-auto">
        {items.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => tabCls(isActive)}>
            {item.icon && <Icon name={item.icon} size={18} />}
            <span>{item.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  )
}

/** Сегментированный переключатель (язык, режим отображения). */
export function SegmentedControl({ options, value, onChange, ariaLabel, size = 'md', className }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel}
      className={cn('inline-flex min-w-0 max-w-full gap-0.5 rounded-md border border-line bg-surface-muted p-0.5', className)}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <button key={o.value} type="button" role="radio" aria-checked={active} onClick={() => onChange(o.value)}
            title={o.title}
            className={cn(
              'inline-flex min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 break-words rounded-[0.375rem] text-center font-medium leading-tight transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
              size === 'sm' ? 'min-h-8 min-w-8 px-2 text-xs' : 'min-h-9 min-w-9 px-3 text-sm',
              active ? 'bg-surface text-fg shadow-1' : 'text-fg-muted hover:text-fg',
            )}>
            {o.icon && <Icon name={o.icon} size={16} />}
            <span className="min-w-0 [overflow-wrap:anywhere]">{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}
