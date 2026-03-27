import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getDashboardFacultyComparison, getDashboardStats, getRecordFilterOptions } from '../services/api'
import Spinner from '../components/Spinner'

function StatCard({ title, value, sub, color = 'blue' }) {
  const colors = {
    blue:   'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
    green:  'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400',
    yellow: 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-400',
    red:    'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400',
  }
  return (
    <div className="card p-5">
      <p className="text-sm text-gray-500 dark:text-gray-400">{title}</p>
      <p className={`text-3xl font-bold mt-1 ${colors[color]}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{sub}</p>}
    </div>
  )
}

export default function DashboardPage() {
  const { t } = useTranslation()
  const [stats, setStats] = useState(null)
  const [filterOptions, setFilterOptions] = useState({ faculties: [], ops: [] })
  const [comparison, setComparison] = useState([])
  const [selectedFaculty, setSelectedFaculty] = useState('')
  const [selectedOp, setSelectedOp] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    getRecordFilterOptions()
      .then((data) => {
        setFilterOptions(data || { faculties: [], ops: [] })
      })
      .catch(() => {
        setFilterOptions({ faculties: [], ops: [] })
      })
  }, [])

  useEffect(() => {
    setLoading(true)
    setError('')
    const statsPromise = getDashboardStats({
      faculty: selectedFaculty || undefined,
      op: selectedOp || undefined,
    })

    const comparisonPromise = getDashboardFacultyComparison({
      faculty: selectedFaculty || undefined,
      op: selectedOp || undefined,
    })

    Promise.all([statsPromise, comparisonPromise])
      .then(([statsData, comparisonData]) => {
        setStats(statsData)
        setComparison(comparisonData || [])
      })
      .catch(() => setError(t('dashboard.loadError')))
      .finally(() => setLoading(false))
  }, [selectedFaculty, selectedOp])

  const facultyOptions = useMemo(() => filterOptions?.faculties || [], [filterOptions])

  const opOptions = useMemo(() => {
    if (!selectedFaculty) {
      return (filterOptions?.ops || []).map((name) => ({ id: name, name }))
    }

    const target = facultyOptions.find((faculty) => faculty.name === selectedFaculty)
    return (target?.ops || []).map((name) => ({ id: name, name }))
  }, [facultyOptions, filterOptions, selectedFaculty])

  const averageScoreHeight = Math.max(8, Math.min(100, (Number(stats?.avg_score || 0) / 10) * 100))

  const comparisonTitle = useMemo(() => {
    if (selectedOp) return t('dashboard.compareByGroup')
    if (selectedFaculty) return t('dashboard.compareByOp')
    return t('dashboard.compareByFaculty')
  }, [selectedFaculty, selectedOp])

  const maxComparisonScore = useMemo(() => Math.max(...comparison.map((item) => Number(item.avg_score || 0)), 10), [comparison])
  const maxComparisonAttendance = useMemo(() => Math.max(...comparison.map((item) => Number(item.avg_attendance || 0)), 100), [comparison])
  const maxComparisonProblems = useMemo(() => Math.max(...comparison.map((item) => Number(item.problem_records || 0)), 1), [comparison])

  const renderComparisonChart = (title, valueKey, maxValue, formatter = (v) => String(v)) => (
    <div className="card p-4">
      <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">{title}</h3>
      {comparison.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('dashboard.noDataChart')}</p>
      ) : (
        <div className="h-[220px] rounded-2xl border border-indigo-100/70 dark:border-indigo-900/40 bg-gradient-to-b from-indigo-50/70 via-white to-emerald-50/60 dark:from-gray-900 dark:via-gray-900 dark:to-emerald-950/30 p-3">
          <div className="h-full w-full flex items-end justify-between gap-2">
            {comparison.map((item) => {
              const raw = Number(item[valueKey] || 0)
              const heightPct = Math.max(10, (raw / maxValue) * 100)
              return (
                <div key={`${valueKey}-${item.label}`} className="flex-1 h-full flex flex-col justify-end items-center">
                  <div className="text-[11px] font-semibold text-indigo-700 dark:text-indigo-300 mb-1">{formatter(raw)}</div>
                  <div
                    className="w-full rounded-t-lg rounded-b-sm bg-gradient-to-b from-indigo-600 to-emerald-500 shadow-[0_8px_14px_rgba(79,70,229,0.25)]"
                    style={{
                      height: `${heightPct}%`,
                      minHeight: '18px',
                    }}
                  />
                  <div className="pt-2 text-[10px] text-center text-gray-600 dark:text-gray-400 line-clamp-2">
                    {item.label}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )

  if (loading) return (
    <div className="flex items-center justify-center h-64"><Spinner size="lg" /></div>
  )
  if (error) return (
    <div className="text-red-500 text-center mt-20">{error}</div>
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('dashboard.title')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('dashboard.subtitle')}</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard title={t('dashboard.totalRecords')} value={stats.total_records} color="blue" />
        <StatCard
          title={t('dashboard.avgScore')}
          value={stats.avg_score.toFixed(1)}
          sub={t('dashboard.outOf')}
          color={stats.avg_score >= 7 ? 'green' : stats.avg_score >= 5 ? 'yellow' : 'red'}
        />
        <StatCard
          title={t('dashboard.avgAttendance')}
          value={`${stats.avg_attendance.toFixed(1)}%`}
          color={stats.avg_attendance >= 75 ? 'green' : 'yellow'}
        />
        <StatCard
          title={t('dashboard.problemRecords')}
          value={stats.problem_records}
          sub={t('dashboard.belowFive')}
          color={stats.problem_records > 0 ? 'red' : 'green'}
        />
      </div>

      <div className="card p-5">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">{t('dashboard.filters')}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="label">{t('dashboard.faculty')}</label>
            <select
              className="input"
              value={selectedFaculty}
              onChange={(e) => {
                setSelectedFaculty(e.target.value)
                setSelectedOp('')
              }}
            >
              <option value="">{t('dashboard.allFaculties')}</option>
              {facultyOptions.map((faculty) => (
                <option key={faculty.name} value={faculty.name}>{faculty.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">{t('dashboard.op')}</label>
            <select
              className="input"
              value={selectedOp}
              onChange={(e) => setSelectedOp(e.target.value)}
            >
              <option value="">{t('dashboard.allOp')}</option>
              {opOptions.map((op) => (
                <option key={op.id} value={op.name}>{op.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="card p-5">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">{t('dashboard.avgScoreTitle')}</h2>
        {Number(stats.total_records || 0) === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('dashboard.noData')}</p>
        ) : (
          <div className="h-[260px] w-full rounded-2xl border border-indigo-100/70 dark:border-indigo-900/40 bg-gradient-to-b from-indigo-50/70 via-white to-emerald-50/60 dark:from-gray-900 dark:via-gray-900 dark:to-emerald-950/30 p-4">
            <div className="h-full w-full flex items-end justify-center">
              <div className="w-full max-w-[320px] h-full flex flex-col items-center justify-end">
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">{t('dashboard.avgScoreLabel')}</div>
                <div
                  className="w-full rounded-t-xl rounded-b-md bg-gradient-to-b from-indigo-600 to-emerald-500 shadow-[0_10px_18px_rgba(79,70,229,0.25)] transition-all duration-300"
                  style={{
                    height: `${averageScoreHeight}%`,
                    minHeight: '24px',
                  }}
                />
                <div className="mt-3 text-2xl font-bold text-indigo-600 dark:text-indigo-400">
                  {Number(stats.avg_score || 0).toFixed(1)} / 10
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">{comparisonTitle}</h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {renderComparisonChart(t('dashboard.chartScore'), 'avg_score', maxComparisonScore, (v) => `${v.toFixed(1)}`)}
          {renderComparisonChart(t('dashboard.chartAttendance'), 'avg_attendance', maxComparisonAttendance, (v) => `${v.toFixed(1)}%`)}
          {renderComparisonChart(t('dashboard.chartProblems'), 'problem_records', maxComparisonProblems, (v) => `${Math.round(v)}`)}
        </div>
      </div>
    </div>
  )
}
