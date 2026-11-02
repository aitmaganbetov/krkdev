import { Card, CardBody, CardHeader, EmptyState, Skeleton, cn } from '../ui'

// Общие элементы дашбордов модулей (записи КРК, взаимопосещение, ситуационный мониторинг).
// Категориальная палитра графиков (chart-1…6). Классы перечислены целиком, чтобы их увидел Tailwind.
export const CHART = [
  { bg: 'bg-chart-1', stroke: 'stroke-chart-1' },
  { bg: 'bg-chart-2', stroke: 'stroke-chart-2' },
  { bg: 'bg-chart-3', stroke: 'stroke-chart-3' },
  { bg: 'bg-chart-4', stroke: 'stroke-chart-4' },
  { bg: 'bg-chart-5', stroke: 'stroke-chart-5' },
  { bg: 'bg-chart-6', stroke: 'stroke-chart-6' },
]
// «Остальные» — нейтральный цвет вне палитры; хорошо/плохо — статусные цвета.
export const COLOR_OTHER = { bg: 'bg-line-strong', stroke: 'stroke-line-strong' }
export const COLOR_GOOD = { bg: 'bg-success', stroke: 'stroke-success' }
export const COLOR_BAD = { bg: 'bg-danger', stroke: 'stroke-danger' }

export const BAR_TONE = { success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger' }

export function formatPercent(value) {
  return `${value.toFixed(1)}%`
}

// Значение «8.9 / 10»: число крупно и без переноса, шкала — приглушённо (переносится, если не помещается).
export function ScoreValue({ value, outOf }) {
  return (
    <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-1">
      <span className="whitespace-nowrap">{value}</span>
      <span className="min-w-0 text-base font-medium text-fg-subtle [overflow-wrap:anywhere]">{outOf}</span>
    </span>
  )
}

// Полоса выполнения контрольного ориентира.
export function ProgressMetric({ label, value, display, target, tone }) {
  const width = Math.max(0, Math.min(100, value))
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-fg">{label}</p>
          <p className="mt-0.5 text-xs text-fg-subtle">{target}</p>
        </div>
        <span className="min-w-0 max-w-[50%] shrink-0 text-right text-lg font-semibold tabular text-fg">{display}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-hover" role="progressbar" aria-label={label}
        aria-valuenow={Math.round(value)} aria-valuemin="0" aria-valuemax="100">
        <div className={cn('h-full rounded-full', BAR_TONE[tone])} style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}

// Кольцевая диаграмма с легендой. Подписи легенды переносятся, значения — в одну строку.
export function DonutChart({ title, description, items, emptyText, totalLabel, locale }) {
  const size = 160
  const strokeWidth = 18
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const total = items.reduce((sum, item) => sum + Number(item.value || 0), 0)
  let offset = 0

  return (
    <Card>
      <CardHeader title={title} description={description} />
      {total > 0 ? (
        <CardBody className="grid gap-6 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
          {/* Подпись в центре кольца — через наложение ячеек грида, без абсолютного позиционирования */}
          <div className="mx-auto grid h-40 w-40 shrink-0 place-items-center">
            <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full -rotate-90 [grid-area:1/1]" aria-hidden="true">
              <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={strokeWidth} className="stroke-surface-hover" />
              {items.map((item) => {
                const value = Number(item.value || 0)
                const dash = (value / total) * circumference
                const currentOffset = offset
                offset += dash
                return (
                  <circle
                    key={item.label}
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    fill="none"
                    className={item.color.stroke}
                    strokeWidth={strokeWidth}
                    strokeDasharray={`${dash} ${circumference - dash}`}
                    strokeDashoffset={-currentOffset}
                  />
                )
              })}
            </svg>
            <div className="flex max-w-[6.5rem] flex-col items-center text-center [grid-area:1/1]">
              <span className="text-2xl font-semibold tabular text-fg">{total.toLocaleString(locale)}</span>
              <span className="max-w-full text-xs text-fg-subtle [overflow-wrap:anywhere]">{totalLabel}</span>
            </div>
          </div>
          <ul className="flex min-w-0 flex-col gap-3">
            {items.map((item) => (
              <li key={item.label} className="flex min-w-0 items-start gap-3">
                <span className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', item.color.bg)} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-start justify-between gap-3 text-sm">
                    <span className="min-w-0 text-fg">{item.label}</span>
                    <span className="shrink-0 whitespace-nowrap font-semibold tabular text-fg">{item.valueLabel}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-hover">
                    <div className={cn('h-full rounded-full', item.color.bg)} style={{ width: `${(item.value / total) * 100}%` }} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </CardBody>
      ) : (
        <EmptyState icon="chart" title={emptyText} compact />
      )}
    </Card>
  )
}

// Горизонтальные столбики рейтинга (один цвет: категории здесь не кодируются цветом).
export function BarChart({ title, description, items, emptyText }) {
  const maxValue = Math.max(...items.map((item) => Number(item.value || 0)), 0)
  return (
    <Card>
      <CardHeader title={title} description={description} />
      {items.length === 0 ? (
        <EmptyState icon="chart" title={emptyText} compact />
      ) : (
        <CardBody>
          <ul className="flex min-w-0 flex-col gap-4">
            {items.map((item) => (
              <li key={item.label} className="min-w-0">
                <div className="mb-1.5 flex min-w-0 items-start justify-between gap-3 text-sm">
                  <span className="min-w-0 text-fg">{item.label}</span>
                  <span className="shrink-0 whitespace-nowrap font-semibold tabular text-fg">{item.valueLabel}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-hover">
                  <div className="h-full rounded-full bg-chart-1" style={{ width: `${maxValue ? (item.value / maxValue) * 100 : 0}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </CardBody>
      )}
    </Card>
  )
}

// Плитка оперативной сводки.
export function SummaryTile({ label, value, note }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-md bg-surface-muted p-4">
      <p className="text-xs font-medium text-fg-subtle">{label}</p>
      <p className="text-base font-semibold text-fg">{value}</p>
      <p className="text-sm text-fg-muted">{note}</p>
    </div>
  )
}


// Заглушка на время первой загрузки дашборда модуля (шапка страницы уже отрисована оболочкой)
export function ModuleSkeleton({ label }) {
  return (
    <div role="status" aria-busy="true" className="flex min-w-0 flex-col gap-6">
      <span className="sr-only">{label}</span>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[1, 2, 3, 4].map((item) => <Skeleton key={item} className="h-32" rounded="rounded-lg" />)}
      </div>
      <Skeleton className="h-24" rounded="rounded-lg" />
      <Skeleton className="h-72" rounded="rounded-lg" />
    </div>
  )
}
