import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import * as XLSX from 'xlsx-js-style'
import { getRecords, deleteRecord, getBasicInfoCatalog } from '../services/api'
import { useAuth } from '../context/AuthContext'
import Spinner from '../components/Spinner'
import StatusBadge from '../components/StatusBadge'
import { formatDateTimeUtcPlus5, formatDateUtcPlus5 } from '../utils/datetime'

const DEFAULT_PAGE_SIZE = 20
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

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
  { header: 'Соответствие темы и содержания занятия силлабусу', value: (r) => r.ratings?.['1.1'] ?? '' },
  { header: 'Системность и логическая последовательность в содержании материала', value: (r) => r.ratings?.['1.2'] ?? '' },
  { header: 'Содержание и изложение учебного материала', value: (r) => r.ratings?.['1.3'] ?? '' },
  { header: 'Организация самостоятельной работы обучающихся', value: (r) => r.ratings?.['1.4'] ?? '' },
  { header: 'Использование эффективных методов контроля хода занятия и результатов выполнения заданий обучающимися', value: (r) => r.ratings?.['1.5'] ?? '' },
  { header: 'Рациональность использования времени на изучение учебных вопросов', value: (r) => r.ratings?.['1.6'] ?? '' },
  { header: 'Преподавание дисциплины на языке обучения (казахском, английском, русском)', value: (r) => r.ratings?.['1.7'] ?? '' },
  { header: 'Использование приемов поддержания внимания обучающихся и способность установить с ними контакт', value: (r) => r.ratings?.['2.1'] ?? '' },
  { header: 'Умение вызвать и поддержать интерес аудитории к дисциплине', value: (r) => r.ratings?.['2.2'] ?? '' },
  { header: 'Ясность и доступность учебного материала', value: (r) => r.ratings?.['2.3'] ?? '' },
  { header: 'Культура речи, речевые данные, дикция, эрудиция, внешний вид, манера поведения, умение держаться перед аудиторией', value: (r) => r.ratings?.['2.4'] ?? '' },
  { header: 'Доброжелательность и такт по отношению к обучающемуся', value: (r) => r.ratings?.['2.5'] ?? '' },
  { header: 'Организация и активизация деятельности обучающихся, побуждение их к высказыванию, выступлению; анализ выступлений и замечаний, сделанных по их ходу', value: (r) => r.ratings?.['2.6'] ?? '' },
  { header: 'Использование технических средств обучения, современных интерактивных методов обучения, цифровых образовательных ресурсов, прикладного программного обеспечения, использование записей на доске, наглядных пособий, раздаточного материала', value: (r) => r.ratings?.['3.1'] ?? '' },
  { header: 'Творческий подход и интерес к своему делу', value: (r) => r.ratings?.['3.2'] ?? '' },
  { header: 'Практическое применение знаний, полученных по предполагаемой дисциплине. Практик ориентированность', value: (r) => r.ratings?.['3.3'] ?? '' },
  { header: 'Актуальность и новизна предлагаемого материала.', value: (r) => r.ratings?.['3.4'] ?? '' },
  { header: 'Уровень владения английским языком', value: () => '' },
  { header: 'Обязательное заполнение комментарий по занятию, отражение пунктов, по которым снижена оценка или что наиболее понравилось в проведение занятия', value: (r) => r.comment || '' },
  { header: 'Сумма', value: (r) => (Number.isFinite(Number(r.score)) ? Number(r.score).toFixed(2).replace('.', ',') : '') },
  { header: 'Created at', value: (r) => formatDateUtcPlus5(r.created_at) },
]

