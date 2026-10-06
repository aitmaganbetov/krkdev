import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { blockLocalUser, createLocalUser, deleteLocalUser, getLocalUsers, unblockLocalUser, updateLocalUser, updateLocalUserRole } from '../services/api'
import { formatDateTimeUtcPlus5 } from '../utils/datetime'
import {
  Alert, Badge, Button, Card, CardHeader, DataTable, EmptyState, Field, FilterBar, Input, Modal,
  PageHeader, PageStack, SearchInput, Select, Spinner, useUI,
} from '../components/ui'

// Значения ролей уходят в API как есть; подписи — из shell.roles.*
const ROLE_VALUES = ['admin', 'inspector', 'staff']
const CREATE_FORM_ID = 'create-user-form'

export default function UsersPage() {
  const { t } = useTranslation()
  const { toast, confirm } = useUI()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [filterRole, setFilterRole] = useState('')
  const [savingRoleFor, setSavingRoleFor] = useState('')
  const [savingBlockFor, setSavingBlockFor] = useState('')
  const [deletingUserFor, setDeletingUserFor] = useState('')
  const [creating, setCreating] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
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
    const r = filterRole.trim()
    if (!q && !r) return users
    return users.filter((user) => {
      const username = (user.username || '').toLowerCase()
      const displayName = (user.display_name || '').toLowerCase()
      const matchesQuery = !q || username.includes(q) || displayName.includes(q)
      const matchesRole = !r || (user.role || 'staff') === r
      return matchesQuery && matchesRole
    })
  }, [users, query, filterRole])

  const roleOptions = ROLE_VALUES.map((value) => ({ value, label: t(`shell.roles.${value}`) }))
  const filtersActive = !!(query.trim() || filterRole.trim())

  const handleRoleChange = async (username, role) => {
    setSavingRoleFor(username)
    try {
      const updated = await updateLocalUserRole(username, role)
      setUsers((prev) => prev.map((item) => (item.username === username ? updated : item)))
      toast.success(t('usersPage.roleChanged', { username }))
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
      toast.success(t('usersPage.created', { username: created?.username || newUser.username }))
    } catch (err) {
      setError(err.response?.data?.detail || t('users.createError'))
    } finally {
      setCreating(false)
    }
  }

  const openCreateModal = () => {
    setError('')
    setShowCreateModal(true)
  }

  const closeCreateModal = () => {
    if (creating) return
    setShowCreateModal(false)
  }

  const handleToggleBlock = async (user) => {
    setError('')
    // Блокировка — с подтверждением; разблокировка выполняется сразу
    if (!user.is_blocked) {
      const ok = await confirm({
        title: t('usersPage.blockConfirmTitle'),
        message: t('usersPage.blockConfirm', { username: user.username }),
        confirmLabel: t('users.blockBtn'),
        tone: 'danger',
      })
      if (!ok) return
    }
    setSavingBlockFor(user.username)
    try {
      const updated = user.is_blocked
        ? await unblockLocalUser(user.username)
        : await blockLocalUser(user.username, { reason: 'manual_admin_block' })
      setUsers((prev) => prev.map((item) => (item.username === user.username ? updated : item)))
      toast.success(t(user.is_blocked ? 'usersPage.unblocked' : 'usersPage.blocked', { username: user.username }))
    } catch (err) {
      setError(err.response?.data?.detail || (user.is_blocked ? t('users.unblockError') : t('users.blockError')))
    } finally {
      setSavingBlockFor('')
    }
  }

  const handleDeleteUser = async (user) => {
    setError('')
    const confirmed = await confirm({
      title: t('usersPage.deleteConfirmTitle'),
      message: t('usersPage.deleteConfirm', { username: user.username }),
      confirmLabel: t('users.deleteBtn'),
      tone: 'danger',
    })
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
      toast.success(t('usersPage.deleted', { username: user.username }))
    } catch (err) {
      setError(err.response?.data?.detail || t('users.deleteError'))
    } finally {
      setDeletingUserFor('')
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
      toast.success(t('usersPage.updated', { username }))
    } catch (err) {
      setError(err.response?.data?.detail || t('users.updateError'))
    }
  }

  const isEditing = (user) => editingUser === user.username

  // Действия строки: на мобильных карточках — кнопки с подписями (переносятся),
  // в таблице (≥ md) — компактные кнопки-иконки с подсказкой.
  const renderActions = (user) => {
    if (isEditing(user)) {
      return (
        <div className="flex min-w-0 flex-wrap items-center gap-2 md:justify-end">
          <Input
            size="sm"
            type="password"
            className="min-w-[10rem] flex-1 basis-40"
            placeholder={t('usersPage.newPasswordHint')}
            aria-label={t('usersPage.newPasswordHint')}
            title={t('usersPage.newPasswordHint')}
            autoComplete="new-password"
            value={editForm.password}
            onChange={(e) => setEditForm((prev) => ({ ...prev, password: e.target.value }))}
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon="check" onClick={() => saveEdit(user.username)}>{t('users.saveBtn')}</Button>
            <Button size="sm" variant="secondary" onClick={cancelEdit}>{t('users.cancelBtn')}</Button>
          </div>
        </div>
      )
    }
    const blockLabel = user.is_blocked ? t('users.unblockBtn') : t('users.blockBtn')
    const blockAria = t(user.is_blocked ? 'usersPage.unblockAria' : 'usersPage.blockAria', { username: user.username })
    const blockIcon = user.is_blocked ? 'unlock' : 'lock'
    const blockBusy = savingBlockFor === user.username
    const deleteBusy = deletingUserFor === user.username
    return (
      <>
        <div className="flex min-w-0 flex-wrap gap-2 md:hidden">
          <Button size="sm" variant="secondary" icon="edit" onClick={() => startEdit(user)}>{t('users.editBtn')}</Button>
          <Button size="sm" variant="secondary" icon={blockIcon} loading={blockBusy} onClick={() => handleToggleBlock(user)}>
            {blockLabel}
          </Button>
          <Button size="sm" variant="danger-ghost" icon="trash" loading={deleteBusy} onClick={() => handleDeleteUser(user)}>
            {t('users.deleteBtn')}
          </Button>
        </div>
        <div className="hidden items-center justify-end gap-1 md:flex">
          <Button size="sm" variant="ghost" icon="edit" iconOnly
            aria-label={t('usersPage.editAria', { username: user.username })} onClick={() => startEdit(user)} />
          <Button size="sm" variant="ghost" icon={blockIcon} iconOnly loading={blockBusy}
            aria-label={blockAria} onClick={() => handleToggleBlock(user)} />
          <Button size="sm" variant="danger-ghost" icon="trash" iconOnly loading={deleteBusy}
            aria-label={t('usersPage.deleteAria', { username: user.username })} onClick={() => handleDeleteUser(user)} />
        </div>
      </>
    )
  }

  const columns = [
    {
      key: 'username',
      header: t('users.loginCol'),
      mobile: 'title',
      nowrap: true,
      cell: (user) => <span className="font-medium text-fg">{user.username}</span>,
    },
    {
      key: 'display_name',
      header: t('users.nameCol'),
      // В режиме редактирования поле ввода не должно сжиматься
      minWidth: editingUser ? '16rem' : undefined,
      cell: (user) => (isEditing(user) ? (
        <Input
          size="sm"
          aria-label={t('users.nameCol')}
          placeholder={t('users.namePlaceholder')}
          value={editForm.display_name}
          onChange={(e) => setEditForm((prev) => ({ ...prev, display_name: e.target.value }))}
        />
      ) : (user.display_name || '—')),
    },
    {
      key: 'role',
      header: t('users.roleCol'),
      // Селект роли всегда не уже 10rem (+ поля ячейки) — дефект аудита №3
      minWidth: '12rem',
      cell: (user) => (isEditing(user) ? (
        <Select
          size="sm"
          className="min-w-[10rem]"
          aria-label={t('usersPage.roleOf', { username: user.username })}
          options={roleOptions}
          value={editForm.role}
          onChange={(e) => setEditForm((prev) => ({ ...prev, role: e.target.value }))}
        />
      ) : (
        <div className="flex min-w-0 items-center gap-2">
          <Select
            size="sm"
            className="min-w-[10rem] flex-1"
            aria-label={t('usersPage.roleOf', { username: user.username })}
            options={roleOptions}
            value={user.role || 'staff'}
            disabled={savingRoleFor === user.username}
            onChange={(e) => handleRoleChange(user.username, e.target.value)}
          />
          {savingRoleFor === user.username && <Spinner size={16} className="text-fg-subtle" />}
        </div>
      )),
    },
    {
      key: 'auth_source',
      header: t('users.sourceCol'),
      nowrap: true,
      cell: (user) => <span className="text-fg-muted">{user.auth_source || '—'}</span>,
    },
    {
      key: 'is_ldap',
      header: t('users.ldapCol'),
      nowrap: true,
      cell: (user) => <span className="text-fg-muted">{user.is_ldap ? t('users.isLdap') : t('users.notLdap')}</span>,
    },
    {
      key: 'status',
      header: t('users.statusCol'),
      cell: (user) => (
        <div className="flex min-w-0 flex-col items-start gap-1">
          <Badge tone={user.is_blocked ? 'danger' : 'success'} dot>
            {user.is_blocked ? t('users.statusBlocked') : t('users.statusActive')}
          </Badge>
          {user.is_blocked && user.blocked_until && (
            <span className="text-xs text-danger">{t('users.blockedUntil')}: {user.blocked_until}</span>
          )}
        </div>
      ),
    },
    {
      key: 'last_login_at',
      header: t('users.lastLoginCol'),
      nowrap: true,
      cell: (user) => (
        <span className="text-fg-muted tabular">{user.last_login_at ? formatDateTimeUtcPlus5(user.last_login_at) : '—'}</span>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('ui.actions')}</span>,
      mobileLabel: '',
      mobile: 'full',
      align: 'right',
      minWidth: editingUser ? '20rem' : undefined,
      cell: renderActions,
    },
  ]

  const countText = filtersActive
    ? t('usersPage.shown', { shown: filtered.length, total: users.length })
    : t('users.total', { count: filtered.length })

  return (
    <PageStack>
      <PageHeader
        title={t('users.title')}
        description={t('usersPage.description')}
        actions={<Button icon="plus" onClick={openCreateModal}>{t('usersPage.add')}</Button>}
      />

      {error && !showCreateModal && <Alert tone="danger" onClose={() => setError('')} closeLabel={t('ui.close')}>{error}</Alert>}

      <FilterBar>
        <Field label={t('users.searchLabel')}>
          <SearchInput
            placeholder={t('users.searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </Field>
        <Field label={t('users.filterByRole')}>
          <Select
            options={roleOptions}
            placeholder={t('users.allRoles')}
            value={filterRole}
            onChange={(e) => setFilterRole(e.target.value)}
          />
        </Field>
      </FilterBar>

      {/* Без данных при ошибке загрузки таблицу не показываем — достаточно сообщения выше */}
      {!(error && !loading && users.length === 0) && (
        <Card>
          <CardHeader title={t('usersPage.listTitle')} description={loading ? null : countText} />
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey="username"
            loading={loading}
            caption={t('users.title')}
            empty={(
              <EmptyState
                icon="users"
                title={t('users.notFound')}
                description={filtersActive ? t('ui.nothingFoundHint') : undefined}
                compact
              />
            )}
          />
        </Card>
      )}

      <Modal
        open={showCreateModal}
        onClose={closeCreateModal}
        size="md"
        title={t('users.addTitle')}
        description={t('usersPage.createDescription')}
        footer={(
          <>
            <Button variant="secondary" onClick={closeCreateModal} disabled={creating}>{t('users.cancelBtn')}</Button>
            <Button type="submit" form={CREATE_FORM_ID} icon="plus" loading={creating}>{t('usersPage.create')}</Button>
          </>
        )}
      >
        <form id={CREATE_FORM_ID} onSubmit={handleCreateUser} className="flex min-w-0 flex-col gap-4">
          {error && <Alert tone="danger" onClose={() => setError('')} closeLabel={t('ui.close')}>{error}</Alert>}
          <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t('users.loginCol')} required>
              <Input
                value={newUser.username}
                onChange={(e) => setNewUser((prev) => ({ ...prev, username: e.target.value }))}
                autoComplete="off"
                data-autofocus
              />
            </Field>
            <Field label={t('users.nameCol')}>
              <Input
                value={newUser.display_name}
                onChange={(e) => setNewUser((prev) => ({ ...prev, display_name: e.target.value }))}
                autoComplete="off"
              />
            </Field>
            <Field label={t('users.passwordPlaceholder')} required>
              <Input
                type="password"
                value={newUser.password}
                onChange={(e) => setNewUser((prev) => ({ ...prev, password: e.target.value }))}
                autoComplete="new-password"
              />
            </Field>
            <Field label={t('users.roleCol')}>
              <Select
                options={roleOptions}
                value={newUser.role}
                onChange={(e) => setNewUser((prev) => ({ ...prev, role: e.target.value }))}
              />
            </Field>
          </div>
        </form>
      </Modal>
    </PageStack>
  )
}
