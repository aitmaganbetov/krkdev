import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  getAiSettings,
  getBasicInfoCatalog,
  getPlatonusStatus,
  getLdapSettings,
  saveAiSettings,
  saveLdapSettings,
  syncPlatonusCatalogs,
  testAiProvider,
  testLdapSettings,
} from '../services/api'
import {
  Alert, Badge, Button, Card, CardBody, CardFooter, CardHeader, Field, FormSection, Input, PageHeader, PageStack, SkeletonText, Spinner, Switch, Textarea, cn,
} from '../components/ui'

function countGroups(faculties = []) {
  return faculties.reduce((total, faculty) => (
    total + (faculty.specializations || []).reduce((sum, specialization) => sum + (specialization.groups?.length || 0), 0)
  ), 0)
}

// Модели: [ID, отображаемое имя, ключ пометки settingsPage.ai.modelTags.* или null]
const AI_MODELS = {
  openai: [
    ['gpt-5.6-luna', 'GPT-5.6 Luna', 'economy'],
    ['gpt-5.6-terra', 'GPT-5.6 Terra', 'balanced'],
    ['gpt-5.6-sol', 'GPT-5.6 Sol', 'best'],
    ['gpt-5.4-mini', 'GPT-5.4 mini', null],
    ['gpt-5.4-nano', 'GPT-5.4 nano', null],
  ],
  gemini: [
    ['gemini-2.5-flash', 'Gemini 2.5 Flash', 'stable'],
    ['gemini-2.5-pro', 'Gemini 2.5 Pro', null],
    ['gemini-3-pro-preview', 'Gemini 3 Pro · Preview', null],
  ],
}

// Провайдеры: [ключ, название, API] — названия продуктов не переводятся
const AI_PROVIDERS = [
  ['openai', 'OpenAI', 'Responses API'],
  ['gemini', 'Google Gemini', 'Gemini API'],
]

// Подписи справочников Platonus по ключу (бэкенд отдаёт подпись только по-русски)
const CATALOG_LABEL_KEYS = {
  tutors: 'settings.teachers',
  faculties: 'settings.faculties',
  specializations: 'settings.specializations',
  groups: 'settings.groups',
}

const CATALOG_STATUS_TONES = {
  synced: 'success',
  outdated: 'warning',
  unavailable: 'danger',
  local_error: 'danger',
}

const DATE_LOCALES = { ru: 'ru-RU', kz: 'kk-KZ', en: 'en-GB' }

// Примеры значений — технические строки, не переводятся
const PLACEHOLDERS = {
  serverUrl: 'ldaps://dc1.kaztbu.edu.kz:636',
  baseDn: 'dc=company,dc=local',
  bindDn: 'cn=ldap-reader,ou=service,dc=company,dc=local',
  password: '••••••••',
  cert: '-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----',
}

