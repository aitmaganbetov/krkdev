import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { deletePeerVisit, getAcademicYears, getMyPeerVisitSchedule, getPeerVisits } from '../services/api'
import { useAuth } from '../context/AuthContext'
import StatusBadge from '../components/StatusBadge'
import {
  Alert, Badge, Button, Card, CardHeader, DataTable, EmptyState, Field, FilterBar, PageHeader, PageStack, Pagination,
  SearchInput, Select, useUI,
} from '../components/ui'
import { formatDateTimeUtcPlus5, formatDateUtcPlus5 } from '../utils/datetime'
import { COMMENT_FIELDS, CRITERIA, FACULTIES, LEVEL_TONE, SCHEDULE_STATUS_TONE, STATUSES, overallLevel } from '../utils/peerVisit'
import { managesWorkspace } from '../utils/roles'

const DEFAULT_PAGE_SIZE = 20
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]
const EXPORT_PAGE_SIZE = 200

// Колонки выгрузки в Excel — в порядке пунктов бланка, подписи на русском (как выгрузка записей КРК)
function exportColumns(t) {
  const ru = (key, opts) => t(key, { lng: 'ru', ...opts })
  const valueLabel = (group, value) => (value === undefined || value === null ? '' : ru(`peerVisits.${group}.${value}`, { defaultValue: value }))
  const field = (key) => ru(`peerVisits.fields.${key}`)
  return [
    { header: '№', value: (_v, index) => index + 1 },
    { header: field('datetime'), value: (v) => formatDateTimeUtcPlus5(v.datetime) },
    { header: field('academicYear'), value: (v) => v.academic_year },
    { header: field('teacher'), value: (v) => v.teacher },
    { header: field('department'), value: (v) => v.department },
    { header: field('faculty'), value: (v) => valueLabel('faculties', v.faculty) },
    { header: field('educationLevel'), value: (v) => valueLabel('educationLevels', v.education_level) },
    { header: field('course'), value: (v) => v.course },
    { header: field('group'), value: (v) => v.group_name },
    { header: field('studentsPlan'), value: (v) => v.students_plan },
    { header: field('studentsFact'), value: (v) => v.students_fact },
    { header: field('language'), value: (v) => valueLabel('languages', v.language) },
    { header: field('subject'), value: (v) => v.subject },
    { header: field('lessonType'), value: (v) => valueLabel('lessonTypes', v.lesson_type) },
    { header: field('topic'), value: (v) => v.topic },
    ...CRITERIA.map((criterion) => ({
      header: `${criterion.code}. ${ru(`peerVisits.criteria.${criterion.code}.title`)}`,
      value: (v) => {
        if (criterion.kind === 'syllabus') return valueLabel('syllabus', v.syllabus_compliant ? 'yes' : 'no')
        if (criterion.kind === 'level') return valueLabel('levels', v.ratings?.[criterion.code])
        return v[criterion.field] || ''
      },
    })),
    { header: ru('peerVisits.summary.overall'), value: (v) => valueLabel('levelsShort', overallLevel(v.score)) },
    { header: ru('peerVisits.summary.scoreColumn'), value: (v) => Number(v.score || 0).toFixed(2).replace('.', ',') },
    ...COMMENT_FIELDS.map((name) => ({ header: ru(`peerVisits.comments.${name}`), value: (v) => v[name] || '' })),
    { header: field('visitorName'), value: (v) => v.visitor_name },
    { header: field('visitorPosition'), value: (v) => v.visitor_position },
    { header: field('visitorDegree'), value: (v) => v.visitor_degree || '' },
    { header: ru('peerVisits.columns.status'), value: (v) => ru(`status.${v.status}`, { defaultValue: v.status }) },
    { header: ru('peerVisits.detail.submittedBy'), value: (v) => v.submitted_by_display || v.submitted_by || '' },
  ]
}

