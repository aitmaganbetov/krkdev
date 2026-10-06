import { cn } from './cn'
import { EmptyState, Skeleton } from './Feedback'

const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' }

/**
 * Таблица данных.
 * columns: [{ key, header, cell?: (row, i) => node, align?, className?, headerClassName?, headerProps?, minWidth?,
 *             nowrap?, mobile?: 'title' | 'hidden' | 'full' }]
 * — ≥ md: таблица в собственном контейнере с горизонтальным скроллом, липкая шапка, первая колонка закреплена.
 * — < md: каждая строка — карточка: колонка с mobile:'title' (или первая) — заголовок, остальные — «подпись: значение».
 */
export default function DataTable({
  columns, rows, rowKey = 'id', onRowClick, loading = false, skeletonRows = 5, empty, caption,
  stickyFirst = true, maxHeight, className, rowClassName, mobileCards = true,
}) {
  const keyOf = (row, i) => (typeof rowKey === 'function' ? rowKey(row, i) : row?.[rowKey] ?? i)
  const render = (col, row, i) => (col.cell ? col.cell(row, i) : row?.[col.key] ?? '—')
  const titleCol = columns.find((c) => c.mobile === 'title') || columns[0]
  const isEmpty = !loading && (!rows || rows.length === 0)
  const clickable = !!onRowClick
  const onKey = (e, row) => {
    if (clickable && (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
      e.preventDefault()
      onRowClick(row)
    }
  }

  return (
    <div className={cn('min-w-0', className)}>
      {/* Таблица */}
      <div className={cn('scrollbar-thin min-w-0 overflow-auto', mobileCards && 'hidden md:block')} style={maxHeight ? { maxHeight } : undefined}>
        <table className="w-full border-separate border-spacing-0 text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr>
              {columns.map((col, ci) => (
                <th key={col.key} scope="col" style={col.minWidth ? { minWidth: col.minWidth } : undefined} {...col.headerProps}
                  className={cn(
                    'sticky top-0 z-sticky border-b border-line bg-surface-muted px-4 py-2.5 text-xs font-semibold text-fg-muted',
                    ALIGN[col.align || 'left'],
                    ci === 0 && stickyFirst && 'left-0 z-[calc(var(--z-sticky)_+_1)]',
                    col.headerClassName,
                  )}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && Array.from({ length: skeletonRows }, (_, r) => (
              <tr key={`s${r}`}>
                {columns.map((col) => (
                  <td key={col.key} className="border-b border-line px-4 py-3"><Skeleton className="h-4 w-3/4" /></td>
                ))}
              </tr>
            ))}
            {!loading && rows?.map((row, i) => (
              <tr key={keyOf(row, i)}
                onClick={clickable ? () => onRowClick(row) : undefined}
                onKeyDown={clickable ? (e) => onKey(e, row) : undefined}
                tabIndex={clickable ? 0 : undefined}
                className={cn('group', clickable && 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus', rowClassName?.(row))}>
                {columns.map((col, ci) => (
                  <td key={col.key} style={col.minWidth ? { minWidth: col.minWidth } : undefined}
                    className={cn(
                      'border-b border-line bg-surface px-4 py-3 align-middle text-fg transition-colors group-hover:bg-surface-hover',
                      ALIGN[col.align || 'left'],
                      col.nowrap && 'whitespace-nowrap',
                      ci === 0 && stickyFirst && 'sticky left-0 z-sticky',
                      col.className,
                    )}>
                    {render(col, row, i)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {isEmpty && (empty ?? <EmptyState compact />)}
      </div>

      {/* Карточки на мобильном */}
      {mobileCards && (
        <div className="md:hidden">
          {loading && Array.from({ length: 3 }, (_, r) => (
            <div key={r} className="space-y-2 border-b border-line p-4"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-3 w-3/4" /></div>
          ))}
          {!loading && rows?.length > 0 && (
            <ul className="divide-y divide-line">
              {rows.map((row, i) => (
                <li key={keyOf(row, i)}>
                  <div
                    onClick={clickable ? () => onRowClick(row) : undefined}
                    onKeyDown={clickable ? (e) => onKey(e, row) : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    role={clickable ? 'button' : undefined}
                    className={cn('min-w-0 px-4 py-3', clickable && 'cursor-pointer hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus')}>
                    <div className="min-w-0 font-medium text-fg">{render(titleCol, row, i)}</div>
                    <dl className="mt-2 grid min-w-0 grid-cols-[fit-content(40%)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
                      {columns.filter((c) => c !== titleCol && c.mobile !== 'hidden').map((col) => (
                        col.mobile === 'full' ? (
                          <dd key={col.key} className="col-span-2 min-w-0 pt-1">{render(col, row, i)}</dd>
                        ) : (
                          <div key={col.key} className="contents">
                            <dt className="min-w-0 text-fg-subtle [overflow-wrap:anywhere]">{col.mobileLabel ?? col.header}</dt>
                            <dd className="min-w-0 text-fg">{render(col, row, i)}</dd>
                          </div>
                        )
                      ))}
                    </dl>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {isEmpty && (empty ?? <EmptyState compact />)}
        </div>
      )}
    </div>
  )
}
