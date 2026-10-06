import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  captureRoomPhoto,
  createViolation,
  getRecords,
  getRooms,
  getViolations,
  improveViolationText,
  recordRoomVideo,
  reviewViolation,
  uploadViolationAct,
} from '../services/api'
import Spinner from '../components/Spinner'
import { useAuth } from '../context/AuthContext'

const tabs = [
  { id: 'live', label: 'Онлайн мониторинг' },
  { id: 'violations', label: 'Нарушения' },
  { id: 'archive', label: 'Архив' },
  { id: 'analytics', label: 'Аналитика' },
]

function getDemoLessons(date, databaseRecords, configuredRooms) {
  const uniqueTeachers = new Set()
  const sourceRecords = databaseRecords.filter((record) => {
    const teacher = String(record.teacher || '').trim().toLowerCase()
    if (!teacher || uniqueTeachers.has(teacher)) return false
    uniqueTeachers.add(teacher)
    return true
  }).slice(0, 6)

  return sourceRecords.map((record, index) => ({
    ...record,
    id: `demo-${record.id}`,
    source_record_id: record.id,
    room: configuredRooms.length
      ? configuredRooms[index % configuredRooms.length].name
      : record.room,
    configured_room_id: configuredRooms.length
      ? configuredRooms[index % configuredRooms.length].id
      : null,
    datetime: `${date}T${index < 3 ? '15:10' : '16:20'}:00`,
    status: 'demo',
    is_demo: true,
  }))
}

function Icon({ name, className = 'w-5 h-5' }) {
  const paths = {
    pulse: 'M3 12h4l2-7 4 14 2-7h6',
    alert: 'M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z',
    archive: 'M5 8h14M9 12h6m-9 9h12a2 2 0 002-2V8H4v11a2 2 0 002 2zM4 3h16v5H4z',
    chart: 'M4 19V9m5 10V5m5 14v-7m5 7V3',
    clock: 'M12 8v4l3 2m6-2a9 9 0 11-18 0 9 9 0 0118 0z',
    pin: 'M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0zM15 11a3 3 0 11-6 0 3 3 0 016 0z',
    book: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5A4.5 4.5 0 003 9.5v9A4.5 4.5 0 017.5 14c1.746 0 3.332.477 4.5 1.253m0-9C13.168 5.477 14.754 5 16.5 5A4.5 4.5 0 0121 9.5v9a4.5 4.5 0 00-4.5-4.5c-1.746 0-3.332.477-4.5 1.253',
    users: 'M17 20h5v-2a4 4 0 00-5-3.87M17 20H7m10 0v-2a5 5 0 00-10 0v2m10 0H7m0 0H2v-2a4 4 0 015-3.87M15 7a3 3 0 11-6 0 3 3 0 016 0z',
    search: 'M21 21l-4.35-4.35m2.35-5.65a8 8 0 11-16 0 8 8 0 0116 0z',
  }
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={paths[name]} />
    </svg>
  )
}

function Metric({ label, value, tone }) {
  const tones = {
    indigo: 'border-l-[#163A63] text-[#163A63] dark:text-blue-300',
    emerald: 'border-l-emerald-600 text-emerald-700 dark:text-emerald-400',
    rose: 'border-l-rose-600 text-rose-700 dark:text-rose-400',
    amber: 'border-l-amber-600 text-amber-700 dark:text-amber-400',
  }
  return (
    <div className={`rounded-lg border border-slate-200 border-l-4 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900 ${tones[tone]}`}>
      <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{label}</p>
      <p className="mt-2 text-3xl font-bold tracking-tight">{value}</p>
    </div>
  )
}

