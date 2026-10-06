import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from './cn'
import Icon from './Icon'

/**
 * Выпадающее меню. Рисуется в портале с position:fixed, прижимается к краям экрана (не уходит за viewport,
 * не обрезается overflow родителя). Слой: z-popover. Закрытие: Esc, клик вне, выбор пункта.
 * items: [{ label, icon, onClick, tone: 'danger', disabled }] | { divider: true }
 */
export default function Menu({ trigger, items, align = 'end', header, className }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const btn = useRef(null)
  const panel = useRef(null)
  const id = useId()

  useLayoutEffect(() => {
    if (!open || !btn.current || !panel.current) return
    const a = btn.current.getBoundingClientRect()
    const p = panel.current.getBoundingClientRect()
    let left = align === 'end' ? a.right - p.width : a.left
    left = Math.max(8, Math.min(left, window.innerWidth - p.width - 8))
    let top = a.bottom + 6
    if (top + p.height > window.innerHeight - 8) top = Math.max(8, a.top - p.height - 6)
    setPos({ top, left })
  }, [open, align])

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      if (!panel.current?.contains(e.target) && !btn.current?.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') { setOpen(false); btn.current?.focus() }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const list = [...(panel.current?.querySelectorAll('[role=menuitem]:not([disabled])') || [])]
        const i = list.indexOf(document.activeElement)
        const next = e.key === 'ArrowDown' ? (i + 1) % list.length : (i - 1 + list.length) % list.length
        list[next]?.focus()
      }
    }
    const onScroll = () => setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onScroll)
    setTimeout(() => panel.current?.querySelector('[role=menuitem]')?.focus(), 0)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onScroll)
    }
  }, [open])

  return (
    <>
      {trigger({ ref: btn, open, onClick: () => setOpen((v) => !v), 'aria-haspopup': 'menu', 'aria-expanded': open, 'aria-controls': open ? id : undefined })}
      {open && createPortal(
        <div ref={panel} id={id} role="menu" style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
          className={cn('fixed z-popover min-w-[12rem] max-w-[min(20rem,calc(100vw-1rem))] animate-scale-in rounded-lg border border-line bg-surface-raised p-1 shadow-3', className)}>
          {header && <div className="border-b border-line px-3 pb-2 pt-1.5">{header}</div>}
          {items.map((it, i) => it.divider ? (
            <div key={`d${i}`} className="my-1 h-px bg-line" role="separator" />
          ) : (
            <button key={it.label} type="button" role="menuitem" disabled={it.disabled}
              onClick={() => { setOpen(false); it.onClick?.() }}
              className={cn(
                'flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none',
                'disabled:cursor-not-allowed disabled:opacity-50',
                it.tone === 'danger' ? 'text-danger hover:bg-danger-subtle focus-visible:bg-danger-subtle' : 'text-fg hover:bg-surface-hover focus-visible:bg-surface-hover',
              )}>
              {it.icon && <Icon name={it.icon} size={18} />}
              <span className="min-w-0 flex-1">{it.label}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
