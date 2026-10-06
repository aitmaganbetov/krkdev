import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { cn } from './cn'
import Icon from './Icon'

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

let lockCount = 0
function lockScroll() {
  if (lockCount++ === 0) {
    const sw = window.innerWidth - document.documentElement.clientWidth
    document.body.style.overflow = 'hidden'
    if (sw > 0) document.body.style.paddingRight = `${sw}px`
  }
}
function unlockScroll() {
  if (--lockCount === 0) {
    document.body.style.overflow = ''
    document.body.style.paddingRight = ''
  }
}

/** Общая механика слоя: портал, блокировка прокрутки, Esc, ловушка фокуса, возврат фокуса. */
function useLayer(open, onClose, panelRef, initialFocusRef, focusPanel = false) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    if (!open) return undefined
    const prev = document.activeElement
    lockScroll()
    const panel = panelRef.current
    const t = setTimeout(() => {
      const target = initialFocusRef?.current || panel?.querySelector('[data-autofocus]') || (focusPanel ? panel : panel?.querySelector(FOCUSABLE)) || panel
      target?.focus({ preventScroll: true })
    }, 0)
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current?.()
      } else if (e.key === 'Tab' && panel) {
        const items = [...panel.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null)
        if (!items.length) return
        const first = items[0]
        const last = items[items.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      document.removeEventListener('keydown', onKey)
      unlockScroll()
      if (prev && typeof prev.focus === 'function') prev.focus({ preventScroll: true })
    }
  }, [open, panelRef, initialFocusRef, focusPanel])
}

const MODAL_SIZES = { sm: 'sm:max-w-md', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl', full: 'sm:max-w-[min(96vw,90rem)]' }

/**
 * Модальное окно.
 * — ≥ 640px: по центру, max-height 90vh, шапка и футер зафиксированы, прокручивается только тело;
 * — < 640px: на весь экран.
 * Слой: z-modal (токен). Закрытие: Esc, клик по подложке (если dismissible), кнопка ×.
 */
export function Modal({ open, onClose, title, description, children, footer, size = 'md', dismissible = true,
  initialFocusRef, className, bodyClassName, closeLabel }) {
  const { t } = useTranslation()
  const panelRef = useRef(null)
  const titleId = useId()
  const descId = useId()
  useLayer(open, dismissible ? onClose : undefined, panelRef, initialFocusRef)
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-modal flex items-stretch justify-center sm:items-center sm:p-6">
      <div className="absolute inset-0 animate-fade-in bg-[rgb(6_18_31/0.55)]" onClick={dismissible ? onClose : undefined} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn(
          'relative flex w-full min-w-0 animate-scale-in flex-col bg-surface-raised shadow-3 outline-none',
          'h-full sm:h-auto sm:max-h-[90vh] sm:rounded-xl sm:border sm:border-line',
          MODAL_SIZES[size],
          className,
        )}
      >
        <div className="flex shrink-0 items-start gap-3 border-b border-line px-4 py-4 sm:px-6">
          <div className="min-w-0 flex-1">
            {title && <h2 id={titleId} className="text-lg font-semibold text-fg">{title}</h2>}
            {description && <p id={descId} className="mt-1 text-sm text-fg-muted">{description}</p>}
          </div>
          {dismissible && (
            <button type="button" onClick={onClose} aria-label={closeLabel || t('ui.close')} title={closeLabel || t('ui.close')}
              className="-mr-1 grid h-9 w-9 shrink-0 place-items-center rounded-md text-fg-subtle transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
              <Icon name="x" size={20} />
            </button>
          )}
        </div>
        <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5', bodyClassName)}>{children}</div>
        {footer && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3 sm:px-6">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

/** Боковая панель (меню на мобильном, детали). side: left | right. */
export function Drawer({ open, onClose, title, children, footer, side = 'right', width = 'w-[min(22rem,88vw)]',
  className, id, hideHeader = false, ariaLabel }) {
  const { t } = useTranslation()
  const panelRef = useRef(null)
  const titleId = useId()
  useLayer(open, onClose, panelRef, undefined, true)
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-drawer">
      <div className="absolute inset-0 animate-fade-in bg-[rgb(6_18_31/0.45)]" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title && !hideHeader ? titleId : undefined}
        aria-label={ariaLabel}
        tabIndex={-1}
        className={cn(
          'absolute inset-y-0 flex max-w-full flex-col bg-surface shadow-3 outline-none',
          side === 'left' ? 'left-0 animate-slide-in-left border-r border-line' : 'right-0 animate-slide-in-right border-l border-line',
          width,
          className,
        )}
      >
        {!hideHeader && (
          <div className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
            <h2 id={titleId} className="min-w-0 flex-1 truncate text-base font-semibold text-fg">{title}</h2>
            <button type="button" onClick={onClose} aria-label={t('ui.close')} title={t('ui.close')}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-fg-subtle hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
              <Icon name="x" size={20} />
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        {footer && <div className="shrink-0 border-t border-line p-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
