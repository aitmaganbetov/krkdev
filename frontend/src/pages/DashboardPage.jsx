import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { getAcademicYears } from '../services/api'
import { intlLocale } from '../utils/locale'
import { Badge, Field, Icon, PageHeader, PageStack, Select, Tabs } from '../components/ui'
import RecordsDashboard from '../components/dashboard/RecordsDashboard'
import PeerVisitsDashboard from '../components/dashboard/PeerVisitsDashboard'
import MonitoringDashboard from '../components/dashboard/MonitoringDashboard'
import PersonalDashboard from '../components/dashboard/PersonalDashboard'
import { useAuth } from '../context/AuthContext'
import { managesWorkspace } from '../utils/roles'

// Модули дашборда: у каждого свои показатели и фильтры; учебный год — общий
const ALL_MODULES = {
  krk: { value: 'krk', icon: 'records', Component: RecordsDashboard },
  peer: { value: 'peer', icon: 'user-check', Component: PeerVisitsDashboard },
  monitoring: { value: 'monitoring', icon: 'monitor', Component: MonitoringDashboard },
  personal: { value: 'personal', icon: 'user', Component: PersonalDashboard },
}

// Каждой роли — только свои данные: руководство и деканат (по своему факультету) — все модули, инспектор КРК —
// записи КРК, инспектор взаимопосещения — взаимопосещение, остальные — «Мои показатели»
function modulesFor(role) {
  if (managesWorkspace(role)) return [ALL_MODULES.krk, ALL_MODULES.peer, ALL_MODULES.monitoring]
  if (role === 'inspector') return [ALL_MODULES.krk]
  if (role === 'peer_inspector') return [ALL_MODULES.peer]
  return [ALL_MODULES.personal]
}

const currentYearName = () => {
  const now = new Date()
  const start = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1
  return `${start}-${start + 1}`
}

export default function DashboardPage() {
  const { t, i18n } = useTranslation()
  const [params, setParams] = useSearchParams()
  const { role } = useAuth()
  const MODULES = modulesFor(role)
  const module = MODULES.find((item) => item.value === params.get('module')) || MODULES[0]
  // Учебный год: '' — все годы; null — ещё не определён (ждём справочник, чтобы не грузить данные дважды)
  const [years, setYears] = useState([])
  const [selectedYear, setSelectedYear] = useState(null)
  const locale = intlLocale(i18n.language)

  // По умолчанию — текущий учебный год по дате (новый начинается 1 сентября), как на сервере
  useEffect(() => {
    getAcademicYears()
      .then((data) => {
        const list = data || []
        setYears(list)
        const current = currentYearName()
        const fallback = list.find((item) => item.is_default)?.name
        setSelectedYear(list.some((item) => item.name === current) ? current : (fallback || ''))
      })
      .catch(() => setSelectedYear(''))
  }, [])

  const formattedDate = new Intl.DateTimeFormat(locale || 'ru', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date())
  const selectModule = (value) => setParams(value === MODULES[0].value ? {} : { module: value }, { replace: true })
  const { Component } = module

  return (
    <PageStack>
      <PageHeader
        title={t('dashboard.title')}
        description={t(`dashModules.descriptions.${module.value}`)}
        actions={
          <Field label={t('dash.year.label')} className="w-full sm:w-56">
            <Select
              value={selectedYear ?? ''}
              onChange={(event) => setSelectedYear(event.target.value)}
              placeholder={t('dash.year.all')}
              options={years.map((item) => ({
                value: item.name,
                label: item.name === currentYearName() ? `${item.name} · ${t('dash.year.current')}` : item.name,
              }))}
            />
          </Field>
        }
      >
        <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-sm text-fg-muted">
          <span className="inline-flex items-center gap-1.5">
            <Icon name="calendar" size={16} className="text-fg-subtle" />
            {t('dash.asOf', { date: formattedDate })}
          </span>
          <Badge tone="primary" icon="calendar">
            {selectedYear ? t('dash.year.badge', { year: selectedYear }) : t('dash.year.all')}
          </Badge>
        </div>
      </PageHeader>

      {/* Одна вкладка — без переключателя */}
      {MODULES.length > 1 && (
        <Tabs
          ariaLabel={t('dashModules.label')}
          value={module.value}
          onChange={selectModule}
          items={MODULES.map((item) => ({ value: item.value, label: t(`dashModules.${item.value}`), icon: item.icon }))}
        />
      )}

      {/* key: при смене модуля его состояние (фильтры, загрузка) начинается заново */}
      <div role="tabpanel" aria-label={t(`dashModules.${module.value}`)} className="min-w-0">
        <Component key={module.value} selectedYear={selectedYear} />
      </div>
    </PageStack>
  )
}
