import { useEffect, useMemo, useState } from 'react'
import { getBasicInfoCatalog, getLdapSettings, saveLdapSettings, testLdapSettings } from '../services/api'
import { useTheme } from '../context/ThemeContext'
import Spinner from '../components/Spinner'

function countGroups(faculties = []) {
  return faculties.reduce((total, faculty) => (
    total + (faculty.specializations || []).reduce((sum, specialization) => sum + (specialization.groups?.length || 0), 0)
  ), 0)
}

export default function SystemSettingsPage() {
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
      .catch(() => setError('Не удалось загрузить системные справочники'))
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
      .catch(() => setLdapError('Не удалось загрузить LDAP настройки'))
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
      setLdapNotice('LDAP настройки сохранены')
    } catch {
      setLdapError('Не удалось сохранить LDAP настройки')
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
      setLdapTestError('Не удалось выполнить тест LDAP подключения')
    } finally {
      setLdapTesting(false)
    }
  }

  return (
    <div className="space-y-5 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Настройка системы</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Параметры интерфейса и актуальность локальных справочников</p>
      </div>

      <div className="card p-5 flex items-center justify-between gap-4">
        <div>
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Тема интерфейса</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Текущая тема: {dark ? 'Тёмная' : 'Светлая'}</p>
        </div>
        <button className="btn-secondary" onClick={toggle}>
          Переключить тему
        </button>
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Состояние справочников</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Данные для выпадающих списков формы</p>
          </div>
          <button className="btn-secondary" onClick={load} disabled={loading}>
            Обновить проверку
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-10"><Spinner size="lg" /></div>
        ) : error ? (
          <div className="mt-4 text-red-500">{error}</div>
        ) : (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
              <p className="text-xs text-gray-500 dark:text-gray-400">Преподаватели</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{stats.teachers}</p>
            </div>
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
              <p className="text-xs text-gray-500 dark:text-gray-400">Факультеты</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{stats.faculties}</p>
            </div>
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
              <p className="text-xs text-gray-500 dark:text-gray-400">Специализации</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{stats.specializations}</p>
            </div>
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
              <p className="text-xs text-gray-500 dark:text-gray-400">Группы</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{stats.groups}</p>
            </div>
          </div>
        )}
      </div>

      <div className="card p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">LDAP настройки</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Подключение к LDAP для аутентификации пользователей</p>
          </div>
          {ldapLoading && <Spinner size="sm" />}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="label">URL сервера</label>
            <input
              className="input"
              placeholder="ldaps://dc1.kaztbu.edu.kz:636"
              value={ldap.server_url}
              onChange={(e) => updateLdap({ server_url: e.target.value })}
            />
          </div>

          <div className="sm:col-span-2">
            <label className="label">Base DN</label>
            <input
              className="input"
              placeholder="dc=company,dc=local"
              value={ldap.base_dn}
              onChange={(e) => updateLdap({ base_dn: e.target.value })}
            />
          </div>

          <div className="sm:col-span-2">
            <label className="label">Bind DN</label>
            <input
              className="input"
              placeholder="cn=ldap-reader,ou=service,dc=company,dc=local"
              value={ldap.bind_dn}
              onChange={(e) => updateLdap({ bind_dn: e.target.value })}
            />
          </div>

          <div className="sm:col-span-2">
            <label className="label">Пароль администратора AD</label>
            <input
              className="input"
              type="password"
              placeholder="••••••••"
              value={ldap.bind_password}
              onChange={(e) => updateLdap({ bind_password: e.target.value })}
            />
          </div>

          <div className="sm:col-span-2">
            <label className="label">Ключ сертификата (PEM)</label>
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
            {ldapTesting ? 'Тестирование...' : 'Тест LDAP'}
          </button>
          <button className="btn-primary" onClick={handleSaveLdap} disabled={ldapSaving || ldapLoading}>
            {ldapSaving ? 'Сохранение...' : 'Сохранить LDAP'}
          </button>
        </div>
      </div>
    </div>
  )
}