import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { cn } from './ui'

// Адрес страницы аудитории для QR на двери: тот же сайт, с которого распечатан код
export const roomScanUrl = (code) => `${window.location.origin}/room/${encodeURIComponent(code)}`

/** QR-код аудитории (PNG data URL, средняя коррекция ошибок — печать на двери переживает потёртости). */
export default function RoomQr({ code, size = 220, className, alt }) {
  const [src, setSrc] = useState('')

  useEffect(() => {
    let cancelled = false
    if (!code) return undefined
    QRCode.toDataURL(roomScanUrl(code), { errorCorrectionLevel: 'M', margin: 1, width: size * 2 })
      .then((url) => { if (!cancelled) setSrc(url) })
      .catch(() => { if (!cancelled) setSrc('') })
    return () => { cancelled = true }
  }, [code, size])

  return src
    ? <img src={src} alt={alt} width={size} height={size} className={cn('block bg-white', className)} />
    : <span aria-hidden="true" className={cn('block bg-surface-muted', className)} style={{ width: size, height: size }} />
}
