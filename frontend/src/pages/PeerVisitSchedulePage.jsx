import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  apiErrorText, createPeerVisitScheduleRow, deletePeerVisitScheduleRow, getAcademicYears, getBasicInfoCatalog,
  getPeerVisitSchedule, getPeerVisitScheduleSummary, getPeerVisitScheduleTutors, updatePeerVisitScheduleRow,
} from '../services/api'
import { useAuth } from '../context/AuthContext'
import {
  Alert, Badge, Button, Card, CardHeader, Checkbox, Combobox, DataTable, EmptyState, Field, FilterBar, Input, Modal,
  PageHeader, PageStack, SearchInput, Select, StatCard, Textarea, useUI,
} from '../components/ui'
import { SCHEDULE_STATUSES, SCHEDULE_STATUS_TONE } from '../utils/peerVisit'
import { isAdmin } from '../utils/roles'
import { localizedName } from '../utils/locale'

// Учебный год идёт с сентября
const MONTHS = [9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8]
const FORM_ID = 'schedule-row-form'

const emptyForm = (facultyId) => ({
  faculty_id: facultyId ? String(facultyId) : '', cafedra_id: '',
  visited_name: '', visited_position: '', visitor_name: '', visitor_position: '', month: '', note: '',
})

/** Модальная форма строки графика. Преподаватели — из справочника Platonus (подсказки по ФИО). */
function RowForm({ open, row, academicYear, period, faculties, cafedras, tutors, deanFacultyId, onClose, onSaved }) {
  const { t, i18n } = useTranslation()
  const [data, setData] = useState(() => emptyForm(deanFacultyId))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setError('')
    setData(row ? {
      faculty_id: String(row.faculty_id), cafedra_id: row.cafedra_id ? String(row.cafedra_id) : '',
      visited_name: row.visited_name, visited_position: row.visited_position || '',
      visitor_name: row.visitor_name, visitor_position: row.visitor_position || '',
      month: String(row.month), note: row.note || '',
    } : emptyForm(deanFacultyId))
  }, [open, row, deanFacultyId])

  const tutorByName = useMemo(() => new Map(tutors.map((tutor) => [tutor.full_name, tutor])), [tutors])
  // Преподаватели выбранного факультета — первыми (так их отдаёт сервер), кафедра — в пояснении
  const tutorOptions = useMemo(
    () => tutors.map((tutor) => ({ value: tutor.id, label: tutor.full_name, description: tutor.cafedra || '' })),
    [tutors],
  )
  const facultyCafedras = cafedras.filter((c) => !data.faculty_id || String(c.faculty_id) === data.faculty_id)
  const update = (patch) => setData((d) => ({ ...d, ...patch }))
  // Выбран преподаватель из справочника — должность и степень подставляются из Platonus (поле можно изменить)
  const choosePerson = (field, text) => {
    const tutor = tutorByName.get(text.trim())
    const changed = text.trim() !== data[`${field}_name`].trim()
    update({ [`${field}_name`]: text, ...(tutor && changed && tutor.position ? { [`${field}_position`]: tutor.position } : {}) })
  }
  const tutorHint = (name) => (name.trim() && !tutorByName.has(name.trim()) ? t('schedule.form.notInCatalog') : t('schedule.form.tutorHint'))

  const submit = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    const visited = tutorByName.get(data.visited_name.trim())
    const visitor = tutorByName.get(data.visitor_name.trim())
    const payload = {
      cafedra_id: data.cafedra_id ? Number(data.cafedra_id) : null,
      visited_tutor_id: visited?.id ?? null, visited_name: data.visited_name, visited_position: data.visited_position,
      visitor_tutor_id: visitor?.id ?? null, visitor_name: data.visitor_name, visitor_position: data.visitor_position,
      month: Number(data.month), note: data.note.trim() || null,
    }
    if (!deanFacultyId) payload.faculty_id = data.faculty_id ? Number(data.faculty_id) : null
    try {
      if (row) await updatePeerVisitScheduleRow(row.id, payload)
      else await createPeerVisitScheduleRow({ ...payload, academic_year: academicYear, period: Number(period) || 1 })
      onSaved()
    } catch (err) {
      setError(apiErrorText(err, t('schedule.form.saveError')))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={saving ? undefined : onClose}
      size="lg"
      title={row ? t('schedule.form.editTitle') : t('schedule.form.addTitle')}
      description={`${academicYear || ''} · ${t(`schedule.periods.${row?.period || period || 1}`)}`}
      closeLabel={t('ui.close')}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
          <Button type="submit" form={FORM_ID} icon="check" loading={saving}>{t('schedule.form.save')}</Button>
        </>
      )}
    >
      <form id={FORM_ID} onSubmit={submit} className="flex min-w-0 flex-col gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          {!deanFacultyId && (
            <Field label={t('schedule.form.faculty')} required>
              <Select value={data.faculty_id} required placeholder={t('peerVisits.fields.select')}
                options={faculties.map((f) => ({ value: String(f.id), label: localizedName(f, 'name', i18n.language) }))}
                onChange={(e) => update({ faculty_id: e.target.value, cafedra_id: '' })} />
            </Field>
          )}
          <Field label={t('schedule.form.cafedra')}>
            <Select value={data.cafedra_id} placeholder={t('peerVisits.fields.select')}
              options={facultyCafedras.map((c) => ({ value: String(c.id), label: localizedName(c, 'name', i18n.language) }))}
              onChange={(e) => update({ cafedra_id: e.target.value })} />
          </Field>
          <Field label={t('schedule.form.month')} required>
            <Select value={data.month} required placeholder={t('peerVisits.fields.select')}
              options={MONTHS.map((m) => ({ value: String(m), label: t(`schedule.months.${m}`) }))}
              onChange={(e) => update({ month: e.target.value })} />
          </Field>
        </div>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <Field label={t('schedule.form.visited')} required hint={tutorHint(data.visited_name)}>
            <Combobox value={data.visited_name} required options={tutorOptions} sheetTitle={t('schedule.form.visited')}
              placeholder={t('schedule.form.tutorPlaceholder')} onChange={(text) => choosePerson('visited', text)} />
          </Field>
          <Field label={t('schedule.form.visitedPosition')} hint={t('schedule.form.positionHint')}>
            <Input value={data.visited_position} onChange={(e) => update({ visited_position: e.target.value })} />
          </Field>
          <Field label={t('schedule.form.visitor')} required hint={tutorHint(data.visitor_name)}>
            <Combobox value={data.visitor_name} required options={tutorOptions} sheetTitle={t('schedule.form.visitor')}
              placeholder={t('schedule.form.tutorPlaceholder')} onChange={(text) => choosePerson('visitor', text)} />
          </Field>
          <Field label={t('schedule.form.visitorPosition')} hint={t('schedule.form.positionHint')}>
            <Input value={data.visitor_position} onChange={(e) => update({ visitor_position: e.target.value })} />
          </Field>
        </div>
        <Field label={t('schedule.form.note')}>
          <Textarea rows={2} value={data.note} onChange={(e) => update({ note: e.target.value })} />
        </Field>
      </form>
    </Modal>
  )
}

