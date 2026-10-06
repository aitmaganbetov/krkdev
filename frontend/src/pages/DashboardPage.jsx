import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getAcademicYears, getDashboardFacultyComparison, getDashboardStats, getRecordFilterOptions } from '../services/api'
import { intlLocale } from '../utils/locale'
import {
  Alert, Badge, Button, Card, CardBody, CardHeader, DataTable, EmptyState, Field, FilterBar, Icon,
  PageHeader, PageStack, Select, Skeleton, Spinner, StatCard, cn,
} from '../components/ui'

// Категориальная палитра графиков (chart-1…6). Классы перечислены целиком, чтобы их увидел Tailwind.
const CHART = [
  { bg: 'bg-chart-1', stroke: 'stroke-chart-1' },
  { bg: 'bg-chart-2', stroke: 'stroke-chart-2' },
  { bg: 'bg-chart-3', stroke: 'stroke-chart-3' },
  { bg: 'bg-chart-4', stroke: 'stroke-chart-4' },
  { bg: 'bg-chart-5', stroke: 'stroke-chart-5' },
  { bg: 'bg-chart-6', stroke: 'stroke-chart-6' },
]
// «Остальные» — нейтральный цвет вне палитры; хорошо/плохо — статусные цвета.
const COLOR_OTHER = { bg: 'bg-line-strong', stroke: 'stroke-line-strong' }
const COLOR_GOOD = { bg: 'bg-success', stroke: 'stroke-success' }
const COLOR_BAD = { bg: 'bg-danger', stroke: 'stroke-danger' }

