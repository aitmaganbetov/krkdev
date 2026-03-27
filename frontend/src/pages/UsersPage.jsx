import { useEffect, useMemo, useState } from 'react'
import { createLocalUser, getLocalUsers, updateLocalUser, updateLocalUserRole } from '../services/api'
import Spinner from '../components/Spinner'

export default function UsersPage() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [savingRoleFor, setSavingRoleFor] = useState('')
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
      .catch(() => setError('Не удалось загрузить список пользователей'))
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
      setError('Не удалось обновить роль пользователя')
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
      setError(err.response?.data?.detail || 'Не удалось создать пользователя')
    } finally {
      setCreating(false)
    }
  }

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
      setError(err.response?.data?.detail || 'Не удалось обновить пользователя')
    }
  }

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Пользователи</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Локальные пользователи из таблицы users (авторизованные в системе)
          </p>
        </div>
        <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300">
          Всего: {filtered.length}
        </span>
      </div>

      <div className="card p-4">
        <label className="label mb-2">Поиск пользователя</label>
        <input
          className="input"
          placeholder="Логин или ФИО"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="card p-4">
        <h2 className="font-semibold text-gray-900 dark:text-white mb-3">Добавить пользователя вручную</h2>
        <form className="grid grid-cols-1 md:grid-cols-4 gap-3" onSubmit={handleCreateUser}>
          <input
            className="input"
            placeholder="Логин"
            value={newUser.username}
            onChange={(e) => setNewUser((prev) => ({ ...prev, username: e.target.value }))}
            required
          />
          <input
            className="input"
            placeholder="ФИО"
            value={newUser.display_name}
            onChange={(e) => setNewUser((prev) => ({ ...prev, display_name: e.target.value }))}
          />
          <input
            className="input"
            type="password"
            placeholder="Пароль"
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
              {creating ? 'Создание...' : 'Добавить'}
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
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide bg-gray-50 dark:bg-gray-800/50">
                  <th className="px-4 py-3">Логин</th>
                  <th className="px-4 py-3">ФИО</th>
                  <th className="px-4 py-3">Роль</th>
                  <th className="px-4 py-3">Источник</th>
                  <th className="px-4 py-3">LDAP</th>
                  <th className="px-4 py-3">Последний вход</th>
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
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{user.is_ldap ? 'Да' : 'Нет'}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">{user.last_login_at || '—'}</td>
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
                            Сохранить
                          </button>
                          <button className="btn-secondary text-xs px-3 py-2" onClick={cancelEdit}>
                            Отмена
                          </button>
                        </div>
                      ) : (
                        <button className="btn-secondary text-xs px-3 py-2" onClick={() => startEdit(user)}>
                          Изменить
                        </button>
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
        )}
      </div>
    </div>
  )
}