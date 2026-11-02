import { useEffect, useRef } from 'react'

/**
 * Периодический вызов, который не работает в скрытой вкладке (фоновые вкладки не опрашивают сервер и не
 * перерисовывают страницу). При возврате на вкладку вызов выполняется сразу, если подошёл срок,
 * или всегда — при immediateOnVisible.
 */
export function useVisibleInterval(callback, ms, { enabled = true, immediateOnVisible = false } = {}) {
  const saved = useRef(callback)
  useEffect(() => { saved.current = callback })

  useEffect(() => {
    if (!enabled) return undefined
    let timer = null
    let last = Date.now()
    const run = () => {
      last = Date.now()
      saved.current()
    }
    const schedule = (delay) => {
      clearTimeout(timer)
      timer = setTimeout(() => { run(); schedule(ms) }, delay)
    }
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') {
        clearTimeout(timer)
        return
      }
      const due = ms - (Date.now() - last)
      if (immediateOnVisible || due <= 0) {
        run()
        schedule(ms)
      } else {
        schedule(due)
      }
    }
    if (document.visibilityState === 'visible') schedule(ms)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [ms, enabled, immediateOnVisible])
}
