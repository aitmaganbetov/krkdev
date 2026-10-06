import { cloneElement, useCallback, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Подсказка при наведении и фокусе. Рисуется в портале с position:fixed и прижимается к краям
 * экрана, поэтому не обрезается контейнерами и не уходит за viewport. Слой: z-tooltip.
 */
export default function Tooltip({ content, children, placement = 'top', delay = 250 }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const anchor = useRef(null)
  const tip = useRef(null)
  const timer = useRef()
  const id = useId()

  const show = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(true), delay)
  }, [delay])
  const hide = useCallback(() => {
    clearTimeout(timer.current)
    setOpen(false)
  }, [])

  useLayoutEffect(() => {
    if (!open || !anchor.current || !tip.current) return
    const a = anchor.current.getBoundingClientRect()
    const t = tip.current.getBoundingClientRect()
    const gap = 8
    let top = placement === 'bottom' ? a.bottom + gap : a.top - t.height - gap
    if (top < 4) top = a.bottom + gap
    if (top + t.height > window.innerHeight - 4) top = a.top - t.height - gap
    let left = a.left + a.width / 2 - t.width / 2
    left = Math.max(8, Math.min(left, window.innerWidth - t.width - 8))
    setPos({ top, left })
  }, [open, placement, content])

  if (!content) return children
  const child = cloneElement(children, {
    ref: anchor,
    'aria-describedby': open ? id : undefined,
    onMouseEnter: (e) => { children.props.onMouseEnter?.(e); show() },
    onMouseLeave: (e) => { children.props.onMouseLeave?.(e); hide() },
    onFocus: (e) => { children.props.onFocus?.(e); show() },
    onBlur: (e) => { children.props.onBlur?.(e); hide() },
  })
  return (
    <>
      {child}
      {open && createPortal(
        <div
          ref={tip}
          id={id}
          role="tooltip"
          style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
          className="pointer-events-none fixed z-tooltip max-w-xs rounded-md bg-fg px-2.5 py-1.5 text-xs leading-snug text-canvas shadow-2"
        >
          {content}
        </div>,
        document.body,
      )}
    </>
  )
}

/** Текст в одну строку с многоточием; полный текст — в title (и для скринридеров остаётся целиком). */
export function TruncatedText({ children, className = '', as: Comp = 'span', lines = 1 }) {
  const text = typeof children === 'string' || typeof children === 'number' ? String(children) : undefined
  const clamp = lines > 1 ? { display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical', overflow: 'hidden' } : undefined
  return (
    <Comp title={text} style={clamp} className={`block min-w-0 ${lines > 1 ? '' : 'truncate'} ${className}`}>
      {children}
    </Comp>
  )
}
