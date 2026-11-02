import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getPeerVisitsDashboard } from '../../services/api'
import { intlLocale } from '../../utils/locale'
import { FACULTIES, LEVEL_TONE, overallLevel } from '../../utils/peerVisit'
import {
  Alert, Badge, Button, Card, CardBody, CardHeader, DataTable, EmptyState, Field, FilterBar, Select, StatCard, cn,
} from '../ui'
import { CHART, COLOR_BAD, COLOR_GOOD, DonutChart, ModuleSkeleton, ProgressMetric, SummaryTile } from './charts'
import { useAuth } from '../../context/AuthContext'

// Цвета уровней на диаграмме: хорошо → плохо (классы целиком, чтобы их увидел Tailwind)
const COLOR_WARNING = { bg: 'bg-warning', stroke: 'stroke-warning' }
const LEVEL_COLORS = { high: COLOR_GOOD, medium: CHART[0], satisfactory: COLOR_WARNING, low: CHART[4], fail: COLOR_BAD }
const STATUS_COLORS = { submitted: CHART[0], rework: COLOR_WARNING, accepted: COLOR_GOOD }

const share = (part, whole) => `${whole ? Math.round((part / whole) * 100) : 0}%`

/** Дашборд модуля «Взаимопосещение»: отзывы (без черновиков) и выполнение графика. */
export default function PeerVisitsDashboard({ selectedYear }) {
  const { t, i18n } = useTranslation()
  const { role } = useAuth()
  const locale = intlLocale(i18n.language)
  const [faculty, setFaculty] = useState('')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    if (selectedYear === null) return
    setLoading(true)
    setError('')
    getPeerVisitsDashboard({ academic_year: selectedYear || undefined, faculty: faculty || undefined })
      .then(setData)
      .catch(() => setError(t('peerDash.loadError')))
      .finally(() => setLoading(false))
  }, [selectedYear, faculty, retryKey, t])

  const levelItems = useMemo(() => {
    const levels = data?.levels || {}
    const total = Object.values(levels).reduce((sum, value) => sum + value, 0)
    return Object.entries(levels).filter(([, value]) => value > 0).map(([level, value]) => ({
      label: t(`peerVisits.levelsShort.${level}`),
      value,
      valueLabel: `${value.toLocaleString(locale)} (${share(value, total)})`,
      color: LEVEL_COLORS[level],
    }))
  }, [data, locale, t])

  const statusItems = useMemo(() => {
    const statuses = data?.statuses || {}
    return Object.entries(statuses).filter(([, value]) => value > 0).map(([status, value]) => ({
      label: t(`status.${status}`),
      value,
      valueLabel: `${value.toLocaleString(locale)} (${share(value, data.total)})`,
      color: STATUS_COLORS[status],
    }))
  }, [data, locale, t])

  if (!data && loading) return <ModuleSkeleton label={t('dash.loading')} />

  const avgLevel = overallLevel(data?.avg_score || 0)
  const schedule = data?.schedule
  const facultyColumns = [
    { key: 'faculty', header: t('peerDash.faculties.colFaculty'), mobile: 'title', minWidth: '14rem', cell: (r) => <span className="font-medium text-fg">{r.faculty_name}</span> },
    { key: 'total', header: t('peerDash.faculties.colTotal'), align: 'right', nowrap: true, cell: (r) => <span className="tabular">{r.total}</span> },
    { key: 'accepted', header: t('peerDash.faculties.colAccepted'), align: 'right', nowrap: true, cell: (r) => <span className="tabular">{r.accepted}</span> },
    {
      key: 'level',
      header: t('peerDash.faculties.colLevel'),
      nowrap: true,
      cell: (r) => {
        const level = overallLevel(r.avg_score || 0)
        return level ? <Badge tone={LEVEL_TONE[level]}>{t(`peerVisits.levelsShort.${level}`)}</Badge> : <span className="text-fg-subtle">—</span>
      },
    },
    {
      key: 'problems',
      header: t('peerDash.faculties.colProblems'),
      align: 'right',
      nowrap: true,
      cell: (r) => <Badge tone={r.problems > 0 ? 'danger' : 'success'} className="tabular">{r.problems}</Badge>,
    },
    {
      key: 'schedule',
      header: t('peerDash.faculties.colSchedule'),
      minWidth: '9rem',
      cell: (r) => (r.schedule_total ? (
        <div className="flex min-w-0 items-center gap-2">
          <div className="h-1.5 min-w-12 flex-1 overflow-hidden rounded-full bg-surface-hover" aria-hidden="true">
            <div className="h-full rounded-full bg-success" style={{ width: `${r.schedule_percent || 0}%` }} />
          </div>
          <span className="w-10 shrink-0 text-right text-sm font-semibold tabular">{r.schedule_percent || 0}%</span>
        </div>
      ) : <span className="text-fg-subtle">—</span>),
    },
    {
      key: 'overdue',
      header: t('peerDash.faculties.colOverdue'),
      align: 'right',
      nowrap: true,
      cell: (r) => <span className={cn('tabular', r.schedule_overdue > 0 && 'font-semibold text-danger')}>{r.schedule_overdue}</span>,
    },
  ]

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {error && (
        <Alert tone="danger" action={<Button variant="secondary" size="sm" icon="refresh" onClick={() => setRetryKey((v) => v + 1)}>{t('ui.retry')}</Button>}>
          {error}
        </Alert>
      )}

      {/* Деканат видит только свой факультет — фильтр ему не нужен */}
      {role !== 'dean' && <FilterBar>
        <Field label={t('peerDash.filter.faculty')}>
          <Select value={faculty} placeholder={t('peerDash.filter.all')}
            options={FACULTIES.map((code) => ({ value: code, label: t(`peerVisits.faculties.${code}`) }))}
            onChange={(e) => setFaculty(e.target.value)} />
        </Field>
      </FilterBar>}

      {data && (
        <>
          <section className={cn('grid grid-cols-1 gap-4 transition-opacity sm:grid-cols-2 xl:grid-cols-4', loading && 'opacity-60')} aria-busy={loading}>
            <StatCard label={t('peerDash.kpi.total')} icon="user-check" value={data.total.toLocaleString(locale)}
              hint={t('peerDash.kpi.totalHint', { count: data.statuses.accepted })} />
            <StatCard label={t('peerDash.kpi.review')} icon="inbox" tone={data.statuses.submitted ? 'primary' : 'neutral'}
              value={data.statuses.submitted.toLocaleString(locale)} hint={t('peerDash.kpi.reviewHint', { count: data.statuses.rework })} />
            <StatCard label={t('peerDash.kpi.level')} icon="star" tone={avgLevel ? LEVEL_TONE[avgLevel] : 'neutral'}
              value={avgLevel ? t(`peerVisits.levelsShort.${avgLevel}`) : '—'}
              hint={avgLevel ? t('peerDash.kpi.levelHint', { score: Number(data.avg_score).toFixed(2) }) : t('peerDash.kpi.noScore')} />
            <StatCard label={t('peerDash.kpi.problems')} icon="alert" tone={data.problems ? 'danger' : 'success'}
              value={data.problems.toLocaleString(locale)} hint={t('peerDash.kpi.problemsHint')} />
          </section>

          <Card>
            <CardHeader title={t('peerDash.schedule.title')} description={t('peerDash.schedule.description')} />
            {schedule ? (
              <CardBody className="flex flex-col gap-5">
                <ProgressMetric
                  label={t('peerDash.schedule.progress')}
                  value={schedule.percent}
                  display={`${schedule.percent}% · ${t('peerDash.schedule.display', { done: schedule.done, total: schedule.total })}`}
                  target={t('peerDash.schedule.target', { total: schedule.total })}
                  tone={schedule.percent >= 70 ? 'success' : schedule.overdue ? 'danger' : 'warning'}
                />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <SummaryTile label={t('peerDash.schedule.overdue')} value={schedule.overdue.toLocaleString(locale)} note={t('peerDash.schedule.overdueNote')} />
                  <SummaryTile label={t('peerDash.schedule.inProgress')} value={schedule.in_progress.toLocaleString(locale)} note={t('peerDash.schedule.inProgressNote')} />
                  <SummaryTile label={t('peerDash.schedule.planned')} value={schedule.planned.toLocaleString(locale)} note={t('peerDash.schedule.plannedNote')} />
                  <SummaryTile label={t('peerDash.schedule.late')} value={schedule.late.toLocaleString(locale)} note={t('peerDash.schedule.lateNote')} />
                </div>
              </CardBody>
            ) : (
              <EmptyState icon="calendar" title={t('peerDash.schedule.empty')} compact />
            )}
          </Card>

          <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-2">
            <DonutChart title={t('peerDash.levels.title')} description={t('peerDash.levels.description')} items={levelItems}
              emptyText={t('peerDash.levels.empty')} totalLabel={t('dash.total')} locale={locale} />
            <DonutChart title={t('peerDash.statuses.title')} description={t('peerDash.statuses.description')} items={statusItems}
              emptyText={t('peerDash.statuses.empty')} totalLabel={t('dash.total')} locale={locale} />
          </div>

          <Card className="overflow-hidden">
            <CardHeader title={t('peerDash.faculties.title')} description={t('peerDash.faculties.description')} />
            <DataTable columns={facultyColumns} rows={data.faculties} rowKey="faculty" caption={t('peerDash.faculties.title')}
              empty={<EmptyState icon="chart" title={t('peerDash.faculties.empty')} compact />} />
          </Card>
        </>
      )}
    </div>
  )
}
