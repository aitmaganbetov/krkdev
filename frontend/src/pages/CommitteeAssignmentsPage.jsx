import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  apiErrorText, clearCommitteeAssignments, distributeCommitteeAssignments, getCommitteeAssignments, getCommitteeOrder,
  setCommitteeAssignment, setCommitteeInspectorExcluded,
} from '../services/api'
import {
  Alert, Badge, Button, Card, CardHeader, Checkbox, DataTable, EmptyState, Field, FilterBar, LoadingBlock, PageHeader,
  PageStack, SearchInput, SegmentedControl, Select, StatCard, useUI,
} from '../components/ui'

// Распределение проверок по преподавателям между членами комитета КРК (services/committee_assignments.py).
// Каждому преподавателю с занятиями в семестре назначается член комитета не ниже по званию с другой кафедры;
// назначение можно поменять вручную — список проверяющих в строке содержит только допустимых.
const RANK_TONE = { 4: 'primary', 3: 'info', 2: 'neutral', 1: 'neutral' }
const cafedraName = (item, lang) => (lang === 'kz' && item.cafedra_kz) || item.cafedra_ru || '—'
const fold = (value) => (value || '').toLowerCase()

function TeacherStatus({ item }) {
  const { t } = useTranslation()
  let badge
  if (item.inspector_missing) badge = <Badge tone="danger" dot>{t('assignments.status.missing')}</Badge>
  else if (!item.inspector_id) badge = <Badge tone="warning" dot>{t('assignments.status.unassigned')}</Badge>
  else if (item.done) badge = <Badge tone="success" dot>{t('assignments.status.done')}</Badge>
  else badge = <Badge tone="info" dot>{t('assignments.status.planned')}</Badge>
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {badge}
      {item.manual && <Badge tone="neutral">{t('assignments.manual')}</Badge>}
    </span>
  )
}

