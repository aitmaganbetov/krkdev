import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  apiErrorText,
  createRoom,
  deleteRoom,
  getRooms,
  syncRoomsFromPlatonus,
  testRoomCamera,
  updateRoom,
} from '../services/api'
import CameraLive from '../components/CameraLive'
import RoomInventoryModal from '../components/RoomInventoryModal'
import RoomQr, { roomScanUrl } from '../components/RoomQr'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { isSuperadmin } from '../utils/roles'
import {
  Alert, Badge, Button, Card, CardHeader, DataTable, EmptyState, Field, FilterBar, FormSection, Input, Modal, PageHeader, PageStack,
  Pagination, SearchInput, SegmentedControl, Select, StatCard, Switch, Textarea, useUI,
} from '../components/ui'
import { formatMoney } from '../utils/locale'

const EMPTY_FORM = {
  name: '',
  building: '',
  floor: '',
  capacity: 0,
  area: 0,
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
const PAGE_SIZE = 25
const byNumber = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' })

export default function RoomsSettingsPage() {
  const { t, i18n } = useTranslation()
  const { toast, confirm } = useUI()
  const [rooms, setRooms] = useState([])
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState(null)
  const [editingPlatonus, setEditingPlatonus] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testingId, setTestingId] = useState(null)
  const [viewingRoom, setViewingRoom] = useState(null)
  const [inventoryRoom, setInventoryRoom] = useState(null)
  const [qrRoom, setQrRoom] = useState(null)
  // Администратор работает с кабинетами и смотрит камеры, но настройку камеры меняет только суперадминистратор
  const { role } = useAuth()
  const canConfigureCamera = isSuperadmin(role)
  const hasCameraSetup = (room) => Boolean(room.camera_enabled || room.camera_stream_url || room.camera_api_url)
  const [search, setSearch] = useState('')
  const [building, setBuilding] = useState('')
  const [cameraFilter, setCameraFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')

  const loadRooms = () => {
    setLoading(true)
    getRooms()
      .then((data) => {
        setRooms(data || [])
        setError('')
      })
      .catch((err) => setError(apiErrorText(err, t('roomsPage.loadError'))))
      .finally(() => setLoading(false))
  }

  useEffect(() => loadRooms(), [])

  // Корпуса — по числу кабинетов: учебные блоки наверху, базы практики внизу
  const buildings = useMemo(() => {
    const counts = new Map()
    rooms.forEach((room) => counts.set(room.building || '', (counts.get(room.building || '') || 0) + 1))
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || byNumber.compare(a[0], b[0]))
      .map(([name, count]) => ({ name, count }))
  }, [rooms])

  const cameraCount = useMemo(() => rooms.filter((room) => room.camera_enabled).length, [rooms])
  const inventoryTotal = useMemo(() => rooms.reduce((sum, room) => sum + (Number(room.inventory_total) || 0), 0), [rooms])
  const money = (value) => formatMoney(value, i18n.language)
  // Площадь, м²: до одного знака после запятой в формате языка интерфейса
  const area = (value) => new Intl.NumberFormat(i18n.language === 'en' ? 'en-GB' : 'ru-RU', { maximumFractionDigits: 1 }).format(Number(value) || 0)
  const totalArea = useMemo(() => rooms.reduce((sum, room) => sum + (Number(room.area) || 0), 0), [rooms])
  // Итоги кабинета обновляются сразу после правки инвентаря, без перезагрузки списка
  const updateInventorySummary = (roomId, count, total) => setRooms((current) => current.map((room) => (
    room.id === roomId ? { ...room, inventory_count: count, inventory_total: total } : room
  )))
  const withCount = (label, count) => (loading ? label : `${label} · ${count}`)

  const filteredRooms = useMemo(() => {
    const query = search.trim().toLowerCase()
    return rooms
      .filter((room) => !building || (room.building || '') === building)
      .filter((room) => cameraFilter === 'all' || Boolean(room.camera_enabled) === (cameraFilter === 'with'))
      .filter((room) => !query || [room.name, room.building, room.room_type, room.equipment]
        .some((value) => String(value || '').toLowerCase().includes(query)))
      .sort((a, b) => byNumber.compare(a.building || '', b.building || '') || byNumber.compare(a.name, b.name))
  }, [rooms, search, building, cameraFilter])

  useEffect(() => setPage(1), [search, building, cameraFilter])

  const totalPages = Math.max(1, Math.ceil(filteredRooms.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageRooms = filteredRooms.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const importFromPlatonus = async () => {
    setSyncing(true)
    setError('')
    try {
      const result = await syncRoomsFromPlatonus()
      toast.success(t('roomsPage.sync.done', { total: result.total, created: result.created, updated: result.updated }))
      if (result.missing?.length) {
        toast.warning(t('roomsPage.sync.missing', { count: result.missing.length, names: result.missing.slice(0, 5).join(', ') }))
      }
      loadRooms()
    } catch (err) {
      toast.error(apiErrorText(err, t('roomsPage.sync.error')))
    } finally {
      setSyncing(false)
    }
  }

  const openCreate = () => {
    setForm(EMPTY_FORM)
    setEditingId(null)
    setEditingPlatonus(false)
    setError('')
    setShowForm(true)
  }

  const openEdit = (room) => {
    setForm({
      name: room.name || '',
      building: room.building || '',
      floor: room.floor || '',
      capacity: room.capacity || 0,
      area: room.area || 0,
      equipment: room.equipment || '',
      notes: room.notes || '',
      camera_enabled: Boolean(room.camera_enabled),
      camera_api_url: room.camera_api_url || '',
      camera_stream_url: room.camera_stream_url || '',
      camera_username: room.camera_username || '',
      camera_api_key: '',
    })
    setEditingId(room.id)
    setEditingPlatonus(Boolean(room.platonus_auditory_id))
    setError('')
    setShowForm(true)
  }

  const save = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const payload = { ...form, capacity: Number(form.capacity) || 0, area: Number(form.area) || 0 }
      if (editingId) await updateRoom(editingId, payload)
      else await createRoom(payload)
      toast.success(editingId ? t('roomsPage.updated') : t('roomsPage.created'))
      setShowForm(false)
      setEditingId(null)
      setForm(EMPTY_FORM)
      loadRooms()
    } catch (err) {
      setError(apiErrorText(err, t('roomsPage.saveError')))
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
      toast.error(apiErrorText(err, t('roomsPage.deleteError')))
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
      toast.error(apiErrorText(err, t('roomsPage.testError')))
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

  const columns = [
    {
      key: 'name',
      header: t('roomsPage.columns.room'),
      mobile: 'title',
      minWidth: '12rem',
      cell: (room) => (
        <div className="min-w-0">
          <p className="break-words font-semibold text-fg">{room.name}</p>
          {room.room_type && <p className="mt-0.5 break-words text-xs text-fg-muted">{room.room_type}</p>}
        </div>
      ),
    },
    { key: 'location', header: t('roomsPage.columns.location'), minWidth: '10rem', cell: (room) => locationOf(room) },
    {
      key: 'capacity',
      header: t('roomsPage.capacity'),
      align: 'right',
      nowrap: true,
      cell: (room) => (room.capacity
        ? <span className="tabular">{room.capacity}</span>
        : <span className="text-fg-subtle">—</span>),
    },
    {
      key: 'area',
      header: t('roomsPage.area'),
      align: 'right',
      nowrap: true,
      cell: (room) => (room.area
        ? <span className="tabular">{t('roomsPage.areaValue', { value: area(room.area) })}</span>
        : <span className="text-fg-subtle">—</span>),
    },
    {
      key: 'inventory',
      header: t('roomsPage.columns.inventory'),
      align: 'right',
      nowrap: true,
      cell: (room) => (room.inventory_count ? (
        <div className="flex flex-col items-end">
          <span className="tabular font-medium">{money(room.inventory_total)}</span>
          <span className="text-xs text-fg-muted">{t('roomsPage.inventory.items', { count: room.inventory_count })}</span>
        </div>
      ) : <span className="text-fg-subtle">—</span>),
    },
    {
      key: 'camera',
      header: t('roomsPage.camera'),
      nowrap: true,
      cell: (room) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={room.camera_enabled ? 'success' : 'neutral'} dot>
            {room.camera_enabled ? t('roomsPage.cameraOn') : t('roomsPage.noCamera')}
          </Badge>
          {room.camera_enabled && !room.camera_stream_url && !room.camera_api_url && (
            <Badge tone="warning">{t('roomsPage.urlEmpty')}</Badge>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('roomsPage.columns.actions')}</span>,
      mobile: 'full',
      nowrap: true,
      cell: (room) => (
        <div className="flex flex-wrap items-center gap-2">
          {room.qr_code && (
            <Button variant="secondary" size="sm" icon="maximize" onClick={() => setQrRoom(room)}>
              {t('roomsPage.actions.qr')}
            </Button>
          )}
          <Button variant="secondary" size="sm" icon="inbox" onClick={() => setInventoryRoom(room)}>
            {t('roomsPage.actions.inventory')}
          </Button>
          <Button variant="secondary" size="sm" icon="camera" onClick={() => openEdit(room)}>
            {room.camera_enabled || !canConfigureCamera ? t('roomsPage.actions.edit') : t('roomsPage.actions.setupCamera')}
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
          {/* Кабинет из Platonus вернётся при следующем импорте — удалять имеет смысл только заведённые вручную */}
          {!room.platonus_auditory_id && (canConfigureCamera || !hasCameraSetup(room)) && (
            <Button variant="danger-ghost" size="sm" icon="trash" onClick={() => remove(room)}>
              {t('roomsPage.actions.delete')}
            </Button>
          )}
        </div>
      ),
    },
  ]

  return (
    <PageStack>
      <PageHeader
        title={t('nav.rooms')}
        description={t('roomsPage.description')}
        actions={(
          <>
            <Button as={Link} variant="secondary" icon="printer"
              to={`/rooms-settings/qr?ids=${filteredRooms.map((room) => room.id).join(',')}`}>
              {t('roomsPage.qr.printButton', { count: filteredRooms.length })}
            </Button>
            <Button variant="secondary" icon="download" loading={syncing} disabled={syncing} onClick={importFromPlatonus}>
              {syncing ? t('roomsPage.sync.running') : t('roomsPage.sync.action')}
            </Button>
            <Button icon="plus" onClick={openCreate}>{t('roomsPage.add')}</Button>
          </>
        )}
      />

      {/* На телефоне счётчики есть в переключателе камеры — карточки только съели бы первый экран */}
      <div className="hidden min-w-0 gap-4 sm:grid sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('roomsPage.stats.total')} value={loading ? '…' : rooms.length} icon="building"
          hint={loading ? null : t('roomsPage.stats.totalArea', { value: area(totalArea) })} />
        <StatCard label={t('roomsPage.stats.withCamera')} value={loading ? '…' : cameraCount} icon="camera" tone="success" />
        <StatCard label={t('roomsPage.stats.withoutCamera')} value={loading ? '…' : rooms.length - cameraCount} icon="video" />
        <StatCard label={t('roomsPage.stats.inventoryTotal')} value={loading ? '…' : money(inventoryTotal)} icon="inbox" tone="primary" />
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

      <FilterBar ariaLabel={t('roomsPage.filters')}>
        <Field label={t('roomsPage.searchLabel')}>
          <SearchInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('roomsPage.searchPlaceholder')}
          />
        </Field>
        <Field label={t('roomsPage.form.building')}>
          <Select value={building} onChange={(e) => setBuilding(e.target.value)} placeholder={t('roomsPage.allBuildings')}>
            {buildings.map((item) => (
              <option key={item.name} value={item.name}>
                {(item.name || t('roomsPage.noBuilding'))} · {item.count}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('roomsPage.camera')}>
          <SegmentedControl
            ariaLabel={t('roomsPage.camera')}
            value={cameraFilter}
            onChange={setCameraFilter}
            className="w-full"
            options={[
              { value: 'all', label: withCount(t('roomsPage.cameraFilter.all'), rooms.length) },
              { value: 'with', label: withCount(t('roomsPage.cameraFilter.with'), cameraCount) },
              { value: 'without', label: withCount(t('roomsPage.cameraFilter.without'), rooms.length - cameraCount) },
            ]}
          />
        </Field>
      </FilterBar>

      {!loading && rooms.length === 0 && !error ? (
        <Card>
          <EmptyState
            icon="building"
            title={t('roomsPage.empty')}
            description={t('roomsPage.emptyHint')}
            action={(
              <Button icon="download" loading={syncing} disabled={syncing} onClick={importFromPlatonus}>
                {t('roomsPage.sync.action')}
              </Button>
            )}
          />
        </Card>
      ) : (
        <Card>
          <CardHeader
            title={t('roomsPage.listTitle')}
            description={loading ? null : t('roomsPage.shown', { count: filteredRooms.length })}
          />
          <DataTable
            columns={columns}
            rows={pageRooms}
            loading={loading}
            caption={t('roomsPage.listTitle')}
            empty={<EmptyState icon="search" title={t('roomsPage.nothingFound')} description={t('roomsPage.nothingFoundHint')} compact />}
          />
          {totalPages > 1 && (
            <div className="border-t border-line px-4 py-3 sm:px-5">
              <Pagination page={currentPage} pageCount={totalPages} onPageChange={setPage} total={filteredRooms.length} pageSize={PAGE_SIZE} />
            </div>
          )}
        </Card>
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

          {editingPlatonus && <Alert tone="info">{t('roomsPage.form.platonusHint')}</Alert>}

          <FormSection title={t('roomsPage.form.roomSection')}>
            <Field label={t('roomsPage.form.name')} required>
              <Input value={form.name} onChange={(e) => patchForm({ name: e.target.value })} placeholder={t('roomsPage.form.namePlaceholder')} readOnly={editingPlatonus} data-autofocus={editingPlatonus ? undefined : true} />
            </Field>
            <Field label={t('roomsPage.form.building')}>
              <Input value={form.building} onChange={(e) => patchForm({ building: e.target.value })} placeholder={t('roomsPage.form.buildingPlaceholder')} readOnly={editingPlatonus} />
            </Field>
            <Field label={t('roomsPage.form.floor')}>
              <Input value={form.floor} onChange={(e) => patchForm({ floor: e.target.value })} placeholder="1" />
            </Field>
            <Field label={t('roomsPage.form.capacity')}>
              <Input type="number" min="0" inputMode="numeric" value={form.capacity} onChange={(e) => patchForm({ capacity: e.target.value })} />
            </Field>
            <Field label={t('roomsPage.form.area')}>
              <Input type="number" min="0" step="0.01" inputMode="decimal" value={form.area} onChange={(e) => patchForm({ area: e.target.value })} />
            </Field>
            <Field label={t('roomsPage.form.equipment')} className="sm:col-span-2">
              <Textarea value={form.equipment} onChange={(e) => patchForm({ equipment: e.target.value })} placeholder={t('roomsPage.form.equipmentPlaceholder')} />
            </Field>
            <Field label={t('roomsPage.form.notes')} className="sm:col-span-2">
              <Textarea rows={2} value={form.notes} onChange={(e) => patchForm({ notes: e.target.value })} />
            </Field>
          </FormSection>

          <FormSection title={t('roomsPage.form.cameraSection')} className="border-t border-line pt-6">
            {!canConfigureCamera && (
              <Alert tone="info" className="sm:col-span-2">{t('roomsPage.form.cameraLocked')}</Alert>
            )}
            <div className="sm:col-span-2">
              <Switch
                disabled={!canConfigureCamera}
                checked={form.camera_enabled}
                onChange={(camera_enabled) => patchForm({ camera_enabled })}
                label={t('roomsPage.form.cameraEnabled')}
                description={t('roomsPage.form.cameraEnabledHint')}
              />
            </div>
            <Field label={t('roomsPage.form.apiUrl')} className="sm:col-span-2">
              <Input disabled={!canConfigureCamera} value={form.camera_api_url} onChange={(e) => patchForm({ camera_api_url: e.target.value })} placeholder={PLACEHOLDERS.apiUrl} autoComplete="off" spellCheck={false} />
            </Field>
            <Field label={t('roomsPage.form.streamUrl')} hint={t('roomsPage.form.streamUrlHint')} className="sm:col-span-2">
              <Input disabled={!canConfigureCamera} value={form.camera_stream_url} onChange={(e) => patchForm({ camera_stream_url: e.target.value })} placeholder={PLACEHOLDERS.streamUrl} autoComplete="off" spellCheck={false} />
            </Field>
            <Field label={t('roomsPage.form.username')}>
              <Input disabled={!canConfigureCamera} value={form.camera_username} onChange={(e) => patchForm({ camera_username: e.target.value })} autoComplete="off" />
            </Field>
            <Field label={t('roomsPage.form.apiKey')} hint={t('roomsPage.form.apiKeyHint')}>
              <Input
                type="password"
                disabled={!canConfigureCamera}
                value={form.camera_api_key}
                onChange={(e) => patchForm({ camera_api_key: e.target.value })}
                placeholder={editingId ? t('roomsPage.form.apiKeyKeep') : PLACEHOLDERS.password}
                autoComplete="new-password"
              />
            </Field>
          </FormSection>
        </form>
      </Modal>

      {/* QR-код аудитории для двери: сотрудник видит пары, камеру и оснащение, студент отмечается */}
      <Modal
        open={!!qrRoom}
        onClose={() => setQrRoom(null)}
        size="sm"
        title={qrRoom ? t('roomsPage.qr.title', { name: qrRoom.name }) : ''}
        description={qrRoom?.building}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setQrRoom(null)}>{t('roomsPage.live.close')}</Button>
            {qrRoom && (
              <Button as={Link} icon="printer" to={`/rooms-settings/qr?ids=${qrRoom.id}`}>{t('roomsPage.qr.print')}</Button>
            )}
          </>
        )}
      >
        {qrRoom && (
          <div className="flex min-w-0 flex-col items-center gap-3 text-center">
            <RoomQr code={qrRoom.qr_code} size={240} alt={t('roomsPage.qr.alt', { name: qrRoom.name })} className="rounded-md border border-line p-2" />
            <a href={roomScanUrl(qrRoom.qr_code)} target="_blank" rel="noreferrer" className="break-all font-mono text-xs text-accent underline-offset-2 hover:underline">
              {roomScanUrl(qrRoom.qr_code)}
            </a>
            <p className="text-sm text-fg-muted">{t('roomsPage.qr.hint')}</p>
          </div>
        )}
      </Modal>

      {/* Оснащение и инвентаризация */}
      <RoomInventoryModal room={inventoryRoom} onClose={() => setInventoryRoom(null)} onChanged={updateInventorySummary} />

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
