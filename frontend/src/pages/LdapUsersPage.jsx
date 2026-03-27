import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getLdapUsers } from '../services/api'
import Spinner from '../components/Spinner'

export default function LdapUsersPage() {
  const { t } = useTranslation()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')

  useEffect(() => {
    getLdapUsers()
      .then((data) => {
        setItems(data || [])
        setError('')
      })
      .catch(() => setError(t('ldap.loadError')))
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((row) => {
      const username = (row.username || '').toLowerCase()
      const displayName = (row.display_name || '').toLowerCase()
      const dn = (row.dn || '').toLowerCase()
      return username.includes(q) || displayName.includes(q) || dn.includes(q)
    })
  }, [items, query])

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('ldap.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t('ldap.subtitle')}
          </p>
        </div>
        <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300">
          {t('ldap.total', {count: filtered.length})}
        </span>
      </div>

      <div className="card p-4">
        <label className="label mb-2">{t('ldap.searchLabel')}</label>
        <input
          className="input"
          placeholder={t('ldap.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-14"><Spinner size="lg" /></div>
        ) : error ? (
          <div className="text-center text-red-500 py-14">{error}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide bg-gray-50 dark:bg-gray-800/50">
                  <th className="px-4 py-3">{t('ldap.loginCol')}</th>
                  <th className="px-4 py-3">{t('ldap.nameCol')}</th>
                  <th className="px-4 py-3">{t('ldap.dnCol')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {filtered.map((row) => (
                  <tr key={`${row.username}-${row.dn}`} className="hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{row.username || '—'}</td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{row.display_name || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 max-w-[340px] truncate" title={row.dn || ''}>{row.dn || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className="text-center py-10 text-gray-400 space-y-2">
                <p>{t('ldap.notFound')}</p>
                <p className="text-xs">{t('ldap.checkSettings')}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}