export default function PeerVisitsPage() {
  const navigate = useNavigate()
  const { role } = useAuth()
  const { t } = useTranslation()
  const { toast, confirm } = useUI()
  const canManage = managesWorkspace(role)
  const canExport = managesWorkspace(role) || role === 'peer_inspector'
  // Деканат проверяет отзывы, но сам их не заполняет; «Пользователь» заполняет отзывы только из своего плана
  const canCreate = role !== 'user' && role !== 'teacher'
  const hasPlan = role !== 'dean'
  // План посещений по графику: строки, где пользователь — посещающий
  const [myPlan, setMyPlan] = useState([])
  useEffect(() => {
    if (hasPlan) getMyPeerVisitSchedule().then(setMyPlan).catch(() => {})
  }, [hasPlan])

  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [deleting, setDeleting] = useState(null)
  const [exporting, setExporting] = useState(false)

  const [search, setSearch] = useState('')
  // Запрос к API уходит после паузы ввода
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filterYear, setFilterYear] = useState('')
  // Пока не известен учебный год по умолчанию, список не грузим, чтобы не мигал «все годы»
  const [yearReady, setYearReady] = useState(false)
  const [filterFaculty, setFilterFaculty] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [academicYears, setAcademicYears] = useState([])

  useEffect(() => {
    getAcademicYears()
      .then((years) => {
        setAcademicYears(years.map((year) => year.name))
        const defaultYear = years.find((year) => year.is_default)?.name
        if (defaultYear) setFilterYear((current) => current || defaultYear)
      })
      .catch(() => {})
      .finally(() => setYearReady(true))
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  const filterParams = useCallback(() => ({
    search: debouncedSearch || undefined,
    academic_year: filterYear || undefined,
    faculty: filterFaculty || undefined,
    status: filterStatus || undefined,
  }), [debouncedSearch, filterYear, filterFaculty, filterStatus])

  // Номер последнего запроса: ответы устаревших запросов игнорируются
  const requestIdRef = useRef(0)
  const fetchVisits = useCallback(async (pageNum = 0) => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    setError(false)
    try {
      const data = await getPeerVisits({ skip: pageNum * pageSize, limit: pageSize, ...filterParams() })
      if (requestId !== requestIdRef.current) return
      setItems(data.items)
      setTotal(data.total)
    } catch {
      if (requestId === requestIdRef.current) setError(true)
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }, [filterParams, pageSize])

  useEffect(() => {
    if (!yearReady) return
    setPage(0)
    fetchVisits(0)
  }, [fetchVisits, yearReady])

  const handleDelete = async (visit) => {
    const ok = await confirm({
      title: t('peerVisits.confirm.deleteTitle'),
      message: t('peerVisits.confirm.delete', { teacher: visit.teacher || '—' }),
      confirmLabel: t('ui.delete'),
      tone: 'danger',
    })
    if (!ok) return
    setDeleting(visit.id)
    try {
      await deletePeerVisit(visit.id)
      fetchVisits(page)
      toast.success(t('peerVisits.toast.deleted'))
    } catch {
      toast.error(t('peerVisits.apiErrors.delete'))
    } finally {
      setDeleting(null)
    }
  }

  // Выгрузка всех отзывов по текущим фильтрам (постранично: сервер отдаёт не больше 200 за раз)
  const handleExport = async () => {
    setExporting(true)
    try {
      const rows = []
      for (let skip = 0; ; skip += EXPORT_PAGE_SIZE) {
        const data = await getPeerVisits({ skip, limit: EXPORT_PAGE_SIZE, ...filterParams() })
        rows.push(...data.items)
        if (rows.length >= data.total || data.items.length === 0) break
      }
      const { default: ExcelJS } = await import('exceljs')
      const workbook = new ExcelJS.Workbook()
      const sheet = workbook.addWorksheet('Взаимопосещение')
      const columns = exportColumns(t)
      sheet.addRow(columns.map((c) => c.header))
      rows.forEach((row, index) => sheet.addRow(columns.map((c) => c.value(row, index) ?? '')))
      const header = sheet.getRow(1)
      header.font = { bold: true }
      header.alignment = { vertical: 'top', wrapText: true }
      sheet.columns.forEach((column) => { column.width = 22 })
      sheet.views = [{ state: 'frozen', ySplit: 1 }]
      const buffer = await workbook.xlsx.writeBuffer()
      const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `peer-visits_${filterYear || 'all'}.xlsx`
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error(t('common.error'))
    } finally {
      setExporting(false)
    }
  }

  const totalPages = Math.ceil(total / pageSize)
  const goToPage = (target) => {
    if (totalPages <= 0) return
    const next = Math.max(0, Math.min(target, totalPages - 1))
    if (next === page) return
    setPage(next)
    fetchVisits(next)
  }

  const hasFilters = Boolean(search || filterYear || filterFaculty || filterStatus)
  const resetFilters = () => {
    setSearch('')
    setFilterYear('')
    setFilterFaculty('')
    setFilterStatus('')
    setPage(0)
  }

  const columns = [
    {
      key: 'teacher',
      header: t('peerVisits.columns.teacher'),
      mobile: 'title',
      minWidth: '13rem',
      cell: (v) => <span className="font-medium text-fg">{v.teacher || '—'}</span>,
    },
    { key: 'visitor', header: t('peerVisits.columns.visitor'), minWidth: '12rem', cell: (v) => v.visitor_name || '—' },
    { key: 'subject', header: t('peerVisits.columns.subject'), minWidth: '12rem', cell: (v) => v.subject || '—' },
    {
      key: 'faculty',
      header: t('peerVisits.columns.faculty'),
      minWidth: '10rem',
      mobile: 'hidden',
      cell: (v) => t(`peerVisits.faculties.${v.faculty}`, { defaultValue: v.faculty }),
    },
    {
      key: 'level',
      header: t('peerVisits.columns.level'),
      nowrap: true,
      cell: (v) => {
        const level = overallLevel(v.score)
        return level ? <Badge tone={LEVEL_TONE[level]}>{t(`peerVisits.levelsShort.${level}`)}</Badge> : '—'
      },
    },
    { key: 'status', header: t('peerVisits.columns.status'), nowrap: true, cell: (v) => <StatusBadge status={v.status} /> },
    {
      key: 'datetime',
      header: t('peerVisits.columns.date'),
      nowrap: true,
      cell: (v) => <span className="tabular text-fg-muted">{formatDateUtcPlus5(v.datetime)}</span>,
    },
  ]

  if (canManage) {
    columns.push({
      key: 'actions',
      header: <span className="sr-only">{t('ui.actions')}</span>,
      mobileLabel: t('ui.actions'),
      align: 'right',
      nowrap: true,
      cell: (v) => (
        // Клик по кнопкам не должен открывать отзыв (клик по строке)
        <div className="inline-flex flex-wrap items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {v.status !== 'accepted' && (
            <>
              <Button variant="ghost" size="sm" icon="edit" iconOnly aria-label={t('peerVisits.actions.editAction')}
                onClick={() => navigate(`/peer-visits/${v.id}/edit`)} />
              <Button variant="danger-ghost" size="sm" icon="trash" iconOnly aria-label={t('peerVisits.actions.deleteAction')}
                loading={deleting === v.id} onClick={() => handleDelete(v)} />
            </>
          )}
        </div>
      ),
    })
  }

  const emptyState = hasFilters ? (
    <EmptyState
      icon="filter"
      title={t('peerVisits.filteredTitle')}
      description={t('peerVisits.filteredHint')}
      action={<Button variant="secondary" size="sm" icon="rotate-ccw" onClick={resetFilters}>{t('peerVisits.filters.reset')}</Button>}
    />
  ) : (
    <EmptyState
      icon="user-check"
      title={t('peerVisits.emptyTitle')}
      description={t('peerVisits.emptyHint')}
      action={canCreate ? <Button as={Link} to="/peer-visits/new" size="sm" icon="plus">{t('peerVisits.add')}</Button> : undefined}
    />
  )

  const planColumns = [
    { key: 'visited', header: t('schedule.columns.visited'), mobile: 'title', minWidth: '14rem', cell: (r) => <span className="font-medium text-fg">{r.visited_name}</span> },
    { key: 'cafedra', header: t('schedule.columns.cafedra'), minWidth: '11rem', mobile: 'hidden', cell: (r) => r.cafedra_name },
    { key: 'month', header: t('schedule.columns.month'), nowrap: true, cell: (r) => `${t(`schedule.months.${r.month}`)} ${r.academic_year}` },
    {
      key: 'status',
      header: t('schedule.columns.status'),
      nowrap: true,
      cell: (r) => <Badge tone={SCHEDULE_STATUS_TONE[r.status]} dot>{t(`schedule.statuses.${r.status}`)}</Badge>,
    },
    {
      key: 'action',
      header: <span className="sr-only">{t('ui.actions')}</span>,
      mobileLabel: t('ui.actions'),
      align: 'right',
      nowrap: true,
      cell: (r) => (r.review_id ? (
        <Button as={Link} to={`/peer-visits/${r.review_id}`} variant="secondary" size="sm" icon="file-text">{t('peerVisits.myPlan.open')}</Button>
      ) : (
        <Button as={Link} to={`/peer-visits/new?schedule=${r.id}`} size="sm" icon="edit">{t('peerVisits.myPlan.fill')}</Button>
      )),
    },
  ]

  return (
    <PageStack>
      <PageHeader
        title={t('peerVisits.title')}
        description={t('peerVisits.count', { count: total })}
        actions={(
          <>
            {canExport && (
              <Button variant="secondary" icon="download" loading={exporting} disabled={loading || total === 0} onClick={handleExport}>
                {exporting ? t('recordsList.exporting') : t('recordsList.export')}
              </Button>
            )}
            {canCreate && <Button as={Link} to="/peer-visits/new" icon="plus">{t('peerVisits.add')}</Button>}
          </>
        )}
      />

      {myPlan.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader title={t('peerVisits.myPlan.title')} description={t('peerVisits.myPlan.description')} />
          <DataTable columns={planColumns} rows={myPlan} caption={t('peerVisits.myPlan.title')} />
        </Card>
      )}

      <FilterBar>
        <Field label={t('peerVisits.filters.search')} className="sm:col-span-2">
          <SearchInput
            value={search}
            placeholder={t('peerVisits.filters.searchPlaceholder')}
            onChange={(e) => { setSearch(e.target.value); setPage(0) }}
          />
        </Field>
        <Field label={t('peerVisits.filters.year')}>
          <Select
            value={filterYear}
            placeholder={t('peerVisits.filters.allYears')}
            options={academicYears.map((y) => ({ value: y, label: y }))}
            onChange={(e) => { setFilterYear(e.target.value); setPage(0) }}
          />
        </Field>
        <Field label={t('peerVisits.filters.faculty')}>
          <Select
            value={filterFaculty}
            placeholder={t('peerVisits.filters.allFaculties')}
            options={FACULTIES.map((code) => ({ value: code, label: t(`peerVisits.faculties.${code}`) }))}
            onChange={(e) => { setFilterFaculty(e.target.value); setPage(0) }}
          />
        </Field>
        <Field label={t('peerVisits.filters.status')}>
          <Select
            value={filterStatus}
            placeholder={t('peerVisits.filters.allStatuses')}
            options={STATUSES.map((value) => ({ value, label: t(`status.${value}`) }))}
            onChange={(e) => { setFilterStatus(e.target.value); setPage(0) }}
          />
        </Field>
      </FilterBar>

      {/* Ошибка загрузки заменяет таблицу; закрыв сообщение, можно вернуться к списку */}
      {error ? (
        <Alert tone="danger" onClose={() => setError(false)} closeLabel={t('ui.close')}>{t('peerVisits.loadError')}</Alert>
      ) : (
        <Card className="overflow-hidden">
          <DataTable
            columns={columns}
            rows={items}
            loading={loading}
            skeletonRows={Math.min(pageSize, 8)}
            caption={t('peerVisits.tableCaption')}
            onRowClick={(v) => navigate(`/peer-visits/${v.id}`)}
            maxHeight="70vh"
            empty={emptyState}
          />
          {!loading && total > 0 && (
            <Pagination
              className="border-t border-line px-4 py-3 sm:px-5"
              page={page + 1}
              pageCount={totalPages}
              onPageChange={(p) => goToPage(p - 1)}
              total={total}
              pageSize={pageSize}
              pageSizeOptions={PAGE_SIZE_OPTIONS}
              onPageSizeChange={(size) => { setPageSize(size); setPage(0) }}
            />
          )}
        </Card>
      )}
    </PageStack>
  )
}
