import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Badge, Button, Card, CardHeader, DataTable, EmptyState, StatCard } from '../ui'
import { BarChart, CHART, COLOR_BAD, COLOR_GOOD, COLOR_OTHER, DonutChart } from '../dashboard/charts'
import { OutcomeBadge, deviationLabels } from './VideoChecklist'
import { CHECKLIST_QUESTIONS, FINAL_STATUSES, deviations } from '../../utils/videoChecklist'
import { formatDateTimeUtcPlus5, formatDateUtcPlus5 } from '../../utils/datetime'
import { intlLocale } from '../../utils/locale'
import { violationTypeLabel } from '../../utils/violationTypes'

// «Архив» и «Аналитика» ситуационного мониторинга — по наблюдениям чек-листа 16-02 (GET /violations).
// Видеомониторинг подтверждает организационные факты и не формирует педагогический балл (п. 4.1, 4.3).

export const observationDate = (item) => String(item.violation_date || '').slice(0, 10)
// В архиве — наблюдения с принятым решением: подписанные ЭЦП и закрытые (нарушение, снято, отклонено)
export const isArchived = (item) => Boolean(item.signed_at) || FINAL_STATUSES.includes(item.status)

const share = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0)
const countBy = (items, keyOf) => {
  const counts = new Map()
  items.forEach((item) => {
    const key = keyOf(item)
    if (key) counts.set(key, (counts.get(key) || 0) + 1)
  })
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
}
const signerName = (item) => item.signature_info?.signer_name || item.signature_info?.subject || ''
// Расхождение по наблюдению: ответы чек-листа; у записей до формы 16-02 — вид нарушения (кроме снятых и отклонённых)
const hasDeviation = (item) => (item.checklist
  ? deviations(item.checklist).length > 0
  : !['rejected', 'justified'].includes(item.status))

export function ArchiveStats({ items }) {
  const { t } = useTranslation()
  const responses = items.flatMap((item) => item.responses || [])
  const count = (status) => items.filter((item) => item.status === status).length
  return (
    <section className="grid min-w-0 grid-cols-2 gap-4 xl:grid-cols-4">
      <StatCard label={t('monitoring.archive.metrics.total')} value={items.length} tone="primary"
        hint={t('monitoring.archive.metrics.totalHint', { count: items.filter((item) => item.signed_at).length })} />
      <StatCard label={t('monitoring.archive.metrics.compliant')} value={count('compliant')} tone="success"
        hint={t('monitoring.archive.metrics.compliantHint', { count: count('technical') })} />
      <StatCard label={t('monitoring.archive.metrics.confirmed')} value={count('confirmed')} tone="danger"
        hint={t('monitoring.archive.metrics.confirmedHint', { count: count('justified') })} />
      <StatCard label={t('monitoring.archive.metrics.responses')} value={responses.length}
        hint={t('monitoring.archive.metrics.responsesHint', {
          ecp: responses.filter((response) => response.method === 'ecp').length,
          scan: responses.filter((response) => response.method !== 'ecp').length,
        })} />
    </section>
  )
}

