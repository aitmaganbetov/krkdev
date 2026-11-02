import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  getBasicInfoCatalog, getCatalogCafedras, getCatalogFaculties, getCatalogGroups, getCatalogSpecializations,
  getCatalogStudents, getCatalogTutors,
} from '../services/api'
import {
  Alert, Badge, Button, Card, DataTable, EmptyState, Field, FilterBar, Pagination, SearchInput, Select,
} from '../components/ui'
import { formatDateTimeUtcPlus5 } from '../utils/datetime'
import { localizedName } from '../utils/locale'

const PAGE_SIZE_OPTIONS = [20, 50, 100, 200]

// Вкладки справочника: загрузка, фильтры и переход к вложенному справочнику по клику на строку
const KINDS = {
  faculties: { load: getCatalogFaculties, filters: [], next: (row) => `/catalogs/cafedras?faculty_id=${row.id}` },
  cafedras: { load: getCatalogCafedras, filters: ['faculty_id'], next: (row) => `/catalogs/specializations?cafedra_id=${row.id}` },
  specializations: {
    load: getCatalogSpecializations,
    filters: ['faculty_id', 'cafedra_id'],
    next: (row) => `/catalogs/groups?specialization_id=${row.id}`,
  },
  groups: { load: getCatalogGroups, filters: ['faculty_id', 'cafedra_id', 'specialization_id'], next: null },
  // Вкладки раздела «Пользователи». Студентов загружает синхронизация расписания, а не справочников
  tutors: {
    load: getCatalogTutors,
    filters: ['faculty_id', 'cafedra_id'],
    next: (row) => `/users/tutors/${row.id}`,
    caption: 'usersSection.tabs.tutors',
  },
  students: {
    load: getCatalogStudents,
    filters: ['faculty_id'],
    next: (row) => `/users/students/${row.id}`,
    caption: 'usersSection.tabs.students',
    source: { text: 'usersSection.studentsSource', link: '/schedule', linkText: 'usersSection.studentsSourceLink' },
  },
}

const DEFAULT_SOURCE = { text: 'platonusCatalog.source', link: '/settings', linkText: 'platonusCatalog.sourceLink' }

const countCell = (value) => <span className="tabular">{value ?? 0}</span>