function Pagination({ total, page, pageSize, onPageChange, onPageSizeChange }) {
  if (!total) return null
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const currentPage = Math.min(page, pageCount)
  const candidates = [1, 2, currentPage - 1, currentPage, currentPage + 1, pageCount - 1, pageCount]
    .filter((value) => value >= 1 && value <= pageCount)
  const pages = [...new Set(candidates)].sort((a, b) => a - b)

  return (
    <div className="mt-5 flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">Всего записей: {total}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800" disabled={currentPage === 1} onClick={() => onPageChange(currentPage - 1)}>Назад</button>
        {pages.map((value, index) => (
          <span key={value} className="contents">
            {index > 0 && value - pages[index - 1] > 1 && <span className="px-1 text-slate-400">…</span>}
            <button type="button" onClick={() => onPageChange(value)} className={`min-h-11 min-w-11 rounded-lg px-3 text-xs font-semibold transition-colors ${value === currentPage ? 'bg-blue-700 text-white shadow-sm' : 'border border-slate-300 bg-white text-slate-700 hover:bg-blue-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'}`}>{value}</button>
          </span>
        ))}
        <button type="button" className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800" disabled={currentPage === pageCount} onClick={() => onPageChange(currentPage + 1)}>Вперёд</button>
        <span className="ml-1 text-xs text-slate-400">Страница {currentPage} из {pageCount}</span>
        <label className="ml-auto flex items-center gap-2 text-xs text-slate-500">
          На странице:
          <select className="min-h-11 rounded-lg border border-slate-300 bg-white px-2 py-2 font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200" value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
            {[10, 20, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
      </div>
    </div>
  )
}

function LessonCard({ record, onOpen }) {
  const date = new Date(record.datetime)
  const initials = String(record.teacher || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
  const isProblem = Number(record.score || 0) < 5

  return (
    <article className="group relative overflow-hidden rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md dark:border-slate-700 dark:bg-slate-900">
      <div className={`absolute inset-x-0 top-0 h-1 ${isProblem ? 'bg-rose-600' : 'bg-blue-700'}`} />
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-sm font-bold text-blue-800 dark:bg-blue-950/40 dark:text-blue-300">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 font-bold leading-snug text-slate-900 dark:text-white">{record.teacher}</h3>
          <p className="mt-1 truncate text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">{record.faculty}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${isProblem ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'}`}>
          {isProblem ? 'Риск' : 'Активно'}
        </span>
      </div>

      <div className="my-5 grid gap-3 text-sm">
        <div className="flex items-start gap-3">
          <Icon name="clock" className="mt-0.5 h-4 w-4 text-blue-700" />
          <div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Время</p><p className="font-bold text-slate-800 dark:text-slate-100">{date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</p></div>
        </div>
        <div className="flex items-start gap-3">
          <Icon name="pin" className="mt-0.5 h-4 w-4 text-blue-700" />
          <div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Аудитория</p><p className="font-semibold text-slate-700 dark:text-slate-200">{record.room || '—'}</p></div>
        </div>
        <div className="flex items-start gap-3">
          <Icon name="book" className="mt-0.5 h-4 w-4 text-blue-700" />
          <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Дисциплина</p><p className="line-clamp-2 font-semibold text-slate-700 dark:text-slate-200">{record.subject}</p></div>
        </div>
        <div className="flex items-start gap-3">
          <Icon name="users" className="mt-0.5 h-4 w-4 text-blue-700" />
          <div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Посещаемость</p><p className="font-semibold text-slate-700 dark:text-slate-200">{Number(record.attendance || 0).toFixed(0)}% · {record.group_name}</p></div>
        </div>
      </div>

      <button onClick={() => onOpen(record)} className="btn-primary w-full">
        Зафиксировать нарушение
      </button>
    </article>
  )
}

function ViolationsReview({ items, role, onReview, onUploadAct, uploadingActId }) {
  const [previewImage, setPreviewImage] = useState('')
  const [previewVideo, setPreviewVideo] = useState('')
  const [previewZoom, setPreviewZoom] = useState(1)

  if (!items.length) {
    return <div className="rounded-lg border border-dashed border-slate-300 bg-white py-16 text-center text-slate-400 shadow-sm dark:border-slate-700 dark:bg-slate-900">Зафиксированных нарушений пока нет</div>
  }
  const statusInfo = {
    pending: ['Ожидает проверки', 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'],
    confirmed: ['Подтверждено', 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'],
    rejected: ['Отклонено', 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'],
  }
  return (
    <div className="space-y-4">
      {items.map((item) => {
        const [statusLabel, statusClass] = statusInfo[item.status] || statusInfo.pending
        return (
          <article key={item.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="grid gap-5 p-5 lg:grid-cols-[1fr_.9fr]">
              <div className="min-w-0">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div><p className="text-xs font-bold uppercase tracking-[0.14em] text-blue-700">{item.violation_type}</p><h3 className="mt-1 text-lg font-bold text-slate-900 dark:text-white">{item.teacher}</h3></div>
                  <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusClass}`}>{statusLabel}</span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div><p className="text-xs font-bold uppercase text-slate-400">Аудитория</p><p className="font-semibold dark:text-slate-200">{item.room || '—'}</p></div>
                  <div><p className="text-xs font-bold uppercase text-slate-400">Дата</p><p className="font-semibold dark:text-slate-200">{new Date(`${item.violation_date}T00:00:00`).toLocaleDateString('ru-RU')}</p></div>
                  <div className="col-span-2"><p className="text-xs font-bold uppercase text-slate-400">Дисциплина</p><p className="font-semibold dark:text-slate-200">{item.subject || '—'}</p></div>
                </div>
                {item.description && <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">{item.description}</p>}
                <p className="mt-3 text-xs text-slate-400">Зафиксировал: {item.created_by}</p>
                {item.reviewed_by && <p className="mt-1 text-xs text-slate-400">Проверил: {item.reviewed_by}{item.review_comment ? ` · ${item.review_comment}` : ''}</p>}
                {item.act_url && <a href={item.act_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-blue-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">Открыть прикреплённый АКТ</a>}
              </div>
              <div className="min-w-0">
                <p className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-slate-400">Фото и видео доказательства</p>
                {item.evidence?.length ? (
                  <div className="flex w-full snap-x snap-mandatory gap-3 overflow-x-auto pb-3">
                    {item.evidence.map((media) => (
                      media.media_type === 'photo'
                        ? <button key={media.id} type="button" onClick={() => { setPreviewImage(media.url); setPreviewZoom(1) }} className="group relative w-[220px] shrink-0 snap-start overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900"><img src={media.url} alt="Доказательство" className="aspect-video w-full object-cover transition-transform duration-300 group-hover:scale-105" /><span className="absolute inset-0 flex items-center justify-center bg-slate-950/0 text-sm font-semibold text-white opacity-0 transition-all group-hover:bg-slate-950/30 group-hover:opacity-100">Открыть фото</span></button>
                        : <button key={media.id} type="button" onClick={() => setPreviewVideo(media.url)} className="group relative w-[220px] shrink-0 snap-start overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900"><video muted preload="metadata" className="h-full w-full object-cover"><source src={media.url} type="video/mp4" /></video><span className="absolute inset-0 flex items-center justify-center bg-slate-950/15 text-sm font-semibold text-white transition-colors group-hover:bg-slate-950/35">Открыть видео</span></button>
                    ))}
                  </div>
                ) : <div className="rounded-lg border border-dashed border-slate-300 py-8 text-center text-xs text-slate-400 dark:border-slate-700">Медиа не приложено</div>}
              </div>
            </div>
            {role === 'admin' && item.status === 'pending' && (
              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-5 py-3 dark:border-slate-800">
                <label className="btn-secondary cursor-pointer">
                  {uploadingActId === item.id ? 'Загрузка АКТа...' : item.act_url ? 'Заменить АКТ (PDF)' : 'Прикрепить АКТ (PDF)'}
                  <input type="file" accept="application/pdf,.pdf" className="hidden" disabled={uploadingActId === item.id} onChange={(event) => { const file = event.target.files?.[0]; if (file) onUploadAct(item.id, file); event.target.value = '' }} />
                </label>
                <button className="btn-danger" onClick={() => onReview(item.id, 'rejected')}>Отклонить</button>
                <button className="btn-success" disabled={!item.act_url} title={!item.act_url ? 'Сначала прикрепите АКТ в формате PDF' : undefined} onClick={() => onReview(item.id, 'confirmed')}>Подтвердить нарушение</button>
              </div>
            )}
          </article>
        )
      })}
      {previewImage && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 p-3 backdrop-blur-sm sm:p-6">
          <div className="flex h-full w-full flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
              <p className="font-semibold text-slate-900 dark:text-white">Просмотр фотодоказательства</p>
              <div className="flex items-center gap-2">
                <button type="button" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800" onClick={() => setPreviewZoom((value) => Math.max(0.5, value - 0.25))}>−</button>
                <button type="button" className="min-w-16 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800" onClick={() => setPreviewZoom(1)}>{Math.round(previewZoom * 100)}%</button>
                <button type="button" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800" onClick={() => setPreviewZoom((value) => Math.min(4, value + 0.25))}>+</button>
                <button type="button" className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800" onClick={() => setPreviewImage('')}>Закрыть</button>
              </div>
            </div>
            <div className={`flex min-h-0 flex-1 overflow-auto bg-slate-50 p-4 dark:bg-slate-950 ${previewZoom > 1 ? 'items-start justify-start' : 'items-center justify-center'}`}>
              <img src={previewImage} alt="Увеличенное фотодоказательство" className="max-w-none shrink-0 select-none object-contain transition-[width] duration-200" style={{ width: `${previewZoom * 100}%`, maxHeight: previewZoom <= 1 ? '100%' : 'none' }} />
            </div>
          </div>
        </div>
      )}
      {previewVideo && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 p-3 backdrop-blur-sm sm:p-6">
          <div className="flex h-full w-full flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
              <p className="font-semibold text-slate-900 dark:text-white">Просмотр видеодоказательства</p>
              <button type="button" className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800" onClick={() => setPreviewVideo('')}>Закрыть</button>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-50 p-4 dark:bg-slate-950">
              <video key={previewVideo} controls autoPlay playsInline className="max-h-full max-w-full rounded-lg border border-slate-200 bg-black shadow-sm dark:border-slate-700">
                <source src={previewVideo} type="video/mp4" />
                Ваш браузер не поддерживает просмотр видео.
              </video>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function MonitoringPage() {
  const { i18n } = useTranslation()
  const { role } = useAuth()
  const [records, setRecords] = useState([])
  const [rooms, setRooms] = useState([])
  const [violations, setViolations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('live')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [teacher, setTeacher] = useState('')
  const [room, setRoom] = useState('')
  const [selectedLesson, setSelectedLesson] = useState(null)
  const [violationType, setViolationType] = useState('Отсутствие')
  const [violationDate, setViolationDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [violationDescription, setViolationDescription] = useState('')
  const [savingViolation, setSavingViolation] = useState(false)
  const [violationNotice, setViolationNotice] = useState('')
  const [evidence, setEvidence] = useState([])
  const [capturing, setCapturing] = useState('')
  const [videoExpanded, setVideoExpanded] = useState(false)
  const [uploadingActId, setUploadingActId] = useState(null)
  const [improvingText, setImprovingText] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  useEffect(() => {
    getRecords({ skip: 0, limit: 200 })
      .then(async (data) => {
        const firstItems = data.items || []
        const remainingRequests = []
        for (let skip = firstItems.length; skip < Number(data.total || 0); skip += 200) {
          remainingRequests.push(getRecords({ skip, limit: 200 }))
        }
        const remaining = await Promise.all(remainingRequests)
        setRecords([...firstItems, ...remaining.flatMap((result) => result.items || [])])
      })
      .catch(() => setError('Не удалось загрузить данные мониторинга'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    getRooms().then((data) => setRooms(data || [])).catch(() => setRooms([]))
  }, [])

  const loadViolations = () => {
    getViolations().then((data) => setViolations(data || [])).catch(() => setViolations([]))
  }

  useEffect(() => loadViolations(), [])

  const selectedCameraRoom = useMemo(() => {
    if (!selectedLesson) return null
    if (selectedLesson.configured_room_id) {
      return rooms.find((item) => item.id === selectedLesson.configured_room_id && item.camera_enabled) || null
    }
    const lessonRoom = String(selectedLesson.room || '').toLowerCase()
    return rooms.find((item) => lessonRoom.includes(String(item.name || '').toLowerCase()) && item.camera_enabled) || null
  }, [rooms, selectedLesson])

  const openViolation = (lesson) => {
    setSelectedLesson(lesson)
    setViolationType('Отсутствие')
    setViolationDate(String(lesson.datetime || date).slice(0, 10))
    setViolationDescription('')
    setViolationNotice('')
    setEvidence([])
    setVideoExpanded(false)
  }

  const captureEvidence = async (kind) => {
    if (!selectedCameraRoom) return
    setCapturing(kind)
    setViolationNotice('')
    try {
      const item = kind === 'photo'
        ? await captureRoomPhoto(selectedCameraRoom.id)
        : await recordRoomVideo(selectedCameraRoom.id, 10)
      setEvidence((current) => [...current, item])
    } catch (err) {
      setViolationNotice(err.response?.data?.detail || `Не удалось ${kind === 'photo' ? 'сделать снимок' : 'записать видео'}`)
    } finally {
      setCapturing('')
    }
  }

  const improveDescription = async () => {
    if (violationDescription.trim().length < 3) {
      setViolationNotice('Сначала введите краткое описание ситуации')
      return
    }
    setImprovingText(true)
    setViolationNotice('')
    try {
      const result = await improveViolationText(violationDescription.trim())
      setViolationDescription(result.text)
      setViolationNotice(`Текст улучшен с помощью ${result.provider === 'openai' ? 'OpenAI' : 'Gemini'}`)
    } catch (err) {
      setViolationNotice(err.response?.data?.detail || 'Не удалось улучшить текст с помощью AI')
    } finally {
      setImprovingText(false)
    }
  }

  const saveViolation = async (event) => {
    event.preventDefault()
    if (!selectedLesson || !violationType) return
    setSavingViolation(true)
    setViolationNotice('')
    try {
      await createViolation({
        lesson_ref: String(selectedLesson.id),
        teacher: selectedLesson.teacher,
        room: selectedLesson.room || '',
        subject: selectedLesson.subject || '',
        violation_type: violationType,
        violation_date: violationDate,
        description: violationDescription,
        evidence_ids: evidence.map((item) => item.id),
      })
      setSelectedLesson(null)
      setViolationNotice('Нарушение успешно зафиксировано')
      loadViolations()
      setTab('violations')
    } catch (err) {
      setViolationNotice(err.response?.data?.detail || 'Не удалось сохранить нарушение')
    } finally {
      setSavingViolation(false)
    }
  }

  const handleReview = async (violationId, status) => {
    const comment = window.prompt(status === 'confirmed' ? 'Комментарий администратора (необязательно)' : 'Причина отклонения (необязательно)') ?? ''
    try {
      await reviewViolation(violationId, status, comment)
      loadViolations()
    } catch (err) {
      setViolationNotice(err.response?.data?.detail || 'Не удалось проверить нарушение')
    }
  }

  const handleUploadAct = async (violationId, file) => {
    if (!file.name.toLowerCase().endsWith('.pdf') || (file.type && file.type !== 'application/pdf')) {
      setViolationNotice('Для АКТа можно выбрать только PDF-файл')
      return
    }
    setUploadingActId(violationId)
    setViolationNotice('')
    try {
      await uploadViolationAct(violationId, file)
      setViolationNotice('АКТ успешно прикреплён')
      loadViolations()
    } catch (err) {
      setViolationNotice(err.response?.data?.detail || 'Не удалось загрузить АКТ')
    } finally {
      setUploadingActId(null)
    }
  }

  const filtered = useMemo(() => {
    const queryTeacher = teacher.trim().toLowerCase()
    const queryRoom = room.trim().toLowerCase()
    const recordsWithDemo = [...getDemoLessons(date, records, rooms), ...records]
    return recordsWithDemo.filter((record) => {
      const recordDate = String(record.datetime || '').slice(0, 10)
      const matchesDate = tab === 'archive' || tab === 'analytics' || recordDate === date
      const matchesTab = tab !== 'violations' || Number(record.score || 0) < 5
      return matchesDate && matchesTab
        && String(record.teacher || '').toLowerCase().includes(queryTeacher)
        && String(record.room || '').toLowerCase().includes(queryRoom)
    })
  }, [records, rooms, date, teacher, room, tab])

  const filteredViolations = useMemo(() => {
    const queryTeacher = teacher.trim().toLowerCase()
    const queryRoom = room.trim().toLowerCase()
    return violations.filter((item) => (
      String(item.teacher || '').toLowerCase().includes(queryTeacher)
      && String(item.room || '').toLowerCase().includes(queryRoom)
    ))
  }, [violations, teacher, room])

  const paginationItems = tab === 'violations' ? filteredViolations : filtered
  const pageCount = Math.max(1, Math.ceil(paginationItems.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const paginatedItems = paginationItems.slice((safePage - 1) * pageSize, safePage * pageSize)

  useEffect(() => {
    setPage(1)
  }, [tab, date, teacher, room, pageSize])

  const problemCount = filtered.filter((record) => Number(record.score || 0) < 5).length
  const avgAttendance = filtered.length
    ? filtered.reduce((sum, record) => sum + Number(record.attendance || 0), 0) / filtered.length
    : 0
  const avgScore = filtered.length
    ? filtered.reduce((sum, record) => sum + Number(record.score || 0), 0) / filtered.length
    : 0

  return (
    <div className="cyber-screen relative min-h-full overflow-hidden rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-6">
      <div className="relative space-y-5">
        <header className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-cyan-700 dark:text-cyan-300">
              <Icon name="pulse" className="h-4 w-4" />
              KRK // Monitoring Center
            </div>
            <h1 className="text-3xl font-bold leading-tight tracking-tight text-slate-950 dark:text-white sm:text-4xl">
              Ситуационный мониторинг
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Видеоконтроль аудиторий, фиксация инцидентов и проверка доказательств</p>
          </div>

          <div className="flex max-w-full gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            {tabs.map((item) => {
              const icon = item.id === 'live' ? 'pulse' : item.id === 'violations' ? 'alert' : item.id === 'archive' ? 'archive' : 'chart'
              return (
                <button key={item.id} onClick={() => setTab(item.id)} className={`flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-4 py-2.5 text-xs font-semibold uppercase tracking-wide transition-colors ${tab === item.id ? 'bg-blue-700 text-white shadow-sm' : 'text-slate-500 hover:bg-blue-50 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'}`}>
                  <Icon name={icon} className="h-4 w-4" />{item.label}
                </button>
              )
            })}
          </div>
        </header>

        <section className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 md:grid-cols-[190px_1fr_1fr]">
          <label>
            <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">Дата мониторинга</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input h-12 rounded-lg border-slate-300 bg-white font-semibold dark:border-slate-700 dark:bg-slate-900" />
          </label>
          <label>
            <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">Аудитория</span>
            <div className="relative"><Icon name="search" className="absolute left-4 top-3.5 h-5 w-5 text-slate-400" /><input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="Поиск по аудитории..." className="input h-12 rounded-lg border-slate-300 bg-white pl-12 dark:border-slate-700 dark:bg-slate-900" /></div>
          </label>
          <label>
            <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">Преподаватель</span>
            <div className="relative"><Icon name="search" className="absolute left-4 top-3.5 h-5 w-5 text-slate-400" /><input value={teacher} onChange={(e) => setTeacher(e.target.value)} placeholder="Поиск по фамилии..." className="input h-12 rounded-lg border-slate-300 bg-white pl-12 dark:border-slate-700 dark:bg-slate-900" /></div>
          </label>
        </section>

        <section className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <Metric label="Занятий" value={filtered.length} tone="indigo" />
          <Metric label="Средний балл" value={avgScore.toFixed(1)} tone="emerald" />
          <Metric label="Посещаемость" value={`${avgAttendance.toFixed(0)}%`} tone="amber" />
          <Metric label="Нарушений" value={problemCount} tone="rose" />
        </section>

        {violationNotice && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300">{violationNotice}</div>}

        {tab === 'violations' ? (
          <ViolationsReview items={paginatedItems} role={role} onReview={handleReview} onUploadAct={handleUploadAct} uploadingActId={uploadingActId} />
        ) : loading ? (
          <div className="flex h-64 items-center justify-center"><Spinner size="lg" /></div>
        ) : error ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-5 text-center text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-300">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white py-20 text-center shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-lg bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"><Icon name="pulse" /></div>
            <h2 className="font-bold text-slate-800 dark:text-white">Занятия не найдены</h2>
            <p className="mt-1 text-sm text-slate-400">Измените дату или параметры поиска</p>
          </div>
        ) : tab === 'analytics' ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-700 dark:text-blue-300">Сводка по выборке</p>
              <p className="mt-3 max-w-2xl text-2xl font-bold text-slate-950 dark:text-white">Средний показатель качества — {avgScore.toFixed(1)} из 10 при посещаемости {avgAttendance.toFixed(0)}%.</p>
              <div className="mt-6 h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full bg-blue-700" style={{ width: `${Math.min(100, avgScore * 10)}%` }} /></div>
            </div>
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-400 dark:bg-slate-800"><tr><th className="p-3">Преподаватель</th><th className="p-3">Дисциплина</th><th className="p-3">Аудитория</th><th className="p-3">Балл</th><th className="p-3">Посещаемость</th></tr></thead>
                <tbody>{paginatedItems.map((record) => <tr key={record.id} className="border-t border-slate-100 dark:border-slate-800"><td className="p-3 font-semibold text-slate-900 dark:text-white">{record.teacher}</td><td className="p-3 text-slate-600 dark:text-slate-300">{record.subject}</td><td className="p-3 text-slate-600 dark:text-slate-300">{record.room || '—'}</td><td className="p-3 font-bold text-emerald-600">{Number(record.score || 0).toFixed(1)}</td><td className="p-3 text-slate-600 dark:text-slate-300">{Number(record.attendance || 0).toFixed(0)}%</td></tr>)}</tbody>
              </table>
            </div>
          </div>
        ) : (
          <section>
            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">{tab === 'violations' ? 'Выявленные нарушения' : tab === 'archive' ? 'Архив мониторинга' : 'Занятия под наблюдением'}</h2>
                <p className="text-xs text-slate-400">{new Date(`${date}T00:00:00`).toLocaleDateString(i18n.language, { day: 'numeric', month: 'long', year: 'numeric' })}</p>
              </div>
              <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">{filtered.length} записей</span>
            </div>
            <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {paginatedItems.map((record) => <LessonCard key={record.id} record={record} onOpen={openViolation} />)}
            </div>
          </section>
        )}
        {!loading && !error && paginationItems.length > 0 && (
          <Pagination
            total={paginationItems.length}
            page={safePage}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        )}
      </div>

      {selectedLesson && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/55 p-3 backdrop-blur-sm sm:p-6">
          <form onSubmit={saveViolation} className="my-auto w-full max-w-5xl overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-start justify-between border-b border-slate-100 px-5 py-5 dark:border-slate-800 sm:px-7">
              <div>
                <h2 className="text-2xl font-bold text-slate-950 dark:text-white">Фиксация нарушения</h2>
                <p className="mt-2 text-xs font-bold uppercase tracking-[0.12em] text-slate-400">Преподаватель: <span className="text-slate-800 dark:text-slate-200">{selectedLesson.teacher}</span></p>
                <p className="mt-1 text-xs text-slate-500">{selectedLesson.subject} · аудитория {selectedLesson.room}</p>
              </div>
              <button type="button" onClick={() => setSelectedLesson(null)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800">Закрыть</button>
            </div>

            <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[1.1fr_.9fr]">
              <div className="space-y-6">
                <div>
                  <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Тип нарушения</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {[
                      'Отсутствие',
                      'Опоздание (>15 мин)',
                      'Нарушение методики преподавания',
                      'Отпускает раньше времени',
                      'Отсутствовали студенты',
                      'Нарушение учебной дисциплины',
                      'Несвоевременное заполнение LMS',
                      'Нарушение трудовой дисциплины',
                      'Ненадлежащий контроль при экзамене',
                      'Прочее',
                    ].map((type) => (
                      <button key={type} type="button" onClick={() => setViolationType(type)} className={`min-h-14 rounded-lg border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.09em] transition-colors ${violationType === type ? 'border-blue-700 bg-blue-50 text-blue-800 dark:border-blue-500 dark:bg-blue-950/30 dark:text-blue-300' : 'border-slate-200 bg-white text-slate-500 hover:bg-blue-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800'}`}>{type}</button>
                    ))}
                  </div>
                </div>

                <label><span className="mb-2 block text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Дата нарушения</span><input required type="date" className="input h-14 rounded-lg bg-white font-semibold dark:bg-slate-900" value={violationDate} onChange={(e) => setViolationDate(e.target.value)} /></label>
                <div>
                  <label>
                    <span className="mb-2 block text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Описание ситуации</span>
                    <textarea className="input min-h-36 rounded-lg bg-white p-4 dark:bg-slate-900" placeholder="Опишите ваши наблюдения..." value={violationDescription} onChange={(e) => setViolationDescription(e.target.value)} />
                  </label>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <p className="text-xs text-slate-400">AI исправит ошибки и оформит текст в деловом стиле, не добавляя новых фактов.</p>
                    <button type="button" onClick={improveDescription} disabled={improvingText || violationDescription.trim().length < 3} className="shrink-0 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50">
                      {improvingText ? 'Улучшаю...' : 'Улучшить с AI'}
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Камера кабинета · Live</p>
                {selectedCameraRoom ? (
                  <div className={`${videoExpanded ? 'fixed inset-3 z-[60] flex flex-col rounded-lg border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:inset-8' : 'overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900'}`}>
                    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                      <span className="text-sm font-semibold text-slate-900 dark:text-white">Кабинет {selectedCameraRoom.name}</span>
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />Прямой эфир</span>
                    </div>
                    <div className={`group relative overflow-hidden ${videoExpanded ? 'min-h-0 flex-1' : 'aspect-video'}`}>
                      <img src={`/api/rooms/${selectedCameraRoom.id}/camera/live`} alt={`Live кабинет ${selectedCameraRoom.name}`} className="h-full w-full cursor-zoom-in object-cover transition-transform duration-300 group-hover:scale-[1.02]" />
                      <button type="button" onClick={() => setVideoExpanded((value) => !value)} className="absolute right-3 top-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">{videoExpanded ? 'Свернуть' : 'На весь экран'}</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex aspect-video items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white p-5 text-center text-sm text-slate-400 shadow-sm dark:border-slate-700 dark:bg-slate-900">Для аудитории {selectedLesson.room || '—'} камера не привязана</div>
                )}
                {selectedCameraRoom && (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button type="button" className="btn-secondary" disabled={Boolean(capturing)} onClick={() => captureEvidence('photo')}>{capturing === 'photo' ? 'Снимаем фото...' : 'Снять фото'}</button>
                    <button type="button" className="btn-primary" disabled={Boolean(capturing)} onClick={() => captureEvidence('video')}>{capturing === 'video' ? 'Запись 10 сек...' : 'Записать видео'}</button>
                  </div>
                )}
                {evidence.length > 0 && (
                  <div className="mt-4">
                    <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Медиа доказательства</p>
                    <div className="grid grid-cols-3 gap-2">
                      {evidence.map((item) => (
                        <a key={item.id} href={item.url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-lg border border-slate-200 bg-white text-center shadow-sm dark:border-slate-700 dark:bg-slate-900">
                          {item.media_type === 'photo'
                            ? <img src={item.url} alt="Снимок нарушения" className="aspect-video w-full object-cover" />
                            : <div className="flex aspect-video items-center justify-center text-sm font-semibold text-slate-500">Видео</div>}
                          <span className="block px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{item.media_type === 'photo' ? 'Фото' : 'Видео'}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
                <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800 dark:border-blue-900/30 dark:bg-blue-950/20 dark:text-blue-300">
                  Данные преподавателя, дисциплины и аудитории подставлены из выбранного занятия.
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4 dark:border-slate-800 sm:px-7">
              <button type="button" className="btn-secondary" onClick={() => setSelectedLesson(null)}>Отмена</button>
              <button type="submit" className="btn-primary" disabled={savingViolation}>{savingViolation ? 'Сохранение...' : 'Зафиксировать нарушение'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