const RATING_HEADER_TO_KEY = {
  'Соответствие темы и содержания занятия силлабусу': '1.1',
  'Системность и логическая последовательность в содержании материала': '1.2',
  'Содержание и изложение учебного материала': '1.3',
  'Организация самостоятельной работы обучающихся': '1.4',
  'Использование эффективных методов контроля хода занятия и результатов выполнения заданий обучающимися': '1.5',
  'Рациональность использования времени на изучение учебных вопросов': '1.6',
  'Преподавание дисциплины на языке обучения (казахском, английском, русском)': '1.7',
  'Использование приемов поддержания внимания обучающихся и способность установить с ними контакт': '2.1',
  'Умение вызвать и поддержать интерес аудитории к дисциплине': '2.2',
  'Ясность и доступность учебного материала': '2.3',
  'Культура речи, речевые данные, дикция, эрудиция, внешний вид, манера поведения, умение держаться перед аудиторией': '2.4',
  'Доброжелательность и такт по отношению к обучающемуся': '2.5',
  'Организация и активизация деятельности обучающихся, побуждение их к высказыванию, выступлению; анализ выступлений и замечаний, сделанных по их ходу': '2.6',
  'Использование технических средств обучения, современных интерактивных методов обучения, цифровых образовательных ресурсов, прикладного программного обеспечения, использование записей на доске, наглядных пособий, раздаточного материала': '3.1',
  'Творческий подход и интерес к своему делу': '3.2',
  'Практическое применение знаний, полученных по предполагаемой дисциплине. Практик ориентированность': '3.3',
  'Актуальность и новизна предлагаемого материала.': '3.4',
}