export default function PeerVisitSchedulePage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { toast, confirm } = useUI()
  const { role, facultyId } = useAuth()
  const isDean = role === 'dean'
  const canEdit = isAdmin(role) || isDean

  const [years, setYears] = useState([])
  const [catalog, setCatalog] = useState({ faculties: [], cafedras: [] })
  const [tutors, setTutors] = useState([])
  const [filters, setFilters] = useState({ academic_year: '', period: '1', faculty_id: '', cafedra_id: '', month: '', status: '', unmatched: false })
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [yearReady, setYearReady] = useState(false)
  const [data, setData] = useState({ items: [], total: 0 })
  const [summary, setSummary] = useState({ cafedras: [], total: null })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // undefined — форма закрыта, null — новая строка, объект — правка строки
  const [formRow, setFormRow] = useState(undefined)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    getAcademicYears()
      .then((list) => {
        setYears(list.map((y) => y.name))
        const def = list.find((y) => y.is_default)?.name
        if (def) setFilters((f) => (f.academic_year ? f : { ...f, academic_year: def }))
      })
      .catch(() => {})
      .finally(() => setYearReady(true))
    getBasicInfoCatalog()
      .then((r) => setCatalog({ faculties: r.faculties || [], cafedras: r.cafedras || [] }))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (canEdit) getPeerVisitScheduleTutors().then(setTutors).catch(() => {})
  }, [canEdit])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  const params = useMemo(() => ({
    academic_year: filters.academic_year || undefined,
    period: filters.period || undefined,
    faculty_id: filters.faculty_id || undefined,
    month: filters.month || undefined,
  }), [filters.academic_year, filters.period, filters.faculty_id, filters.month])

  // Номер последнего запроса: ответы устаревших запросов игнорируются
  const requestIdRef = useRef(0)
  const load = useCallback(() => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    setError('')
    Promise.all([
      getPeerVisitSchedule({
        ...params,
        cafedra_id: filters.cafedra_id || undefined,
        status: filters.status || undefined,
        unmatched: filters.unmatched || undefined,
        search: debouncedSearch || undefined,
      }),
      getPeerVisitScheduleSummary(params),
    ])
      .then(([rows, totals]) => {
        if (requestId !== requestIdRef.current) return
        setData(rows)
        setSummary(totals)
      })
      .catch(() => { if (requestId === requestIdRef.current) setError(t('schedule.loadError')) })
      .finally(() => { if (requestId === requestIdRef.current) setLoading(false) })
  }, [params, filters.cafedra_id, filters.status, filters.unmatched, debouncedSearch]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (yearReady) load() }, [load, yearReady])

  const setFilter = (patch) => setFilters((f) => ({ ...f, ...patch }))
  const facultyName = (id) => catalog.faculties.find((f) => String(f.id) === String(id))?.name_ru || ''
  const facultyScope = isDean ? facultyId : filters.faculty_id
  const cafedraOptions = catalog.cafedras.filter((c) => !facultyScope || String(c.faculty_id) === String(facultyScope))
  const hasFilters = Boolean(filters.cafedra_id || filters.month || filters.status || filters.unmatched || search || (!isDean && filters.faculty_id))

  // Печать на утверждение — для одного факультета (у деканата — всегда свой)
  const printFaculty = isDean ? facultyId : filters.faculty_id
  const printUrl = `/peer-visits/schedule/print?${new URLSearchParams({
    academic_year: filters.academic_year || '', period: filters.period || '1', faculty_id: printFaculty ? String(printFaculty) : '',
  })}`

  const resetFilters = () => {
    setSearch('')
    setFilter({ faculty_id: '', cafedra_id: '', month: '', status: '', unmatched: false })
  }

  const handleDelete = async (row) => {
    const ok = await confirm({
      message: t('schedule.form.deleteConfirm', { visitor: row.visitor_name, visited: row.visited_name }),
      confirmLabel: t('ui.delete'),
      tone: 'danger',
    })
    if (!ok) return
    try {
      await deletePeerVisitScheduleRow(row.id)
      toast.success(t('schedule.form.deleted'))
      load()
    } catch (err) {
      toast.error(apiErrorText(err, t('schedule.form.deleteError')))
    }
  }

  // Выгрузка строк по текущим фильтрам (подписи — по-русски, как в бумажном графике)
  const handleExport = async () => {
    setExporting(true)
    try {
      const ru = (key, opts) => t(key, { lng: 'ru', ...opts })
      const { default: ExcelJS } = await import('exceljs')
      const workbook = new ExcelJS.Workbook()
      const sheet = workbook.addWorksheet('График')
      const columns = [
        ['№', (_r, i) => i + 1],
        [ru('schedule.filters.faculty'), (r) => facultyName(r.faculty_id)],
        [ru('schedule.columns.cafedra'), (r) => r.cafedra_name],
        [ru('schedule.columns.visited'), (r) => r.visited_name],
        [ru('schedule.form.visitedPosition'), (r) => r.visited_position || ''],
        [ru('schedule.columns.visitor'), (r) => r.visitor_name],
        [ru('schedule.form.visitorPosition'), (r) => r.visitor_position || ''],
        [ru('schedule.columns.month'), (r) => ru(`schedule.months.${r.month}`)],
        [ru('schedule.columns.status'), (r) => ru(`schedule.statuses.${r.status}`) + (r.late ? ` (${ru('schedule.late')})` : '')],
        [ru('schedule.columns.review'), (r) => (r.review_id ? `№${r.review_id}` : '')],
      ]
      sheet.addRow(columns.map(([header]) => header))
      data.items.forEach((row, index) => sheet.addRow(columns.map(([, value]) => value(row, index))))
      sheet.getRow(1).font = { bold: true }
      sheet.columns.forEach((column) => { column.width = 24 })
      sheet.views = [{ state: 'frozen', ySplit: 1 }]
      const buffer = await workbook.xlsx.writeBuffer()
      const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `peer-visit-schedule_${filters.academic_year || 'all'}.xlsx`
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error(t('common.error'))
    } finally {
      setExporting(false)
    }
  }

  const person = (name, position, matched) => (
    <div className="min-w-0">
      <p className="font-medium text-fg">{name}</p>
      {position && <p className="text-xs text-fg-subtle">{position}</p>}
      {!matched && <Badge tone="warning" className="mt-1">{t('schedule.unmatched')}</Badge>}
    </div>
  )

  const columns = [
    { key: 'cafedra', header: t('schedule.columns.cafedra'), minWidth: '11rem', mobile: 'hidden', cell: (r) => <span className="text-fg-muted">{r.cafedra_name}</span> },
    { key: 'visited', header: t('schedule.columns.visited'), mobile: 'title', minWidth: '14rem', cell: (r) => person(r.visited_name, r.visited_position, Boolean(r.visited_tutor_id)) },
    { key: 'visitor', header: t('schedule.columns.visitor'), minWidth: '14rem', cell: (r) => person(r.visitor_name, r.visitor_position, Boolean(r.visitor_tutor_id)) },
    { key: 'month', header: t('schedule.columns.month'), nowrap: true, cell: (r) => t(`schedule.months.${r.month}`) },
    {
      key: 'status',
      header: t('schedule.columns.status'),
      nowrap: true,
      cell: (r) => (
        <div className="flex flex-col items-start gap-1">
          <Badge tone={SCHEDULE_STATUS_TONE[r.status]} dot>{t(`schedule.statuses.${r.status}`)}</Badge>
          {r.late && <span className="text-xs text-warning">{t('schedule.late')}</span>}
        </div>
      ),
    },
    {
      key: 'review',
      header: t('schedule.columns.review'),
      nowrap: true,
      cell: (r) => (r.review_id ? (
        <Link to={`/peer-visits/${r.review_id}`} onClick={(e) => e.stopPropagation()}
          className="text-sm font-medium text-primary underline-offset-2 hover:underline">
          {t('schedule.openReview', { id: r.review_id })}
        </Link>
      ) : <span className="text-fg-subtle">—</span>),
    },
  ]
  if (canEdit) {
    columns.push({
      key: 'actions',
      header: <span className="sr-only">{t('ui.actions')}</span>,
      mobileLabel: t('ui.actions'),
      align: 'right',
      nowrap: true,
      cell: (r) => (
        // Клик по кнопкам не должен срабатывать как клик по строке
        <div className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="sm" icon="edit" iconOnly aria-label={t('schedule.form.edit')} onClick={() => setFormRow(r)} />
          {!r.review_id && (
            <Button variant="danger-ghost" size="sm" icon="trash" iconOnly aria-label={t('schedule.form.delete')} onClick={() => handleDelete(r)} />
          )}
        </div>
      ),
    })
  }

  const total = summary.total
  const summaryColumns = [
    { key: 'cafedra', header: t('schedule.summary.cafedra'), mobile: 'title', minWidth: '14rem', cell: (c) => <span className="font-medium text-fg">{c.cafedra_name}</span> },
    { key: 'total', header: t('schedule.summary.total'), align: 'right', nowrap: true, cell: (c) => <span className="tabular">{c.total}</span> },
    { key: 'done', header: t('schedule.summary.done'), align: 'right', nowrap: true, cell: (c) => <span className="tabular text-success">{c.done}</span> },
    { key: 'in_progress', header: t('schedule.summary.inProgress'), align: 'right', nowrap: true, cell: (c) => <span className="tabular">{c.in_progress}</span> },
    { key: 'overdue', header: t('schedule.summary.overdue'), align: 'right', nowrap: true, cell: (c) => <span className={c.overdue ? 'tabular font-semibold text-danger' : 'tabular'}>{c.overdue}</span> },
    { key: 'planned', header: t('schedule.summary.planned'), align: 'right', nowrap: true, cell: (c) => <span className="tabular text-fg-muted">{c.planned}</span> },
    {
      key: 'percent',
      header: t('schedule.summary.percent'),
      minWidth: '9rem',
      cell: (c) => (
        <div className="flex min-w-0 items-center gap-2">
          <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-hover" aria-hidden="true">
            <div className="h-full rounded-full bg-success-solid" style={{ width: `${c.percent}%` }} />
          </div>
          <span className="w-10 shrink-0 text-right text-sm font-semibold tabular">{c.percent}%</span>
        </div>
      ),
    },
  ]

  return (
    <PageStack>
      <PageHeader
        title={t('schedule.title')}
        description={isDean && facultyId ? `${facultyName(facultyId)}. ${t('schedule.description')}` : t('schedule.description')}
        actions={(
          <>
            <Button variant="secondary" icon="download" loading={exporting} disabled={loading || !data.items.length} onClick={handleExport}>
              {t('schedule.export')}
            </Button>
            {printFaculty ? (
              <Button as={Link} to={printUrl} variant="secondary" icon="printer">{t('schedule.print.open')}</Button>
            ) : (
              <Button variant="secondary" icon="printer" disabled title={t('schedule.print.needFaculty')}>{t('schedule.print.open')}</Button>
            )}
            {canEdit && <Button icon="plus" onClick={() => setFormRow(null)}>{t('schedule.add')}</Button>}
          </>
        )}
      />

      <FilterBar>
        <Field label={t('schedule.filters.year')}>
          <Select value={filters.academic_year} options={years.map((y) => ({ value: y, label: y }))}
            onChange={(e) => setFilter({ academic_year: e.target.value })} />
        </Field>
        <Field label={t('schedule.filters.period')}>
          <Select value={filters.period} options={[1, 2].map((p) => ({ value: String(p), label: t(`schedule.periods.${p}`) }))}
            onChange={(e) => setFilter({ period: e.target.value })} />
        </Field>
        {!isDean && (
          <Field label={t('schedule.filters.faculty')}>
            <Select value={filters.faculty_id} placeholder={t('schedule.filters.allFaculties')}
              options={catalog.faculties.map((f) => ({ value: String(f.id), label: localizedName(f, 'name', i18n.language) }))}
              onChange={(e) => setFilter({ faculty_id: e.target.value, cafedra_id: '' })} />
          </Field>
        )}
        <Field label={t('schedule.filters.cafedra')}>
          <Select value={filters.cafedra_id} placeholder={t('schedule.filters.allCafedras')}
            options={cafedraOptions.map((c) => ({ value: String(c.id), label: localizedName(c, 'name', i18n.language) }))}
            onChange={(e) => setFilter({ cafedra_id: e.target.value })} />
        </Field>
        <Field label={t('schedule.filters.month')}>
          <Select value={filters.month} placeholder={t('schedule.filters.allMonths')}
            options={MONTHS.map((m) => ({ value: String(m), label: t(`schedule.months.${m}`) }))}
            onChange={(e) => setFilter({ month: e.target.value })} />
        </Field>
        <Field label={t('schedule.filters.status')}>
          <Select value={filters.status} placeholder={t('schedule.filters.allStatuses')}
            options={SCHEDULE_STATUSES.map((s) => ({ value: s, label: t(`schedule.statuses.${s}`) }))}
            onChange={(e) => setFilter({ status: e.target.value })} />
        </Field>
        <Field label={t('schedule.filters.search')} className="sm:col-span-2">
          <SearchInput value={search} placeholder={t('schedule.filters.searchPlaceholder')} onChange={(e) => setSearch(e.target.value)} />
        </Field>
        <div className="flex min-w-0 items-end pb-2 sm:col-span-2">
          <Checkbox label={t('schedule.filters.unmatched')} checked={filters.unmatched} onChange={(e) => setFilter({ unmatched: e.target.checked })} />
        </div>
      </FilterBar>

      {error ? (
        <Alert tone="danger" onClose={() => setError('')} closeLabel={t('ui.close')}>{error}</Alert>
      ) : (
        <>
          {total && (
            <div className="grid min-w-0 grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard label={t('schedule.summary.total')} value={total.total} />
              <StatCard label={t('schedule.summary.done')} tone="success" value={`${total.percent}%`}
                hint={`${total.done} / ${total.total}${total.late ? ` · ${t('schedule.summary.lateHint', { count: total.late })}` : ''}`} />
              <StatCard label={t('schedule.summary.inProgress')} tone="primary" value={total.in_progress} />
              <StatCard label={t('schedule.summary.overdue')} tone={total.overdue ? 'danger' : 'neutral'} value={total.overdue} />
            </div>
          )}

          {summary.cafedras.length > 0 && (
            <Card className="overflow-hidden">
              <CardHeader title={t('schedule.summary.title')} />
              <DataTable
                columns={summaryColumns}
                rows={summary.cafedras.map((c) => ({ ...c, id: `${c.faculty_id}-${c.cafedra_name}` }))}
                caption={t('schedule.summary.title')}
                onRowClick={(c) => c.cafedra_id && setFilter({ cafedra_id: String(c.cafedra_id) })}
              />
            </Card>
          )}

          <Card className="overflow-hidden">
            <div className="border-b border-line px-4 py-3 text-sm text-fg-muted sm:px-5">{t('schedule.count', { count: data.total })}</div>
            <DataTable
              columns={columns}
              rows={data.items}
              loading={loading}
              skeletonRows={8}
              caption={t('schedule.title')}
              onRowClick={(r) => { if (r.review_id) navigate(`/peer-visits/${r.review_id}`) }}
              maxHeight="70vh"
              empty={(
                <EmptyState
                  icon="calendar"
                  title={t('schedule.emptyTitle')}
                  description={t('schedule.emptyHint')}
                  action={hasFilters ? (
                    <Button variant="secondary" size="sm" icon="rotate-ccw" onClick={resetFilters}>{t('schedule.filters.reset')}</Button>
                  ) : undefined}
                />
              )}
            />
          </Card>
        </>
      )}

      <RowForm
        open={formRow !== undefined}
        row={formRow || null}
        academicYear={filters.academic_year}
        period={filters.period}
        faculties={catalog.faculties}
        cafedras={catalog.cafedras}
        tutors={tutors}
        deanFacultyId={isDean ? facultyId : null}
        onClose={() => setFormRow(undefined)}
        onSaved={() => {
          setFormRow(undefined)
          toast.success(t('schedule.form.saved'))
          load()
        }}
      />
    </PageStack>
  )
}
