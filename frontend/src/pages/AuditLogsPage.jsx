import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { formatDateTimeUtcPlus5 } from '../utils/datetime'
import { apiErrorText, getAuditActions, getAuditActors, getAuditLogs, getAuditStats } from '../services/api'
import {
  Alert, Badge, Button, Card, DataTable, EmptyState, Field, FilterBar, PageHeader, PageStack,
  Pagination, Select, StatCard, TruncatedText,
} from '../components/ui'

// Код действия бэкенда → ключ подписи auditLog.actions.* (точки и дефисы заменены на «_»)
const ACTION_LABEL_KEYS = {
  'auth.login': 'auth_login',
  'auth.logout': 'auth_logout',
  'auth.me': 'auth_me',
  'record.create': 'record_create',
  'record.update': 'record_update',
  'record.delete': 'record_delete',
  'record.submit': 'record_submit',
  'record.send_to_rework': 'record_send_to_rework',
  'record.accept': 'record_accept',
  'admin.users.create': 'admin_users_create',
  'admin.users.update': 'admin_users_update',
  'admin.users.role.update': 'admin_users_role_update',
  'admin.users.block': 'admin_users_block',
  'admin.users.unblock': 'admin_users_unblock',
  'admin.users.delete': 'admin_users_delete',
  'admin.migrate.faculties': 'admin_migrate_faculties',
  'admin.migrate.records-submitted-by': 'admin_migrate_records_submitted_by',
}

// Результат → тон бейджа
const OUTCOME_TONES = {
  success: 'success',
  failure: 'danger',
  blocked: 'warning',
}

// Причины, для которых есть перевод (auditLog.reasons.*)
const KNOWN_REASONS = [
  'rate_limited',
  'too_many_failed_attempts',
  'missing_credentials',
  'invalid_or_expired_token',
  'frontend_401',
  'manual',
]

// Группа действия → тон бейджа (по префиксу кода)
const ACTION_TONES = { auth: 'info', record: 'primary', admin: 'neutral' }

const PERIODS = [1, 7, 30, 90]
const PAGE_SIZE = 50

