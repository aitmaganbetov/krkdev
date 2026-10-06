import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  createRoom,
  deleteRoom,
  getRooms,
  testRoomCamera,
  updateRoom,
} from '../services/api'
import CameraLive from '../components/CameraLive'
import {
  Alert, Badge, Button, Card, CardFooter, DescriptionList, EmptyState, Field, FormSection, Icon, Input, Modal, PageHeader, PageStack, SearchInput, SkeletonText, Switch, Textarea, useUI,
} from '../components/ui'

const EMPTY_FORM = {
  name: '',
  building: '',
  floor: '',
  capacity: 0,
  equipment: '',
  notes: '',
  camera_enabled: false,
  camera_api_url: '',
  camera_stream_url: '',
  camera_username: '',
  camera_api_key: '',
}

// Примеры адресов — технические строки, не переводятся
const PLACEHOLDERS = {
  apiUrl: 'https://camera.local/api/status',
  streamUrl: 'rtsp://camera.local/stream',
  password: '••••••••',
}

const FORM_ID = 'room-form'

export default function RoomsSettingsPage() {
  const { t } = useTranslation()
  const { toast, confirm } = useUI()
  const [rooms, setRooms] = useState([])
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testingId, setTestingId] = useState(null)
  const [viewingRoom, setViewingRoom] = useState(null)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')

  const loadRooms = () => {
    setLoading(true)
    getRooms()
      .then((data) => {
        setRooms(data || [])
        setError('')
      })
      .catch((err) => setError(err.response?.data?.detail || t('roomsPage.loadError')))
      .finally(() => setLoading(false))
  }

  useEffect(() => loadRooms(), [])

  const filteredRooms = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return rooms
    return rooms.filter((room) => [room.name, room.building, room.equipment]
      .some((value) => String(value || '').toLowerCase().includes(query)))
  }, [rooms, search])

  const openCreate = () => {
    setForm(EMPTY_FORM)
    setEditingId(null)
    setError('')
    setShowForm(true)
  }

  const openEdit = (room) => {
    setForm({
      name: room.name || '',
      building: room.building || '',
      floor: room.floor || '',
      capacity: room.capacity || 0,
      equipment: room.equipment || '',
      notes: room.notes || '',
      camera_enabled: Boolean(room.camera_enabled),
      camera_api_url: room.camera_api_url || '',
      camera_stream_url: room.camera_stream_url || '',
      camera_username: room.camera_username || '',
      camera_api_key: '',
    })
    setEditingId(room.id)
    setError('')
    setShowForm(true)
  }

  const save = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const payload = { ...form, capacity: Number(form.capacity) || 0 }
      if (editingId) await updateRoom(editingId, payload)
      else await createRoom(payload)
      toast.success(editingId ? t('roomsPage.updated') : t('roomsPage.created'))
      setShowForm(false)
      setEditingId(null)
      setForm(EMPTY_FORM)
      loadRooms()
    } catch (err) {
      const detail = err.response?.data?.detail
      setError(typeof detail === 'string' ? detail : t('roomsPage.saveError'))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (room) => {
    const ok = await confirm({
      title: t('roomsPage.deleteTitle'),
      message: t('roomsPage.deleteConfirm', { name: room.name }),
      confirmLabel: t('roomsPage.actions.delete'),
      tone: 'danger',
    })
    if (!ok) return
    try {
      await deleteRoom(room.id)
      setRooms((current) => current.filter((item) => item.id !== room.id))
      toast.success(t('roomsPage.deleted'))
    } catch (err) {
      toast.error(err.response?.data?.detail || t('roomsPage.deleteError'))
    }
  }

  const testCamera = async (room) => {
    setTestingId(room.id)
    setError('')
    try {
      const result = await testRoomCamera(room.id)
      if (result.success) toast.success(`${room.name}: ${result.message}`)
      else toast.error(`${room.name}: ${result.message}`)
    } catch (err) {
      toast.error(err.response?.data?.detail || t('roomsPage.testError'))
    } finally {
      setTestingId(null)
    }
  }

  const closeForm = () => {
    setShowForm(false)
    setEditingId(null)
  }

  const patchForm = (patch) => setForm({ ...form, ...patch })

  const locationOf = (room) => [room.building, room.floor && t('roomsPage.floor', { floor: room.floor })]
    .filter(Boolean).join(' · ') || t('roomsPage.noLocation')

  return (
    <PageStack>
      <PageHeader
        title={t('nav.rooms')}
        description={t('roomsPage.description')}
        actions={<Button icon="plus" onClick={openCreate}>{t('roomsPage.add')}</Button>}
      />

      <div className="w-full min-w-0 sm:max-w-md">
        <SearchInput
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('roomsPage.searchPlaceholder')}
          aria-label={t('roomsPage.searchLabel')}
        />
      </div>

      {error && !showForm && (
        <Alert
          tone="danger"
          closeLabel={t('ui.close')}
          onClose={() => setError('')}
          action={!rooms.length && (
            <Button variant="secondary" size="sm" icon="refresh" onClick={loadRooms}>{t('ui.retry')}</Button>
          )}
        >
          {error}
        </Alert>
      )}

      {loading ? (
        <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Card key={i} padded><SkeletonText lines={5} /></Card>
          ))}
        </div>
      ) : filteredRooms.length === 0 ? (
        <Card>
          {rooms.length > 0 ? (
            <EmptyState icon="search" title={t('roomsPage.nothingFound')} description={t('roomsPage.nothingFoundHint')} />
          ) : (
            <EmptyState
              icon="building"
              title={t('roomsPage.empty')}
              description={t('roomsPage.emptyHint')}
              action={<Button icon="plus" onClick={openCreate}>{t('roomsPage.add')}</Button>}
            />
          )}
        </Card>
      ) : (
        <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredRooms.map((room) => (
            <Card as="article" key={room.id} className="flex flex-col">
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-4 sm:px-5">
                <div className="min-w-0 flex-1 basis-40">
                  <h2 className="break-words text-base font-semibold text-fg">{room.name}</h2>
                  <p className="mt-0.5 text-sm text-fg-muted">{locationOf(room)}</p>
                </div>
                <Badge tone={room.camera_enabled ? 'success' : 'neutral'} dot>
                  {room.camera_enabled ? t('roomsPage.camera') : t('roomsPage.noCamera')}
                </Badge>
              </div>

              <div className="flex min-w-0 flex-1 flex-col gap-4 px-4 py-4 sm:px-5">
                <DescriptionList
                  columns={1}
                  items={[
                    {
                      label: t('roomsPage.capacity'),
                      value: room.capacity
                        ? <span className="tabular">{t('roomsPage.capacityValue', { count: room.capacity })}</span>
                        : <span className="text-fg-subtle">{t('roomsPage.capacityEmpty')}</span>,
                    },
                    {
                      label: t('roomsPage.equipment'),
                      value: room.equipment
                        ? <span className="whitespace-pre-line">{room.equipment}</span>
                        : <span className="text-fg-subtle">{t('roomsPage.equipmentEmpty')}</span>,
                    },
                  ]}
                />

                {room.camera_enabled && (
                  <div className="min-w-0 rounded-md border border-line bg-surface-muted p-3">
                    <p className="flex min-w-0 items-center gap-2 text-sm font-medium text-fg">
                      <Icon name="camera" size={18} className="text-accent" />
                      <span className="min-w-0">{t('roomsPage.cameraApi')}</span>
                    </p>
                    {room.camera_api_url ? (
                      <p className="mt-1.5 min-w-0 break-all font-mono text-xs text-fg-muted" aria-label={t('roomsPage.cameraApiUrl')}>
                        {room.camera_api_url}
                      </p>
                    ) : (
                      <p className="mt-1.5 text-xs text-fg-subtle">{t('roomsPage.urlEmpty')}</p>
                    )}
                    {room.camera_api_key_configured && (
                      <Badge tone="success" icon="key" className="mt-2">{t('roomsPage.keySaved')}</Badge>
                    )}
                  </div>
                )}
              </div>

              <CardFooter className="justify-start">
                <Button variant="secondary" size="sm" icon="edit" onClick={() => openEdit(room)}>
                  {t('roomsPage.actions.edit')}
                </Button>
                {room.camera_enabled && (
                  <Button size="sm" icon="video" onClick={() => setViewingRoom(room)}>
                    {t('roomsPage.actions.live')}
                  </Button>
                )}
                {room.camera_enabled && (
                  <Button variant="secondary" size="sm" icon="refresh" loading={testingId === room.id} disabled={testingId === room.id} onClick={() => testCamera(room)}>
                    {testingId === room.id ? t('roomsPage.actions.testing') : t('roomsPage.actions.test')}
                  </Button>
                )}
                <Button variant="danger-ghost" size="sm" icon="trash" onClick={() => remove(room)}>
                  {t('roomsPage.actions.delete')}
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      {/* Форма кабинета */}
      <Modal
        open={showForm}
        onClose={closeForm}
        size="lg"
        title={editingId ? t('roomsPage.form.editTitle') : t('roomsPage.form.createTitle')}
        description={t('roomsPage.form.description')}
        footer={(
          <>
            <Button variant="secondary" onClick={closeForm}>{t('roomsPage.form.cancel')}</Button>
            <Button type="submit" form={FORM_ID} loading={saving}>
              {saving ? t('roomsPage.form.saving') : t('roomsPage.form.save')}
            </Button>
          </>
        )}
      >
        <form id={FORM_ID} onSubmit={save} className="flex min-w-0 flex-col gap-6">
          {error && <Alert tone="danger" closeLabel={t('ui.close')} onClose={() => setError('')}>{error}</Alert>}

          <FormSection title={t('roomsPage.form.roomSection')}>
            <Field label={t('roomsPage.form.name')} required>
              <Input value={form.name} onChange={(e) => patchForm({ name: e.target.value })} placeholder={t('roomsPage.form.namePlaceholder')} data-autofocus />
            </Field>
            <Field label={t('roomsPage.form.building')}>
              <Input value={form.building} onChange={(e) => patchForm({ building: e.target.value })} placeholder={t('roomsPage.form.buildingPlaceholder')} />
            </Field>
            <Field label={t('roomsPage.form.floor')}>
              <Input value={form.floor} onChange={(e) => patchForm({ floor: e.target.value })} placeholder="1" />
            </Field>
            <Field label={t('roomsPage.form.capacity')}>
              <Input type="number" min="0" inputMode="numeric" value={form.capacity} onChange={(e) => patchForm({ capacity: e.target.value })} />
            </Field>
            <Field label={t('roomsPage.form.equipment')} className="sm:col-span-2">
              <Textarea value={form.equipment} onChange={(e) => patchForm({ equipment: e.target.value })} placeholder={t('roomsPage.form.equipmentPlaceholder')} />
            </Field>
            <Field label={t('roomsPage.form.notes')} className="sm:col-span-2">
              <Textarea rows={2} value={form.notes} onChange={(e) => patchForm({ notes: e.target.value })} />
            </Field>
          </FormSection>

          <FormSection title={t('roomsPage.form.cameraSection')} className="border-t border-line pt-6">
            <div className="sm:col-span-2">
              <Switch
                checked={form.camera_enabled}
                onChange={(camera_enabled) => patchForm({ camera_enabled })}
                label={t('roomsPage.form.cameraEnabled')}
                description={t('roomsPage.form.cameraEnabledHint')}
              />
            </div>
            <Field label={t('roomsPage.form.apiUrl')} className="sm:col-span-2">
              <Input value={form.camera_api_url} onChange={(e) => patchForm({ camera_api_url: e.target.value })} placeholder={PLACEHOLDERS.apiUrl} autoComplete="off" spellCheck={false} />
            </Field>
            <Field label={t('roomsPage.form.streamUrl')} hint={t('roomsPage.form.streamUrlHint')} className="sm:col-span-2">
              <Input value={form.camera_stream_url} onChange={(e) => patchForm({ camera_stream_url: e.target.value })} placeholder={PLACEHOLDERS.streamUrl} autoComplete="off" spellCheck={false} />
            </Field>
            <Field label={t('roomsPage.form.username')}>
              <Input value={form.camera_username} onChange={(e) => patchForm({ camera_username: e.target.value })} autoComplete="off" />
            </Field>
            <Field label={t('roomsPage.form.apiKey')} hint={t('roomsPage.form.apiKeyHint')}>
              <Input
                type="password"
                value={form.camera_api_key}
                onChange={(e) => patchForm({ camera_api_key: e.target.value })}
                placeholder={editingId ? t('roomsPage.form.apiKeyKeep') : PLACEHOLDERS.password}
                autoComplete="new-password"
              />
            </Field>
          </FormSection>
        </form>
      </Modal>

      {/* Просмотр камеры */}
      <Modal
        open={!!viewingRoom}
        onClose={() => setViewingRoom(null)}
        size="xl"
        title={viewingRoom ? t('roomsPage.live.title', { name: viewingRoom.name }) : ''}
        description={(
          <span className="inline-flex items-center gap-1.5 font-medium text-success">
            <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-success" />
            {t('roomsPage.live.badge')}
          </span>
        )}
        footer={<Button variant="secondary" onClick={() => setViewingRoom(null)}>{t('roomsPage.live.close')}</Button>}
      >
        {viewingRoom && (
          // Видео всегда на тёмной подложке: класс dark переключает токены внутри, чтобы alt-текст был светлым в обеих темах
          <div className="dark grid aspect-video w-full min-w-0 place-items-center overflow-hidden rounded-md bg-[rgb(6_18_31)]">
            <CameraLive
              roomId={viewingRoom.id}
              alt={t('roomsPage.live.alt', { name: viewingRoom.name })}
              className="h-full w-full object-contain text-sm text-fg-muted"
              onError={(event) => { event.currentTarget.alt = t('roomsPage.live.error') }}
            />
          </div>
        )}
      </Modal>
    </PageStack>
  )
}
