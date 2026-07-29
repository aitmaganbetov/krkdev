import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  getAiSettings,
  getBasicInfoCatalog,
  getPlatonusStatus,
  getLdapSettings,
  saveAiSettings,
  saveLdapSettings,
  testAiProvider,
  testLdapSettings,
} from '../services/api'
import { useTheme } from '../context/ThemeContext'
import Spinner from '../components/Spinner'

function countGroups(faculties = []) {
  return faculties.reduce((total, faculty) => (
    total + (faculty.specializations || []).reduce((sum, specialization) => sum + (specialization.groups?.length || 0), 0)
  ), 0)
}

const AI_MODELS = {
  openai: [
    ['gpt-5.6-luna', 'GPT-5.6 Luna · экономичная'],
    ['gpt-5.6-terra', 'GPT-5.6 Terra · сбалансированная'],
    ['gpt-5.6-sol', 'GPT-5.6 Sol · максимальное качество'],
    ['gpt-5.4-mini', 'GPT-5.4 mini'],
    ['gpt-5.4-nano', 'GPT-5.4 nano'],
  ],
  gemini: [
    ['gemini-2.5-flash', 'Gemini 2.5 Flash · стабильная'],
    ['gemini-2.5-pro', 'Gemini 2.5 Pro'],
    ['gemini-3-pro-preview', 'Gemini 3 Pro · Preview'],
  ],
}

