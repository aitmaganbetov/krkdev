import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getViolationsDashboard } from '../../services/api'
import { intlLocale } from '../../utils/locale'
import { violationTypeLabel } from '../../utils/violationTypes'
import { Alert, Button, Card, CardHeader, DataTable, EmptyState, StatCard, cn } from '../ui'
import { BarChart, CHART, COLOR_OTHER, DonutChart, ModuleSkeleton } from './charts'

const share = (part, whole) => `${whole ? Math.round((part / whole) * 100) : 0}%`

/** Дашборд модуля «Ситуационный мониторинг»: наблюдения по чек-листу 16-02 за учебный год (по дате наблюдения). */
export default function MonitoringDashboard({ selectedYear }) {
  const { t, i18n } = useTranslation()
  const locale = intlLocale(i18n.language)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    if (selectedYear === null) return
    setLoading(true)
    setError('')
    getViolationsDashboard({ academic_year: selectedYear || undefined })
      .then(setData)
      .catch(() => setError(t('monDash.loadError')))
      .finally(() => setLoading(false))
  }, [selectedYear, retryKey, t])

  const count = (value) => Number(value || 0).toLocaleString(locale)
  const monthName = useMemo(() => new Intl.DateTimeFormat(locale || 'ru', { month: 'long', year: 'numeric' }), [locale])

  if (!data && loading) return <ModuleSkeleton label={t('dash.loading')} />

  const typeItems = (data?.by_type || []).map((item) => ({
    label: violationTypeLabel(t, item.type), value: item.count, valueLabel: count(item.count),
  }))
  const monthItems = (data?.by_month || []).map((item) => {
    const [year, month] = item.month.split('-').map(Number)
    return { label: monthName.format(new Date(year, month - 1, 1)), value: item.count, valueLabel: count(item.count) }
  })
  // «Не определён» — нейтральным цветом вне палитры
  const facultyItems = (data?.by_faculty || []).map((item, index) => ({
    label: item.faculty_name || t('monDash.byFaculty.unknown'),
    value: item.count,
    valueLabel: `${count(item.count)} (${share(item.count, data.total)})`,
    color: item.faculty_id ? CHART[index % CHART.length] : COLOR_OTHER,
  }))
  const statuses = data?.statuses || {}
  const teacherColumns = [
    {
      key: 'teacher',
      header: t('monDash.top.colTeacher'),
      mobile: 'title',
      minWidth: '14rem',
      cell: (row, index) => (
        <div className="flex min-w-0 items-start gap-3">
          <span className="w-6 shrink-0 text-right text-fg-subtle tabular">{index + 1}</span>
          <span className="min-w-0 font-medium text-fg">{row.teacher}</span>
        </div>
      ),
    },
    { key: 'count', header: t('monDash.top.colCount'), align: 'right', nowrap: true, cell: (row) => <span className="font-semibold tabular">{row.count}</span> },
  ]

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {error && (
        <Alert tone="danger" action={<Button variant="secondary" size="sm" icon="refresh" onClick={() => setRetryKey((v) => v + 1)}>{t('ui.retry')}</Button>}>
          {error}
        </Alert>
      )}

      {data && (
        <>
          <section className={cn('grid grid-cols-1 gap-4 transition-opacity sm:grid-cols-2 xl:grid-cols-4', loading && 'opacity-60')} aria-busy={loading}>
            {/* Наблюдения по чек-листу 16-02; «ожидает проверки» старых записей — тоже требует уточнения */}
            <StatCard label={t('monDash.kpi.total')} icon="eye" tone="primary" value={count(data.total)} hint={t('monDash.kpi.totalHint')} />
            <StatCard label={t('monDash.kpi.confirmed')} icon="check-circle" tone={statuses.confirmed ? 'danger' : 'success'} value={count(statuses.confirmed)}
              hint={t('monDash.kpi.confirmedHint', {
                clarification: count((statuses.clarification || 0) + (statuses.pending || 0)), technical: count(statuses.technical),
              })} />
            <StatCard label={t('monDash.kpi.notified')} icon="bell" tone="primary" value={share(data.notified, statuses.confirmed)}
              hint={t('monDash.kpi.notifiedHint', { count: count(data.notified), total: count(statuses.confirmed) })} />
            <StatCard label={t('monDash.kpi.evidence')} icon="camera" value={share(data.with_evidence, data.total)}
              hint={t('monDash.kpi.evidenceHint', { count: count(data.with_evidence), total: count(data.total) })} />
          </section>

          <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-2">
            <BarChart title={t('monDash.byType.title')} items={typeItems} emptyText={t('monDash.byType.empty')} />
            <BarChart title={t('monDash.byMonth.title')} items={monthItems} emptyText={t('monDash.byMonth.empty')} />
          </div>

          <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-[minmax(0,11fr)_minmax(0,9fr)]">
            <DonutChart title={t('monDash.byFaculty.title')} description={t('monDash.byFaculty.description')} items={facultyItems}
              emptyText={t('monDash.byFaculty.empty')} totalLabel={t('dash.total')} locale={locale} />
            <Card className="overflow-hidden">
              <CardHeader title={t('monDash.top.title')} description={t('monDash.top.description')} />
              <DataTable columns={teacherColumns} rows={data.top_teachers} rowKey="teacher" caption={t('monDash.top.title')}
                empty={<EmptyState icon="check-circle" title={t('monDash.top.empty')} compact />} />
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
