import { cn } from './cn'

export default function Spinner({ size = 20, className, label }) {
  return (
    <svg
      className={cn('shrink-0 animate-spin', className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21.5 12A9.5 9.5 0 0 0 12 2.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

// Индикатор загрузки целой области (страницы, карточки).
export function LoadingBlock({ label, className }) {
  return (
    <div className={cn('flex min-h-40 flex-col items-center justify-center gap-3 p-8 text-fg-muted', className)}>
      <Spinner size={28} className="text-primary" />
      {label && <p className="text-sm">{label}</p>}
    </div>
  )
}
