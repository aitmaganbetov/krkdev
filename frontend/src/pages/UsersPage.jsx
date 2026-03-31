import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { blockLocalUser, createLocalUser, deleteLocalUser, getLocalUsers, unblockLocalUser, updateLocalUser, updateLocalUserRole } from '../services/api'
import { formatDateTimeUtcPlus5 } from '../utils/datetime'
import Spinner from '../components/Spinner'

export default function UsersPage() {
  const { t } = useTranslation()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [savingRoleFor, setSavingRoleFor] = useState('')
  const [savingBlockFor, setSavingBlockFor] = useState('')
  const [deletingUserFor, setDeletingUserFor] = useState('')
  const [creating, setCreating] = useState(false)
  const [editingUser, setEditingUser] = useState(null)
  const [newUser, setNewUser] = useState({ username: '', display_name: '', password: '', role: 'staff' })
  const [editForm, setEditForm] = useState({ display_name: '', password: '', role: 'staff' })

  useEffect(() => {
    getLocalUsers()
      .then((data) => {
        setUsers(data || [])
        setError('')
      })
      .catch(() => setError(t('users.loadError')))
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return users
    return users.filter((user) => {
      const username = (user.username || '').toLowerCase()
      const displayName = (user.display_name || '').toLowerCase()
      return username.includes(q) || displayName.includes(q)
    })
  }, [users, query])

  const handleRoleChange = async (username, role) => {
    setSavingRoleFor(username)
    try {
      const updated = await updateLocalUserRole(username, role)
      setUsers((prev) => prev.map((item) => (item.username === username ? updated : item)))
    } catch {
      setError(t('users.roleUpdateError'))
    } finally {
      setSavingRoleFor('')
    }
  }

  const handleCreateUser = async (e) => {
    e.preventDefault()
    setError('')
    setCreating(true)
    try {
      const created = await createLocalUser(newUser)
      setUsers((prev) => [created, ...prev])
      setNewUser({ username: '', display_name: '', password: '', role: 'staff' })
    } catch (err) {
      setError(err.response?.data?.detail || t('users.createError'))
    } finally {
      setCreating(false)
    }
  }

  const handleToggleBlock = async (user) => {
    setError('')
    setSavingBlockFor(user.username)
    try {
      const updated = user.is_blocked
        ? await unblockLocalUser(user.username)
        : await blockLocalUser(user.username, { reason: 'manual_admin_block' })
      setUsers((prev) => prev.map((item) => (item.username === user.username ? updated : item)))
    } catch (err) {
      setError(err.response?.data?.detail || (user.is_blocked ? t('users.unblockError') : t('users.blockError')))
    } finally {
      setSavingBlockFor('')
    }
  }

  const handleDeleteUser = async (user) => {
    setError('')
    const confirmed = window.confirm(t('users.deleteConfirm', { username: user.username }))
    if (!confirmed) {
      return
    }

    setDeletingUserFor(user.username)
    try {
      await deleteLocalUser(user.username)
      setUsers((prev) => prev.filter((item) => item.username !== user.username))
      if (editingUser === user.username) {
        cancelEdit()
      }
    } catch (err) {
      setError(err.response?.data?.detail || t('users.deleteError'))
    } finally {
      setDeletingUserFor('')
    }
  }

  const statusClass = (isBlocked) => (isBlocked
    ? 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300'
    : 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300')

  const startEdit = (user) => {
    setEditingUser(user.username)
    setEditForm({
      display_name: user.display_name || '',
      password: '',
      role: user.role || 'staff',
    })
  }

  const cancelEdit = () => {
    setEditingUser(null)
    setEditForm({ display_name: '', password: '', role: 'staff' })
  }

  const saveEdit = async (username) => {
    setError('')
    try {
      const payload = {
        display_name: editForm.display_name,
        role: editForm.role,
      }
      if (editForm.password.trim()) {
        payload.password = editForm.password
      }

      const updated = await updateLocalUser(username, payload)
      setUsers((prev) => prev.map((item) => (item.username === username ? updated : item)))
      cancelEdit()
    } catch (err) {
      setError(err.response?.data?.detail || t('users.updateError'))
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('users.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t('users.subtitle')}
          </p>
        </div>
        <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300">
          {t('users.total', {count: filtered.length})}
        </span>
      </div>

      <div className="card p-4">
        <label className="label mb-2">{t('users.searchLabel')}</label>
        <input
          className="input"
          {...{placeholder: t('users.searchPlaceholder')}}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="card p-4">
        <h2 className="font-semibold text-gray-900 dark:text-white mb-3">{t('users.addTitle')}</h2>
        <form className="grid grid-cols-1 md:grid-cols-4 gap-3" onSubmit={handleCreateUser}>
          <input
            className="input"
            placeholder={t('users.loginPlaceholder')}
            value={newUser.username}
            onChange={(e) => setNewUser((prev) => ({ ...prev, username: e.target.value }))}
            required
          />
          <input
            className="input"
            placeholder={t('users.namePlaceholder')}
            value={newUser.display_name}
            onChange={(e) => setNewUser((prev) => ({ ...prev, display_name: e.target.value }))}
          />
          <input
            className="input"
            type="password"
            placeholder={t('users.passwordPlaceholder')}
            value={newUser.password}
            onChange={(e) => setNewUser((prev) => ({ ...prev, password: e.target.value }))}
            required
          />
          <div className="flex gap-2">
            <select
              className="input"
              value={newUser.role}
              onChange={(e) => setNewUser((prev) => ({ ...prev, role: e.target.value }))}
            >
              <option value="admin">admin</option>
              <option value="inspector">inspector</option>
              <option value="staff">staff</option>
            </select>
            <button className="btn-primary whitespace-nowrap" type="submit" disabled={creating}>
              {creating ? t('users.adding') : t('users.addBtn')}
            </button>
          </div>
        </form>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-14">
            <Spinner size="lg" />
          </div>
        ) : error ? (
          <div className="text-center text-red-500 py-14">{error}</div>
        ) : (
          <>
            {/* Mobile: card list */}
            <div className="sm:hidden divide-y divide-gray-100 dark:divide-gray-800">
              {filtered.map((user) => (
                <div key={user.username} className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-gray-900 dark:text-gray-100">{user.username}</p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{user.display_name || '—'}</p>
                    </div>
                    <span className="text-xs px-2 py-1 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-medium flex-shrink-0">
                      {user.role || 'staff'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-500 dark:text-gray-400">
                    <span>{user.auth_source || '—'}</span>
                    {user.is_ldap && <span>LDAP</span>}
                    {user.last_login_at && <span>{formatDateTimeUtcPlus5(user.last_login_at)}</span>}
                    <span className={`px-2 py-0.5 rounded-full font-medium ${statusClass(user.is_blocked)}`}>
                      {user.is_blocked ? t('users.statusBlocked') : t('users.statusActive')}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <select
                      className="input h-8 py-1 text-xs"
                      value={user.role || 'staff'}
                      disabled={savingRoleFor === user.username}
                      onChange={(e) => handleRoleChange(user.username, e.target.value)}
                    >
                      <option value="admin">admin</option>
                      <option value="inspector">inspector</option>
                      <option value="staff">staff</option>
                    </select>
                    <button className="btn-secondary text-xs px-3 py-1.5" onClick={() => startEdit(user)}>
                      {t('users.editBtn')}
                    </button>
                    <button
                      className="btn-secondary text-xs px-3 py-1.5"
                      disabled={savingBlockFor === user.username}
                      onClick={() => handleToggleBlock(user)}
                    >
                      {user.is_blocked ? t('users.unblockBtn') : t('users.blockBtn')}
                    </button>
                    <button
                      className="btn-secondary text-xs px-3 py-1.5"
                      disabled={deletingUserFor === user.username}
                      onClick={() => handleDeleteUser(user)}
                    >
                      {t('users.deleteBtn')}
                    </button>
                  </div>
                  {user.is_blocked && user.blocked_until && (
                    <p className="text-xs text-red-500 dark:text-red-300">
                      {t('users.blockedUntil')}: {user.blocked_until}
                    </p>
                  )}
                  {editingUser === user.username && (
                    <div className="space-y-2 pt-2 border-t border-gray-100 dark:border-gray-800">
                      <input
                        className="input"
                        placeholder={t('users.namePlaceholder')}
                        value={editForm.display_name}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, display_name: e.target.value }))}
                      />
                      <input
                        className="input"
                        type="password"
                        placeholder={t('users.newPasswordPlaceholder')}
                        value={editForm.password}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, password: e.target.value }))}
                      />
                      <div className="flex gap-2">
                        <button className="btn-primary text-xs px-3 py-2" onClick={() => saveEdit(user.username)}>{t('users.saveBtn')}</button>
                        <button className="btn-secondary text-xs px-3 py-2" onClick={cancelEdit}>{t('users.cancelBtn')}</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {filtered.length === 0 && (
                <p className="text-center py-10 text-gray-400">{t('users.notFound')}</p>
              )}
            </div>

            {/* Desktop: table */}
            <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide bg-gray-50 dark:bg-gray-800/50">
                  <th className="px-4 py-3">{t('users.loginCol')}</th>
                  <th className="px-4 py-3">{t('users.nameCol')}</th>
                  <th className="px-4 py-3">{t('users.roleCol')}</th>
                  <th className="px-4 py-3">{t('users.sourceCol')}</th>
                  <th className="px-4 py-3">{t('users.ldapCol')}</th>
                  <th className="px-4 py-3">{t('users.statusCol')}</th>
                  <th className="px-4 py-3">{t('users.lastLoginCol')}</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {filtered.map((user) => (
                  <tr key={`${user.username}-${user.last_login_at}`} className="hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{user.username}</td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                      {editingUser === user.username ? (
                        <input
                          className="input h-9 py-1"
                          value={editForm.display_name}
                          onChange={(e) => setEditForm((prev) => ({ ...prev, display_name: e.target.value }))}
                        />
                      ) : (user.display_name || '—')}
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                      {editingUser === user.username ? (
                        <select
                          className="input h-9 py-1"
                          value={editForm.role}
                          onChange={(e) => setEditForm((prev) => ({ ...prev, role: e.target.value }))}
                        >
                          <option value="admin">admin</option>
                          <option value="inspector">inspector</option>
                          <option value="staff">staff</option>
                        </select>
                      ) : (
                        <select
                          className="input h-9 py-1"
                          value={user.role || 'staff'}
                          disabled={savingRoleFor === user.username}
                          onChange={(e) => handleRoleChange(user.username, e.target.value)}
                        >
                          <option value="admin">admin</option>
                          <option value="inspector">inspector</option>
                          <option value="staff">staff</option>
                        </select>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{user.auth_source || '—'}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{user.is_ldap ? t('users.isLdap') : t('users.notLdap')}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                      <div className="flex flex-col gap-1">
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium w-fit ${statusClass(user.is_blocked)}`}>
                          {user.is_blocked ? t('users.statusBlocked') : t('users.statusActive')}
                        </span>
                        {user.is_blocked && user.blocked_until && (
                          <span className="text-xs text-red-500 dark:text-red-300">{t('users.blockedUntil')}: {user.blocked_until}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">{user.last_login_at ? formatDateTimeUtcPlus5(user.last_login_at) : '—'}</td>
                    <td className="px-4 py-3 text-right">
                      {editingUser === user.username ? (
                        <div className="flex items-center justify-end gap-2">
                          <input
                            className="input h-9 py-1 w-40"
                            type="password"
                            placeholder="Новый пароль"
                            value={editForm.password}
                            onChange={(e) => setEditForm((prev) => ({ ...prev, password: e.target.value }))}
                          />
                          <button className="btn-primary text-xs px-3 py-2" onClick={() => saveEdit(user.username)}>
                            {t('users.saveBtn')}
                          </button>
                          <button className="btn-secondary text-xs px-3 py-2" onClick={cancelEdit}>
                            {t('users.cancelBtn')}
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-2">
                          <button className="btn-secondary text-xs px-3 py-2" onClick={() => startEdit(user)}>
                            {t('users.editBtn')}
                          </button>
                          <button
                            className="btn-secondary text-xs px-3 py-2"
                            disabled={savingBlockFor === user.username}
                            onClick={() => handleToggleBlock(user)}
                          >
                            {user.is_blocked ? t('users.unblockBtn') : t('users.blockBtn')}
                          </button>
                          <button
                            className="btn-secondary text-xs px-3 py-2"
                            disabled={deletingUserFor === user.username}
                            onClick={() => handleDeleteUser(user)}
                          >
                            {t('users.deleteBtn')}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <p className="text-center py-10 text-gray-400">Пользователи не найдены</p>
            )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}