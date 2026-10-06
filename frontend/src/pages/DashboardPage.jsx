import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getDashboardFacultyComparison, getDashboardStats, getRecordFilterOptions } from '../services/api'

function Icon({ name, className = 'h-5 w-5' }) {
  const paths = {
    document: 'M9 12h6m-6 4h6M10 2h4l5 5v13a2 2 0 01-2 2H7a2 2 0 01-2-2V4a2 2 0 012-2h3zm4 0v5h5',
    quality: 'M12 3l2.2 4.46 4.92.72-3.56 3.46.84 4.89L12 14.22l-4.4 2.31.84-4.89L4.88 8.18l4.92-.72L12 3z',
    attendance: 'M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2m7-10a4 4 0 100-8 4 4 0 000 8zm8 0l2 2 4-4',
    alert: 'M12 9v4m0 4h.01M10.3 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.7 3.86a2 2 0 00-3.4 0z',
    filter: 'M4 5h16M7 12h10m-7 7h4',
    building: 'M3 21h18M5 21V5l7-3 7 3v16M9 9h1m4 0h1m-6 4h1m4 0h1m-6 4h1m4 0h1',
    refresh: 'M4 4v6h6M20 20v-6h-6M5.1 15a8 8 0 0013.2 2M18.9 9A8 8 0 005.7 7',
    check: 'M5 13l4 4L19 7',
    chart: 'M4 19V9m5 10V5m5 14v-7m5 7V3',
  }
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={paths[name]} />
    </svg>
  )
}

