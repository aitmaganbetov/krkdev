import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import Spinner from '../components/Spinner'
import { formatDateTimeUtcPlus5 } from '../utils/datetime'

const ACTION_LABELS = {
  'auth.login': 'Вход в систему',
  'auth.logout': 'Выход из системы',
  'auth.me': 'Проверка сессии',
  'record.create': 'Создание записи',
  'record.update': 'Редактирование записи',
  'record.delete': 'Удаление записи',
  'record.submit': 'Отправка записи',
  'record.send_to_rework': 'Возврат на доработку',
  'record.accept': 'Принятие записи',
  'admin.users.create': 'Создание пользователя',
  'admin.users.update': 'Обновление пользователя',
  'admin.users.role.update': 'Изменение роли пользователя',
  'admin.migrate.faculties': 'Импорт факультетов',
  'admin.migrate.records-submitted-by': 'Миграция submitted_by',
}

const OUTCOME_LABELS = {
  success: 'Успешно',
  failure: 'Ошибка',
  blocked: 'Заблокировано',
}

const REASON_LABELS = {
  rate_limited: 'Слишком много попыток входа',
  too_many_failed_attempts: 'Превышен лимит неудачных попыток',
  missing_credentials: 'Отсутствуют данные авторизации',
  invalid_or_expired_token: 'Токен недействителен или истек',
  frontend_401: 'Автоматический выход после 401',
  manual: 'Ручной выход',
}