/** Реестр наблюдений с принятым решением: итог, подпись ЭЦП, пояснения преподавателя и PDF формы 16-02. */
export function ArchiveTable({ rows, total, loading, error, onRetry }) {
  const { t } = useTranslation()
  if (error && !total) {
    return <Alert tone="danger" title={error}
      action={<Button variant="secondary" size="sm" icon="refresh" onClick={onRetry}>{t('ui.retry')}</Button>} />
  }
  const columns = [
    { key: 'date', header: t('monitoring.archive.columns.date'), nowrap: true,
      cell: (item) => <span className="tabular">{formatDateUtcPlus5(item.violation_date)}</span> },
    { key: 'teacher', header: t('monitoring.archive.columns.teacher'), mobile: 'title', minWidth: '14rem',
      cell: (item) => (
        <div className="min-w-0">
          <p className="font-medium text-fg">{item.teacher || '—'}</p>
          {item.subject && <p className="mt-0.5 text-xs text-fg-muted">{item.subject}</p>}
        </div>
      ) },
    { key: 'room', header: t('monitoring.archive.columns.room'), minWidth: '8rem', cell: (item) => item.room || '—' },
    { key: 'outcome', header: t('monitoring.archive.columns.outcome'), minWidth: '12rem',
      cell: (item) => {
        const labels = deviationLabels(t, item)
        return (
          <div className="flex min-w-0 flex-col items-start gap-1">
            <OutcomeBadge status={item.status} />
            <span className="text-xs text-fg-muted">
              {labels.length ? labels.join(' · ') : item.checklist ? t('monitoring.archive.noDeviations') : violationTypeLabel(t, item.violation_type)}
            </span>
            {item.responses?.length > 0 && <Badge tone="info">{t('myViolations.response.count', { count: item.responses.length })}</Badge>}
          </div>
        )
      } },
    { key: 'signature', header: t('monitoring.archive.columns.signature'), minWidth: '12rem',
      cell: (item) => (item.signed_at ? (
        <div className="min-w-0">
          <p className="text-fg">{signerName(item) || '—'}</p>
          <p className="mt-0.5 text-xs text-fg-subtle tabular">{formatDateTimeUtcPlus5(item.signed_at)}</p>
        </div>
      ) : <span className="text-sm text-fg-subtle">{t('monitoring.archive.notSigned')}</span>) },
    { key: 'form', header: t('monitoring.archive.columns.form'), align: 'right', nowrap: true,
      cell: (item) => (item.act_url ? (
        <Button as="a" href={item.act_url} target="_blank" rel="noopener" variant="secondary" size="sm" icon="file-text"
          aria-label={item.checklist ? t('checklist.openForm') : t('myViolations.openAct', { id: item.id })}>
          PDF
        </Button>
      ) : <span className="text-sm text-fg-subtle">—</span>) },
  ]
  return (
    <Card className="overflow-hidden">
      <CardHeader title={t('monitoring.archive.title')} description={t('monitoring.archive.description')} />
      <DataTable columns={columns} rows={rows} loading={loading} skeletonRows={4} caption={t('monitoring.archive.title')}
        empty={<EmptyState icon="inbox" title={t('monitoring.archive.empty')} description={t('monitoring.archive.emptyHint')} compact />} />
    </Card>
  )
}

// Цвета итогов: соответствие и нарушение — статусными цветами, остальные — палитрой, записи до формы — нейтрально
const OUTCOME_COLORS = {
  compliant: COLOR_GOOD, clarification: CHART[2], violation: CHART[4], confirmed: COLOR_BAD, justified: CHART[0],
  technical: CHART[5], pending: COLOR_OTHER, rejected: COLOR_OTHER,
}

