import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getDashboardFacultyComparison, getDashboardStats, getRecordFilterOptions } from '../../services/api'
import { intlLocale } from '../../utils/locale'
import {
  Alert, Badge, Button, Card, CardBody, CardHeader, DataTable, EmptyState, Field, FilterBar, Icon,
  Select, Spinner, StatCard, cn,
} from '../ui'
import {
  BarChart, CHART, COLOR_BAD, COLOR_GOOD, COLOR_OTHER, DonutChart, ModuleSkeleton, ProgressMetric, ScoreValue, SummaryTile,
  formatPercent,
} from './charts'

/** Дашборд модуля «Записи КРК». Учебный год выбирается в оболочке DashboardPage. */
export default function RecordsDashboard({ selectedYear }) {
  const { t, i18n } = useTranslation()
  const [stats, setStats] = useState(null)
  const [filterOptions, setFilterOptions] = useState({ faculties: [], ops: [] })
  const [comparison, setComparison] = useState([])
  const [selectedFaculty, setSelectedFaculty] = useState('')
  const [selectedOp, setSelectedOp] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retryKey, setRetryKey] = useState(0)

  // Для форматирования дат и чисел: в Intl казахский язык — 'kk'
  const locale = intlLocale(i18n.language)

  // Смена учебного года сбрасывает факультет и ОП
  useEffect(() => {
    setSelectedFaculty('')
    setSelectedOp('')
  }, [selectedYear])

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

  if (!stats && loading) return <ModuleSkeleton label={t('dash.loading')} />

  return (
    <div className="flex min-w-0 flex-col gap-6">
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
    </div>
  )
}