export default function PlatonusCatalogPage({ kind }) {
  const config = KINDS[kind]
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const querySearch = params.get('search') || ''
  const [search, setSearch] = useState(querySearch)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(50)
  const [data, setData] = useState({ total: 0, items: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [options, setOptions] = useState({ faculties: [], cafedras: [] })

  const filterValue = (name) => params.get(name) || ''
  const filterKey = config.filters.map((name) => filterValue(name)).join('|')

  // Варианты фильтров — из общего справочника (тот же, что у форм)
  useEffect(() => {
    if (!config.filters.length) return
    getBasicInfoCatalog()
      .then((result) => setOptions({ faculties: result.faculties || [], cafedras: result.cafedras || [] }))
      .catch(() => {})
  }, [config.filters.length])

  // Поле поиска следует за адресом (переход между вкладками, «Сбросить фильтры»)
  useEffect(() => { setSearch(querySearch) }, [kind]) // eslint-disable-line react-hooks/exhaustive-deps

  // Поиск попадает в адрес страницы после паузы ввода
  useEffect(() => {
    if (search === querySearch) return undefined
    const timer = setTimeout(() => {
      setParams((prev) => {
        const next = new URLSearchParams(prev)
        if (search) next.set('search', search)
        else next.delete('search')
        return next
      }, { replace: true })
    }, 300)
    return () => clearTimeout(timer)
  }, [search, querySearch, setParams])

  // При смене вкладки, фильтров или размера страницы — на первую страницу
  useEffect(() => { setPage(0) }, [kind, filterKey, querySearch, pageSize])

  // Номер последнего запроса: ответы устаревших запросов игнорируются
  const requestIdRef = useRef(0)
  useEffect(() => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    setError(false)
    const query = { skip: page * pageSize, limit: pageSize, search: querySearch || undefined }
    config.filters.forEach((name) => { if (params.get(name)) query[name] = params.get(name) })
    config.load(query)
      .then((result) => { if (requestId === requestIdRef.current) setData(result) })
      .catch(() => { if (requestId === requestIdRef.current) setError(true) })
      .finally(() => { if (requestId === requestIdRef.current) setLoading(false) })
  }, [kind, page, pageSize, querySearch, filterKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Смена фильтра сбрасывает зависящие от него (кафедра зависит от факультета и т. д.)
  const setFilter = (name, value, reset = []) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      ;[name, ...reset].forEach((key) => next.delete(key))
      if (value) next.set(name, value)
      return next
    })
  }

  const facultyId = filterValue('faculty_id')
  const cafedraOptions = options.cafedras.filter((c) => !facultyId || String(c.faculty_id) === facultyId)
  const specializationOptions = options.faculties
    .filter((f) => !facultyId || String(f.id) === facultyId)
    .flatMap((f) => f.specializations || [])
  const hasFilters = Boolean(querySearch || config.filters.some((name) => filterValue(name)))

  const resetFilters = () => {
    setSearch('')
    setParams({}, { replace: true })
  }

  const name = (row, prefix = 'name') => localizedName(row, prefix, lang) || '—'
  const titleCell = (row) => <span className="font-medium text-fg">{name(row)}</span>
  const personCell = (row) => (
    <div className="flex min-w-0 flex-col">
      <span className="font-medium text-fg">{row.full_name || '—'}</span>
      {row.email && <span className="break-all text-xs text-fg-muted">{row.email}</span>}
    </div>
  )
  const loginCell = (row) => <span className="break-all text-fg-muted">{row.login || '—'}</span>
  // Учётная запись КРК: роль и последний вход; «Не входил» — человека в users ещё нет
  const accountCell = ({ account }) => (account ? (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex flex-wrap gap-1">
        <Badge tone="primary">{t(`shell.roles.${account.role || 'user'}`)}</Badge>
        {account.blocked && <Badge tone="danger">{t('usersSection.blocked')}</Badge>}
      </div>
      <span className="text-xs text-fg-muted tabular">{account.last_login_at ? formatDateTimeUtcPlus5(account.last_login_at) : '—'}</span>
    </div>
  ) : <span className="text-fg-subtle">{t('usersSection.noAccount')}</span>)
  // Вход по ЭЦП возможен, когда в Platonus есть и ИИН, и логин (ИИН сопоставляется с сертификатом)
  const ecpCell = (row) => {
    if (row.has_iin && row.login) return <Badge tone="success" icon="key">{t('usersSection.ecp.ready')}</Badge>
    return <Badge tone="neutral">{t(row.has_iin ? 'usersSection.ecp.noLogin' : 'usersSection.ecp.noIin')}</Badge>
  }
  const columnsByKind = {
    faculties: [
      { key: 'name', header: t('platonusCatalog.columns.name'), mobile: 'title', minWidth: '16rem', cell: titleCell },
      { key: 'cafedras', header: t('platonusCatalog.columns.cafedras'), align: 'right', nowrap: true, cell: (r) => countCell(r.cafedras_count) },
      { key: 'specializations', header: t('platonusCatalog.columns.specializations'), align: 'right', nowrap: true, cell: (r) => countCell(r.specializations_count) },
      { key: 'groups', header: t('platonusCatalog.columns.groups'), align: 'right', nowrap: true, cell: (r) => countCell(r.groups_count) },
    ],
    cafedras: [
      { key: 'name', header: t('platonusCatalog.columns.name'), mobile: 'title', minWidth: '16rem', cell: titleCell },
      { key: 'faculty', header: t('platonusCatalog.columns.faculty'), minWidth: '14rem', cell: (r) => name(r, 'faculty_name') },
      { key: 'specializations', header: t('platonusCatalog.columns.specializations'), align: 'right', nowrap: true, cell: (r) => countCell(r.specializations_count) },
      { key: 'tutors', header: t('platonusCatalog.columns.tutors'), align: 'right', nowrap: true, cell: (r) => countCell(r.tutors_count) },
    ],
    specializations: [
      { key: 'code', header: t('platonusCatalog.columns.code'), nowrap: true, cell: (r) => <span className="tabular text-fg-muted">{r.code || '—'}</span> },
      { key: 'name', header: t('platonusCatalog.columns.name'), mobile: 'title', minWidth: '16rem', cell: titleCell },
      { key: 'cafedra', header: t('platonusCatalog.columns.cafedra'), minWidth: '12rem', cell: (r) => name(r, 'cafedra_name') },
      { key: 'faculty', header: t('platonusCatalog.columns.faculty'), minWidth: '12rem', mobile: 'hidden', cell: (r) => name(r, 'faculty_name') },
      { key: 'groups', header: t('platonusCatalog.columns.groups'), align: 'right', nowrap: true, cell: (r) => countCell(r.groups_count) },
    ],
    groups: [
      { key: 'group', header: t('platonusCatalog.columns.group'), mobile: 'title', nowrap: true, cell: (r) => <span className="font-medium text-fg">{r.name || '—'}</span> },
      {
        key: 'specialization',
        header: t('platonusCatalog.columns.specialization'),
        minWidth: '16rem',
        cell: (r) => (r.specialization_id
          ? [r.specialization_code, localizedName(r, 'specialization_name', lang)].filter(Boolean).join(' — ')
          : '—'),
      },
      { key: 'cafedra', header: t('platonusCatalog.columns.cafedra'), minWidth: '12rem', mobile: 'hidden', cell: (r) => name(r, 'cafedra_name') },
      { key: 'faculty', header: t('platonusCatalog.columns.faculty'), minWidth: '12rem', mobile: 'hidden', cell: (r) => name(r, 'faculty_name') },
    ],
    tutors: [
      { key: 'name', header: t('usersSection.columns.fullName'), mobile: 'title', minWidth: '14rem', cell: personCell },
      { key: 'cafedra', header: t('platonusCatalog.columns.cafedra'), minWidth: '12rem', cell: (r) => name(r, 'cafedra_name') },
      { key: 'faculty', header: t('platonusCatalog.columns.faculty'), minWidth: '12rem', mobile: 'hidden', cell: (r) => name(r, 'faculty_name') },
      { key: 'login', header: t('usersSection.columns.login'), minWidth: '8rem', cell: loginCell },
      { key: 'ecp', header: t('usersSection.columns.ecp'), nowrap: true, cell: ecpCell },
      { key: 'account', header: t('usersSection.columns.account'), minWidth: '10rem', cell: accountCell },
    ],
    students: [
      { key: 'name', header: t('usersSection.columns.fullName'), mobile: 'title', minWidth: '14rem', cell: personCell },
      { key: 'group', header: t('platonusCatalog.columns.group'), nowrap: true, cell: (r) => r.group_name || '—' },
      { key: 'specialization', header: t('usersSection.columns.programme'), nowrap: true, mobile: 'hidden', cell: (r) => <span className="tabular text-fg-muted">{r.specialization_code || '—'}</span> },
      { key: 'faculty', header: t('platonusCatalog.columns.faculty'), minWidth: '12rem', mobile: 'hidden', cell: (r) => name(r, 'faculty_name') },
      { key: 'login', header: t('usersSection.columns.login'), minWidth: '8rem', cell: loginCell },
      { key: 'ecp', header: t('usersSection.columns.ecp'), nowrap: true, cell: ecpCell },
      { key: 'account', header: t('usersSection.columns.account'), minWidth: '10rem', cell: accountCell },
    ],
  }
  const source = config.source || DEFAULT_SOURCE

  const totalPages = Math.ceil(data.total / pageSize)
  const emptyState = hasFilters ? (
    <EmptyState
      icon="filter"
      title={t('platonusCatalog.filteredTitle')}
      description={t('platonusCatalog.filteredHint')}
      action={<Button variant="secondary" size="sm" icon="rotate-ccw" onClick={resetFilters}>{t('platonusCatalog.reset')}</Button>}
    />
  ) : (
    <EmptyState
      icon="database"
      title={t('platonusCatalog.emptyTitle')}
      description={t('platonusCatalog.emptyHint')}
      action={<Button as={Link} to={source.link} variant="secondary" size="sm" icon="settings">{t(source.linkText)}</Button>}
    />
  )

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Alert tone="info">
        {t(source.text)}{' '}
        <Link to={source.link} className="font-medium underline underline-offset-2">{t(source.linkText)}</Link>
      </Alert>

      <FilterBar>
        <Field label={t('platonusCatalog.search')} className="sm:col-span-2">
          <SearchInput value={search} placeholder={t(`platonusCatalog.searchPlaceholder.${kind}`)} onChange={(e) => setSearch(e.target.value)} />
        </Field>
        {config.filters.includes('faculty_id') && (
          <Field label={t('platonusCatalog.columns.faculty')}>
            <Select
              value={facultyId}
              placeholder={t('platonusCatalog.allFaculties')}
              options={options.faculties.map((f) => ({ value: String(f.id), label: localizedName(f, 'name', lang) }))}
              onChange={(e) => setFilter('faculty_id', e.target.value, ['cafedra_id', 'specialization_id'])}
            />
          </Field>
        )}
        {config.filters.includes('cafedra_id') && (
          <Field label={t('platonusCatalog.columns.cafedra')}>
            <Select
              value={filterValue('cafedra_id')}
              placeholder={t('platonusCatalog.allCafedras')}
              options={cafedraOptions.map((c) => ({ value: String(c.id), label: localizedName(c, 'name', lang) }))}
              onChange={(e) => setFilter('cafedra_id', e.target.value, ['specialization_id'])}
            />
          </Field>
        )}
        {config.filters.includes('specialization_id') && (
          <Field label={t('platonusCatalog.columns.specialization')}>
            <Select
              value={filterValue('specialization_id')}
              placeholder={t('platonusCatalog.allSpecializations')}
              options={specializationOptions.map((s) => ({
                value: String(s.id),
                label: [s.code, localizedName(s, 'name', lang)].filter(Boolean).join(' — '),
              }))}
              onChange={(e) => setFilter('specialization_id', e.target.value)}
            />
          </Field>
        )}
      </FilterBar>

      {error ? (
        <Alert tone="danger" onClose={() => setError(false)} closeLabel={t('ui.close')}>{t('platonusCatalog.loadError')}</Alert>
      ) : (
        <Card className="overflow-hidden">
          <div className="border-b border-line px-4 py-3 text-sm text-fg-muted sm:px-5">
            {t(`platonusCatalog.count.${kind}`, { count: data.total })}
          </div>
          <DataTable
            columns={columnsByKind[kind]}
            rows={data.items}
            loading={loading}
            skeletonRows={8}
            caption={t(config.caption || `catalogs.tabs.${kind}`)}
            onRowClick={config.next ? (row) => navigate(config.next(row)) : undefined}
            maxHeight="65vh"
            empty={emptyState}
          />
          {!loading && data.total > Math.min(...PAGE_SIZE_OPTIONS) && (
            <Pagination
              className="border-t border-line px-4 py-3 sm:px-5"
              page={page + 1}
              pageCount={totalPages}
              onPageChange={(p) => setPage(p - 1)}
              total={data.total}
              pageSize={pageSize}
              pageSizeOptions={PAGE_SIZE_OPTIONS}
              onPageSizeChange={setPageSize}
            />
          )}
        </Card>
      )}
    </div>
  )
}