/** Аналитика за период: итоги наблюдений, виды расхождений, аудитории, технические сбои и преподаватели. */
export function ObservationsAnalytics({ items, loading, error, onRetry }) {
  const { t, i18n } = useTranslation()
  const locale = intlLocale(i18n.language)
  const stats = useMemo(() => {
    const count = (...statuses) => items.filter((item) => statuses.includes(item.status)).length
    const technical = count('technical')
    // Виды расхождений — по ответам чек-листа (кроме снятых по пояснению и отклонённых); старые записи — по виду нарушения
    const deviationCounts = new Map()
    items.filter((item) => !['justified', 'rejected', 'compliant'].includes(item.status)).forEach((item) => {
      const labels = item.checklist ? deviations(item.checklist).map((key) => t(`checklist.short.${key}`)) : [violationTypeLabel(t, item.violation_type)]
      labels.forEach((label) => deviationCounts.set(label, (deviationCounts.get(label) || 0) + 1))
    })
    const questionOrder = CHECKLIST_QUESTIONS.map((question) => t(`checklist.short.${question.key}`))
    return {
      total: items.length,
      assessed: items.length - technical,
      compliant: count('compliant'),
      violations: count('violation', 'confirmed'),
      confirmed: count('confirmed'),
      justified: count('justified'),
      technical,
      outcomes: countBy(items, (item) => item.status),
      deviationTypes: [...deviationCounts.entries()]
        .sort((a, b) => b[1] - a[1] || questionOrder.indexOf(a[0]) - questionOrder.indexOf(b[0])),
      rooms: countBy(items.filter((item) => item.status !== 'technical' && hasDeviation(item)), (item) => item.room).slice(0, 8),
      technicalRooms: countBy(items.filter((item) => item.status === 'technical'), (item) => item.room).slice(0, 8),
      // Преподаватели — только по подписанным ЭЦП нарушениям (как дашборд)
      teachers: countBy(items.filter((item) => item.status === 'confirmed'), (item) => item.teacher).slice(0, 10),
    }
  }, [items, t])

  if (error && !items.length) {
    return <Alert tone="danger" title={error}
      action={<Button variant="secondary" size="sm" icon="refresh" onClick={onRetry}>{t('ui.retry')}</Button>} />
  }
  if (loading && !items.length) return null
  if (!items.length) {
    return <Card><EmptyState icon="chart" title={t('monitoring.analytics.empty')} description={t('monitoring.archive.emptyHint')} /></Card>
  }

  const number = (value) => Number(value || 0).toLocaleString(locale)
  const bars = (entries) => entries.map(([label, value]) => ({ label, value, valueLabel: number(value) }))
  const outcomeItems = stats.outcomes.map(([status, value]) => ({
    label: t(`checklist.outcomes.${status}`, { defaultValue: status }),
    value,
    valueLabel: `${number(value)} (${share(value, stats.total)}%)`,
    color: OUTCOME_COLORS[status] || COLOR_OTHER,
  }))

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <section className="grid min-w-0 grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label={t('monitoring.analytics.metrics.total')} value={number(stats.total)} tone="primary"
          hint={t('monitoring.analytics.metrics.totalHint')} />
        <StatCard label={t('monitoring.analytics.metrics.compliance')} value={`${share(stats.compliant, stats.assessed)}%`} tone="success"
          hint={t('monitoring.analytics.metrics.complianceHint', { count: number(stats.compliant), total: number(stats.assessed) })} />
        <StatCard label={t('monitoring.analytics.metrics.violations')} value={number(stats.violations)} tone="danger"
          hint={t('monitoring.analytics.metrics.violationsHint', { signed: number(stats.confirmed), justified: number(stats.justified) })} />
        <StatCard label={t('monitoring.analytics.metrics.technical')} value={`${share(stats.technical, stats.total)}%`} tone="warning"
          hint={t('monitoring.analytics.metrics.technicalHint', { count: number(stats.technical) })} />
      </section>

      <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-2">
        <DonutChart title={t('monitoring.analytics.outcomes.title')} description={t('monitoring.analytics.outcomes.description')}
          items={outcomeItems} emptyText={t('monitoring.analytics.empty')} totalLabel={t('monitoring.analytics.outcomes.total')} locale={locale} />
        <BarChart title={t('monitoring.analytics.deviations.title')} description={t('monitoring.analytics.deviations.description')}
          items={bars(stats.deviationTypes)} emptyText={t('monitoring.analytics.deviations.empty')} />
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-3">
        <BarChart title={t('monitoring.analytics.rooms.title')} description={t('monitoring.analytics.rooms.description')}
          items={bars(stats.rooms)} emptyText={t('monitoring.analytics.rooms.empty')} />
        <BarChart title={t('monitoring.analytics.technical.title')} description={t('monitoring.analytics.technical.description')}
          items={bars(stats.technicalRooms)} emptyText={t('monitoring.analytics.technical.empty')} />
        <BarChart title={t('monitoring.analytics.teachers.title')} description={t('monitoring.analytics.teachers.description')}
          items={bars(stats.teachers)} emptyText={t('monitoring.analytics.teachers.empty')} />
      </div>
    </div>
  )
}
