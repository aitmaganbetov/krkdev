import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { cn } from './cn'
import Icon from './Icon'
import Button from './Button'
import { Modal } from './Overlay'

const UIContext = createContext(null)

const TOAST = {
  success: { icon: 'check-circle', cls: 'text-success' },
  danger: { icon: 'alert-circle', cls: 'text-danger' },
  warning: { icon: 'alert', cls: 'text-warning' },
  info: { icon: 'info', cls: 'text-info' },
}

/**
 * Провайдер уведомлений (toast) и диалога подтверждения.
 *   const { toast, confirm } = useUI()
 *   toast.success('Сохранено')
 *   if (!(await confirm({ title, message, confirmLabel, tone: 'danger' }))) return
 */
export function UIProvider({ children }) {
  const { t } = useTranslation()
  const [toasts, setToasts] = useState([])
  const [dialog, setDialog] = useState(null)
  const seq = useRef(0)

  const dismiss = useCallback((id) => setToasts((list) => list.filter((x) => x.id !== id)), [])

  const push = useCallback((tone, message, opts = {}) => {
    const id = ++seq.current
    setToasts((list) => [...list.slice(-4), { id, tone, message, title: opts.title }])
    const ttl = opts.duration ?? (tone === 'danger' ? 8000 : 4500)
    if (ttl > 0) setTimeout(() => dismiss(id), ttl)
    return id
  }, [dismiss])

  const toast = useMemo(() => ({
    success: (m, o) => push('success', m, o),
    error: (m, o) => push('danger', m, o),
    warning: (m, o) => push('warning', m, o),
    info: (m, o) => push('info', m, o),
    dismiss,
  }), [push, dismiss])

  const confirm = useCallback((opts) => new Promise((resolve) => {
    setDialog({ ...(typeof opts === 'string' ? { message: opts } : opts), resolve })
  }), [])

  const close = (result) => {
    dialog?.resolve(result)
    setDialog(null)
  }

  return (
    <UIContext.Provider value={{ toast, confirm }}>
      {children}
      <Modal
        open={!!dialog}
        onClose={() => close(false)}
        size="sm"
        title={dialog?.title || t('ui.confirmTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => close(false)}>{dialog?.cancelLabel || t('ui.cancel')}</Button>
            <Button variant={dialog?.tone === 'danger' ? 'danger' : 'primary'} onClick={() => close(true)} data-autofocus>
              {dialog?.confirmLabel || t('ui.confirm')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-fg-muted">{dialog?.message}</p>
      </Modal>
      {createPortal(
        <div aria-live="polite" aria-atomic="false"
          className="pointer-events-none fixed inset-x-0 bottom-0 z-toast flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:items-end">
          {toasts.map((x) => (
            <div key={x.id} role={x.tone === 'danger' ? 'alert' : 'status'}
              className="pointer-events-auto flex w-full min-w-0 max-w-sm animate-scale-in items-start gap-3 rounded-lg border border-line bg-surface-raised px-4 py-3 text-sm shadow-3">
              <Icon name={TOAST[x.tone].icon} size={18} className={cn('mt-0.5', TOAST[x.tone].cls)} />
              <div className="min-w-0 flex-1">
                {x.title && <p className="font-semibold text-fg">{x.title}</p>}
                <p className="text-fg-muted">{x.message}</p>
              </div>
              <button type="button" onClick={() => dismiss(x.id)} aria-label={t('ui.close')} title={t('ui.close')}
                className="-m-1 rounded-md p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
                <Icon name="x" size={16} />
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </UIContext.Provider>
  )
}

export function useUI() {
  const ctx = useContext(UIContext)
  if (!ctx) throw new Error('useUI must be used inside UIProvider')
  return ctx
}