export default function AuditLogsPage() {
  const { t } = useTranslation()
  const [logs, setLogs] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [page, setPage] = useState(0)
  const [limit, setLimit] = useState(50)
  const [daysBack, setDaysBack] = useState(7)
  const [filterAction, setFilterAction] = useState('')
  const [filterOutcome, setFilterOutcome] = useState('')
  const [filterActor, setFilterActor] = useState('')
  const [allActions, setAllActions] = useState([])
  const [allActors, setAllActors] = useState([])
  const [total, setTotal] = useState(0)

  useEffect(() => {
        if (page === 0 && !logs.length) {
          loadLogs()
          loadStats()
          loadFilters()
        }
      }, [])

      useEffect(() => {
        if (logs.length > 0 || stats) {
          loadLogs()
        }
      }, [page, limit, daysBack, filterAction, filterOutcome, filterActor])

  const loadLogs = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams({
        skip: page * limit,
        limit,
        days_back: daysBack,
      })
      if (filterAction) params.append('action', filterAction)
      if (filterOutcome) params.append('outcome', filterOutcome)
      if (filterActor) params.append('actor', filterActor)

      const response = await fetch(`/api/admin/audit-logs?${params}`, {
        credentials: 'include',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token') || ''}` }
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }))
        const statusText = response.status === 404 
          ? 'Логи аудита недоступны. Убедитесь, что бэкенд перезагружен с новым кодом.' 
          : errorData.detail || `HTTP ${response.status}`
        throw new Error(statusText)
      }
      const data = await response.json()
      setLogs(data.logs || [])
      setTotal(data.total || 0)
      setError(null)
    } catch (err) {
      console.error('Error loading logs:', err)
      setError(err.message || t('common.error'))
    } finally {
      setLoading(false)
    }
  }

  const loadStats = async () => {
    try {
      const response = await fetch(`/api/admin/audit-logs/stats?days_back=${daysBack}`, {
        credentials: 'include',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token') || ''}` }
      })
      if (!response.ok) throw new Error(t('common.error'))
      const data = await response.json()
      setStats(data)
    } catch (err) {
      console.error('Error loading stats:', err)
    }
  }

  const loadFilters = async () => {
    try {
      const [actionsRes, actorsRes] = await Promise.all([
        fetch('/api/admin/audit-logs/actions', {
          credentials: 'include',
          headers: { 'Authorization': `Bearer ${localStorage.getItem('token') || ''}` }
        }),
        fetch('/api/admin/audit-logs/actors', {
          credentials: 'include',
          headers: { 'Authorization': `Bearer ${localStorage.getItem('token') || ''}` }
        })
      ])
      if (actionsRes.ok) {
        const data = await actionsRes.json()
        setAllActions(data.actions || [])
      }
      if (actorsRes.ok) {
        const data = await actorsRes.json()
        setAllActors(data.actors || [])
      }
    } catch (err) {
      console.error('Error loading filters:', err)
    }
  }

  const outcomeColor = (outcome) => {
    switch (outcome) {
      case 'success':
        return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
      case 'failure':
        return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
      case 'blocked':
        return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300'
      default:
        return 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-300'
    }
  }

  const getActionLabel = (action) => ACTION_LABELS[action] || action

  const getOutcomeLabel = (outcome) => OUTCOME_LABELS[outcome] || outcome

  const getReasonLabel = (details) => {
    const reason = details?.reason
    if (!reason) return ''
    return REASON_LABELS[reason] || reason
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white mb-1">Логи аудита</h1>
        <p className="text-gray-600 dark:text-gray-400">Просмотр всех действий в системе</p>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div className="rounded-lg bg-white dark:bg-gray-800 p-3 sm:p-4 shadow-sm border border-gray-200 dark:border-gray-700">
            <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">Всего событий</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{stats.total_events}</p>
          </div>
          <div className="rounded-lg bg-green-50 dark:bg-green-900/20 p-3 sm:p-4 shadow-sm border border-green-200 dark:border-green-800">
            <p className="text-xs sm:text-sm text-green-700 dark:text-green-400">Успешных</p>
            <p className="text-2xl font-bold text-green-900 dark:text-green-300">{stats.success}</p>
          </div>
          <div className="rounded-lg bg-red-50 dark:bg-red-900/20 p-3 sm:p-4 shadow-sm border border-red-200 dark:border-red-800">
            <p className="text-xs sm:text-sm text-red-700 dark:text-red-400">Ошибок</p>
            <p className="text-2xl font-bold text-red-900 dark:text-red-300">{stats.failure}</p>
          </div>
          <div className="rounded-lg bg-yellow-50 dark:bg-yellow-900/20 p-3 sm:p-4 shadow-sm border border-yellow-200 dark:border-yellow-800">
            <p className="text-xs sm:text-sm text-yellow-700 dark:text-yellow-400">Заблокировано</p>
            <p className="text-2xl font-bold text-yellow-900 dark:text-yellow-300">{stats.blocked}</p>
          </div>
          <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 p-3 sm:p-4 shadow-sm border border-blue-200 dark:border-blue-800">
            <p className="text-xs sm:text-sm text-blue-700 dark:text-blue-400">Пользователей</p>
            <p className="text-2xl font-bold text-blue-900 dark:text-blue-300">{stats.unique_actors}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="rounded-lg bg-white dark:bg-gray-800 p-4 shadow-sm border border-gray-200 dark:border-gray-700 space-y-4">
        <h3 className="font-semibold text-gray-900 dark:text-white">Фильтры</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Дней назад</label>
            <select
              value={daysBack}
              onChange={(e) => {
                setDaysBack(parseInt(e.target.value))
                setPage(0)
              }}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
            >
              <option value={1}>1 день</option>
              <option value={7}>7 дней</option>
              <option value={30}>30 дней</option>
              <option value={90}>90 дней</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Действие</label>
            <select
              value={filterAction}
              onChange={(e) => {
                setFilterAction(e.target.value)
                setPage(0)
              }}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
            >
              <option value="">Все</option>
              {allActions.map(action => (
                <option key={action} value={action}>{action}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Результат</label>
            <select
              value={filterOutcome}
              onChange={(e) => {
                setFilterOutcome(e.target.value)
                setPage(0)
              }}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
            >
              <option value="">Все</option>
              <option value="success">Успешно</option>
              <option value="failure">Ошибка</option>
              <option value="blocked">Заблокировано</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Пользователь</label>
            <select
              value={filterActor}
              onChange={(e) => {
                setFilterActor(e.target.value)
                setPage(0)
              }}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
            >
              <option value="">Все</option>
              {allActors.map(actor => (
                <option key={actor} value={actor}>{actor}</option>
              ))}
            </select>
          </div>
        </div>

        {(filterAction || filterOutcome || filterActor) && (
          <button
            onClick={() => {
              setFilterAction('')
              setFilterOutcome('')
              setFilterActor('')
              setPage(0)
            }}
            className="text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300"
          >
            Очистить фильтры
          </button>
        )}
      </div>

      {/* Logs Table */}
      {error && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 p-4 border border-red-200 dark:border-red-800">
          <p className="text-red-700 dark:text-red-300 font-bold mb-3">⚠️ Ошибка при загрузке логов аудита</p>
          <p className="text-red-600 dark:text-red-400 text-sm mb-3">{error}</p>
          <hr className="border-red-200 dark:border-red-700 my-2" />
          <p className="text-xs text-red-500 dark:text-red-400 mt-3">
            <strong>Решение:</strong> Убедитесь, что:
            <br />1. Бэкенд-сервер перезагружен (должны быть загружены новые маршруты)
            <br />2. Сервер доступен по адресу указанному в конфигурации
            <br />3. Пользователь имеет роль администратора
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : (
        <>
          <div className="rounded-lg bg-white dark:bg-gray-800 shadow-sm border border-gray-200 dark:border-gray-700 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-700 dark:text-gray-300">Время</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700 dark:text-gray-300">Действие</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700 dark:text-gray-300">Результат</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700 dark:text-gray-300">Пользователь</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700 dark:text-gray-300">Причина</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700 dark:text-gray-300">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-gray-500 dark:text-gray-400">
                      {t('common.noData')}
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400">{formatDateTimeUtcPlus5(log.timestamp)}</td>
                      <td className="px-4 py-3 text-gray-900 dark:text-gray-100">
                        <div className="text-sm font-medium">{getActionLabel(log.action)}</div>
                        <div className="font-mono text-[11px] text-gray-500 dark:text-gray-400">{log.action}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-medium ${outcomeColor(log.outcome)}`}>
                          {getOutcomeLabel(log.outcome)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-900 dark:text-gray-100">{log.actor}</td>
                      <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400">{getReasonLabel(log.details) || '—'}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-gray-400">{log.ip_address || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between py-4 px-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <div className="text-sm text-gray-600 dark:text-gray-400">
              Показано {Math.min(page * limit + 1, total)}–{Math.min((page + 1) * limit, total)} из {total}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                className="px-3 py-1 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Назад
              </button>
              <button
                onClick={() => setPage(page + 1)}
                disabled={(page + 1) * limit >= total}
                className="px-3 py-1 rounded-lg border border-gray-300 dark:border-gray-600 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Далее
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
