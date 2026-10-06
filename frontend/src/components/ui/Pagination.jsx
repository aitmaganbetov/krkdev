import { useTranslation } from 'react-i18next'
import { cn } from './cn'
import Icon from './Icon'

function pageList(page, count) {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1)
  const out = [1]
  const from = Math.max(2, page - 1)
  const to = Math.min(count - 1, page + 1)
  if (from > 2) out.push('…')
  for (let i = from; i <= to; i++) out.push(i)
  if (to < count - 1) out.push('…')
  out.push(count)
  return out
}

const btn = 'inline-flex h-9 min-w-9 shrink-0 cursor-pointer items-center justify-center rounded-md px-2 text-sm font-medium tabular transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-40'

/**
 * Пагинация. page — с 1. На узком экране номера страниц скрываются, остаются «назад/вперёд» и «N из M».
 */
export default function Pagination({ page, pageCount, onPageChange, total, pageSize, pageSizeOptions = [10, 20, 50, 100],
  onPageSizeChange, className }) {
  const { t } = useTranslation()
  const count = Math.max(1, pageCount || 1)
  const from = total ? (page - 1) * pageSize + 1 : 0
  const to = total ? Math.min(total, page * pageSize) : 0
  return (
    <div className={cn('flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-3', className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-sm text-fg-muted">
        {total != null && <span className="tabular">{t('ui.pagination.range', { from, to, total })}</span>}
        {onPageSizeChange && (
          <label className="inline-flex items-center gap-2">
            <span>{t('ui.pagination.perPage')}</span>
            <select value={pageSize} onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="input min-h-9 w-auto py-1 pl-2.5">
              {pageSizeOptions.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
      </div>
      <nav aria-label={t('ui.pagination.label')} className="flex items-center gap-1">
        <button type="button" className={cn(btn, 'text-fg-muted hover:bg-surface-hover hover:text-fg')}
          disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label={t('ui.pagination.prev')} title={t('ui.pagination.prev')}>
          <Icon name="chevron-left" size={18} />
        </button>
        <span className="px-2 text-sm text-fg-muted tabular sm:hidden">{t('ui.pagination.pageOf', { page, count })}</span>
        <div className="hidden items-center gap-1 sm:flex">
          {pageList(page, count).map((p, i) => p === '…' ? (
            <span key={`e${i}`} className="px-1 text-fg-subtle" aria-hidden="true">…</span>
          ) : (
            <button key={p} type="button" onClick={() => onPageChange(p)} aria-current={p === page ? 'page' : undefined}
              className={cn(btn, p === page ? 'bg-primary text-primary-on' : 'text-fg hover:bg-surface-hover')}>
              {p}
            </button>
          ))}
        </div>
        <button type="button" className={cn(btn, 'text-fg-muted hover:bg-surface-hover hover:text-fg')}
          disabled={page >= count} onClick={() => onPageChange(page + 1)} aria-label={t('ui.pagination.next')} title={t('ui.pagination.next')}>
          <Icon name="chevron-right" size={18} />
        </button>
      </nav>
    </div>
  )
}