export default function SystemSettingsPage() {
  const { t, i18n } = useTranslation()
  const [catalog, setCatalog] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [platonusStatus, setPlatonusStatus] = useState(null)
  const [platonusError, setPlatonusError] = useState('')
  const [platonusSyncing, setPlatonusSyncing] = useState(false)
  const [platonusNotice, setPlatonusNotice] = useState('')
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
      setPlatonusError(statusResult.reason?.response?.data?.detail || t('settingsPage.platonus.statusError'))
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
      .catch(() => setAiError(t('settingsPage.ai.loadError')))
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

  const handlePlatonusSync = async () => {
    setPlatonusSyncing(true)
    setPlatonusNotice('')
    setPlatonusError('')
    try {
      const result = await syncPlatonusCatalogs()
      setPlatonusNotice(result.message || t('settingsPage.platonus.synced'))
      await load()
    } catch (err) {
      setPlatonusError(err.response?.data?.detail || t('settingsPage.platonus.syncError'))
    } finally {
      setPlatonusSyncing(false)
    }
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
      setAiNotice(t('settingsPage.ai.saved'))
    } catch (err) {
      setAiError(err.response?.data?.detail || t('settingsPage.ai.saveError'))
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
      setAiError(err.response?.data?.detail || t('settingsPage.ai.testError'))
    } finally {
      setAiTesting('')
    }
  }

  // --- Отображение ---

  const dateLocale = DATE_LOCALES[i18n.language] || 'ru-RU'
  const modelLabel = (name, tag) => (tag ? `${name} · ${t(`settingsPage.ai.modelTags.${tag}`)}` : name)

  // Состояние подключения к Platonus: бейдж + текст
  const connection = platonusStatus
    ? platonusStatus.connected
      ? { tone: 'success', label: t('settingsPage.platonus.connected') }
      : { tone: 'danger', label: t('settingsPage.platonus.disconnected') }
    : loading
      ? { tone: 'neutral', label: t('settingsPage.platonus.checking') }
      : { tone: 'neutral', label: t('settingsPage.platonus.notChecked') }

  const catalogItems = platonusStatus?.catalogs || [
    { key: 'tutors', label: t('settings.teachers'), local_count: stats.teachers },
    { key: 'faculties', label: t('settings.faculties'), local_count: stats.faculties },
    { key: 'specializations', label: t('settings.specializations'), local_count: stats.specializations },
    { key: 'groups', label: t('settings.groups'), local_count: stats.groups },
  ]

  const closeLabel = t('ui.close')

  return (
    <PageStack>
      <PageHeader title={t('nav.settings')} description={t('settingsPage.description')} />

      {/* Интеграция с Platonus */}
      <Card>
        <CardHeader title={t('settingsPage.platonus.title')} description={t('settingsPage.platonus.description')} />
        <CardBody className="flex flex-col gap-4">
          <div className="flex min-w-0 flex-col gap-3 rounded-md border border-line p-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <Badge tone={connection.tone} dot>{connection.label}</Badge>
              {platonusStatus?.message && <p className="mt-2 text-sm text-fg-muted">{platonusStatus.message}</p>}
            </div>
            {platonusStatus && (
              <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                <dt className="text-fg-subtle">{t('settingsPage.platonus.database')}</dt>
                <dd className="min-w-0 break-all text-fg">{platonusStatus.database || '—'}</dd>
                <dt className="text-fg-subtle">{t('settingsPage.platonus.checkedAt')}</dt>
                <dd className="min-w-0 tabular text-fg">{new Date(platonusStatus.checked_at).toLocaleString(dateLocale)}</dd>
                <dt className="text-fg-subtle">{t('settingsPage.platonus.responseTime')}</dt>
                <dd className="min-w-0 tabular text-fg">{t('settingsPage.platonus.ms', { value: platonusStatus.response_ms })}</dd>
              </dl>
            )}
          </div>

          {platonusError && <Alert tone="danger" closeLabel={closeLabel} onClose={() => setPlatonusError('')}>{platonusError}</Alert>}
          {platonusNotice && <Alert tone="success" closeLabel={closeLabel} onClose={() => setPlatonusNotice('')}>{platonusNotice}</Alert>}
          {error && <Alert tone="danger">{error}</Alert>}

          <div>
            <h3 className="mb-3 text-sm font-semibold text-fg">{t('settingsPage.platonus.catalogsTitle')}</h3>
            <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {catalogItems.map((item) => {
                const statusKey = CATALOG_STATUS_TONES[item.status] ? item.status : 'pending'
                const label = CATALOG_LABEL_KEYS[item.key] ? t(CATALOG_LABEL_KEYS[item.key]) : item.label
                return (
                  <div key={item.key} className="flex min-w-0 flex-col gap-2 rounded-md border border-line bg-surface-muted p-3">
                    <div className="flex min-w-0 items-start justify-between gap-2">
                      <p className="min-w-0 text-sm font-medium text-fg-muted">{label}</p>
                      {loading && <Spinner size={16} className="text-fg-subtle" />}
                    </div>
                    <p className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
                      <span className="text-2xl font-semibold tabular text-fg">{item.local_count ?? '—'}</span>
                      <span className="text-xs text-fg-subtle">{t('settingsPage.platonus.local')}</span>
                    </p>
                    {item.remote_count !== null && item.remote_count !== undefined && (
                      <p className="text-sm tabular text-fg-muted">{t('settingsPage.platonus.remote', { count: item.remote_count })}</p>
                    )}
                    <Badge tone={CATALOG_STATUS_TONES[statusKey] || 'neutral'} className="self-start">
                      {t(`settingsPage.platonus.catalogStatus.${statusKey}`)}
                    </Badge>
                  </div>
                )
              })}
            </div>
          </div>
        </CardBody>
        <CardFooter>
          <Button variant="secondary" icon="refresh" onClick={load} loading={loading} disabled={loading || platonusSyncing}>
            {loading ? t('settingsPage.platonus.checking') : t('settingsPage.platonus.check')}
          </Button>
          <Button
            onClick={handlePlatonusSync}
            loading={platonusSyncing}
            disabled={loading || platonusSyncing || !platonusStatus?.connected}
            title={!platonusStatus?.connected ? t('settingsPage.platonus.syncNeedsConnection') : undefined}
          >
            {platonusSyncing ? t('settingsPage.platonus.syncing') : t('settingsPage.platonus.sync')}
          </Button>
        </CardFooter>
      </Card>

      {/* AI-провайдеры */}
      <Card>
        <CardHeader title={t('settingsPage.ai.title')} description={t('settingsPage.ai.description')} />
        <CardBody className="flex flex-col gap-4">
          {aiLoading ? (
            <div className="grid min-w-0 gap-4 lg:grid-cols-2" aria-busy="true">
              <SkeletonText lines={5} className="rounded-lg border border-line p-4" />
              <SkeletonText lines={5} className="rounded-lg border border-line p-4" />
            </div>
          ) : (
            <div role="radiogroup" aria-label={t('settingsPage.ai.providerGroup')} className="grid min-w-0 gap-4 lg:grid-cols-2">
              {AI_PROVIDERS.map(([provider, title, subtitle]) => {
                const settings = ai[provider]
                const isActive = ai.active_provider === provider
                const canTest = settings.enabled && settings.api_key_configured
                return (
                  <div
                    key={provider}
                    className={cn(
                      'flex min-w-0 flex-col rounded-lg border bg-surface transition-colors',
                      isActive ? 'border-primary ring-1 ring-primary' : 'border-line',
                    )}
                  >
                    <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={isActive}
                        onClick={() => setAi((current) => ({ ...current, active_provider: provider }))}
                        className="flex min-h-10 min-w-0 flex-1 basis-44 cursor-pointer items-center gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                      >
                        <span aria-hidden="true" className={cn('grid h-5 w-5 shrink-0 place-items-center rounded-full border-2', isActive ? 'border-primary' : 'border-line-strong')}>
                          {isActive && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
                        </span>
                        <span className="min-w-0">
                          <span className="block font-semibold text-fg">{title}</span>
                          <span className="block text-xs text-fg-subtle">{subtitle}</span>
                        </span>
                      </button>
                      <div className="flex flex-wrap items-center gap-2">
                        {isActive && <Badge tone="primary">{t('settingsPage.ai.active')}</Badge>}
                        <Switch
                          checked={settings.enabled}
                          onChange={(enabled) => updateAiProvider(provider, { enabled })}
                          label={t('settingsPage.ai.enabled')}
                        />
                      </div>
                    </div>

                    <div className="flex min-w-0 flex-1 flex-col gap-4 p-4">
                      <Field label={t('settingsPage.ai.model')} hint={t('settingsPage.ai.modelHint')}>
                        <Input
                          list={`${provider}-models`}
                          value={settings.model}
                          onChange={(e) => updateAiProvider(provider, { model: e.target.value })}
                          placeholder={t('settingsPage.ai.modelPlaceholder')}
                          autoComplete="off"
                        />
                        <datalist id={`${provider}-models`}>
                          {AI_MODELS[provider].map(([id, name, tag]) => <option key={id} value={id}>{modelLabel(name, tag)}</option>)}
                        </datalist>
                        <div role="group" aria-label={t('settingsPage.ai.modelChips')} className="flex min-w-0 flex-wrap gap-2">
                          {AI_MODELS[provider].map(([id, name, tag]) => {
                            const selected = settings.model === id
                            return (
                              <button
                                key={id}
                                type="button"
                                title={modelLabel(name, tag)}
                                aria-pressed={selected}
                                onClick={() => updateAiProvider(provider, { model: id })}
                                className={cn(
                                  'inline-flex min-h-8 max-w-full cursor-pointer items-center rounded-md border px-3 py-1 text-xs font-medium transition-colors',
                                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
                                  selected ? 'border-primary bg-primary text-primary-on' : 'border-line-strong bg-surface text-fg-muted hover:bg-surface-hover hover:text-fg',
                                )}
                              >
                                <span className="min-w-0 break-all">{id}</span>
                              </button>
                            )
                          })}
                        </div>
                      </Field>

                      <Field
                        label={t('settingsPage.ai.apiKey')}
                        hint={settings.api_key_configured ? t('settingsPage.ai.keyConfiguredHint') : t('settingsPage.ai.keyMissingHint')}
                        labelAction={(
                          <Badge tone={settings.api_key_configured ? 'success' : 'neutral'} icon={settings.api_key_configured ? 'check' : undefined}>
                            {settings.api_key_configured ? t('settingsPage.ai.keyConfigured') : t('settingsPage.ai.keyMissing')}
                          </Badge>
                        )}
                      >
                        <Input
                          type="password"
                          autoComplete="new-password"
                          placeholder={settings.api_key_configured ? t('settingsPage.ai.apiKeyReplacePlaceholder') : t('settingsPage.ai.apiKeyPlaceholder')}
                          value={settings.api_key}
                          onChange={(e) => updateAiProvider(provider, { api_key: e.target.value })}
                        />
                      </Field>

                      <Button
                        variant="secondary"
                        block
                        className="mt-auto"
                        icon="link"
                        loading={aiTesting === provider}
                        disabled={Boolean(aiTesting) || aiSaving || aiLoading || !canTest}
                        title={!canTest ? t('settingsPage.ai.testUnavailable') : undefined}
                        onClick={() => handleTestAi(provider)}
                      >
                        {aiTesting === provider ? t('settingsPage.ai.testing') : t('settingsPage.ai.test')}
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {aiError && <Alert tone="danger" closeLabel={closeLabel} onClose={() => setAiError('')}>{aiError}</Alert>}
          {aiNotice && <Alert tone="success" closeLabel={closeLabel} onClose={() => setAiNotice('')}>{aiNotice}</Alert>}
        </CardBody>
        <CardFooter>
          <Button onClick={handleSaveAi} loading={aiSaving} disabled={aiSaving || aiLoading}>
            {aiSaving ? t('settingsPage.ai.saving') : t('settingsPage.ai.save')}
          </Button>
        </CardFooter>
      </Card>

      {/* LDAP */}
      <Card>
        <CardHeader title={t('settings.ldapTitle')} description={t('settings.ldapSubtitle')} />
        <CardBody className="flex flex-col gap-4">
          {ldapLoading ? (
            <div role="status" aria-busy="true" aria-label={t('settingsPage.ldap.loading')}>
              <SkeletonText lines={6} />
            </div>
          ) : (
            <FormSection>
              <Field label={t('settings.serverUrl')} className="sm:col-span-2">
                <Input
                  placeholder={PLACEHOLDERS.serverUrl}
                  value={ldap.server_url}
                  onChange={(e) => updateLdap({ server_url: e.target.value })}
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>
              <Field label={t('settings.baseDn')} className="sm:col-span-2">
                <Input
                  placeholder={PLACEHOLDERS.baseDn}
                  value={ldap.base_dn}
                  onChange={(e) => updateLdap({ base_dn: e.target.value })}
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>
              <Field label={t('settings.bindDn')} className="sm:col-span-2">
                <Input
                  placeholder={PLACEHOLDERS.bindDn}
                  value={ldap.bind_dn}
                  onChange={(e) => updateLdap({ bind_dn: e.target.value })}
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>
              <Field label={t('settings.bindPassword')} className="sm:col-span-2">
                <Input
                  type="password"
                  placeholder={PLACEHOLDERS.password}
                  value={ldap.bind_password}
                  onChange={(e) => updateLdap({ bind_password: e.target.value })}
                  autoComplete="new-password"
                />
              </Field>
              <Field label={t('settings.certKey')} className="sm:col-span-2">
                <Textarea
                  className="break-all font-mono text-xs"
                  rows={4}
                  maxRows={40}
                  placeholder={PLACEHOLDERS.cert}
                  value={ldap.certificate_key}
                  onChange={(e) => updateLdap({ certificate_key: e.target.value })}
                  spellCheck={false}
                />
              </Field>
            </FormSection>
          )}

          {ldapError && <Alert tone="danger" closeLabel={closeLabel} onClose={() => setLdapError('')}>{ldapError}</Alert>}
          {ldapNotice && <Alert tone="success" closeLabel={closeLabel} onClose={() => setLdapNotice('')}>{ldapNotice}</Alert>}
          {ldapTestError && <Alert tone="danger" closeLabel={closeLabel} onClose={() => setLdapTestError('')}>{ldapTestError}</Alert>}
          {ldapTestNotice && <Alert tone="success" closeLabel={closeLabel} onClose={() => setLdapTestNotice('')}>{ldapTestNotice}</Alert>}
        </CardBody>
        <CardFooter>
          <Button variant="secondary" icon="link" onClick={handleTestLdap} loading={ldapTesting} disabled={ldapTesting || ldapSaving || ldapLoading}>
            {ldapTesting ? t('settings.testing') : t('settings.testBtn')}
          </Button>
          <Button onClick={handleSaveLdap} loading={ldapSaving} disabled={ldapSaving || ldapLoading}>
            {ldapSaving ? t('settings.saving') : t('settings.saveBtn')}
          </Button>
        </CardFooter>
      </Card>
    </PageStack>
  )
}
