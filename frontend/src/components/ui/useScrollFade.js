import { useEffect, useRef } from 'react'

// Помечает горизонтальный скролл-контейнер атрибутами data-fade-left/right, когда за краем есть содержимое
// (см. .scroll-fade в index.css). Возвращает ref для контейнера.
export default function useScrollFade() {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const update = () => {
      el.dataset.fadeLeft = String(el.scrollLeft > 1)
      el.dataset.fadeRight = String(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [])
  return ref
}
