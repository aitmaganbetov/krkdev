import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { getNotifications, markAllNotificationsRead, markNotificationRead } from '../services/api'
import { Button, Icon, cn } from './ui'
import { formatDateTimeUtcPlus5 } from '../utils/datetime'
import { useVisibleInterval } from '../hooks/useVisibleInterval'

// Новые уведомления подтягиваются раз в минуту и при возвращении на вкладку
const POLL_MS = 60_000

/** Колокольчик в шапке: число непрочитанных и список последних уведомлений. */
export default function NotificationBell() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [data, setData] = useState({ unread: 0, items: [] })
  const [error, setError] = useState(false)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const btn = useRef(null)
  const panel = useRef(null)

  const load = useCallback(() => {
    getNotifications()
      .then((result) => { setData(result); setError(false) })
      .catch(() => setError(true))
  }, [])

  useEffect(() => { load() }, [load])
  // В скрытой вкладке опрос не идёт; при возврате на вкладку — сразу свежие уведомления
  useVisibleInterval(load, POLL_MS, { immediateOnVisible: true })

  // Панель в портале, прижата к правому краю кнопки и не выходит за экран
  useLayoutEffect(() => {
    if (!open || !btn.current || !panel.current) return
    const a = btn.current.getBoundingClientRect()
    const p = panel.current.getBoundingClientRect()
    setPos({ top: a.bottom + 6, left: Math.max(8, Math.min(a.right - p.width, window.innerWidth - p.width - 8)) })
  }, [open, data])

  useEffect(() => {
    if (!open) return undefined
    load()
    const close = () => setOpen(false)
    const onDown = (e) => {
      if (!panel.current?.contains(e.target) && !btn.current?.contains(e.target)) close()
    }
    const onKey = (e) => { if (e.key === 'Escape') { close(); btn.current?.focus() } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
    }
  }, [open, load])

  const openItem = (item) => {
    setOpen(false)
    if (!item.read_at) {
      setData((d) => ({
        unread: Math.max(0, d.unread - 1),
        items: d.items.map((i) => (i.id === item.id ? { ...i, read_at: new Date().toISOString() } : i)),
      }))
      markNotificationRead(item.id).catch(() => {})
    }
    if (item.link) navigate(item.link)
  }

  const markAll = async () => {
    try {
      await markAllNotificationsRead()
      load()
    } catch { /* список обновится при следующем опросе */ }
  }

  const label = data.unread ? t('notifications.openUnread', { count: data.unread }) : t('notifications.open')

  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <Icon name="bell" size={20} />
        {data.unread > 0 && (
          <span aria-hidden="true"
            className="absolute right-1 top-1 grid min-h-[1.125rem] min-w-[1.125rem] place-items-center rounded-full bg-danger-solid px-1 text-[0.6875rem] font-semibold leading-none text-white tabular">
            {data.unread > 99 ? '99+' : data.unread}
          </span>
        )}
      </button>
      {open && createPortal(
        <div ref={panel} role="dialog" aria-label={t('notifications.title')}
          style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
          className="fixed z-popover flex max-h-[min(28rem,calc(100vh-5rem))] w-[min(24rem,calc(100vw-1rem))] animate-scale-in flex-col rounded-lg border border-line bg-surface-raised shadow-3">
          <div className="flex min-w-0 items-center justify-between gap-2 border-b border-line px-4 py-2.5">
            <p className="text-sm font-semibold text-fg">{t('notifications.title')}</p>
            {data.unread > 0 && (
              <Button variant="ghost" size="sm" onClick={markAll}>{t('notifications.markAll')}</Button>
            )}
          </div>
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-1">
            {error && !data.items.length && <p className="px-3 py-6 text-center text-sm text-danger">{t('notifications.loadError')}</p>}
            {!error && !data.items.length && <p className="px-3 py-6 text-center text-sm text-fg-subtle">{t('notifications.empty')}</p>}
            {data.items.map((item) => (
              <button key={item.id} type="button" onClick={() => openItem(item)}
                className="flex w-full min-w-0 cursor-pointer gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none">
                <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', item.read_at ? 'bg-transparent' : 'bg-primary')} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className={cn('block text-sm text-fg', !item.read_at && 'font-semibold')}>{item.title}</span>
                  {item.body && <span className="mt-0.5 block text-xs text-fg-muted">{item.body}</span>}
                  <span className="mt-1 block text-xs text-fg-subtle tabular">{formatDateTimeUtcPlus5(item.created_at)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
