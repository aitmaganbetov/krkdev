import { useEffect, useMemo, useState } from 'react'
import {
  createRoom,
  deleteRoom,
  getRooms,
  testRoomCamera,
  updateRoom,
} from '../services/api'
import Spinner from '../components/Spinner'

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

function CameraIcon({ className = 'w-5 h-5' }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  )
}

export default function RoomsSettingsPage() {
  const [rooms, setRooms] = useState([])
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testingId, setTestingId] = useState(null)
  const [viewingRoom, setViewingRoom] = useState(null)
  const [search, setSearch] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!showForm) return

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setShowForm(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showForm])

  const loadRooms = () => {
    setLoading(true)
    getRooms()
      .then((data) => {
        setRooms(data || [])
        setError('')
      })
      .catch((err) => setError(err.response?.data?.detail || 'Не удалось загрузить кабинеты'))
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
    setNotice('')
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
    setNotice('')
    setShowForm(true)
  }

  const save = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const payload = { ...form, capacity: Number(form.capacity) || 0 }
      if (editingId) await updateRoom(editingId, payload)
      else await createRoom(payload)
      setNotice(editingId ? 'Настройки кабинета обновлены' : 'Кабинет добавлен')
      setShowForm(false)
      setEditingId(null)
      setForm(EMPTY_FORM)
      loadRooms()
    } catch (err) {
      const detail = err.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Не удалось сохранить кабинет')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (room) => {
    if (!window.confirm(`Удалить кабинет «${room.name}»?`)) return
    try {
      await deleteRoom(room.id)
      setRooms((current) => current.filter((item) => item.id !== room.id))
      setNotice('Кабинет удалён')
    } catch (err) {
      setError(err.response?.data?.detail || 'Не удалось удалить кабинет')
    }
  }

  const testCamera = async (room) => {
    setTestingId(room.id)
    setError('')
    setNotice('')
    try {
      const result = await testRoomCamera(room.id)
      if (result.success) setNotice(`${room.name}: ${result.message}`)
      else setError(`${room.name}: ${result.message}`)
    } catch (err) {
      setError(err.response?.data?.detail || 'Ошибка проверки камеры')
    } finally {
      setTestingId(null)
    }
  }

  const closeForm = () => {
    setShowForm(false)
    setEditingId(null)
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-500">Инфраструктура</p>
          <h1 className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">Настройка кабинетов</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Оснащение аудиторий и подключение камер через API</p>
        </div>
        <button className="btn-primary" onClick={openCreate}>+ Добавить кабинет</button>
      </div>

      <div className="card p-4">
        <input className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по кабинету, корпусу или оборудованию..." />
      </div>

      {notice && <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">{notice}</div>}
      {error && <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</div>}

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm" onClick={closeForm}>
          <form onSubmit={save} className="w-full max-w-5xl overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-gray-900" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 border-b border-gray-200 bg-gradient-to-r from-indigo-50 to-cyan-50 px-5 py-4 dark:border-gray-800 dark:from-indigo-950/40 dark:to-cyan-950/30">
              <div>
                <h2 className="font-bold text-gray-900 dark:text-white">{editingId ? 'Редактирование кабинета' : 'Новый кабинет'}</h2>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Форма открытия в модальном окне</p>
              </div>
              <button type="button" className="btn-secondary" onClick={closeForm}>Закрыть</button>
            </div>
            <div className="max-h-[calc(100vh-220px)] overflow-y-auto">
              <div className="grid gap-4 p-5 md:grid-cols-2">
                <label><span className="label">Номер / название *</span><input required className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Например, 1002-1" /></label>
                <label><span className="label">Корпус</span><input className="input" value={form.building} onChange={(e) => setForm({ ...form, building: e.target.value })} placeholder="Главный корпус" /></label>
                <label><span className="label">Этаж</span><input className="input" value={form.floor} onChange={(e) => setForm({ ...form, floor: e.target.value })} placeholder="1" /></label>
                <label><span className="label">Вместимость</span><input type="number" min="0" className="input" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} /></label>
                <label className="md:col-span-2"><span className="label">Что находится внутри</span><textarea className="input min-h-24" value={form.equipment} onChange={(e) => setForm({ ...form, equipment: e.target.value })} placeholder="Интерактивная панель, проектор, 25 компьютеров, микрофон..." /></label>
                <label className="md:col-span-2"><span className="label">Примечание</span><textarea className="input min-h-20" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
              </div>

              <div className="border-t border-gray-200 bg-slate-50/70 p-5 dark:border-gray-800 dark:bg-gray-950/40">
                <label className="mb-4 flex cursor-pointer items-center gap-3">
                  <input type="checkbox" className="h-4 w-4 rounded text-indigo-600" checked={form.camera_enabled} onChange={(e) => setForm({ ...form, camera_enabled: e.target.checked })} />
                  <span><span className="block text-sm font-bold text-gray-900 dark:text-white">Камера подключена</span><span className="block text-xs text-gray-500">Включить интеграцию камеры для этого кабинета</span></span>
                </label>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="md:col-span-2"><span className="label">API URL камеры</span><input className="input" value={form.camera_api_url} onChange={(e) => setForm({ ...form, camera_api_url: e.target.value })} placeholder="https://camera.local/api/status" /></label>
                  <label className="md:col-span-2"><span className="label">URL видеопотока</span><input className="input" value={form.camera_stream_url} onChange={(e) => setForm({ ...form, camera_stream_url: e.target.value })} placeholder="rtsp://camera.local/stream или https://.../hls.m3u8" /></label>
                  <label><span className="label">Логин камеры</span><input className="input" value={form.camera_username} onChange={(e) => setForm({ ...form, camera_username: e.target.value })} autoComplete="off" /></label>
                  <label><span className="label">Пароль / API-ключ</span><input type="password" className="input" value={form.camera_api_key} onChange={(e) => setForm({ ...form, camera_api_key: e.target.value })} placeholder={editingId ? 'Оставьте пустым, чтобы не менять' : '••••••••'} autoComplete="new-password" /><span className="mt-1 block text-xs text-gray-400">Для UNV используется Digest-авторизация по логину и паролю</span></label>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4 dark:border-gray-800">
              <button type="button" className="btn-secondary" onClick={closeForm}>Отмена</button>
              <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Сохранение...' : 'Сохранить'}</button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : filteredRooms.length === 0 ? (
        <div className="card py-16 text-center"><p className="font-semibold text-gray-700 dark:text-gray-200">Кабинеты пока не добавлены</p><p className="mt-1 text-sm text-gray-400">Добавьте первый кабинет и настройте его оснащение</p></div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredRooms.map((room) => (
            <article key={room.id} className="card overflow-hidden">
              <div className="flex items-start justify-between gap-3 border-b border-gray-100 p-5 dark:border-gray-800">
                <div><h2 className="text-lg font-black text-gray-900 dark:text-white">{room.name}</h2><p className="text-sm text-gray-500">{[room.building, room.floor && `${room.floor} этаж`].filter(Boolean).join(' · ') || 'Расположение не указано'}</p></div>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${room.camera_enabled ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40' : 'bg-gray-100 text-gray-400 dark:bg-gray-800'}`}><span className={`h-2 w-2 rounded-full ${room.camera_enabled ? 'bg-emerald-500' : 'bg-gray-400'}`} />Камера</span>
              </div>
              <div className="space-y-4 p-5 text-sm">
                <div><p className="text-xs font-bold uppercase tracking-wider text-gray-400">Вместимость</p><p className="mt-1 font-semibold text-gray-800 dark:text-gray-200">{room.capacity ? `${room.capacity} мест` : 'Не указана'}</p></div>
                <div><p className="text-xs font-bold uppercase tracking-wider text-gray-400">Оснащение</p><p className="mt-1 whitespace-pre-line text-gray-700 dark:text-gray-300">{room.equipment || 'Оборудование не указано'}</p></div>
                {room.camera_enabled && <div className="rounded-xl bg-indigo-50 p-3 dark:bg-indigo-950/30"><div className="flex items-center gap-2 font-semibold text-indigo-700 dark:text-indigo-300"><CameraIcon />API камеры настроен</div><p className="mt-1 truncate text-xs text-indigo-500">{room.camera_api_url || 'URL не указан'}{room.camera_api_key_configured ? ' · ключ сохранён' : ''}</p></div>}
              </div>
              <div className="flex flex-wrap gap-2 border-t border-gray-100 p-4 dark:border-gray-800">
                <button className="btn-secondary flex-1" onClick={() => openEdit(room)}>Изменить</button>
                {room.camera_enabled && <button className="btn-primary flex-1" onClick={() => setViewingRoom(room)}>Смотреть Live</button>}
                {room.camera_enabled && <button className="btn-secondary flex-1" onClick={() => testCamera(room)} disabled={testingId === room.id}>{testingId === room.id ? 'Проверка...' : 'Проверить API'}</button>}
                <button className="btn-danger" onClick={() => remove(room)}>Удалить</button>
              </div>
            </article>
          ))}
        </div>
      )}

      {viewingRoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm" onClick={() => setViewingRoom(null)}>
          <div className="w-full max-w-5xl overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-gray-900" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-800">
              <div><h2 className="font-bold text-gray-900 dark:text-white">Камера · кабинет {viewingRoom.name}</h2><p className="flex items-center gap-1.5 text-xs text-emerald-600"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />Прямой эфир</p></div>
              <button className="btn-secondary" onClick={() => setViewingRoom(null)}>Закрыть</button>
            </div>
            <div className="flex min-h-[320px] items-center justify-center bg-black p-2">
              <img
                src={`/api/rooms/${viewingRoom.id}/camera/live`}
                alt={`Камера кабинета ${viewingRoom.name}`}
                className="max-h-[70vh] w-full object-contain"
                onError={(event) => { event.currentTarget.alt = 'Не удалось получить изображение с камеры' }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