export default function AuditLogsPage() {
  const { t } = useTranslation()
  const [logs, setLogs] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [page, setPage] = useState(0)
  const [daysBack, setDaysBack] = useState(7)
  const [filterAction, setFilterAction] = useState('')
  const [filterOutcome, setFilterOutcome] = useState('')
  const [filterActor, setFilterActor] = useState('')
  const [allActions, setAllActions] = useState([])
  const [allActors, setAllActors] = useState([])
  const [total, setTotal] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    getAuditLogs({
      skip: page * PAGE_SIZE,
      limit: PAGE_SIZE,
      days_back: daysBack,
      action: filterAction || undefined,
      outcome: filterOutcome || undefined,
      actor: filterActor || undefined,
    })
      .then((data) => {
        if (!active) return
        setLogs(data.logs || [])
        setTotal(data.total || 0)
        setError(null)
      })
      .catch((err) => { if (active) setError(err) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [page, daysBack, filterAction, filterOutcome, filterActor])

  useEffect(() => {
    let active = true
    getAuditStats(daysBack)
      .then((data) => { if (active) setStats(data) })
      .catch(() => {})
    return () => { active = false }
  }, [daysBack])

  useEffect(() => {
    getAuditActions().then((data) => setAllActions(data.actions || [])).catch(() => {})
    getAuditActors().then((data) => setAllActors(data.actors || [])).catch(() => {})
  }, [])

  const errorMessage = error
    ? (error.response?.status === 404 ? t('auditLog.unavailable') : apiErrorText(error, t('common.error')))
    : ''

  const getActionLabel = (action) => (ACTION_LABEL_KEYS[action] ? t(`auditLog.actions.${ACTION_LABEL_KEYS[action]}`) : action)

  const getOutcomeLabel = (outcome) => (OUTCOME_TONES[outcome] ? t(`auditLog.outcomes.${outcome}`) : outcome)

  const getReasonLabel = (details) => {
    const reason = details?.reason
    if (!reason) return ''
    return KNOWN_REASONS.includes(reason) ? t(`auditLog.reasons.${reason}`) : reason
  }

  const hasFilters = Boolean(filterAction || filterOutcome || filterActor)

  const clearFilters = () => {
    setFilterAction('')
    setFilterOutcome('')
    setFilterActor('')
    setPage(0)
  }

  // Состояние страницы 0-базовое, компонент Pagination считает с 1
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const columns = [
    {
      key: 'timestamp',
      header: t('auditLog.columns.time'),
      nowrap: true,
      cell: (log) => <span className="tabular text-fg-muted">{formatDateTimeUtcPlus5(log.timestamp)}</span>,
    },
    {
      key: 'action',
      header: t('auditLog.columns.action'),
      mobile: 'title',
      minWidth: '14rem',
      cell: (log) => (
        <div className="flex min-w-0 flex-col items-start gap-1">
          <Badge tone={ACTION_TONES[String(log.action || '').split('.')[0]] || 'neutral'}>{getActionLabel(log.action)}</Badge>
          <code className="min-w-0 break-all font-mono text-xs font-normal text-fg-subtle">{log.action}</code>
        </div>
      ),
    },
    {
      key: 'outcome',
      header: t('auditLog.columns.outcome'),
      nowrap: true,
      cell: (log) => (
        <Badge tone={OUTCOME_TONES[log.outcome] || 'neutral'} dot>{getOutcomeLabel(log.outcome)}</Badge>
      ),
    },
    {
      key: 'actor',
      header: t('auditLog.columns.actor'),
      minWidth: '9rem',
      cell: (log) => <span className="min-w-0 break-words">{log.actor || '—'}</span>,
    },
    {
      key: 'reason',
      header: t('auditLog.columns.reason'),
      minWidth: '12rem',
      cell: (log) => {
        const reason = getReasonLabel(log.details)
        return reason
          ? <TruncatedText lines={2} className="text-fg-muted">{reason}</TruncatedText>
          : <span className="text-fg-subtle">—</span>
      },
    },
    {
      key: 'ip',
      header: t('auditLog.columns.ip'),
      nowrap: true,
      cell: (log) => <span className="font-mono text-xs text-fg-muted">{log.ip_address || '—'}</span>,
    },
  ]

  return (
    <PageStack>
      <PageHeader title={t('nav.auditLogs')} description={t('auditLog.description')} />

      {/* Сводка за период */}
      {stats && (
        <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          <StatCard label={t('auditLog.stats.total')} value={stats.total_events} icon="audit" />
          <StatCard label={t('auditLog.stats.success')} value={stats.success} icon="check-circle" tone="success" />
          <StatCard label={t('auditLog.stats.failure')} value={stats.failure} icon="alert-circle" tone="danger" />
          <StatCard label={t('auditLog.stats.blocked')} value={stats.blocked} icon="lock" tone="warning" />
          <StatCard label={t('auditLog.stats.actors')} value={stats.unique_actors} icon="users" tone="primary" />
        </div>
      )}

      {/* Фильтры */}
      <FilterBar
        actions={hasFilters && (
          <Button variant="ghost" size="sm" icon="x" onClick={clearFilters}>{t('auditLog.filters.clear')}</Button>
        )}
      >
        <Field label={t('auditLog.filters.period')}>
          <Select
            value={daysBack}
            onChange={(e) => {
              setDaysBack(parseInt(e.target.value))
              setPage(0)
            }}
            options={PERIODS.map((days) => ({ value: days, label: t(`auditLog.periods.d${days}`) }))}
          />
        </Field>
        <Field label={t('auditLog.filters.action')}>
          <Select
            value={filterAction}
            onChange={(e) => {
              setFilterAction(e.target.value)
              setPage(0)
            }}
            placeholder={t('auditLog.filters.all')}
            options={allActions.map((action) => ({ value: action, label: getActionLabel(action) }))}
          />
        </Field>
        <Field label={t('auditLog.filters.outcome')}>
          <Select
            value={filterOutcome}
            onChange={(e) => {
              setFilterOutcome(e.target.value)
              setPage(0)
            }}
            placeholder={t('auditLog.filters.all')}
            options={Object.keys(OUTCOME_TONES).map((outcome) => ({ value: outcome, label: getOutcomeLabel(outcome) }))}
          />
        </Field>
        <Field label={t('auditLog.filters.actor')}>
          <Select
            value={filterActor}
            onChange={(e) => {
              setFilterActor(e.target.value)
              setPage(0)
            }}
            placeholder={t('auditLog.filters.all')}
            options={allActors.map((actor) => ({ value: actor, label: actor }))}
          />
        </Field>
      </FilterBar>

      {errorMessage && (
        <Alert tone="danger" title={t('auditLog.loadErrorTitle')}>
          <p className="break-words">{errorMessage}</p>
          <p className="mt-2 text-xs">{t('auditLog.checklistTitle')}</p>
          <ul className="mt-1 list-disc pl-5 text-xs">
            <li>{t('auditLog.checklist.restarted')}</li>
            <li>{t('auditLog.checklist.reachable')}</li>
            <li>{t('auditLog.checklist.admin')}</li>
          </ul>
        </Alert>
      )}

      {/* Журнал событий */}
      <Card className="overflow-hidden">
        <DataTable
          columns={columns}
          rows={logs}
          rowKey="id"
          loading={loading}
          skeletonRows={8}
          caption={t('auditLog.tableCaption')}
          empty={(
            <EmptyState
              icon="audit"
              title={t('auditLog.empty')}
              description={t('auditLog.emptyHint')}
              compact
              action={hasFilters && (
                <Button variant="secondary" size="sm" icon="x" onClick={clearFilters}>{t('auditLog.filters.clear')}</Button>
              )}
            />
          )}
        />
        {total > 0 && (
          <div className="border-t border-line px-4 py-3 sm:px-5">
            <Pagination
              page={page + 1}
              pageCount={pageCount}
              onPageChange={(next) => setPage(next - 1)}
              total={total}
              pageSize={PAGE_SIZE}
            />
          </div>
        )}
      </Card>
    </PageStack>
  )
}
