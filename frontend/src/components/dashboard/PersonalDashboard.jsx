import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { apiErrorText, getMyDashboard } from '../../services/api'
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, LoadingBlock, StatCard } from '../ui'
import { SCHEDULE_STATUS_TONE } from '../../utils/peerVisit'

// «Мои показатели» — только данные текущего пользователя (GET /dashboard/me). Разделы появляются, когда
// у пользователя есть такие данные: проверки КРК, план и отзывы взаимопосещения, нарушения, подписи, посещаемость.
const STATUS_TONE = { draft: 'neutral', submitted: 'primary', rework: 'warning', accepted: 'success' }
const PLAN_TONE = { ...SCHEDULE_STATUS_TONE, planned: 'primary' }

function Section({ title, to, children }) {
  const { t } = useTranslation()
  return (
    <Card>
      <CardHeader title={title} actions={to ? <Button as={Link} to={to} variant="ghost" size="sm" icon="arrow-right">{t('myDash.open')}</Button> : undefined} />
      <CardBody>{children}</CardBody>
    </Card>
  )
}

function StatusRow({ statuses, group, tones }) {
  const { t } = useTranslation()
  return (
    <div className="grid min-w-0 grid-cols-2 gap-4 lg:grid-cols-4">
      {Object.entries(statuses).map(([status, count]) => (
        <StatCard key={status} label={t(`myDash.${group}.${status}`)} value={count} tone={count ? tones[status] || 'neutral' : 'neutral'} />
      ))}
    </div>
  )
}

export default function PersonalDashboard({ selectedYear }) {
  const { t, i18n } = useTranslation()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (selectedYear === null) return
    setData(null)
    setError('')
    getMyDashboard({ academic_year: selectedYear || undefined })
      .then(setData)
      .catch((err) => setError(apiErrorText(err, t('myDash.loadError'))))
  }, [selectedYear, t])

  if (error) return <Alert tone="danger">{error}</Alert>
  if (!data) return <LoadingBlock label={t('ui.loading')} />
  if (!Object.keys(data).length) return <Card><EmptyState icon="dashboard" title={t('myDash.empty')} /></Card>

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {data.signing && (
        <Alert tone="warning" action={<Button as={Link} to="/signing" size="sm" icon="key">{t('myDash.open')}</Button>}>
          {t('myDash.signing.pending')}: {data.signing.pending}
        </Alert>
      )}
      {data.committee && <Alert tone="info">{t('myDash.committee.member', { number: data.committee.number, year: data.committee.academic_year })}</Alert>}

      {data.assignments && (
        <Section title={t('myDash.assignments.title')} to="/records/new">
          <div className="grid min-w-0 grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label={t('myDash.assignments.total')} value={data.assignments.total} tone="primary" icon="user-check" />
            <StatCard label={t('myDash.assignments.done')} value={data.assignments.done} tone={data.assignments.done ? 'success' : 'neutral'} />
            <StatCard label={t('myDash.assignments.left')} value={data.assignments.total - data.assignments.done}
              tone={data.assignments.total > data.assignments.done ? 'warning' : 'neutral'} />
          </div>
          <ul className="mt-4 flex flex-col gap-2">
            {data.assignments.items.map((row) => (
              <li key={`${row.term}-${row.name}`} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md border border-line px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="text-fg">{row.name}</span>
                  <span className="block text-xs text-fg-subtle">{(i18n.language === 'kz' && row.cafedra_kz) || row.cafedra_ru || ''}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-fg-muted">{t('myDash.assignments.term', { term: row.term })}</span>
                  <Badge tone={row.done ? 'success' : 'info'} dot>{t(row.done ? 'assignments.status.done' : 'assignments.status.planned')}</Badge>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {data.attendance && (
        <Section title={t('myDash.attendance.title')} to="/my-attendance">
          <div className="grid min-w-0 grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label={t('myDash.attendance.marks')} value={data.attendance.marks} tone="primary" icon="check-circle" />
            <StatCard label={t('myDash.attendance.days')} value={data.attendance.days} />
            <StatCard label={t('myDash.attendance.last')} value={data.attendance.last ? data.attendance.last.split('-').reverse().join('.') : '—'} />
            <StatCard label={t('myDash.attendance.group')} value={data.attendance.group || '—'} />
          </div>
        </Section>
      )}

      {data.records && (
        <Section title={t('myDash.records.title')} to="/records">
          <StatusRow statuses={data.records.statuses} group="statuses" tones={STATUS_TONE} />
          <div className="mt-4 grid min-w-0 grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label={t('myDash.records.avg')} value={data.records.avg_score || '—'} tone="primary" />
            <StatCard label={t('myDash.records.problem')} value={data.records.problem} tone={data.records.problem ? 'danger' : 'neutral'} />
          </div>
        </Section>
      )}

      {data.plan && (
        <Section title={t('myDash.plan.title')} to="/peer-visits">
          <StatusRow statuses={data.plan.statuses} group="planStatuses" tones={PLAN_TONE} />
          {data.plan.upcoming.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-sm font-medium text-fg">{t('myDash.plan.upcoming')}</p>
              <ul className="flex flex-col gap-2">
                {data.plan.upcoming.map((row) => (
                  <li key={row.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md border border-line px-3 py-2 text-sm">
                    <span className="min-w-0 text-fg">{row.visited_name}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-fg-muted">{t(`schedule.months.${row.month}`)}</span>
                      <Badge tone={PLAN_TONE[row.status]} dot>{t(`myDash.planStatuses.${row.status}`)}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      )}

      {data.reviews && (
        <Section title={t('myDash.reviews.title')} to="/peer-visits">
          <StatusRow statuses={data.reviews.statuses} group="statuses" tones={STATUS_TONE} />
        </Section>
      )}

      {data.violations && (
        <Section title={t('myDash.violations.title')} to="/my-violations">
          {/* Только подтверждённые организационные несоответствия: одно наблюдение по камере не вывод (п. 4.5) */}
          <div className="grid min-w-0 grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label={t('myDash.violations.total')} value={data.violations.total} tone="danger" />
          </div>
        </Section>
      )}
    </div>
  )
}