export default function RecordsPage() {
  const navigate = useNavigate()
  const { role } = useAuth()
  const { t } = useTranslation()
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
  const [filterFaculty, setFilterFaculty] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [academicYears, setAcademicYears] = useState([])
  const [faculties, setFaculties] = useState([])

  useEffect(() => {
    getBasicInfoCatalog()
      .then((r) => {
        setAcademicYears(r.academic_years ?? [])
        const facultyNames = (r.faculties ?? [])
          .map((faculty) => faculty?.name_ru)
          .filter(Boolean)
        setFaculties(Array.from(new Set(facultyNames)))
      })
      .catch(() => {})
  }, [])

  const fetchRecords = useCallback(async (pageNum = 0) => {
    setLoading(true)
    try {
      const data = await getRecords({
        skip: pageNum * pageSize,
        limit: pageSize,
        search: search || undefined,
        academic_year: filterYear || undefined,
        faculty: filterFaculty || undefined,
        status: filterStatus || undefined,
      })
      setItems(data.items)
      setTotal(data.total)
    } catch {
      setError(t('records.loadError'))
    } finally {
      setLoading(false)
    }
  }, [search, filterYear, filterFaculty, filterStatus, pageSize, t])

  useEffect(() => {
    setPage(0)
    fetchRecords(0)
  }, [fetchRecords])

  const handleDelete = async (id) => {
    if (!window.confirm(t('records.deleteConfirm'))) return
    setDeleting(id)
    try {
      await deleteRecord(id)
      fetchRecords(page)
    } catch {
      alert(t('records.deleteError'))
    } finally {
      setDeleting(null)
    }
  }

  const handleExportExcel = async () => {
    if (!canExportRecords) return

    setExporting(true)
    try {
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
        alert(t('records.notFound'))
        return
      }

      const headerRow = EXPORT_COLUMNS.map((column) => column.header)
      const valueRows = acceptedRows.map((record, index) => EXPORT_COLUMNS.map((column) => column.value(record, index)))
      const totalStudentsPlan = acceptedRows.reduce((sum, record) => sum + Number(record.students_plan || 0), 0)
      const totalStudentsFact = acceptedRows.reduce((sum, record) => sum + Number(record.students_fact || 0), 0)
      const averageScore = acceptedRows.reduce((sum, record) => sum + Number(record.score || 0), 0) / acceptedRows.length
      const totalAttendancePercent = totalStudentsPlan > 0 ? (totalStudentsFact / totalStudentsPlan) * 100 : 0

      const summaryRow = EXPORT_COLUMNS.map((column) => {
        if (column.header === 'Порядковый номер') return 'ИТОГ'
        if (column.header === 'Преподаватель') return `Записей: ${acceptedRows.length}`
        if (column.header === 'Посещаемость %') return `${totalAttendancePercent.toFixed(1).replace('.', ',')}%`
        if (column.header === 'Сумма') return averageScore.toFixed(2).replace('.', ',')

        const ratingKey = RATING_HEADER_TO_KEY[column.header]
        if (ratingKey) {
          const averageRating = acceptedRows.reduce((sum, record) => sum + Number(record.ratings?.[ratingKey] || 0), 0) / acceptedRows.length
          return averageRating.toFixed(2).replace('.', ',')
        }

        return ''
      })

      const allRows = [headerRow, ...valueRows, summaryRow]
      const worksheet = XLSX.utils.aoa_to_sheet(allRows)
      worksheet['!autofilter'] = {
        ref: XLSX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: EXPORT_COLUMNS.length - 1, r: allRows.length - 1 } }),
      }
      worksheet['!cols'] = EXPORT_COLUMNS.map((_, columnIndex) => {
        const maxLength = allRows.reduce((currentMax, row) => {
          const rawValue = row[columnIndex]
          const normalized = rawValue === null || rawValue === undefined ? '' : String(rawValue)
          return Math.max(currentMax, normalized.length)
        }, 0)

        // Add padding and clamp width to keep the sheet readable.
        return { wch: Math.min(Math.max(maxLength + 2, 10), 90) }
      })

      const thinBorder = {
        top: { style: 'thin', color: { rgb: '000000' } },
        bottom: { style: 'thin', color: { rgb: '000000' } },
        left: { style: 'thin', color: { rgb: '000000' } },
        right: { style: 'thin', color: { rgb: '000000' } },
      }

      const accentRowStyle = {
        fill: { fgColor: { rgb: '87CEEB' } },
        font: { bold: true, color: { rgb: '003049' } },
        alignment: { vertical: 'center', horizontal: 'center', wrapText: true },
        border: thinBorder,
      }
      const headerRowIndex = 1
      const summaryRowIndex = valueRows.length + 2

      for (let columnIndex = 0; columnIndex < EXPORT_COLUMNS.length; columnIndex += 1) {
        const columnLetter = XLSX.utils.encode_col(columnIndex)
        const headerCellAddress = `${columnLetter}${headerRowIndex}`
        const summaryCellAddress = `${columnLetter}${summaryRowIndex}`

        if (worksheet[headerCellAddress]) {
          worksheet[headerCellAddress].s = accentRowStyle
        }
        if (worksheet[summaryCellAddress]) {
          worksheet[summaryCellAddress].s = accentRowStyle
        }
      }

      for (let rowIndex = 1; rowIndex <= allRows.length; rowIndex += 1) {
        for (let columnIndex = 0; columnIndex < EXPORT_COLUMNS.length; columnIndex += 1) {
          const cellAddress = `${XLSX.utils.encode_col(columnIndex)}${rowIndex}`
          if (!worksheet[cellAddress]) continue

          worksheet[cellAddress].s = {
            ...(worksheet[cellAddress].s || {}),
            border: thinBorder,
          }
        }
      }

      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Report')

      const today = new Date().toISOString().slice(0, 10)
      XLSX.writeFile(workbook, `records_${today}.xlsx`)
    } catch {
      alert(t('records.exportError'))
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

  const pageTokens = (() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i)
    const candidates = new Set([0, 1, page - 1, page, page + 1, totalPages - 2, totalPages - 1])
    const sorted = [...candidates].filter((v) => v >= 0 && v < totalPages).sort((a, b) => a - b)
    const tokens = []
    for (let i = 0; i < sorted.length; i += 1) {
      if (i > 0 && sorted[i] - sorted[i - 1] > 1) tokens.push('ellipsis')
      tokens.push(sorted[i])
    }
    return tokens
  })()

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('records.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {total === 1 ? t('records.count_one', { count: 1 }) : total < 5 ? t('records.count_few', { count: total }) : t('records.count_many', { count: total })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canExportRecords && (
            <button
              className="btn-secondary"
              onClick={handleExportExcel}
              disabled={loading || exporting}
            >
              {exporting ? t('records.exporting') : t('records.exportExcel')}
            </button>
          )}
          <button className="btn-primary" onClick={() => navigate('/records/new')}>
            + {t('records.addRecord')}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card p-4 flex flex-col sm:flex-row gap-3">
        <input
          className="input flex-1"
          placeholder={t('records.searchPlaceholderFull')}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(0)
          }}
        />
        <select
          className="input sm:w-52"
          value={filterYear}
          onChange={(e) => {
            setFilterYear(e.target.value)
            setPage(0)
          }}
        >
          <option value="">{t('records.allYears')}</option>
          {academicYears.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <select
          className="input sm:w-60"
          value={filterFaculty}
          onChange={(e) => {
            setFilterFaculty(e.target.value)
            setPage(0)
          }}
        >
          <option value="">{t('dashboard.allFaculties')}</option>
          {faculties.map((facultyName) => (
            <option key={facultyName} value={facultyName}>{facultyName}</option>
          ))}
        </select>
        <select
          className="input sm:w-44"
          value={filterStatus}
          onChange={(e) => {
            setFilterStatus(e.target.value)
            setPage(0)
          }}
        >
          <option value="">{t('records.allStatuses')}</option>
          <option value="draft">{t('status.draft')}</option>
          <option value="submitted">{t('status.submitted')}</option>
          <option value="rework">{t('status.rework')}</option>
          <option value="accepted">{t('status.accepted')}</option>
        </select>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><Spinner size="lg" /></div>
        ) : error ? (
          <p className="text-center text-red-500 py-16">{error}</p>
        ) : (
          <>
            {/* Mobile: card list */}
            <div className="md:hidden divide-y divide-gray-100 dark:divide-gray-800">
              {items.map((r) => (
                <div key={r.id} className="p-4 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
                  <div
                    className="flex items-start justify-between gap-3 cursor-pointer"
                    onClick={() => navigate(`/records/${r.id}`)}
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 dark:text-gray-100 leading-snug">{r.teacher}</p>
                      <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{r.subject}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <StatusBadge status={r.status} />
                      <span className={`text-base font-bold ${
                        r.score >= 7 ? 'text-green-600 dark:text-green-400'
                          : r.score >= 5 ? 'text-yellow-600 dark:text-yellow-400'
                            : 'text-red-600 dark:text-red-400'
                      }`}>{r.score.toFixed(1)}</span>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400">
                    <span>{r.group_name}</span>
                    <span>{r.lesson_type}</span>
                    <span>{r.attendance.toFixed(0)}% {t('records.attendance').replace(' %', '')}</span>
                    <span>{formatDateUtcPlus5(r.datetime)}</span>
                  </div>
                  {canManageRecords && (
                    <div className="mt-2 flex gap-3 text-xs">
                      <button
                        className="text-primary-600 dark:text-primary-400 hover:underline"
                        onClick={(e) => {
                          e.stopPropagation()
                          navigate(`/records/${r.id}/edit`)
                        }}
                      >
                        {t('records.edit')}
                      </button>
                      <button
                        className="text-red-500 hover:underline disabled:opacity-40"
                        disabled={deleting === r.id}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDelete(r.id)
                        }}
                      >
                        {deleting === r.id ? '…' : t('records.delete')}
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {items.length === 0 && (
                <p className="text-center py-12 text-gray-400">{t('records.notFound')}</p>
              )}
            </div>

            {/* Desktop: table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide bg-gray-50 dark:bg-gray-800/50">
                    <th className="px-4 py-3">{t('records.teacher')}</th>
                    <th className="px-4 py-3">{t('records.subject')}</th>
                    <th className="px-4 py-3">{t('records.group')}</th>
                    <th className="px-4 py-3">{t('records.op')}</th>
                    <th className="px-4 py-3">{t('records.type')}</th>
                    <th className="px-4 py-3">{t('records.score')}</th>
                    <th className="px-4 py-3">{t('records.attendance')}</th>
                    <th className="px-4 py-3">{t('records.savedBy')}</th>
                    <th className="px-4 py-3">{t('records.status')}</th>
                    <th className="px-4 py-3">{t('records.date')}</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {items.map((r) => (
                    <tr
                      key={r.id}
                      className="hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors"
                    >
                      <td
                        className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100 cursor-pointer hover:text-primary-600 dark:hover:text-primary-400"
                        onClick={() => navigate(`/records/${r.id}`)}
                      >
                        {r.teacher}
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.subject}</td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.group_name}</td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400 max-w-[120px] truncate">{r.op}</td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.lesson_type}</td>
                      <td className="px-4 py-3">
                        <span className={`font-semibold ${
                          r.score >= 7 ? 'text-green-600 dark:text-green-400'
                            : r.score >= 5 ? 'text-yellow-600 dark:text-yellow-400'
                              : 'text-red-600 dark:text-red-400'
                        }`}>
                          {r.score.toFixed(1)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.attendance.toFixed(0)}%</td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.submitted_by_display || r.submitted_by || '—'}</td>
                      <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        {formatDateUtcPlus5(r.datetime)}
                      </td>
                      <td className="px-4 py-3">
                        {canManageRecords ? (
                          <div className="flex items-center gap-2">
                            <button
                              className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
                              onClick={() => navigate(`/records/${r.id}/edit`)}
                            >
                              {t('records.edit')}
                            </button>
                            <button
                              className="text-xs text-red-500 hover:underline disabled:opacity-40"
                              disabled={deleting === r.id}
                              onClick={() => handleDelete(r.id)}
                            >
                              {deleting === r.id ? '…' : t('records.delete')}
                            </button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {items.length === 0 && (
                <p className="text-center py-12 text-gray-400">{t('records.notFound')}</p>
              )}
            </div>

            {/* Pagination */}
            {total > 0 && (
              <div className="flex flex-col gap-3 px-4 py-3 border-t border-gray-100 dark:border-gray-800">

                {/* Total + page size */}
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t('records.totalRecords')}: <span className="font-semibold">{total}</span>
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500 dark:text-gray-400">{t('records.pageSize')}:</span>
                    <select
                      className="input w-20 text-sm py-1"
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value))
                        setPage(0)
                      }}
                    >
                      {PAGE_SIZE_OPTIONS.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Prev / page numbers / Next */}
                {totalPages > 1 && (
                  <div className="flex flex-wrap items-center gap-1">
                    <button
                      className="btn-secondary text-xs px-3 py-1"
                      disabled={page === 0}
                      onClick={() => goToPage(page - 1)}
                    >
                      {t('records.prev')}
                    </button>

                    {pageTokens.map((token, idx) =>
                      token === 'ellipsis' ? (
                        <span key={`e-${idx}`} className="px-1 text-gray-400 select-none">…</span>
                      ) : (
                        <button
                          key={token}
                          onClick={() => goToPage(token)}
                          className={`h-8 min-w-[2rem] px-2 rounded-md text-xs border transition-colors ${
                            token === page
                              ? 'bg-primary-600 border-primary-600 text-white'
                              : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                          }`}
                        >
                          {token + 1}
                        </button>
                      )
                    )}

                    <button
                      className="btn-secondary text-xs px-3 py-1"
                      disabled={page + 1 >= totalPages}
                      onClick={() => goToPage(page + 1)}
                    >
                      {t('records.next')}
                    </button>

                    <span className="ml-2 text-sm text-gray-500 dark:text-gray-400">
                      {t('records.page')} {page + 1} {t('records.of')} {totalPages}
                    </span>
                  </div>
                )}

              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