export default function SystemSettingsPage() {
  const { t } = useTranslation()
  const { dark, toggle } = useTheme()
  const [catalog, setCatalog] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [platonusStatus, setPlatonusStatus] = useState(null)
  const [platonusError, setPlatonusError] = useState('')
  const [ldapLoading, setLdapLoading] = useState(true)
  const [ldapSaving, setLdapSaving] = useState(false)
  const [ldapTesting, setLdapTesting] = useState(false)
  const [ldapNotice, setLdapNotice] = useState('')
  const [ldapError, setLdapError] = useState('')
  const [ldapTestNotice, setLdapTestNotice] = useState('')
  const [ldapTestError, setLdapTestError] = useState('')
  const [ldap, setLdap] = useState({
    server_url: '',
    base_dn: '',
    bind_dn: '',
    bind_password: '',
    certificate_key: '',
  })
  const [ai, setAi] = useState({
    active_provider: 'openai',
    openai: { enabled: false, model: 'gpt-5.6-luna', api_key: '', api_key_configured: false },
    gemini: { enabled: false, model: 'gemini-2.5-flash', api_key: '', api_key_configured: false },
  })
  const [aiLoading, setAiLoading] = useState(true)
  const [aiSaving, setAiSaving] = useState(false)
  const [aiTesting, setAiTesting] = useState('')
  const [aiNotice, setAiNotice] = useState('')
  const [aiError, setAiError] = useState('')

  const load = async () => {
    setLoading(true)
    setPlatonusError('')
    const [catalogResult, statusResult] = await Promise.allSettled([
      getBasicInfoCatalog(),
      getPlatonusStatus(),
    ])
    if (catalogResult.status === 'fulfilled') {
      setCatalog(catalogResult.value)
      setError('')
    } else {
      setError(t('settings.catalogError'))
    }
    if (statusResult.status === 'fulfilled') {
      setPlatonusStatus(statusResult.value)
    } else {
      setPlatonusError(statusResult.reason?.response?.data?.detail || 'Не удалось проверить интеграцию с Platonus')
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    getLdapSettings()
      .then((data) => {
        setLdap({
          server_url: data.server_url || '',
          base_dn: data.base_dn || '',
          bind_dn: data.bind_dn || '',
          bind_password: data.bind_password || '',
          certificate_key: data.certificate_key || '',
        })
        setLdapError('')
      })
      .catch(() => setLdapError(t('settings.ldapLoadError')))
      .finally(() => setLdapLoading(false))
  }, [])

  useEffect(() => {
    getAiSettings()
      .then((data) => {
        setAi({
          active_provider: data.active_provider || 'openai',
          openai: { ...data.openai, api_key: '' },
          gemini: { ...data.gemini, api_key: '' },
        })
        setAiError('')
      })
      .catch(() => setAiError('Не удалось загрузить настройки AI'))
      .finally(() => setAiLoading(false))
  }, [])

  const stats = useMemo(() => {
    const faculties = catalog?.faculties || []
    const specializations = faculties.reduce((sum, faculty) => sum + (faculty.specializations?.length || 0), 0)
    return {
      teachers: catalog?.teachers?.length || 0,
      faculties: faculties.length,
      specializations,
      groups: countGroups(faculties),
    }
  }, [catalog])

  const updateLdap = (patch) => {
    setLdap((prev) => ({ ...prev, ...patch }))
  }

  const handleSaveLdap = async () => {
    setLdapNotice('')
    setLdapError('')
    setLdapTestNotice('')
    setLdapTestError('')
    setLdapSaving(true)
    try {
      const payload = { ...ldap }
      await saveLdapSettings(payload)
      setLdap(payload)
      setLdapNotice(t('settings.ldapSaved'))
    } catch {
      setLdapError(t('settings.ldapSaveError'))
    } finally {
      setLdapSaving(false)
    }
  }

  const handleTestLdap = async () => {
    setLdapTestNotice('')
    setLdapTestError('')
    setLdapNotice('')
    setLdapError('')
    setLdapTesting(true)

    try {
      const payload = { ...ldap }
      const result = await testLdapSettings(payload)
      if (result.success) {
        setLdapTestNotice(result.details ? `${result.message}. ${result.details}` : result.message)
      } else {
        setLdapTestError(result.details ? `${result.message}. ${result.details}` : result.message)
      }
    } catch {
      setLdapTestError(t('settings.ldapTestError'))
    } finally {
      setLdapTesting(false)
    }
  }

  const updateAiProvider = (provider, patch) => {
    setAi((current) => ({
      ...current,
      [provider]: { ...current[provider], ...patch },
    }))
  }

  const handleSaveAi = async () => {
    setAiNotice('')
    setAiError('')
    setAiSaving(true)
    try {
      const saved = await saveAiSettings(ai)
      setAi({
        active_provider: saved.active_provider,
        openai: { ...saved.openai, api_key: '' },
        gemini: { ...saved.gemini, api_key: '' },
      })
      setAiNotice('Настройки AI сохранены. API-ключи хранятся только на сервере.')
    } catch (err) {
      setAiError(err.response?.data?.detail || 'Не удалось сохранить настройки AI')
    } finally {
      setAiSaving(false)
    }
  }

  const handleTestAi = async (provider) => {
    setAiNotice('')
    setAiError('')
    setAiTesting(provider)
    try {
      const result = await testAiProvider(provider)
      setAiNotice(`${provider === 'openai' ? 'OpenAI' : 'Gemini'}: ${result.message}`)
    } catch (err) {
      setAiError(err.response?.data?.detail || 'Не удалось проверить AI-подключение')
    } finally {
      setAiTesting('')
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('settings.title')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('settings.subtitle')}</p>
      </div>

      <div className="card p-5 flex items-center justify-between gap-4">
        <div>
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">{t('settings.theme')}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('settings.currentTheme')} {dark ? t('settings.dark') : t('settings.light')}</p>
        </div>
        <button className="btn-secondary" onClick={toggle}>
          {t('settings.switchTheme')}
        </button>
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Интеграция с Platonus</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Доступность подключения и состояние синхронизации справочников</p>
          </div>
          <button className="btn-secondary" onClick={load} disabled={loading}>
            {loading ? 'Проверка...' : 'Проверить подключение'}
          </button>
        </div>

        {platonusStatus && (
          <div className={`mt-4 flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between ${platonusStatus.connected ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30' : 'border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/30'}`}>
            <div className="flex items-center gap-3">
              <span className={`h-3 w-3 shrink-0 rounded-full ${platonusStatus.connected ? 'bg-emerald-500' : 'bg-rose-500'}`} />
              <div>
                <p className={`font-bold ${platonusStatus.connected ? 'text-emerald-800 dark:text-emerald-300' : 'text-rose-800 dark:text-rose-300'}`}>{platonusStatus.connected ? 'Platonus подключён' : 'Platonus недоступен'}</p>
                <p className="text-sm text-gray-600 dark:text-gray-300">{platonusStatus.message}</p>
              </div>
            </div>
            <div className="text-xs text-gray-500 sm:text-right">
              <p>База: {platonusStatus.database}</p>
              <p>Проверено: {new Date(platonusStatus.checked_at).toLocaleString('ru-RU')} · {platonusStatus.response_ms} мс</p>
            </div>
          </div>
        )}

        {platonusError && <p className="mt-4 text-sm text-red-500">{platonusError}</p>}
        {error && <p className="mt-4 text-sm text-red-500">{error}</p>}

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(platonusStatus?.catalogs || [
            { key: 'tutors', label: t('settings.teachers'), local_count: stats.teachers },
            { key: 'faculties', label: t('settings.faculties'), local_count: stats.faculties },
            { key: 'specializations', label: t('settings.specializations'), local_count: stats.specializations },
            { key: 'groups', label: t('settings.groups'), local_count: stats.groups },
          ]).map((item) => {
            const labels = {
              synced: ['Синхронизировано', 'text-emerald-600'],
              outdated: ['Требуется обновление', 'text-amber-600'],
              unavailable: ['Platonus недоступен', 'text-rose-500'],
              local_error: ['Ошибка локальной базы', 'text-rose-500'],
            }
            const [statusLabel, statusClass] = labels[item.status] || ['Ожидание проверки', 'text-gray-400']
            return (
              <div key={item.key} className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{item.label}</p>
                  {loading && <Spinner size="sm" />}
                </div>
                <p className="mt-2 text-xl font-bold text-gray-900 dark:text-white">{item.local_count ?? '—'} <span className="text-xs font-normal text-gray-400">локально</span></p>
                {item.remote_count !== null && item.remote_count !== undefined && <p className="text-sm text-gray-500">{item.remote_count} в Platonus</p>}
                <p className={`mt-2 text-xs font-semibold ${statusClass}`}>{statusLabel}</p>
              </div>
            )
          })}
        </div>
      </div>

      <div className="card p-5 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">AI для улучшения текста</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Настройте OpenAI или Gemini для описания нарушений. Одновременно используется выбранный активный провайдер.</p>
          </div>
          {aiLoading && <Spinner size="sm" />}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {[
            ['openai', 'OpenAI', 'Responses API'],
            ['gemini', 'Google Gemini', 'Gemini API'],
          ].map(([provider, title, subtitle]) => {
            const settings = ai[provider]
            const isActive = ai.active_provider === provider
            return (
              <div key={provider} className={`rounded-2xl border-2 p-4 transition-colors ${isActive ? 'border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/20' : 'border-gray-200 dark:border-gray-700'}`}>
                <div className="flex items-start justify-between gap-3">
                  <button type="button" onClick={() => setAi((current) => ({ ...current, active_provider: provider }))} className="text-left">
                    <span className="block font-bold text-gray-900 dark:text-white">{title}</span>
                    <span className="text-xs text-gray-500">{subtitle} · {isActive ? 'выбран' : 'выбрать'}</span>
                  </button>
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200">
                    <input type="checkbox" checked={settings.enabled} onChange={(e) => updateAiProvider(provider, { enabled: e.target.checked })} className="h-4 w-4 accent-indigo-600" />
                    Включён
                  </label>
                </div>
                <div className="mt-4 space-y-3">
                  <div>
                    <label className="label">Модель</label>
                    <input
                      className="input"
                      list={`${provider}-models`}
                      value={settings.model}
                      onChange={(e) => updateAiProvider(provider, { model: e.target.value })}
                      placeholder="Выберите или введите ID модели"
                    />
                    <datalist id={`${provider}-models`}>
                      {AI_MODELS[provider].map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                    </datalist>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {AI_MODELS[provider].map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          title={label}
                          onClick={() => updateAiProvider(provider, { model: id })}
                          className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors ${settings.model === id ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-gray-200 bg-white text-gray-600 hover:border-indigo-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}
                        >
                          {id}
                        </button>
                      ))}
                    </div>
                    <p className="mt-1 text-xs text-gray-400">Выберите модель из списка или вручную введите её ID.</p>
                  </div>
                  <div>
                    <label className="label">API-ключ</label>
                    <input
                      className="input"
                      type="password"
                      autoComplete="new-password"
                      placeholder={settings.api_key_configured ? 'Ключ сохранён · введите новый для замены' : 'Введите API-ключ'}
                      value={settings.api_key}
                      onChange={(e) => updateAiProvider(provider, { api_key: e.target.value })}
                    />
                    <p className="mt-1 text-xs text-gray-400">{settings.api_key_configured ? '✓ Ключ настроен на сервере' : 'Ключ ещё не настроен'}</p>
                  </div>
                  <button type="button" className="btn-secondary w-full" disabled={aiTesting || aiSaving || aiLoading || !settings.enabled || !settings.api_key_configured} onClick={() => handleTestAi(provider)}>
                    {aiTesting === provider ? 'Проверка...' : 'Проверить подключение'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {aiError && <p className="text-sm text-red-500">{aiError}</p>}
        {aiNotice && <p className="text-sm text-green-600 dark:text-green-400">{aiNotice}</p>}
        <div className="flex justify-end">
          <button className="btn-primary" onClick={handleSaveAi} disabled={aiSaving || aiLoading}>
            {aiSaving ? 'Сохранение...' : 'Сохранить настройки AI'}
          </button>
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">{t('settings.ldapTitle')}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('settings.ldapSubtitle')}</p>
          </div>
          {ldapLoading && <Spinner size="sm" />}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="label">{t('settings.serverUrl')}</label>
            <input
              className="input"
              placeholder="ldaps://dc1.kaztbu.edu.kz:636"
              value={ldap.server_url}
              onChange={(e) => updateLdap({ server_url: e.target.value })}
            />
          </div>

          <div className="sm:col-span-2">
            <label className="label">{t('settings.baseDn')}</label>
            <input
              className="input"
              placeholder="dc=company,dc=local"
              value={ldap.base_dn}
              onChange={(e) => updateLdap({ base_dn: e.target.value })}
            />
          </div>

          <div className="sm:col-span-2">
            <label className="label">{t('settings.bindDn')}</label>
            <input
              className="input"
              placeholder="cn=ldap-reader,ou=service,dc=company,dc=local"
              value={ldap.bind_dn}
              onChange={(e) => updateLdap({ bind_dn: e.target.value })}
            />
          </div>

          <div className="sm:col-span-2">
            <label className="label">{t('settings.bindPassword')}</label>
            <input
              className="input"
              type="password"
              placeholder="••••••••"
              value={ldap.bind_password}
              onChange={(e) => updateLdap({ bind_password: e.target.value })}
            />
          </div>

          <div className="sm:col-span-2">
            <label className="label">{t('settings.certKey')}</label>
            <textarea
              className="input min-h-[120px]"
              placeholder="-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
              value={ldap.certificate_key}
              onChange={(e) => updateLdap({ certificate_key: e.target.value })}
            />
          </div>
        </div>

        {ldapError && <p className="text-sm text-red-500">{ldapError}</p>}
        {ldapNotice && <p className="text-sm text-green-600 dark:text-green-400">{ldapNotice}</p>}
        {ldapTestError && <p className="text-sm text-red-500">{ldapTestError}</p>}
        {ldapTestNotice && <p className="text-sm text-green-600 dark:text-green-400">{ldapTestNotice}</p>}

        <div className="flex justify-end gap-2">
          <button
            className="btn-secondary"
            onClick={handleTestLdap}
            disabled={ldapTesting || ldapSaving || ldapLoading}
          >
            {ldapTesting ? t('settings.testing') : t('settings.testBtn')}
          </button>
          <button className="btn-primary" onClick={handleSaveLdap} disabled={ldapSaving || ldapLoading}>
            {ldapSaving ? t('settings.saving') : t('settings.saveBtn')}
          </button>
        </div>
      </div>
    </div>
  )
}
