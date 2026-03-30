import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { getRecords, deleteRecord } from '../services/api'
import { useAuth } from '../context/AuthContext'
import Spinner from '../components/Spinner'
import StatusBadge from '../components/StatusBadge'
import { formatDateUtcPlus5 } from '../utils/datetime'

const LIMIT = 20

export default function RecordsPage() {
  const navigate = useNavigate()
  const { role } = useAuth()
  const { t } = useTranslation()
  const canManageRecords = role === 'admin'

  const [items, setItems]     = useState([])
  const [total, setTotal]     = useState(0)
  const [page, setPage]       = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [deleting, setDeleting] = useState(null)

  // Filters
  const [search, setSearch]           = useState('')
  const [filterTeacher, setFilterTeacher] = useState('')
  const [filterSubject, setFilterSubject] = useState('')
  const [filterOp, setFilterOp]           = useState('')
  const [filterYear, setFilterYear]       = useState('')

  const fetchRecords = useCallback(async (pageNum = 0) => {
    setLoading(true)
    try {
      const data = await getRecords({
        skip: pageNum * LIMIT,
        limit: LIMIT,
        search: search || undefined,
        teacher: filterTeacher || undefined,
        subject: filterSubject || undefined,
        op: filterOp || undefined,
        academic_year: filterYear || undefined,
      })
      setItems(data.items)
      setTotal(data.total)
    } catch {
      setError(t('records.loadError'))
    } finally {
      setLoading(false)
    }
  }, [search, filterTeacher, filterSubject, filterOp, filterYear])

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

  const totalPages = Math.ceil(total / LIMIT)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('records.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {total === 1 ? t('records.count_one', {count:1}) : total < 5 ? t('records.count_few', {count:total}) : t('records.count_many', {count:total})}
          </p>
        </div>
        <button className="btn-primary" onClick={() => navigate('/records/new')}>
          + {t('records.addRecord')}
        </button>
      </div>

      {/* Filters */}
      <div className="card p-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <input
          className="input"
          placeholder={t('records.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <input
          className="input"
          placeholder={t('records.teacher')}
          value={filterTeacher}
          onChange={(e) => setFilterTeacher(e.target.value)}
        />
        <input
          className="input"
          placeholder={t('records.subject')}
          value={filterSubject}
          onChange={(e) => setFilterSubject(e.target.value)}
        />
        <input
          className="input"
          placeholder={t('records.op')}
          value={filterOp}
          onChange={(e) => setFilterOp(e.target.value)}
        />
        <input
          className="input"
          placeholder={t('records.academicYear')}
          value={filterYear}
          onChange={(e) => setFilterYear(e.target.value)}
        />
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
                    <span>{r.attendance.toFixed(0)}% {t('records.attendance').replace(' %','')}</span>
                    <span>{formatDateUtcPlus5(r.datetime)}</span>
                  </div>
                  {canManageRecords && (
                    <div className="mt-2 flex gap-3 text-xs">
                      <button
                        className="text-primary-600 dark:text-primary-400 hover:underline"
                        onClick={(e) => { e.stopPropagation(); navigate(`/records/${r.id}/edit`) }}
                      >
                        {t('records.edit')}
                      </button>
                      <button
                        className="text-red-500 hover:underline disabled:opacity-40"
                        disabled={deleting === r.id}
                        onClick={(e) => { e.stopPropagation(); handleDelete(r.id) }}
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
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-gray-800">
                <button
                  className="btn-secondary text-xs"
                  disabled={page === 0}
                  onClick={() => { setPage(page - 1); fetchRecords(page - 1) }}
                >
                  {t('records.prev')}
                </button>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {t('records.page')} {page + 1} {t('records.of')} {totalPages}
                </span>
                <button
                  className="btn-secondary text-xs"
                  disabled={page + 1 >= totalPages}
                  onClick={() => { setPage(page + 1); fetchRecords(page + 1) }}
                >
                  {t('records.next')}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
