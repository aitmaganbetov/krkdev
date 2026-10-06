import wordmarkUrl from '../../assets/brand/sapa-wordmark.png'

// Фирменные цвета Sapa (логотип: Ректорлық бақылау жүйесі · КазУТБ)
export const BRAND = { navy: '#12304F', teal: '#0090B0', gold: '#E0A800' }

const WORDMARK_RATIO = 602 / 186

// Значок: лупа со столбиками. onDark — белые столбики и ручка для тёмного фона;
// без него значок сам переключается на белый в тёмной теме.
export function SapaMark({ size = 40, onDark = false, className = '', title }) {
  const ink = onDark ? 'fill-white' : 'fill-[#12304F] dark:fill-white'
  const inkStroke = onDark ? 'stroke-white' : 'stroke-[#12304F] dark:stroke-white'
  return (
    <svg
      viewBox="0 0 170 170"
      width={size}
      height={size}
      className={`shrink-0 ${className}`}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <circle cx="67.5" cy="67.5" r="58.6" fill="none" stroke={BRAND.teal} strokeWidth="18" />
      <rect className={ink} x="42" y="80" width="12" height="20.5" rx="4" />
      <rect className={ink} x="62" y="66" width="12" height="34.5" rx="4" />
      <rect x="82" y="47" width="12" height="53.5" rx="4" fill={BRAND.gold} />
      <line className={inkStroke} x1="125" y1="125" x2="158.5" y2="158.5" strokeWidth="21" strokeLinecap="round" />
    </svg>
  )
}

// Надпись «Sapa» — маска из фирменного макета, цвет берётся из currentColor.
export function SapaWordmark({ height = 28, className = '' }) {
  const mask = `url(${wordmarkUrl}) left center / contain no-repeat`
  return (
    <span
      role="img"
      aria-label="Sapa"
      className={`inline-block shrink-0 bg-current ${className}`}
      style={{ height, width: Math.round(height * WORDMARK_RATIO), WebkitMask: mask, mask }}
    />
  )
}

// Значок + надпись. Цвет надписи задаётся классом text-* у родителя или через className.
export function SapaLogo({ height = 32, onDark = false, className = '' }) {
  return (
    <span className={`inline-flex items-center ${className}`} style={{ gap: height * 0.38 }}>
      <SapaMark size={height * 1.18} onDark={onDark} />
      <SapaWordmark height={height} className={onDark ? 'text-white' : 'text-[#12304F] dark:text-white'} />
    </span>
  )
}