function MetricCard({ label, value, note, icon, tone = 'navy' }) {
  const tones = {
    navy: 'border-l-[#163A63] text-[#163A63] dark:text-blue-300',
    green: 'border-l-emerald-600 text-emerald-700 dark:text-emerald-400',
    amber: 'border-l-amber-600 text-amber-700 dark:text-amber-400',
    red: 'border-l-red-600 text-red-700 dark:text-red-400',
  }
  return (
    <article className={`rounded-lg border border-slate-200 border-l-4 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900 ${tones[tone]}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{label}</p>
          <p className="mt-2 text-3xl font-bold tracking-tight">{value}</p>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          <Icon name={icon} />
        </div>
      </div>
      <p className="mt-3 border-t border-slate-100 pt-3 text-xs leading-5 text-slate-500 dark:border-slate-800 dark:text-slate-400">{note}</p>
    </article>
  )
}

function ProgressMetric({ label, value, display, target, tone }) {
  const width = Math.max(0, Math.min(100, value))
  const tones = {
    navy: 'bg-[#1E4E79]',
    green: 'bg-emerald-600',
    amber: 'bg-amber-600',
    red: 'bg-red-600',
  }
  return (
    <div>
      <div className="mb-2 flex items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{label}</p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{target}</p>
        </div>
        <span className="text-lg font-bold text-slate-900 dark:text-white">{display}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-lg bg-slate-200 dark:bg-slate-700" role="progressbar" aria-label={label} aria-valuenow={Math.round(value)} aria-valuemin="0" aria-valuemax="100">
        <div className={`h-full rounded-lg ${tones[tone]}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}

function formatPercent(value) {
  return `${value.toFixed(1)}%`
}

function PieChart({ title, subtitle, items, emptyText = 'Нет данных' }) {
  const size = 180
  const strokeWidth = 18
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const total = items.reduce((sum, item) => sum + Number(item.value || 0), 0)
  let offset = 0

  return (
    <article className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-700">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-cyan-700 dark:text-cyan-300">{subtitle}</p>
        <h3 className="mt-1 text-lg font-bold tracking-tight text-slate-900 dark:text-white">{title}</h3>
      </div>
      <div className="grid gap-5 p-5 lg:grid-cols-[200px_1fr] lg:items-center">
        <div className="relative mx-auto flex h-[200px] w-[200px] items-center justify-center">
          {total > 0 ? (
            <>
              <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full -rotate-90">
                {items.map((item) => {
                  const value = Number(item.value || 0)
                  const dash = (value / total) * circumference
                  const currentOffset = offset
                  offset += dash
                  return (
                    <circle
                      key={item.label}
                      cx={size / 2}
                      cy={size / 2}
                      r={radius}
                      fill="none"
                      stroke={item.color}
                      strokeWidth={strokeWidth}
                      strokeDasharray={`${dash} ${circumference - dash}`}
                      strokeDashoffset={-currentOffset}
                      strokeLinecap="round"
                    />
                  )
                })}
              </svg>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-2xl font-bold text-slate-900 dark:text-white">{total.toLocaleString()}</span>
                <span className="mt-1 text-xs font-medium uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Всего</span>
              </div>
            </>
          ) : (
            <div className="flex h-full w-full items-center justify-center rounded-full border border-dashed border-slate-300 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
              {emptyText}
            </div>
          )}
        </div>
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.label} className="flex items-center gap-3">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate font-medium text-slate-700 dark:text-slate-200">{item.label}</span>
                  <span className="font-bold text-slate-900 dark:text-white">{item.valueLabel}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                  <div className="h-full rounded-full" style={{ width: `${total ? (item.value / total) * 100 : 0}%`, backgroundColor: item.color }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </article>
  )
}

function BarChart({ title, subtitle, items, emptyText = 'Нет данных' }) {
  const maxValue = Math.max(...items.map((item) => Number(item.value || 0)), 0)
  return (
    <article className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-700">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-cyan-700 dark:text-cyan-300">{subtitle}</p>
        <h3 className="mt-1 text-lg font-bold tracking-tight text-slate-900 dark:text-white">{title}</h3>
      </div>
      <div className="space-y-4 p-5">
        {items.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{emptyText}</p>
        ) : items.map((item) => (
          <div key={item.label}>
            <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
              <span className="truncate font-medium text-slate-700 dark:text-slate-200">{item.label}</span>
              <span className="font-bold text-slate-900 dark:text-white">{item.valueLabel}</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-blue-600 to-[#163A63]" style={{ width: `${maxValue ? (item.value / maxValue) * 100 : 0}%` }} />
            </div>
          </div>
        ))}
      </div>
    </article>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-5 animate-pulse" aria-label="Загрузка панели">
      <div className="h-28 rounded-lg bg-slate-200 dark:bg-slate-800" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[1, 2, 3, 4].map((item) => <div key={item} className="h-36 rounded-lg bg-slate-200 dark:bg-slate-800" />)}
      </div>
      <div className="h-72 rounded-lg bg-slate-200 dark:bg-slate-800" />
    </div>
  )
}

export default function DashboardPage() {
  const { t, i18n } = useTranslation()
  const [stats, setStats] = useState(null)
  const [filterOptions, setFilterOptions] = useState({ faculties: [], ops: [] })
  const [comparison, setComparison] = useState([])
  const [selectedFaculty, setSelectedFaculty] = useState('')
  const [selectedOp, setSelectedOp] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    getRecordFilterOptions()
      .then((data) => setFilterOptions(data || { faculties: [], ops: [] }))
      .catch(() => setFilterOptions({ faculties: [], ops: [] }))
  }, [])

  useEffect(() => {
    setLoading(true)
    setError('')
    Promise.all([
      getDashboardStats({ faculty: selectedFaculty || undefined, op: selectedOp || undefined }),
      getDashboardFacultyComparison({ faculty: selectedFaculty || undefined, op: selectedOp || undefined }),
    ])
      .then(([statsData, comparisonData]) => {
        setStats(statsData)
        setComparison(comparisonData || [])
      })
      .catch(() => setError(t('dashboard.loadError')))
      .finally(() => setLoading(false))
  }, [selectedFaculty, selectedOp, retryKey, t])

  const facultyOptions = useMemo(() => filterOptions?.faculties || [], [filterOptions])
  const opOptions = useMemo(() => {
    if (!selectedFaculty) return (filterOptions?.ops || []).map((name) => ({ id: name, name }))
    const target = facultyOptions.find((faculty) => faculty.name === selectedFaculty)
    return (target?.ops || []).map((name) => ({ id: name, name }))
  }, [facultyOptions, filterOptions, selectedFaculty])

  const comparisonTitle = selectedOp
    ? t('dashboard.compareByGroup')
    : selectedFaculty
      ? t('dashboard.compareByOp')
      : t('dashboard.compareByFaculty')

  const sortedComparison = useMemo(
    () => [...comparison].sort((a, b) => Number(b.avg_score || 0) - Number(a.avg_score || 0)),
    [comparison],
  )

  const score = Number(stats?.avg_score || 0)
  const attendance = Number(stats?.avg_attendance || 0)
  const problems = Number(stats?.problem_records || 0)
  const total = Number(stats?.total_records || 0)
  const problemShare = total ? (problems / total) * 100 : 0
  const cleanShare = Math.max(0, 100 - problemShare)

  const chartPalette = ['#0EA5E9', '#1D4ED8', '#14B8A6', '#F59E0B', '#EF4444', '#8B5CF6', '#22C55E', '#64748B']
  const recordsPieItems = useMemo(() => {
    if (sortedComparison.length === 0) return []
    const topByRecords = [...sortedComparison]
      .sort((a, b) => Number(b.total_records || 0) - Number(a.total_records || 0))
      .slice(0, 6)
    const visibleTotal = topByRecords.reduce((sum, item) => sum + Number(item.total_records || 0), 0)
    const other = Math.max(0, total - visibleTotal)
    return [
      ...topByRecords.map((item, index) => {
        const value = Number(item.total_records || 0)
        return {
          label: item.label,
          value,
          valueLabel: `${value.toLocaleString(i18n.language)} (${formatPercent(total ? (value / total) * 100 : 0)})`,
          color: chartPalette[index % chartPalette.length],
        }
      }),
      ...(other > 0
        ? [{
            label: 'Остальные',
            value: other,
            valueLabel: `${other.toLocaleString(i18n.language)} (${formatPercent(total ? (other / total) * 100 : 0)})`,
            color: '#94A3B8',
          }]
        : []),
    ]
  }, [chartPalette, i18n.language, sortedComparison, total])

  const issuePieItems = useMemo(() => ([
    { label: 'Нормальные записи', value: cleanShare, valueLabel: formatPercent(cleanShare), color: '#10B981' },
    { label: 'Проблемные записи', value: problemShare, valueLabel: formatPercent(problemShare), color: '#EF4444' },
  ]), [cleanShare, problemShare])

  const scoreBarItems = useMemo(() => sortedComparison.slice(0, 8).map((item, index) => ({
    label: item.label,
    value: Number(item.avg_score || 0),
    valueLabel: `${Number(item.avg_score || 0).toFixed(1)} / 10`,
    color: chartPalette[index % chartPalette.length],
  })), [chartPalette, sortedComparison])

  const hasFilters = Boolean(selectedFaculty || selectedOp)
  const formattedDate = new Intl.DateTimeFormat(i18n.language || 'ru', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(new Date())

  const resetFilters = () => {
    setSelectedFaculty('')
    setSelectedOp('')
  }

  if (!stats && loading) return <DashboardSkeleton />

  return (
    <div className="cyber-dashboard w-full space-y-5">
      <header className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="h-1 bg-gradient-to-r from-cyan-400 via-blue-500 to-transparent" />
        <div className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-cyan-700 dark:text-cyan-300">
              <Icon name="building" className="h-4 w-4" />
              KRK // Security Operations Center
            </div>
            <h1 className="text-3xl font-bold leading-tight tracking-tight text-slate-950 dark:text-white sm:text-4xl">
              Центр ситуационного контроля
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
              Оперативная картина качества занятий, видеомониторинга и выявленных отклонений
            </p>
          </div>
          <div className="border-l-2 border-amber-600 pl-4 lg:text-right">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Состояние контура</p>
            <p className="mt-1 font-semibold text-slate-900 dark:text-white">{formattedDate}</p>
            <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">● {hasFilters ? 'Фильтр активен' : 'Все подразделения онлайн'}</p>
          </div>
        </div>
      </header>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900" aria-labelledby="dashboard-filters">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Icon name="filter" className="h-4 w-4 text-[#163A63] dark:text-blue-300" />
            <h2 id="dashboard-filters" className="text-sm font-bold uppercase tracking-wide text-slate-800 dark:text-slate-100">{t('dashboard.filters')}</h2>
          </div>
          <div className="flex items-center gap-3">
            {loading && <span className="text-xs font-medium text-slate-500" role="status">Обновление данных…</span>}
            {hasFilters && (
            <button type="button" onClick={resetFilters} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-700 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
              <Icon name="refresh" className="h-4 w-4" />
              Сбросить
            </button>
            )}
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label>
            <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('dashboard.faculty')}</span>
            <select className="input min-h-11 cursor-pointer rounded-lg text-base" value={selectedFaculty} onChange={(event) => { setSelectedFaculty(event.target.value); setSelectedOp('') }}>
              <option value="">{t('dashboard.allFaculties')}</option>
              {facultyOptions.map((faculty) => <option key={faculty.name} value={faculty.name}>{faculty.name}</option>)}
            </select>
          </label>
          <label>
            <span className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('dashboard.op')}</span>
            <select className="input min-h-11 cursor-pointer rounded-lg text-base" value={selectedOp} onChange={(event) => setSelectedOp(event.target.value)}>
              <option value="">{t('dashboard.allOp')}</option>
              {opOptions.map((op) => <option key={op.id} value={op.name}>{op.name}</option>)}
            </select>
          </label>
        </div>
      </section>

      {error && (
        <div className="flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300 sm:flex-row sm:items-center sm:justify-between" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setRetryKey((value) => value + 1)} className="min-h-11 cursor-pointer rounded-lg border border-red-300 px-4 font-semibold transition-colors hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-600 dark:border-red-800 dark:hover:bg-red-950">Повторить</button>
        </div>
      )}

      <section className={`grid gap-4 sm:grid-cols-2 xl:grid-cols-4 ${loading ? 'opacity-60' : ''}`} aria-label="Ключевые показатели" aria-busy={loading}>
        <MetricCard label={t('dashboard.totalRecords')} value={total.toLocaleString(i18n.language)} note="Объём записей в текущей выборке" icon="document" />
        <MetricCard label={t('dashboard.avgScore')} value={`${score.toFixed(1)} / 10`} note={score >= 7 ? 'Показатель соответствует целевому уровню' : 'Показатель ниже целевого уровня 7.0'} icon="quality" tone={score >= 7 ? 'green' : score >= 5 ? 'amber' : 'red'} />
        <MetricCard label={t('dashboard.avgAttendance')} value={`${attendance.toFixed(1)}%`} note={attendance >= 75 ? 'Целевой уровень посещаемости достигнут' : 'Требуется повышение до уровня 75%'} icon="attendance" tone={attendance >= 75 ? 'green' : 'amber'} />
        <MetricCard label={t('dashboard.problemRecords')} value={problems.toLocaleString(i18n.language)} note={`${problemShare.toFixed(1)}% от общего количества записей`} icon="alert" tone={problems > 0 ? 'red' : 'green'} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
        <article className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-700">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-700 dark:text-amber-400">Контрольные ориентиры</p>
            <h2 className="mt-1 text-xl font-bold tracking-tight text-slate-900 dark:text-white">Выполнение ключевых показателей</h2>
          </div>
          <div className="space-y-7 p-5">
            <ProgressMetric label="Средняя оценка качества" value={score * 10} display={`${score.toFixed(1)} / 10`} target="Целевое значение: не менее 7.0" tone={score >= 7 ? 'green' : 'amber'} />
            <ProgressMetric label="Средняя посещаемость" value={attendance} display={`${attendance.toFixed(1)}%`} target="Целевое значение: не менее 75%" tone={attendance >= 75 ? 'green' : 'amber'} />
            <ProgressMetric label="Доля проблемных записей" value={problemShare} display={`${problemShare.toFixed(1)}%`} target="Чем ниже показатель, тем лучше" tone={problemShare <= 10 ? 'green' : 'red'} />
          </div>
        </article>

        <article className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-700 dark:text-amber-400">Структурный анализ</p>
              <h2 className="mt-1 text-xl font-bold tracking-tight text-slate-900 dark:text-white">{comparisonTitle}</h2>
            </div>
            <Icon name="chart" className="h-6 w-6 text-slate-400" />
          </div>

          {sortedComparison.length === 0 ? (
            <p className="p-5 text-sm text-slate-500 dark:text-slate-400">{t('dashboard.noDataChart')}</p>
          ) : (
            <div className="max-h-[430px] overflow-auto">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                  <tr>
                    <th className="w-12 px-4 py-3 text-center">№</th>
                    <th className="px-4 py-3">Подразделение</th>
                    <th className="px-4 py-3" aria-sort="descending">Оценка ↓</th>
                    <th className="px-4 py-3">Посещаемость</th>
                    <th className="px-4 py-3 text-right">Проблемы</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {sortedComparison.map((item, index) => {
                    const itemScore = Number(item.avg_score || 0)
                    const itemAttendance = Number(item.avg_attendance || 0)
                    return (
                      <tr key={item.label} className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60">
                        <td className="px-4 py-3 text-center font-semibold text-slate-400">{index + 1}</td>
                        <td className="max-w-[320px] px-4 py-3 font-semibold text-slate-800 dark:text-slate-100">{item.label}</td>
                        <td className="px-4 py-3">
                          <div className="flex min-w-[130px] items-center gap-3">
                            <span className={`w-8 font-bold ${itemScore >= 7 ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>{itemScore.toFixed(1)}</span>
                            <div className="h-1.5 flex-1 rounded-lg bg-slate-200 dark:bg-slate-700"><div className="h-full rounded-lg bg-[#1E4E79]" style={{ width: `${Math.min(100, itemScore * 10)}%` }} /></div>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-700 dark:text-slate-200">{itemAttendance.toFixed(1)}%</td>
                        <td className="px-4 py-3 text-right">
                          <span className={`inline-flex min-w-8 justify-center rounded-lg border px-2 py-1 text-xs font-bold ${Number(item.problem_records || 0) > 0 ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300' : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'}`}>
                            {Number(item.problem_records || 0)}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <PieChart
          title="Распределение записей"
          subtitle="Структура выборки"
          items={recordsPieItems}
          emptyText="Нет записей для отображения"
        />
        <PieChart
          title="Качество выборки"
          subtitle="Проблемные vs нормальные"
          items={issuePieItems}
          emptyText="Нет данных по проблемным записям"
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <BarChart
          title="Рейтинг подразделений по качеству"
          subtitle="Средняя оценка"
          items={scoreBarItems}
          emptyText="Нет данных для сравнения"
        />
        <article className="rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-700">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-cyan-700 dark:text-cyan-300">Оперативная сводка</p>
            <h2 className="mt-1 text-xl font-bold tracking-tight text-slate-900 dark:text-white">Что смотреть в первую очередь</h2>
          </div>
          <div className="grid gap-3 p-5 sm:grid-cols-2">
            <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">Лучший показатель</p>
              <p className="mt-2 text-lg font-bold text-slate-900 dark:text-white">{sortedComparison[0]?.label || 'Нет данных'}</p>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                {sortedComparison[0] ? `${Number(sortedComparison[0].avg_score || 0).toFixed(1)} / 10` : 'Недостаточно информации'}
              </p>
            </div>
            <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">Зона внимания</p>
              <p className="mt-2 text-lg font-bold text-slate-900 dark:text-white">
                {sortedComparison.find((item) => Number(item.problem_records || 0) > 0)?.label || 'Нет проблемных записей'}
              </p>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                {sortedComparison.find((item) => Number(item.problem_records || 0) > 0)
                  ? `${sortedComparison.find((item) => Number(item.problem_records || 0) > 0).problem_records} проблемных записей`
                  : 'Ситуация стабильна'}
              </p>
            </div>
            <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">Всего записей</p>
              <p className="mt-2 text-lg font-bold text-slate-900 dark:text-white">{total.toLocaleString(i18n.language)}</p>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">В текущей выборке</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">Проблемные записи</p>
              <p className="mt-2 text-lg font-bold text-slate-900 dark:text-white">{problems.toLocaleString(i18n.language)}</p>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{formatPercent(problemShare)} от общего объёма</p>
            </div>
          </div>
        </article>
      </section>

      <footer className="flex flex-col gap-2 border-t border-slate-200 py-4 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400 sm:flex-row sm:items-center sm:justify-between">
        <p>Источник: информационная система Комитета ректорского контроля</p>
        <p className="inline-flex items-center gap-1.5"><Icon name="check" className="h-4 w-4 text-emerald-600" /> Данные сформированы по текущей выборке</p>
      </footer>
    </div>
  )
}
