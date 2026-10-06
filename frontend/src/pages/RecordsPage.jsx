import { useEffect, useState, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { getRecords, deleteRecord, getBasicInfoCatalog, getAcademicYears } from '../services/api'
import { useAuth } from '../context/AuthContext'
import StatusBadge from '../components/StatusBadge'
import {
  Alert, Button, Card, DataTable, EmptyState, Field, FilterBar, PageHeader, PageStack, Pagination,
  SearchInput, Select, useUI,
} from '../components/ui'
import { formatDateTimeUtcPlus5, formatDateUtcPlus5 } from '../utils/datetime'
import { applicableSections, findTemplate, loadRatingTemplates, localized, templateMaxScore } from '../utils/ratingTemplate'

const DEFAULT_PAGE_SIZE = 20
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

const RATING_COLUMNS_PLACEHOLDER = { placeholder: 'ratings' }

const EXPORT_COLUMNS = [
  { header: 'Порядковый номер', value: (_r, index) => index + 1 },
  { header: 'Проверяющий', value: (r) => r.submitted_by_display || r.submitted_by || '' },
  { header: 'Преподаватель', value: (r) => r.teacher || '' },
  { header: '№ аудитории и корпуса', value: (r) => r.room || '' },
  { header: 'Учебная дисциплина', value: (r) => r.subject || '' },
  { header: 'Вид занятия', value: (r) => r.lesson_type || '' },
  { header: 'Формат проведения занятия', value: (r) => r.format || '' },
  { header: 'Тема занятий', value: (r) => r.topic || '' },
  { header: 'Дата и время посещения', value: (r) => formatDateTimeUtcPlus5(r.datetime) },
  { header: 'Факультет', value: (r) => r.faculty || '' },
  { header: 'Группа/ ОП', value: (r) => [r.group_name, r.op].filter(Boolean).join(' / ') },
  { header: 'Посещаемость %', value: (r) => `${Number(r.attendance || 0).toFixed(1).replace('.', ',')}%` },
  { header: 'Учебный год', value: (r) => r.academic_year || '' },
  // сюда подставляются колонки вопросов из справочника (см. buildRatingColumns)
  RATING_COLUMNS_PLACEHOLDER,
  { header: 'Уровень владения английским языком', value: () => '' },
  { header: 'Обязательное заполнение комментарий по занятию, отражение пунктов, по которым снижена оценка или что наиболее понравилось в проведение занятия', value: (r) => r.comment || '' },
  { header: 'Сумма', value: (r) => (Number.isFinite(Number(r.score)) ? Number(r.score).toFixed(2).replace('.', ',') : '') },
  { header: 'Created at', value: (r) => formatDateUtcPlus5(r.created_at) },
]

function questionTitle(question) {
  return question.report_title || localized(question.text, 'ru') || question.code
}

// Вопросы, которые были в анкете этой записи (год + вид занятия): код -> заголовок
function recordQuestionTitles(templates, record) {
  const template = findTemplate(templates, record.academic_year)
  const titles = new Map()
  applicableSections(template, record.lesson_type).forEach((section) => {
    (section.questions || []).forEach((question) => titles.set(question.code, questionTitle(question)))
  })
  return titles
}

// Колонки вопросов по анкетам выгружаемых записей. Один и тот же вопрос (код + формулировка)
// в разных годах или видах занятия идёт одной колонкой; разные формулировки — разными.
function buildRatingColumns(templates, rows) {
  const ordered = [...rows].sort((a, b) => String(b.academic_year).localeCompare(String(a.academic_year)))
  const columns = []
  const byKey = new Map()
  ordered.forEach((record) => {
    recordQuestionTitles(templates, record).forEach((title, code) => {
      const key = `${code}\u0000${title}`
      if (!byKey.has(key)) {
        const column = { code, title }
        byKey.set(key, column)
        columns.push(column)
      }
    })
  })

  const titlesByRecord = new Map(rows.map((record) => [record, recordQuestionTitles(templates, record)]))
  const codeCounts = columns.reduce((acc, c) => ({ ...acc, [c.code]: (acc[c.code] || 0) + 1 }), {})
  return columns.map((column) => {
    const hasQuestion = (r) => titlesByRecord.get(r)?.get(column.code) === column.title
    return {
      header: codeCounts[column.code] > 1 ? `${column.code}. ${column.title}` : column.title,
      ratingCode: column.code,
      hasQuestion,
      value: (r) => (hasQuestion(r) ? (r.ratings?.[column.code] ?? '') : ''),
    }
  })
}

function buildExportColumns(templates, rows) {
  return EXPORT_COLUMNS.flatMap((column) => (
    column === RATING_COLUMNS_PLACEHOLDER ? buildRatingColumns(templates, rows) : [column]
  ))
}

const EXCEL_ACCENT_FILL = '87CEEB'
const EXCEL_ACCENT_TEXT = '003049'
const EXCEL_BORDER = {
  top: { style: 'thin', color: { argb: 'FF000000' } },
  bottom: { style: 'thin', color: { argb: 'FF000000' } },
  left: { style: 'thin', color: { argb: 'FF000000' } },
  right: { style: 'thin', color: { argb: 'FF000000' } },
}

function createMetricChartDataUrl({ title, value, maxValue, displayValue, color }) {
  const canvas = document.createElement('canvas')
  canvas.width = 960
  canvas.height = 280

  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  ctx.fillStyle = '#0F172A'
  ctx.font = 'bold 28px Arial'
  ctx.fillText(title, 40, 48)

  ctx.fillStyle = '#475569'
  ctx.font = '20px Arial'
  ctx.fillText(`Значение: ${displayValue}`, 40, 84)

  const chartLeft = 40
  const chartTop = 120
  const chartWidth = 840
  const chartHeight = 70
  const safeMax = Math.max(maxValue, 1)
  const normalizedValue = Math.max(0, Math.min(value, safeMax))
  const barWidth = (normalizedValue / safeMax) * chartWidth

  ctx.fillStyle = '#E2E8F0'
  ctx.fillRect(chartLeft, chartTop, chartWidth, chartHeight)

  ctx.fillStyle = color
  ctx.fillRect(chartLeft, chartTop, barWidth, chartHeight)

  ctx.strokeStyle = '#94A3B8'
  ctx.lineWidth = 2
  ctx.strokeRect(chartLeft, chartTop, chartWidth, chartHeight)

  ctx.fillStyle = '#334155'
  ctx.font = '18px Arial'
  ctx.fillText('0', chartLeft, chartTop + 100)
  ctx.fillText(String(displayValue), chartLeft + Math.max(barWidth - 10, 0), chartTop - 12)

  ctx.textAlign = 'right'
  ctx.fillText(String(maxValue), chartLeft + chartWidth, chartTop + 100)
  ctx.textAlign = 'left'

  return canvas.toDataURL('image/png')
}

// Цвет балла: те же пороги, что и раньше (≥ 7 — норма, ≥ 5 — внимание, ниже — нарушение)
function scoreToneClass(score) {
  if (score >= 7) return 'text-success'
  if (score >= 5) return 'text-warning'
  return 'text-danger'
}

const STATUS_FILTER_VALUES = ['draft', 'submitted', 'rework', 'accepted']

export default function RecordsPage() {
  const navigate = useNavigate()
  const { role } = useAuth()
  const { t } = useTranslation()
  const { toast, confirm } = useUI()
  const canManageRecords = role === 'admin'
  const canExportRecords = role === 'admin' || role === 'inspector'

  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState(null)
  const [exporting, setExporting] = useState(false)

  // Filters
  const [search, setSearch] = useState('')
  const [filterYear, setFilterYear] = useState('')
  // Пока не известен учебный год по умолчанию, список не грузим, чтобы не мигал «все годы»
  const [yearReady, setYearReady] = useState(false)
  const [filterFaculty, setFilterFaculty] = useState('')
  const [filterOp, setFilterOp] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [academicYears, setAcademicYears] = useState([])
  const [faculties, setFaculties] = useState([])
  const [opsByFaculty, setOpsByFaculty] = useState({})
  const [allOps, setAllOps] = useState([])

  useEffect(() => {
    getBasicInfoCatalog()
      .then((r) => {
        setAcademicYears(r.academic_years ?? [])
        const catalogFaculties = r.faculties ?? []
        const facultyNames = catalogFaculties
          .map((faculty) => faculty?.name_ru)
          .filter(Boolean)
        setFaculties(Array.from(new Set(facultyNames)))

        const formatOpValue = (specialization) => (
          specialization?.code
            ? `${specialization.code} - ${specialization.name_ru || ''}`.trim()
            : (specialization?.name_ru || '').trim()
        )

        const nextOpsByFaculty = {}
        const opSet = new Set()
        catalogFaculties.forEach((faculty) => {
          const facultyName = faculty?.name_ru
          if (!facultyName) return
          const facultyOps = (faculty?.specializations ?? [])
            .map(formatOpValue)
            .filter(Boolean)
          nextOpsByFaculty[facultyName] = Array.from(new Set(facultyOps)).sort((a, b) => a.localeCompare(b))
          facultyOps.forEach((opValue) => opSet.add(opValue))
        })

        setOpsByFaculty(nextOpsByFaculty)
        setAllOps(Array.from(opSet).sort((a, b) => a.localeCompare(b)))
      })
      .catch(() => {})
  }, [])

  const opOptions = filterFaculty ? (opsByFaculty[filterFaculty] ?? []) : allOps

  const fetchRecords = useCallback(async (pageNum = 0) => {
    setLoading(true)
    try {
      const data = await getRecords({
        skip: pageNum * pageSize,
        limit: pageSize,
        search: search || undefined,
        academic_year: filterYear || undefined,
        faculty: filterFaculty || undefined,
        op: filterOp || undefined,
        status: filterStatus || undefined,
      })
      setItems(data.items)
      setTotal(data.total)
    } catch {
      setError(t('records.loadError'))
    } finally {
      setLoading(false)
    }
  }, [search, filterYear, filterFaculty, filterOp, filterStatus, pageSize, t])

  // Фильтр по умолчанию — учебный год из справочника (выбран админом или текущий по дате)
  useEffect(() => {
    getAcademicYears()
      .then((years) => {
        const defaultYear = years.find((year) => year.is_default)?.name
        if (defaultYear) setFilterYear((current) => current || defaultYear)
      })
      .catch(() => {})
      .finally(() => setYearReady(true))
  }, [])

  useEffect(() => {
    if (!yearReady) return
    setPage(0)
    fetchRecords(0)
  }, [fetchRecords, yearReady])

  const handleDelete = async (record) => {
    const { id } = record
    const ok = await confirm({
      title: t('recordsList.deleteConfirmTitle'),
      message: t('recordsList.deleteConfirm', { teacher: record.teacher || '—' }),
      confirmLabel: t('ui.delete'),
      tone: 'danger',
    })
    if (!ok) return
    setDeleting(id)
    try {
      await deleteRecord(id)
      fetchRecords(page)
      toast.success(t('recordsList.deleted'))
    } catch {
      toast.error(t('recordsList.deleteError'))
    } finally {
      setDeleting(null)
    }
  }

  const handleExportExcel = async () => {
    if (!canExportRecords) return

    setExporting(true)
    try {
      const ExcelJS = (await import('exceljs')).default
      const exportLimit = 200
      let skip = 0
      let totalForExport = 0
      const rows = []

      while (true) {
        const data = await getRecords({
          skip,
          limit: exportLimit,
          search: search || undefined,
          academic_year: filterYear || undefined,
          faculty: filterFaculty || undefined,
          op: filterOp || undefined,
          status: filterStatus || undefined,
        })

        const batch = data?.items ?? []
        totalForExport = data?.total ?? 0
        rows.push(...batch)

        if (!batch.length || rows.length >= totalForExport) {
          break
        }
        skip += exportLimit
      }

      const acceptedRows = rows.filter((record) => record.status === 'accepted')

      if (!acceptedRows.length) {
        toast.warning(t('recordsList.exportEmpty'))
        return
      }

      const templates = await loadRatingTemplates()
      const exportColumns = buildExportColumns(templates, acceptedRows)
      const headerRow = exportColumns.map((column) => column.header)
      const valueRows = acceptedRows.map((record, index) => exportColumns.map((column) => column.value(record, index)))
      const totalStudentsPlan = acceptedRows.reduce((sum, record) => sum + Number(record.students_plan || 0), 0)
      const totalStudentsFact = acceptedRows.reduce((sum, record) => sum + Number(record.students_fact || 0), 0)
      const averageScore = acceptedRows.reduce((sum, record) => sum + Number(record.score || 0), 0) / acceptedRows.length
      const totalAttendancePercent = totalStudentsPlan > 0 ? (totalStudentsFact / totalStudentsPlan) * 100 : 0
      const averageAttendance = acceptedRows.reduce((sum, record) => sum + Number(record.attendance || 0), 0) / acceptedRows.length
      const problemRecords = acceptedRows.filter((record) => record.is_problem).length
      const maxScore = Math.max(...acceptedRows.map((record) => templateMaxScore(findTemplate(templates, record.academic_year))))

      const summaryRow = exportColumns.map((column) => {
        if (column.header === 'Порядковый номер') return 'ИТОГ'
        if (column.header === 'Преподаватель') return `Записей: ${acceptedRows.length}`
        if (column.header === 'Посещаемость %') return `${totalAttendancePercent.toFixed(1).replace('.', ',')}%`
        if (column.header === 'Сумма') return averageScore.toFixed(2).replace('.', ',')

        if (column.ratingCode) {
          const rated = acceptedRows.filter((record) => column.hasQuestion(record) && Number.isFinite(Number(record.ratings?.[column.ratingCode])))
          if (!rated.length) return ''
          const averageRating = rated.reduce((sum, record) => sum + Number(record.ratings[column.ratingCode]), 0) / rated.length
          return averageRating.toFixed(2).replace('.', ',')
        }

        return ''
      })

      const allRows = [headerRow, ...valueRows, summaryRow]
      const workbook = new ExcelJS.Workbook()
      const worksheet = workbook.addWorksheet('Report', {
        views: [{ state: 'frozen', ySplit: 1 }],
      })

      worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: exportColumns.length },
      }

      worksheet.columns = exportColumns.map((_, columnIndex) => {
        const maxLength = allRows.reduce((currentMax, row) => {
          const rawValue = row[columnIndex]
          const normalized = rawValue === null || rawValue === undefined ? '' : String(rawValue)
          return Math.max(currentMax, normalized.length)
        }, 0)

        return { width: Math.min(Math.max(maxLength + 2, 10), 90) }
      })

      allRows.forEach((row) => worksheet.addRow(row))

      worksheet.eachRow((row, rowNumber) => {
        row.eachCell((cell) => {
          cell.border = EXCEL_BORDER
          cell.alignment = {
            vertical: 'middle',
            wrapText: true,
          }
          if (rowNumber === 1 || rowNumber === allRows.length) {
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: `FF${EXCEL_ACCENT_FILL}` },
            }
            cell.font = {
              bold: true,
              color: { argb: `FF${EXCEL_ACCENT_TEXT}` },
            }
            cell.alignment = {
              vertical: 'middle',
              horizontal: 'center',
              wrapText: true,
            }
          }
        })
      })

      const chartsSheet = workbook.addWorksheet('Графики')
      chartsSheet.columns = [
        { width: 4 },
        { width: 24 },
        { width: 24 },
        { width: 24 },
        { width: 24 },
        { width: 24 },
        { width: 24 },
        { width: 24 },
      ]

      chartsSheet.mergeCells('B2:H2')
      chartsSheet.getCell('B2').value = 'Графики по экспортированным данным'
      chartsSheet.getCell('B2').fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: `FF${EXCEL_ACCENT_FILL}` },
      }
      chartsSheet.getCell('B2').font = {
        bold: true,
        size: 16,
        color: { argb: `FF${EXCEL_ACCENT_TEXT}` },
      }
      chartsSheet.getCell('B2').alignment = { horizontal: 'center', vertical: 'middle' }

      chartsSheet.mergeCells('B3:H3')
      chartsSheet.getCell('B3').value = `Фильтры: поиск=${search || 'все'}, год=${filterYear || 'все'}, факультет=${filterFaculty || 'все'}, статус=accepted`
      chartsSheet.getCell('B3').font = { italic: true, color: { argb: 'FF475569' } }

      const chartDefinitions = [
        {
          title: 'Средний балл',
          value: averageScore,
          maxValue: maxScore,
          displayValue: averageScore.toFixed(2).replace('.', ','),
          color: '#0EA5E9',
        },
        {
          title: 'Средняя посещаемость',
          value: averageAttendance,
          maxValue: 100,
          displayValue: `${averageAttendance.toFixed(1).replace('.', ',')}%`,
          color: '#10B981',
        },
        {
          title: 'Проблемные записи',
          value: problemRecords,
          maxValue: Math.max(problemRecords, acceptedRows.length, 1),
          displayValue: String(problemRecords),
          color: '#F97316',
        },
      ]

      chartDefinitions.forEach((chart, index) => {
        const imageData = createMetricChartDataUrl(chart)
        if (!imageData) return

        const imageId = workbook.addImage({
          base64: imageData,
          extension: 'png',
        })

        const topRow = 4 + index * 15
        chartsSheet.addImage(imageId, {
          tl: { col: 1, row: topRow - 1 },
          ext: { width: 900, height: 250 },
        })
      })

      const today = new Date().toISOString().slice(0, 10)
      const buffer = await workbook.xlsx.writeBuffer()
      const blob = new Blob([
        buffer,
      ], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `records_${today}.xlsx`
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error(t('recordsList.exportError'))
    } finally {
      setExporting(false)
    }
  }

  const totalPages = Math.ceil(total / pageSize)

  const goToPage = (targetPage) => {
    if (totalPages <= 0) return
    const next = Math.max(0, Math.min(targetPage, totalPages - 1))
    if (next === page) return
    setPage(next)
    fetchRecords(next)
  }

  // Есть ли активные условия отбора — от этого зависит текст пустого состояния
  const hasFilters = Boolean(search || filterYear || filterFaculty || filterOp || filterStatus)

  // Сброс условий — то же, что пользователь выбрал бы «все» в каждом поле
  const resetFilters = () => {
    setSearch('')
    setFilterYear('')
    setFilterFaculty('')
    setFilterOp('')
    setFilterStatus('')
    setPage(0)
  }

  const statusOptions = STATUS_FILTER_VALUES.map((value) => ({ value, label: t(`status.${value}`) }))

  const columns = [
    {
      key: 'teacher',
      header: t('records.teacher'),
      mobile: 'title',
      minWidth: '13rem',
      cell: (r) => <span className="font-medium text-fg">{r.teacher || '—'}</span>,
    },
    { key: 'subject', header: t('records.subject'), minWidth: '12rem', cell: (r) => r.subject || '—' },
    { key: 'group_name', header: t('records.group'), nowrap: true, cell: (r) => r.group_name || '—' },
    {
      key: 'op',
      header: t('records.op'),
      minWidth: '11rem',
      mobile: 'hidden',
      cell: (r) => r.op || '—',
    },
    { key: 'lesson_type', header: t('records.type'), cell: (r) => r.lesson_type || '—' },
    {
      key: 'score',
      header: t('records.score'),
      align: 'right',
      nowrap: true,
      cell: (r) => <span className={`font-semibold tabular ${scoreToneClass(r.score)}`}>{r.score.toFixed(1)}</span>,
    },
    {
      key: 'attendance',
      header: t('records.attendance'),
      align: 'right',
      nowrap: true,
      cell: (r) => <span className="tabular">{r.attendance.toFixed(0)}%</span>,
    },
    {
      key: 'savedBy',
      header: t('records.savedBy'),
      minWidth: '10rem',
      mobile: 'hidden',
      cell: (r) => r.submitted_by_display || r.submitted_by || '—',
    },
    { key: 'status', header: t('records.status'), nowrap: true, cell: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'datetime',
      header: t('records.date'),
      nowrap: true,
      cell: (r) => <span className="tabular text-fg-muted">{formatDateUtcPlus5(r.datetime)}</span>,
    },
  ]

  if (canManageRecords) {
    columns.push({
      key: 'actions',
      header: <span className="sr-only">{t('ui.actions')}</span>,
      mobileLabel: t('ui.actions'),
      align: 'right',
      nowrap: true,
      cell: (r) => (
        // Клик по кнопкам не должен открывать запись (клик по строке)
        <div className="inline-flex flex-wrap items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="sm"
            icon="edit"
            iconOnly
            aria-label={t('recordsList.editAction')}
            onClick={() => navigate(`/records/${r.id}/edit`)}
          />
          <Button
            variant="danger-ghost"
            size="sm"
            icon="trash"
            iconOnly
            aria-label={t('recordsList.deleteAction')}
            loading={deleting === r.id}
            onClick={() => handleDelete(r)}
          />
        </div>
      ),
    })
  }

  const emptyState = hasFilters ? (
    <EmptyState
      icon="filter"
      title={t('recordsList.filteredTitle')}
      description={t('recordsList.filteredHint')}
      action={<Button variant="secondary" size="sm" icon="rotate-ccw" onClick={resetFilters}>{t('recordsList.filters.reset')}</Button>}
    />
  ) : (
    <EmptyState
      icon="records"
      title={t('recordsList.emptyTitle')}
      description={t('recordsList.emptyHint')}
      action={<Button as={Link} to="/records/new" size="sm" icon="plus">{t('recordsList.add')}</Button>}
    />
  )

  return (
    <PageStack>
      <PageHeader
        title={t('records.title')}
        description={t('records.count', { count: total })}
        actions={(
          <>
            {canExportRecords && (
              <Button
                variant="secondary"
                icon="download"
                loading={exporting}
                disabled={loading}
                onClick={handleExportExcel}
              >
                {exporting ? t('recordsList.exporting') : t('recordsList.export')}
              </Button>
            )}
            <Button as={Link} to="/records/new" icon="plus">{t('recordsList.add')}</Button>
          </>
        )}
      />

      {/* Фильтры: поиск занимает две колонки сетки и не сжимается в «квадрат» */}
      <FilterBar>
        <Field label={t('recordsList.filters.search')} className="sm:col-span-2">
          <SearchInput
            value={search}
            placeholder={t('recordsList.filters.searchPlaceholder')}
            title={t('records.searchPlaceholderFull')}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(0)
            }}
          />
        </Field>
        <Field label={t('recordsList.filters.year')}>
          <Select
            value={filterYear}
            placeholder={t('records.allYears')}
            options={academicYears.map((y) => ({ value: y, label: y }))}
            onChange={(e) => {
              setFilterYear(e.target.value)
              setPage(0)
            }}
          />
        </Field>
        <Field label={t('recordsList.filters.faculty')}>
          <Select
            value={filterFaculty}
            placeholder={t('dashboard.allFaculties')}
            options={faculties.map((facultyName) => ({ value: facultyName, label: facultyName }))}
            onChange={(e) => {
              setFilterFaculty(e.target.value)
              setFilterOp('')
              setPage(0)
            }}
          />
        </Field>
        <Field label={t('recordsList.filters.op')}>
          <Select
            value={filterOp}
            placeholder={t('records.allOps')}
            options={opOptions.map((opValue) => ({ value: opValue, label: opValue }))}
            onChange={(e) => {
              setFilterOp(e.target.value)
              setPage(0)
            }}
          />
        </Field>
        <Field label={t('recordsList.filters.status')}>
          <Select
            value={filterStatus}
            placeholder={t('records.allStatuses')}
            options={statusOptions}
            onChange={(e) => {
              setFilterStatus(e.target.value)
              setPage(0)
            }}
          />
        </Field>
      </FilterBar>

      {/* Ошибка загрузки заменяет таблицу, как и раньше; закрыв сообщение, можно вернуться к списку */}
      {error ? (
        <Alert tone="danger" onClose={() => setError('')} closeLabel={t('ui.close')}>{error}</Alert>
      ) : (
        <Card className="overflow-hidden">
          <DataTable
            columns={columns}
            rows={items}
            loading={loading}
            skeletonRows={Math.min(pageSize, 8)}
            caption={t('recordsList.tableCaption')}
            onRowClick={(r) => navigate(`/records/${r.id}`)}
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
              onPageSizeChange={(size) => {
                setPageSize(size)
                setPage(0)
              }}
            />
          )}
        </Card>
      )}
    </PageStack>
  )
}
