import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'

/** Совпадение медиазапроса с подпиской на изменения (первое значение — сразу, без мигания). */
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const onChange = () => setMatches(media.matches)
    onChange()
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [query])
  return matches
}

/** Идёт печать (Ctrl+P): состояние фиксируется синхронно, до того как браузер сверстает страницу для печати. */
export function usePrinting() {
  const [printing, setPrinting] = useState(false)
  useEffect(() => {
    const start = () => flushSync(() => setPrinting(true))
    const end = () => setPrinting(false)
    window.addEventListener('beforeprint', start)
    window.addEventListener('afterprint', end)
    return () => {
      window.removeEventListener('beforeprint', start)
      window.removeEventListener('afterprint', end)
    }
  }, [])
  return printing
}