const BAR_TONE = { success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger' }

function formatPercent(value) {
  return `${value.toFixed(1)}%`
}

// Значение «8.9 / 10»: число крупно и без переноса, шкала — приглушённо (переносится, если не помещается).
function ScoreValue({ value, outOf }) {
  return (
    <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-1">
      <span className="whitespace-nowrap">{value}</span>
      <span className="min-w-0 text-base font-medium text-fg-subtle [overflow-wrap:anywhere]">{outOf}</span>
    </span>
  )
}

// Полоса выполнения контрольного ориентира.
function ProgressMetric({ label, value, display, target, tone }) {
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
function DonutChart({ title, description, items, emptyText, totalLabel, locale }) {
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
function BarChart({ title, description, items, emptyText }) {
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
function SummaryTile({ label, value, note }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-md bg-surface-muted p-4">
      <p className="text-xs font-medium text-fg-subtle">{label}</p>
      <p className="text-base font-semibold text-fg">{value}</p>
      <p className="text-sm text-fg-muted">{note}</p>
    </div>
  )
}

function DashboardSkeleton({ label }) {
  return (
    <PageStack>
      <div role="status" aria-busy="true" className="flex min-w-0 flex-col gap-6">
        <span className="sr-only">{label}</span>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-full max-w-md" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((item) => <Skeleton key={item} className="h-32" rounded="rounded-lg" />)}
        </div>
        <Skeleton className="h-24" rounded="rounded-lg" />
        <Skeleton className="h-72" rounded="rounded-lg" />
      </div>
    </PageStack>
  )
}

export default function DashboardPage() {
  const { t, i18n } = useTranslation()
  const [stats, setStats] = useState(null)
  const [filterOptions, setFilterOptions] = useState({ faculties: [], ops: [] })
  const [comparison, setComparison] = useState([])
  const [selectedFaculty, setSelectedFaculty] = useState('')
  const [selectedOp, setSelectedOp] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retryKey, setRetryKey] = useState(0)
  // Учебный год: '' — все годы; null — ещё не определён (ждём справочник, чтобы не грузить данные дважды)
  const [years, setYears] = useState([])
  const [selectedYear, setSelectedYear] = useState(null)

  // Для форматирования дат и чисел: в Intl казахский язык — 'kk'
  const locale = intlLocale(i18n.language)

  // По умолчанию — текущий учебный год по дате (новый начинается 1 сентября), как на сервере
  useEffect(() => {
    getAcademicYears()
      .then((data) => {
        const list = data || []
        setYears(list)
        const now = new Date()
        const start = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1
        const current = `${start}-${start + 1}`
        const fallback = list.find((item) => item.is_default)?.name
        setSelectedYear(list.some((item) => item.name === current) ? current : (fallback || ''))
      })
      .catch(() => setSelectedYear(''))
  }, [])

  useEffect(() => {
    if (selectedYear === null) return
    getRecordFilterOptions({ academic_year: selectedYear || undefined })
      .then((data) => setFilterOptions(data || { faculties: [], ops: [] }))
      .catch(() => setFilterOptions({ faculties: [], ops: [] }))
  }, [selectedYear])

  useEffect(() => {
    if (selectedYear === null) return
    setLoading(true)
    setError('')
    const params = { faculty: selectedFaculty || undefined, op: selectedOp || undefined, academic_year: selectedYear || undefined }
    Promise.all([
      getDashboardStats(params),
      getDashboardFacultyComparison(params),
    ])
      .then(([statsData, comparisonData]) => {
        setStats(statsData)
        setComparison(comparisonData || [])
      })
      .catch(() => setError(t('dashboard.loadError')))
      .finally(() => setLoading(false))
  }, [selectedFaculty, selectedOp, selectedYear, retryKey, t])

  const facultyOptions = useMemo(() => filterOptions?.faculties || [], [filterOptions])
  const opOptions = useMemo(() => {
    if (!selectedFaculty) return (filterOptions?.ops || []).map((name) => ({ id: name, name }))
    const target = facultyOptions.find((faculty) => faculty.name === selectedFaculty)
    return (target?.ops || []).map((name) => ({ id: name, name }))
  }, [facultyOptions, filterOptions, selectedFaculty])

  const comparisonTitle = selectedOp
    ? t('dashboard.compareByGroup')
    : selectedFaculty
      ? t('dashboard.compareByOp')
      : t('dashboard.compareByFaculty')

  const sortedComparison = useMemo(
    () => [...comparison].sort((a, b) => Number(b.avg_score || 0) - Number(a.avg_score || 0)),
    [comparison],
  )

  const score = Number(stats?.avg_score || 0)
  const attendance = Number(stats?.avg_attendance || 0)
  const problems = Number(stats?.problem_records || 0)
  const total = Number(stats?.total_records || 0)
  const problemShare = total ? (problems / total) * 100 : 0
  // Нет записей за выбранный период — показатели не считаются (а не «0 / ниже нормы»)
  const empty = !loading && total === 0
  const cleanShare = Math.max(0, 100 - problemShare)

  const recordsPieItems = useMemo(() => {
    if (sortedComparison.length === 0) return []
    const topByRecords = [...sortedComparison]
      .sort((a, b) => Number(b.total_records || 0) - Number(a.total_records || 0))
      .slice(0, 6)
    const visibleTotal = topByRecords.reduce((sum, item) => sum + Number(item.total_records || 0), 0)
    const other = Math.max(0, total - visibleTotal)
    return [
      ...topByRecords.map((item, index) => {
        const value = Number(item.total_records || 0)
        return {
          label: item.label,
          value,
          valueLabel: `${value.toLocaleString(locale)} (${formatPercent(total ? (value / total) * 100 : 0)})`,
          color: CHART[index % CHART.length],
        }
      }),
      ...(other > 0
        ? [{
            label: t('dash.distribution.other'),
            value: other,
            valueLabel: `${other.toLocaleString(locale)} (${formatPercent(total ? (other / total) * 100 : 0)})`,
            color: COLOR_OTHER,
          }]
        : []),
    ]
  }, [locale, sortedComparison, total, t])

  const issuePieItems = useMemo(() => ([
    { label: t('dash.quality.normal'), value: cleanShare, valueLabel: formatPercent(cleanShare), color: COLOR_GOOD },
    { label: t('dash.quality.problem'), value: problemShare, valueLabel: formatPercent(problemShare), color: COLOR_BAD },
  ]), [cleanShare, problemShare, t])

  const scoreBarItems = useMemo(() => sortedComparison.slice(0, 8).map((item) => ({
    label: item.label,
    value: Number(item.avg_score || 0),
    valueLabel: `${Number(item.avg_score || 0).toFixed(1)} ${t('dash.outOf10')}`,
  })), [sortedComparison, t])

  const hasFilters = Boolean(selectedFaculty || selectedOp)
  const formattedDate = new Intl.DateTimeFormat(locale || 'ru', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(new Date())

  const currentYearName = (() => {
    const now = new Date()
    const start = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1
    return `${start}-${start + 1}`
  })()

  const resetFilters = () => {
    setSelectedFaculty('')
    setSelectedOp('')
  }

  const bestItem = sortedComparison[0]
  const attentionItem = sortedComparison.find((item) => Number(item.problem_records || 0) > 0)

  const comparisonColumns = [
    {
      key: 'label',
      header: t('dash.compare.colUnit'),
      mobile: 'title',
      minWidth: '16rem',
      cell: (item, index) => (
        <div className="flex min-w-0 items-start gap-3">
          <span className="w-6 shrink-0 text-right text-fg-subtle tabular">{index + 1}</span>
          <span className="min-w-0 font-medium text-fg">{item.label}</span>
        </div>
      ),
    },
    {
      key: 'avg_score',
      header: (
        <span className="inline-flex items-center gap-1">
          {t('dash.compare.colScore')}
          <Icon name="arrow-down" size={14} />
          <span className="sr-only">{t('dash.compare.sortedDesc')}</span>
        </span>
      ),
      mobileLabel: t('dash.compare.colScore'),
      minWidth: '10rem',
      cell: (item) => {
        const itemScore = Number(item.avg_score || 0)
        return (
          <div className="flex min-w-0 items-center gap-3">
            <span className={cn('w-8 shrink-0 font-semibold tabular', itemScore >= 7 ? 'text-success' : 'text-warning')}>
              {itemScore.toFixed(1)}
            </span>
            <div className="h-1.5 min-w-12 flex-1 overflow-hidden rounded-full bg-surface-hover">
              <div className="h-full rounded-full bg-chart-1" style={{ width: `${Math.min(100, itemScore * 10)}%` }} />
            </div>
          </div>
        )
      },
    },
    {
      key: 'avg_attendance',
      header: t('dash.compare.colAttendance'),
      align: 'right',
      nowrap: true,
      cell: (item) => <span className="tabular">{Number(item.avg_attendance || 0).toFixed(1)}%</span>,
    },
    {
      key: 'problem_records',
      header: t('dash.compare.colProblems'),
      align: 'right',
      nowrap: true,
      cell: (item) => {
        const count = Number(item.problem_records || 0)
        return <Badge tone={count > 0 ? 'danger' : 'success'} className="tabular">{count}</Badge>
      },
    },
  ]

  if (!stats && loading) return <DashboardSkeleton label={t('dash.loading')} />

  return (
    <PageStack>
      <PageHeader
        title={t('dashboard.title')}
        description={t('dash.description')}
        actions={
          <Field label={t('dash.year.label')} className="w-full sm:w-56">
            <Select
              value={selectedYear ?? ''}
              onChange={(event) => { setSelectedYear(event.target.value); setSelectedFaculty(''); setSelectedOp('') }}
              placeholder={t('dash.year.all')}
              options={years.map((item) => ({
                value: item.name,
                label: item.name === currentYearName ? `${item.name} · ${t('dash.year.current')}` : item.name,
              }))}
            />
          </Field>
        }
      >
        <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-sm text-fg-muted">
          <span className="inline-flex items-center gap-1.5">
            <Icon name="calendar" size={16} className="text-fg-subtle" />
            {t('dash.asOf', { date: formattedDate })}
          </span>
          <Badge tone="primary" icon="calendar">
            {selectedYear ? t('dash.year.badge', { year: selectedYear }) : t('dash.year.all')}
          </Badge>
          <Badge tone={hasFilters ? 'info' : 'neutral'} dot>
            {hasFilters ? t('dash.scopeFiltered') : t('dash.scopeAll')}
          </Badge>
        </div>
      </PageHeader>

      {error && (
        <Alert
          tone="danger"
          action={<Button variant="secondary" size="sm" icon="refresh" onClick={() => setRetryKey((value) => value + 1)}>{t('ui.retry')}</Button>}
        >
          {error}
        </Alert>
      )}

      {stats && (
        <>
          <section
            aria-label={t('dash.kpiLabel')}
            aria-busy={loading}
            className={cn('grid grid-cols-1 gap-4 transition-opacity sm:grid-cols-2 xl:grid-cols-4', loading && 'opacity-60')}
          >
            <StatCard
              label={t('dashboard.totalRecords')}
              value={total.toLocaleString(locale)}
              hint={t('dash.kpi.totalNote')}
              icon="file-text"
            />
            <StatCard
              label={t('dashboard.avgScore')}
              value={empty ? '—' : <ScoreValue value={score.toFixed(1)} outOf={t('dash.outOf10')} />}
              hint={empty ? t('dash.kpi.noRecords') : score >= 7 ? t('dash.kpi.scoreOk') : t('dash.kpi.scoreLow')}
              icon="star"
              tone={empty ? 'neutral' : score >= 7 ? 'success' : score >= 5 ? 'warning' : 'danger'}
            />
            <StatCard
              label={t('dashboard.avgAttendance')}
              value={empty ? '—' : <span className="whitespace-nowrap">{attendance.toFixed(1)}%</span>}
              hint={empty ? t('dash.kpi.noRecords') : attendance >= 75 ? t('dash.kpi.attendanceOk') : t('dash.kpi.attendanceLow')}
              icon="user-check"
              tone={empty ? 'neutral' : attendance >= 75 ? 'success' : 'warning'}
            />
            <StatCard
              label={t('dashboard.problemRecords')}
              value={problems.toLocaleString(locale)}
              hint={empty ? t('dash.kpi.noRecords') : t('dash.kpi.problemsNote', { value: problemShare.toFixed(1) })}
              icon="alert"
              tone={empty ? 'neutral' : problems > 0 ? 'danger' : 'success'}
            />
          </section>

          <section aria-label={t('dashboard.filters')}>
            <FilterBar
              actions={(loading || hasFilters) && (
                <>
                  {loading && (
                    <span role="status" className="inline-flex items-center gap-2 text-sm text-fg-muted">
                      <Spinner size={16} />
                      {t('dash.updating')}
                    </span>
                  )}
                  {hasFilters && (
                    <Button variant="secondary" size="sm" icon="rotate-ccw" onClick={resetFilters}>
                      {t('dash.reset')}
                    </Button>
                  )}
                </>
              )}
            >
              <Field label={t('dashboard.faculty')}>
                <Select
                  value={selectedFaculty}
                  onChange={(event) => { setSelectedFaculty(event.target.value); setSelectedOp('') }}
                  placeholder={t('dashboard.allFaculties')}
                  options={facultyOptions.map((faculty) => ({ value: faculty.name, label: faculty.name }))}
                />
              </Field>
              <Field label={t('dashboard.op')}>
                <Select
                  value={selectedOp}
                  onChange={(event) => setSelectedOp(event.target.value)}
                  placeholder={t('dashboard.allOp')}
                  options={opOptions.map((op) => ({ value: op.name, label: op.name }))}
                />
              </Field>
            </FilterBar>
          </section>

          {!loading && total === 0 && (
            <Alert tone="info">{selectedYear ? t('dash.year.noData', { year: selectedYear }) : t('dashboard.noData')}</Alert>
          )}

          <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <Card>
              <CardHeader title={t('dash.targets.title')} description={t('dash.targets.description')} />
              <CardBody className="flex flex-col gap-6">
                <ProgressMetric
                  label={t('dash.targets.score')}
                  value={score * 10}
                  display={`${score.toFixed(1)} ${t('dash.outOf10')}`}
                  target={t('dash.targets.scoreTarget')}
                  tone={score >= 7 ? 'success' : 'warning'}
                />
                <ProgressMetric
                  label={t('dash.targets.attendance')}
                  value={attendance}
                  display={`${attendance.toFixed(1)}%`}
                  target={t('dash.targets.attendanceTarget')}
                  tone={attendance >= 75 ? 'success' : 'warning'}
                />
                <ProgressMetric
                  label={t('dash.targets.problems')}
                  value={problemShare}
                  display={`${problemShare.toFixed(1)}%`}
                  target={t('dash.targets.problemsTarget')}
                  tone={problemShare <= 10 ? 'success' : 'danger'}
                />
              </CardBody>
            </Card>

            <Card>
              <CardHeader title={comparisonTitle} description={t('dash.compare.description')} />
              <DataTable
                columns={comparisonColumns}
                rows={sortedComparison}
                rowKey="label"
                maxHeight="27rem"
                caption={comparisonTitle}
                empty={<EmptyState icon="chart" title={t('dashboard.noDataChart')} compact />}
              />
            </Card>
          </div>

          <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-2">
            <DonutChart
              title={t('dash.distribution.title')}
              description={t('dash.distribution.description')}
              items={recordsPieItems}
              emptyText={t('dash.distribution.empty')}
              totalLabel={t('dash.total')}
              locale={locale}
            />
            <DonutChart
              title={t('dash.quality.title')}
              description={t('dash.quality.description')}
              items={issuePieItems}
              emptyText={t('dash.quality.empty')}
              totalLabel={t('dash.total')}
              locale={locale}
            />
          </div>

          <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-[minmax(0,11fr)_minmax(0,9fr)]">
            <BarChart
              title={t('dash.ranking.title')}
              description={t('dash.ranking.description')}
              items={scoreBarItems}
              emptyText={t('dash.ranking.empty')}
            />
            <Card>
              <CardHeader title={t('dash.summary.title')} description={t('dash.summary.description')} />
              <CardBody className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <SummaryTile
                  label={t('dash.summary.best')}
                  value={bestItem?.label || t('dash.summary.noData')}
                  note={bestItem
                    ? `${Number(bestItem.avg_score || 0).toFixed(1)} ${t('dash.outOf10')}`
                    : t('dash.summary.notEnough')}
                />
                <SummaryTile
                  label={t('dash.summary.attention')}
                  value={attentionItem?.label || t('dash.summary.noProblems')}
                  note={attentionItem
                    ? t('dash.summary.problemsCount', { n: attentionItem.problem_records })
                    : t('dash.summary.stable')}
                />
                <SummaryTile
                  label={t('dash.summary.total')}
                  value={total.toLocaleString(locale)}
                  note={t('dash.summary.inSample')}
                />
                <SummaryTile
                  label={t('dash.summary.problems')}
                  value={problems.toLocaleString(locale)}
                  note={t('dash.summary.share', { value: formatPercent(problemShare) })}
                />
              </CardBody>
            </Card>
          </div>

          <footer className="flex min-w-0 flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-line pt-4 text-xs text-fg-subtle">
            <p className="min-w-0">{t('dash.source')}</p>
            <p className="inline-flex min-w-0 items-center gap-1.5">
              <Icon name="check-circle" size={16} className="text-success" />
              {t('dash.sampleNote')}
            </p>
          </footer>
        </>
      )}
    </PageStack>
  )
}
