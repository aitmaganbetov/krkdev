import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getBasicInfoCatalog, getLdapSettings, saveLdapSettings, testLdapSettings } from '../services/api'
import { useTheme } from '../context/ThemeContext'
import Spinner from '../components/Spinner'

function countGroups(faculties = []) {
  return faculties.reduce((total, faculty) => (
    total + (faculty.specializations || []).reduce((sum, specialization) => sum + (specialization.groups?.length || 0), 0)
  ), 0)
}

export default function SystemSettingsPage() {
  const { t } = useTranslation()
  const { dark, toggle } = useTheme()
  const [catalog, setCatalog] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
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

  const load = () => {
    setLoading(true)
    getBasicInfoCatalog()
      .then((data) => {
        setCatalog(data)
        setError('')
      })
      .catch(() => setError(t('settings.catalogError')))
      .finally(() => setLoading(false))
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
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">{t('settings.catalogTitle')}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('settings.catalogSubtitle')}</p>
          </div>
          <button className="btn-secondary" onClick={load} disabled={loading}>
            {t('settings.refreshBtn')}
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-10"><Spinner size="lg" /></div>
        ) : error ? (
          <div className="mt-4 text-red-500">{error}</div>
        ) : (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('settings.teachers')}</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{stats.teachers}</p>
            </div>
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('settings.faculties')}</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{stats.faculties}</p>
            </div>
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('settings.specializations')}</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{stats.specializations}</p>
            </div>
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('settings.groups')}</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{stats.groups}</p>
            </div>
          </div>
        )}
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