export default function CommitteeAssignmentsPage() {
  const { id } = useParams()
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const { toast, confirm } = useUI()

  const [order, setOrder] = useState(null)
  const [term, setTerm] = useState(1)
  const [data, setData] = useState(null)
  // Семестры с числом преподавателей — остаются видны, пока загружается другой семестр
  const [terms, setTerms] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [savingId, setSavingId] = useState(null)
  const [view, setView] = useState('teachers')
  const [search, setSearch] = useState('')
  const [inspectorFilter, setInspectorFilter] = useState('')
  const [onlyUnassigned, setOnlyUnassigned] = useState(false)

  useEffect(() => {
    getCommitteeOrder(id).then(setOrder).catch((err) => setError(apiErrorText(err, t('assignments.loadError'))))
  }, [id, t])

  const load = useCallback(async () => {
    setError('')
    try {
      const result = await getCommitteeAssignments(id, term)
      setData(result)
      setTerms(result.terms)
    } catch (err) {
      setError(apiErrorText(err, t('assignments.loadError')))
    }
  }, [id, term, t])
  useEffect(() => { setData(null); load() }, [load])

  const inspectorsById = useMemo(() => new Map((data?.inspectors || []).map((i) => [i.tutor_id, i])), [data])

  const run = async (action, message) => {
    setBusy(true)
    try {
      const result = await action()
      setData(result)
      toast.success(typeof message === 'function' ? message(result) : message)
    } catch (err) {
      toast.error(apiErrorText(err, t('assignments.actionError')))
    } finally {
      setBusy(false)
    }
  }

  const handleDistribute = async () => {
    const ok = await confirm({ message: t('assignments.distributeConfirm', { term }), confirmLabel: t('assignments.distribute') })
    if (ok) run(() => distributeCommitteeAssignments(id, term), (result) => t('assignments.distributed', result.summary))
  }

  const handleClear = async () => {
    const ok = await confirm({ message: t('assignments.clearConfirm', { term }), confirmLabel: t('assignments.clear'), tone: 'danger' })
    if (ok) run(() => clearCommitteeAssignments(id, term), t('assignments.cleared'))
  }

  // Исключение из проверок не меняет подписанный приказ; проверки исключённого переходят к остальным членам
  const handleExclude = async (inspector) => {
    if (inspector.excluded) {
      run(() => setCommitteeInspectorExcluded(id, inspector.tutor_id, term, false), t('assignments.included', { name: inspector.name }))
      return
    }
    const ok = await confirm({ message: t('assignments.excludeConfirm', { name: inspector.name }), confirmLabel: t('assignments.exclude'), tone: 'danger' })
    if (ok) {
      run(() => setCommitteeInspectorExcluded(id, inspector.tutor_id, term, true),
        (result) => t('assignments.excludedDone', { name: inspector.name, moved: result.moved }))
    }
  }

  const handleAssign = async (item, value) => {
    setSavingId(item.tutor_id)
    try {
      setData(await setCommitteeAssignment(id, { term, teacher_tutor_id: item.tutor_id, inspector_tutor_id: value ? Number(value) : null }))
      toast.success(value ? t('assignments.saved') : t('assignments.removed'))
    } catch (err) {
      toast.error(apiErrorText(err, t('assignments.actionError')))
    } finally {
      setSavingId(null)
    }
  }

  const items = useMemo(() => {
    const query = fold(search.trim())
    return (data?.items || []).filter((item) => (
      (!query || fold(item.name).includes(query) || fold(cafedraName(item, lang)).includes(query))
      && (!inspectorFilter || String(item.inspector_id) === inspectorFilter)
      && (!onlyUnassigned || !item.inspector_id || item.inspector_missing)
    ))
  }, [data, search, inspectorFilter, onlyUnassigned, lang])

  // Допустимые проверяющие строки — сначала наименее загруженные
  const inspectorOptions = (item) => {
    const ids = new Set(item.eligible)
    if (item.inspector_id && !item.inspector_missing) ids.add(item.inspector_id)
    return [...ids].map((tutorId) => inspectorsById.get(tutorId)).filter(Boolean)
      .sort((a, b) => a.load - b.load || a.name.localeCompare(b.name))
      .map((i) => ({ value: String(i.tutor_id), label: t('assignments.inspectorOption', { name: i.name, load: i.load }) }))
  }

  const rankBadge = (rank) => <Badge tone={RANK_TONE[rank]}>{t(`assignments.ranks.${rank}`)}</Badge>
  const person = (item) => (
    <div className="min-w-0">
      <p className="font-medium text-fg">{item.name}</p>
      {item.title && <p className="text-xs text-fg-subtle">{item.title}</p>}
    </div>
  )

  const teacherColumns = [
    { key: 'teacher', header: t('assignments.columns.teacher'), mobile: 'title', minWidth: '14rem', cell: person },
    { key: 'cafedra', header: t('assignments.columns.cafedra'), minWidth: '12rem', cell: (item) => <span className="text-fg-muted">{cafedraName(item, lang)}</span> },
    { key: 'rank', header: t('assignments.columns.rank'), nowrap: true, cell: (item) => rankBadge(item.rank) },
    {
      key: 'inspector',
      header: t('assignments.columns.inspector'),
      minWidth: '15rem',
      cell: (item) => {
        const options = inspectorOptions(item)
        const other = item.other_term_inspector_id && inspectorsById.get(item.other_term_inspector_id)
        return (
          <div className="flex min-w-0 flex-col gap-1">
            <Select size="sm" aria-label={t('assignments.columns.inspector')} value={item.inspector_missing ? '' : String(item.inspector_id || '')}
              placeholder={options.length ? t('assignments.notAssigned') : t('assignments.noEligible')}
              options={options} disabled={busy || savingId === item.tutor_id || (!options.length && !item.inspector_id)}
              onChange={(e) => handleAssign(item, e.target.value)} />
            {other && <span className="text-xs text-fg-subtle">{t('assignments.otherTerm', { name: other.name })}</span>}
          </div>
        )
      },
    },
    { key: 'status', header: t('assignments.columns.status'), nowrap: true, cell: (item) => <TeacherStatus item={item} /> },
  ]

  const inspectorColumns = [
    {
      key: 'member',
      header: t('assignments.columns.member'),
      mobile: 'title',
      minWidth: '14rem',
      cell: (item) => (
        <div className="flex min-w-0 flex-col items-start gap-1">
          {person(item)}
          {item.excluded && <Badge tone="warning" dot>{t('assignments.excluded')}</Badge>}
        </div>
      ),
    },
    { key: 'cafedra', header: t('assignments.columns.cafedra'), minWidth: '12rem', cell: (item) => <span className="text-fg-muted">{cafedraName(item, lang)}</span> },
    { key: 'rank', header: t('assignments.columns.rank'), nowrap: true, cell: (item) => rankBadge(item.rank) },
    { key: 'load', header: t('assignments.columns.termLoad'), align: 'right', nowrap: true, cell: (item) => <span className="tabular font-medium">{item.load}</span> },
    { key: 'total', header: t('assignments.columns.yearLoad'), align: 'right', nowrap: true, cell: (item) => <span className="tabular">{item.total}</span> },
    { key: 'done', header: t('assignments.columns.done'), align: 'right', nowrap: true, cell: (item) => <span className="tabular">{item.done}</span> },
    {
      key: 'actions',
      header: <span className="sr-only">{t('ui.actions')}</span>,
      mobileLabel: t('ui.actions'),
      align: 'right',
      nowrap: true,
      cell: (item) => (
        <span className="inline-flex flex-wrap justify-end gap-1">
          <Button variant="ghost" size="sm" icon="eye" disabled={!item.load}
            onClick={() => { setInspectorFilter(String(item.tutor_id)); setOnlyUnassigned(false); setView('teachers') }}>
            {t('assignments.showTeachers')}
          </Button>
          <Button variant={item.excluded ? 'ghost' : 'danger-ghost'} size="sm" icon={item.excluded ? 'rotate-ccw' : 'minus'} disabled={busy}
            onClick={() => handleExclude(item)}>
            {item.excluded ? t('assignments.include') : t('assignments.exclude')}
          </Button>
        </span>
      ),
    },
  ]

  const summary = data?.summary
  const hasAssignments = Boolean(data?.items.some((item) => item.inspector_id))
  const noSchedule = Boolean(data && !summary.teachers)

  let content
  if (!data) {
    content = !error && <LoadingBlock label={t('ui.loading')} />
  } else if (noSchedule) {
    content = <Card><EmptyState icon="calendar" title={t('assignments.noSchedule', { term })} description={t('assignments.noScheduleHint')} /></Card>
  } else {
    content = (
      <>
        <div className="grid min-w-0 grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label={t('assignments.stats.teachers')} value={summary.teachers} />
          <StatCard label={t('assignments.stats.assigned')} value={summary.assigned} tone="primary" />
          <StatCard label={t('assignments.stats.unassigned')} value={summary.unassigned} tone={summary.unassigned ? 'warning' : 'neutral'} />
          <StatCard label={t('assignments.stats.done')} value={summary.done} tone={summary.done ? 'success' : 'neutral'} />
        </div>

        {!hasAssignments && <Alert tone="info" title={t('assignments.notDistributed', { term })}>{t('assignments.notDistributedHint')}</Alert>}
        {hasAssignments && summary.unassigned > 0 && <Alert tone="warning">{t('assignments.unassignedAlert', { count: summary.unassigned })}</Alert>}

        <Card className="overflow-hidden">
          <CardHeader
            title={t(`assignments.views.${view}`)}
            actions={(
              <SegmentedControl size="sm" ariaLabel={t('assignments.title')} value={view} onChange={setView}
                options={['teachers', 'inspectors'].map((value) => ({ value, label: t(`assignments.views.${value}`) }))} />
            )}
          />
          {view === 'teachers' ? (
            <>
              <div className="border-b border-line p-4">
                <FilterBar ariaLabel={t('assignments.search')}>
                  <Field label={t('assignments.search')}>
                    <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} />
                  </Field>
                  <Field label={t('assignments.inspectorFilter')}>
                    <Select value={inspectorFilter} placeholder={t('assignments.allInspectors')} onChange={(e) => setInspectorFilter(e.target.value)}
                      options={data.inspectors.map((i) => ({ value: String(i.tutor_id), label: t('assignments.inspectorOption', { name: i.name, load: i.load }) }))} />
                  </Field>
                  <div className="flex items-end pb-2">
                    <Checkbox label={t('assignments.onlyUnassigned')} checked={onlyUnassigned} onChange={(e) => setOnlyUnassigned(e.target.checked)} />
                  </div>
                </FilterBar>
              </div>
              <DataTable columns={teacherColumns} rows={items} rowKey="tutor_id" caption={t('assignments.views.teachers')}
                empty={<EmptyState icon="users" title={t('assignments.empty')} />} />
            </>
          ) : (
            <DataTable columns={inspectorColumns} rows={data.inspectors} rowKey="tutor_id" caption={t('assignments.views.inspectors')} />
          )}
        </Card>
      </>
    )
  }

  const orderLabel = order ? (order.number ? `№ ${order.number}` : t('committee.order.draftHeading', { year: order.academic_year })) : ''
  return (
    <PageStack>
      <PageHeader
        back={{ to: '/committee', label: t('assignments.back') }}
        title={t('assignments.title')}
        description={order ? t('assignments.description', { order: orderLabel, year: order.academic_year }) : undefined}
        actions={data && !noSchedule ? (
          <>
            {hasAssignments && <Button variant="danger-ghost" icon="trash" disabled={busy} onClick={handleClear}>{t('assignments.clear')}</Button>}
            <Button icon="refresh" loading={busy} onClick={handleDistribute}>
              {hasAssignments ? t('assignments.redistribute') : t('assignments.distribute')}
            </Button>
          </>
        ) : undefined}
      />

      {terms.length > 0 && (
        <Field label={t('assignments.term')} className="max-w-md">
          <SegmentedControl ariaLabel={t('assignments.term')} value={term} onChange={(value) => { setTerm(value); setInspectorFilter('') }}
            options={terms.map((item) => ({ value: item.term, label: t('assignments.termOption', { term: item.term, count: item.teachers }) }))} />
        </Field>
      )}

      {error && <Alert tone="danger" onClose={() => setError('')} closeLabel={t('ui.close')}>{error}</Alert>}

      {content}

      {data && (
        <Alert tone="info" title={t('assignments.rulesTitle')}>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {t('assignments.rules', { returnObjects: true }).map((rule) => <li key={rule}>{rule}</li>)}
          </ul>
        </Alert>
      )}
    </PageStack>
  )
}
