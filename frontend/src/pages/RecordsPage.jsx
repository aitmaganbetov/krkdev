import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { getRecords, deleteRecord } from '../services/api'
import { useAuth } from '../context/AuthContext'
import Spinner from '../components/Spinner'
import StatusBadge from '../components/StatusBadge'

const LIMIT = 20

export default function RecordsPage() {
  const navigate = useNavigate()
  const { role } = useAuth()
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
      setError('Не удалось загрузить записи')
    } finally {
      setLoading(false)
    }
  }, [search, filterTeacher, filterSubject, filterOp, filterYear])

  useEffect(() => {
    setPage(0)
    fetchRecords(0)
  }, [fetchRecords])

  const handleDelete = async (id) => {
    if (!window.confirm('Удалить запись?')) return
    setDeleting(id)
    try {
      await deleteRecord(id)
      fetchRecords(page)
    } catch {
      alert('Ошибка удаления')
    } finally {
      setDeleting(null)
    }
  }

  const totalPages = Math.ceil(total / LIMIT)

  return (
    <div className="space-y-5 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Записи</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {total} {total === 1 ? 'запись' : total < 5 ? 'записи' : 'записей'}
          </p>
        </div>
        <button className="btn-primary" onClick={() => navigate('/records/new')}>
          + Добавить запись
        </button>
      </div>

      {/* Filters */}
      <div className="card p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <input
          className="input"
          placeholder="Поиск (преподаватель, дисциплина)…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <input
          className="input"
          placeholder="Преподаватель"
          value={filterTeacher}
          onChange={(e) => setFilterTeacher(e.target.value)}
        />
        <input
          className="input"
          placeholder="Дисциплина"
          value={filterSubject}
          onChange={(e) => setFilterSubject(e.target.value)}
        />
        <input
          className="input"
          placeholder="ОП"
          value={filterOp}
          onChange={(e) => setFilterOp(e.target.value)}
        />
        <input
          className="input"
          placeholder="Учебный год (2025/2026)"
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
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide bg-gray-50 dark:bg-gray-800/50">
                    <th className="px-4 py-3">Преподаватель</th>
                    <th className="px-4 py-3">Дисциплина</th>
                    <th className="px-4 py-3">Группа</th>
                    <th className="px-4 py-3">ОП</th>
                    <th className="px-4 py-3">Тип</th>
                    <th className="px-4 py-3">Бал</th>
                    <th className="px-4 py-3">Посещ. %</th>
                    <th className="px-4 py-3">Сохранил/отправил</th>
                    <th className="px-4 py-3">Статус</th>
                    <th className="px-4 py-3">Дата</th>
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
                        {new Date(r.datetime).toLocaleDateString('ru-RU')}
                      </td>
                      <td className="px-4 py-3">
                        {canManageRecords ? (
                          <div className="flex items-center gap-2">
                            <button
                              className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
                              onClick={() => navigate(`/records/${r.id}/edit`)}
                            >
                              Ред.
                            </button>
                            <button
                              className="text-xs text-red-500 hover:underline disabled:opacity-40"
                              disabled={deleting === r.id}
                              onClick={() => handleDelete(r.id)}
                            >
                              {deleting === r.id ? '…' : 'Удал.'}
                            </button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {items.length === 0 && (
                <p className="text-center py-12 text-gray-400">Записи не найдены</p>
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
                  ← Назад
                </button>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  Страница {page + 1} из {totalPages}
                </span>
                <button
                  className="btn-secondary text-xs"
                  disabled={page + 1 >= totalPages}
                  onClick={() => { setPage(page + 1); fetchRecords(page + 1) }}
                >
                  Вперед →
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
