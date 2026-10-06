import { useEffect, useMemo, useRef, useState } from 'react'
import CameraLive from '../components/CameraLive'
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
import { useAuth } from '../context/AuthContext'
import {
  Alert, Badge, Button, Card, CardBody, CardFooter, CardHeader, DataTable, DescriptionList, EmptyState, Field,
  FilterBar, Icon, Input, LoadingBlock, Modal, PageHeader, PageStack, Pagination, SearchInput, StatCard, Tabs,
  Textarea, TruncatedText, cn, useUI,
} from '../components/ui'

const tabs = [
  { id: 'live', icon: 'monitor' },
  { id: 'violations', icon: 'alert' },
  { id: 'archive', icon: 'inbox' },
  { id: 'analytics', icon: 'chart' },
]

// Значения типов нарушений уходят в API как есть (русские строки) — переводится только подпись.
const VIOLATION_TYPES = [
  { value: 'Отсутствие', key: 'absence' },
  { value: 'Опоздание (>15 мин)', key: 'late' },
  { value: 'Нарушение методики преподавания', key: 'methodology' },
  { value: 'Отпускает раньше времени', key: 'earlyRelease' },
  { value: 'Отсутствовали студенты', key: 'noStudents' },
  { value: 'Нарушение учебной дисциплины', key: 'studyDiscipline' },
  { value: 'Несвоевременное заполнение LMS', key: 'lms' },
  { value: 'Нарушение трудовой дисциплины', key: 'laborDiscipline' },
  { value: 'Ненадлежащий контроль при экзамене', key: 'examControl' },
  { value: 'Прочее', key: 'other' },
]
const DEFAULT_VIOLATION_TYPE = VIOLATION_TYPES[0].value

// Подпись типа нарушения на текущем языке; неизвестное значение показываем как есть.
function violationTypeLabel(t, value) {
  const found = VIOLATION_TYPES.find((item) => item.value === value)
  return found ? t(`monitoring.types.${found.key}`) : value
}

// Локаль для дат и времени: 'kz' — код интерфейса, Intl ожидает 'kk'.
const DATE_LOCALES = { ru: 'ru-RU', kz: 'kk-KZ', en: 'en-GB' }
const dateLocale = (lang) => DATE_LOCALES[lang] || 'ru-RU'

// Фон области просмотра медиа: тёмный в обеих темах (единственное допустимое исключение из токенов).
const MEDIA_BG = 'bg-[rgb(6_18_31)]'

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

// Порог низкого балла задаётся в справочнике учебного года (бэкенд отдаёт is_low_score)
function isLowScore(record) {
  return record.is_low_score ?? Number(record.score || 0) < 5
}

// Строка «иконка — подпись — значение» в карточке занятия
function LessonFact({ icon, label, children, className }) {
  return (
    <div className={cn('flex min-w-0 items-start gap-2.5', className)}>
      <Icon name={icon} size={16} className="mt-0.5 text-fg-subtle" />
      <div className="min-w-0">
        <p className="text-xs text-fg-subtle">{label}</p>
        <div className="min-w-0 text-sm font-medium text-fg">{children}</div>
      </div>
    </div>
  )
}

function LessonCard({ record, onOpen }) {
  const { t, i18n } = useTranslation()
  const date = new Date(record.datetime)
  const initials = String(record.teacher || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
  const isProblem = isLowScore(record)

  return (
    <Card as="article" className={cn('flex flex-col gap-4 p-4 sm:p-5', isProblem && 'border-danger/40')}>
      <div className="flex min-w-0 items-start gap-3">
        <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary-subtle text-sm font-semibold text-primary-subtle-fg">
          {initials}
        </span>
        {/* Статус под ФИО, чтобы не отнимать у него ширину */}
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-base font-semibold text-fg" title={record.teacher}>{record.teacher}</h3>
          {record.faculty && <TruncatedText lines={2} className="mt-0.5 text-xs text-fg-muted">{record.faculty}</TruncatedText>}
          <Badge tone={isProblem ? 'danger' : 'success'} dot className="mt-2">
            {isProblem ? t('monitoring.lesson.risk') : t('monitoring.lesson.active')}
          </Badge>
        </div>
      </div>

      <div className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-3">
        <LessonFact icon="clock" label={t('monitoring.lesson.time')}>
          <span className="tabular">{date.toLocaleTimeString(dateLocale(i18n.language), { hour: '2-digit', minute: '2-digit' })}</span>
        </LessonFact>
        <LessonFact icon="pin" label={t('monitoring.lesson.room')}>
          <span className="break-words">{record.room || '—'}</span>
        </LessonFact>
        <LessonFact icon="book" label={t('monitoring.lesson.subject')} className="col-span-2">
          <TruncatedText lines={2}>{record.subject}</TruncatedText>
        </LessonFact>
        <LessonFact icon="users" label={t('monitoring.lesson.attendance')} className="col-span-2">
          <span className="break-words"><span className="tabular">{Number(record.attendance || 0).toFixed(0)}%</span> · {record.group_name}</span>
        </LessonFact>
      </div>

      <Button block icon="alert" className="mt-auto" onClick={() => onOpen(record)}>
        {t('monitoring.lesson.report')}
      </Button>
    </Card>
  )
}

// Кнопка загрузки АКТа: скрытый file input + обычная кнопка (доступна с клавиатуры)
function ActUploadButton({ item, uploading, onUploadAct }) {
  const { t } = useTranslation()
  const inputRef = useRef(null)
  return (
    <>
      <input ref={inputRef} type="file" accept="application/pdf,.pdf" className="hidden" disabled={uploading}
        onChange={(event) => { const file = event.target.files?.[0]; if (file) onUploadAct(item.id, file); event.target.value = '' }} />
      <Button variant="secondary" icon="upload" loading={uploading} onClick={() => inputRef.current?.click()}>
        {uploading ? t('monitoring.review.uploadingAct') : item.act_url ? t('monitoring.review.replaceAct') : t('monitoring.review.attachAct')}
      </Button>
    </>
  )
}

// Миниатюра доказательства: медиа сверху, подпись снизу (без текста поверх изображения)
function EvidenceThumb({ media, onOpen }) {
  const { t } = useTranslation()
  const isPhoto = media.media_type === 'photo'
  return (
    <button type="button" onClick={onOpen}
      className="group flex w-56 shrink-0 snap-start flex-col overflow-hidden rounded-md border border-line bg-surface text-left transition-colors hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
      <span className={cn('block aspect-video w-full overflow-hidden', MEDIA_BG)}>
        {isPhoto
          ? <img src={media.url} alt={t('monitoring.review.evidenceAlt')} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
          : <video muted preload="metadata" className="h-full w-full object-cover"><source src={media.url} type="video/mp4" /></video>}
      </span>
      <span className="flex min-w-0 items-center gap-2 px-3 py-2 text-sm font-medium text-fg-muted group-hover:text-fg">
        <Icon name={isPhoto ? 'image' : 'video'} size={16} />
        <span className="min-w-0">{isPhoto ? t('monitoring.review.openPhoto') : t('monitoring.review.openVideo')}</span>
      </span>
    </button>
  )
}

const STATUS_TONE = { pending: 'warning', confirmed: 'success', rejected: 'danger' }

function ViolationsReview({ items, role, onReview, onUploadAct, uploadingActId, loading, error, onRetry }) {
  const { t, i18n } = useTranslation()
  const [previewImage, setPreviewImage] = useState('')
  const [previewVideo, setPreviewVideo] = useState('')
  const [previewZoom, setPreviewZoom] = useState(1)

  if (loading && !items.length) {
    return <Card><LoadingBlock label={t('monitoring.review.loading')} /></Card>
  }
  if (error && !items.length) {
    return (
      <Alert tone="danger" title={error}
        action={<Button variant="secondary" size="sm" icon="refresh" onClick={onRetry}>{t('ui.retry')}</Button>} />
    )
  }
  if (!items.length) {
    return (
      <Card>
        <EmptyState icon="check-circle" title={t('monitoring.review.empty')} description={t('monitoring.review.emptyHint')} />
      </Card>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {items.map((item) => {
        const status = STATUS_TONE[item.status] ? item.status : 'pending'
        return (
          <Card as="article" key={item.id}>
            <div className="grid min-w-0 gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
              <div className="flex min-w-0 flex-col gap-4">
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-2">
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="break-words text-sm font-medium text-accent">{violationTypeLabel(t, item.violation_type)}</p>
                    <h3 className="mt-0.5 break-words text-lg font-semibold text-fg">{item.teacher}</h3>
                  </div>
                  <Badge tone={STATUS_TONE[status]} dot>{t(`monitoring.review.status.${status}`)}</Badge>
                </div>
                <DescriptionList items={[
                  { label: t('monitoring.review.room'), value: item.room || '—' },
                  { label: t('monitoring.review.date'), value: <span className="tabular">{new Date(`${item.violation_date}T00:00:00`).toLocaleDateString(dateLocale(i18n.language))}</span> },
                  { label: t('monitoring.review.subject'), value: item.subject || '—', full: true },
                ]} />
                {item.description && <p className="whitespace-pre-line rounded-md bg-surface-muted p-3 text-sm text-fg-muted">{item.description}</p>}
                <div className="flex min-w-0 flex-col gap-1 text-xs text-fg-subtle">
                  <p className="break-words">{t('monitoring.review.createdBy', { name: item.created_by })}</p>
                  {item.reviewed_by && (
                    <p className="break-words">
                      {t('monitoring.review.reviewedBy', { name: item.reviewed_by })}{item.review_comment ? ` · ${item.review_comment}` : ''}
                    </p>
                  )}
                </div>
                {item.act_url && (
                  <div className="flex flex-wrap gap-2">
                    <Button as="a" href={item.act_url} target="_blank" rel="noreferrer" variant="secondary" size="sm" icon="file-text">
                      {t('monitoring.review.openAct')}
                    </Button>
                  </div>
                )}
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <p className="text-sm font-medium text-fg">{t('monitoring.review.evidence')}</p>
                {item.evidence?.length ? (
                  <div className="scrollbar-thin flex min-w-0 snap-x snap-mandatory gap-3 overflow-x-auto pb-2">
                    {item.evidence.map((media) => (
                      <EvidenceThumb key={media.id} media={media}
                        onOpen={() => {
                          if (media.media_type === 'photo') { setPreviewImage(media.url); setPreviewZoom(1) } else setPreviewVideo(media.url)
                        }} />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed border-line px-4 py-8 text-center text-sm text-fg-subtle">
                    {t('monitoring.review.noMedia')}
                  </div>
                )}
              </div>
            </div>
            {role === 'admin' && item.status === 'pending' && (
              <CardFooter>
                {!item.act_url && <p className="min-w-0 flex-1 basis-56 text-xs text-fg-subtle">{t('monitoring.review.actRequired')}</p>}
                <ActUploadButton item={item} uploading={uploadingActId === item.id} onUploadAct={onUploadAct} />
                <Button variant="danger" icon="x" onClick={() => onReview(item.id, 'rejected')}>{t('monitoring.review.reject')}</Button>
                <Button variant="success" icon="check" disabled={!item.act_url}
                  title={!item.act_url ? t('monitoring.review.actRequired') : undefined}
                  onClick={() => onReview(item.id, 'confirmed')}>
                  {t('monitoring.review.confirm')}
                </Button>
              </CardFooter>
            )}
          </Card>
        )
      })}

      {/* Просмотр фото: масштаб 50–400%, при увеличении область прокручивается */}
      <Modal
        open={!!previewImage}
        onClose={() => setPreviewImage('')}
        size="full"
        title={t('monitoring.preview.photoTitle')}
        className="sm:!h-[90vh]"
        bodyClassName={cn('!p-0 !overflow-auto', MEDIA_BG)}
        footer={(
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" icon="minus" iconOnly aria-label={t('monitoring.preview.zoomOut')}
                onClick={() => setPreviewZoom((value) => Math.max(0.5, value - 0.25))} />
              <Button variant="secondary" className="min-w-16 tabular" title={t('monitoring.preview.zoomReset')}
                aria-label={t('monitoring.preview.zoomReset')} onClick={() => setPreviewZoom(1)}>
                {Math.round(previewZoom * 100)}%
              </Button>
              <Button variant="secondary" icon="plus" iconOnly aria-label={t('monitoring.preview.zoomIn')}
                onClick={() => setPreviewZoom((value) => Math.min(4, value + 0.25))} />
            </div>
            <Button onClick={() => setPreviewImage('')}>{t('ui.close')}</Button>
          </>
        )}
      >
        <div className={cn('flex h-full min-h-full w-full p-4', previewZoom > 1 ? 'items-start justify-start' : 'items-center justify-center')}>
          <img src={previewImage} alt={t('monitoring.preview.photoAlt')}
            className="max-w-none shrink-0 select-none object-contain transition-[width] duration-200"
            style={{ width: `${previewZoom * 100}%`, maxHeight: previewZoom <= 1 ? '100%' : 'none' }} />
        </div>
      </Modal>

      {/* Просмотр видео */}
      <Modal
        open={!!previewVideo}
        onClose={() => setPreviewVideo('')}
        size="full"
        title={t('monitoring.preview.videoTitle')}
        className="sm:!h-[90vh]"
        bodyClassName={cn('!p-0 flex items-center justify-center', MEDIA_BG)}
        footer={<Button onClick={() => setPreviewVideo('')}>{t('ui.close')}</Button>}
      >
        <video key={previewVideo} controls autoPlay playsInline className="max-h-full max-w-full">
          <source src={previewVideo} type="video/mp4" />
          {t('monitoring.preview.videoUnsupported')}
        </video>
      </Modal>
    </div>
  )
}

export default function MonitoringPage() {
  const { t, i18n } = useTranslation()
  const { toast } = useUI()
  const { role } = useAuth()
  const [records, setRecords] = useState([])
  const [rooms, setRooms] = useState([])
  const [violations, setViolations] = useState([])
  const [violationsLoading, setViolationsLoading] = useState(true)
  const [violationsError, setViolationsError] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('live')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [teacher, setTeacher] = useState('')
  const [room, setRoom] = useState('')
  const [selectedLesson, setSelectedLesson] = useState(null)
  const [violationType, setViolationType] = useState(DEFAULT_VIOLATION_TYPE)
  const [violationDate, setViolationDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [violationDescription, setViolationDescription] = useState('')
  const [savingViolation, setSavingViolation] = useState(false)
  // Сообщение внутри формы фиксации: { tone, text }
  const [violationNotice, setViolationNotice] = useState(null)
  const [evidence, setEvidence] = useState([])
  const [capturing, setCapturing] = useState('')
  const [videoExpanded, setVideoExpanded] = useState(false)
  const [uploadingActId, setUploadingActId] = useState(null)
  const [improvingText, setImprovingText] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  // Диалог проверки нарушения (комментарий администратора): { id, status }
  const [reviewTarget, setReviewTarget] = useState(null)
  const [reviewComment, setReviewComment] = useState('')
  const [reviewing, setReviewing] = useState(false)

  const loadRecords = () => {
    setLoading(true)
    setError('')
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
      .catch(() => setError(t('monitoring.loadError')))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadRecords() }, [])

  useEffect(() => {
    getRooms().then((data) => setRooms(data || [])).catch(() => setRooms([]))
  }, [])

  const loadViolations = () => {
    setViolationsLoading(true)
    getViolations()
      .then((data) => { setViolations(data || []); setViolationsError('') })
      .catch(() => { setViolations([]); setViolationsError(t('monitoring.review.loadError')) })
      .finally(() => setViolationsLoading(false))
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
    setViolationType(DEFAULT_VIOLATION_TYPE)
    setViolationDate(String(lesson.datetime || date).slice(0, 10))
    setViolationDescription('')
    setViolationNotice(null)
    setEvidence([])
    setVideoExpanded(false)
  }

  const captureEvidence = async (kind) => {
    if (!selectedCameraRoom) return
    setCapturing(kind)
    setViolationNotice(null)
    try {
      const item = kind === 'photo'
        ? await captureRoomPhoto(selectedCameraRoom.id)
        : await recordRoomVideo(selectedCameraRoom.id, 10)
      setEvidence((current) => [...current, item])
    } catch (err) {
      setViolationNotice({
        tone: 'danger',
        text: err.response?.data?.detail || t(kind === 'photo' ? 'monitoring.form.photoError' : 'monitoring.form.videoError'),
      })
    } finally {
      setCapturing('')
    }
  }

  const improveDescription = async () => {
    if (violationDescription.trim().length < 3) {
      setViolationNotice({ tone: 'warning', text: t('monitoring.form.needDescription') })
      return
    }
    setImprovingText(true)
    setViolationNotice(null)
    try {
      const result = await improveViolationText(violationDescription.trim())
      setViolationDescription(result.text)
      setViolationNotice({
        tone: 'success',
        text: t('monitoring.form.aiImproved', { provider: result.provider === 'openai' ? 'OpenAI' : 'Gemini' }),
      })
    } catch (err) {
      setViolationNotice({ tone: 'danger', text: err.response?.data?.detail || t('monitoring.form.aiError') })
    } finally {
      setImprovingText(false)
    }
  }

  const saveViolation = async (event) => {
    event.preventDefault()
    if (!selectedLesson || !violationType) return
    setSavingViolation(true)
    setViolationNotice(null)
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
      toast.success(t('monitoring.form.saved'))
      loadViolations()
      setTab('violations')
    } catch (err) {
      setViolationNotice({ tone: 'danger', text: err.response?.data?.detail || t('monitoring.form.saveError') })
    } finally {
      setSavingViolation(false)
    }
  }

  // Вместо window.prompt — диалог с необязательным комментарием
  const handleReview = (violationId, status) => {
    setReviewComment('')
    setReviewTarget({ id: violationId, status })
  }

  const submitReview = async (event) => {
    event.preventDefault()
    if (!reviewTarget) return
    setReviewing(true)
    try {
      await reviewViolation(reviewTarget.id, reviewTarget.status, reviewComment)
      toast.success(t(reviewTarget.status === 'confirmed' ? 'monitoring.review.confirmed' : 'monitoring.review.rejected'))
      setReviewTarget(null)
      loadViolations()
    } catch (err) {
      toast.error(err.response?.data?.detail || t('monitoring.review.reviewError'))
    } finally {
      setReviewing(false)
    }
  }

  const handleUploadAct = async (violationId, file) => {
    if (!file.name.toLowerCase().endsWith('.pdf') || (file.type && file.type !== 'application/pdf')) {
      toast.error(t('monitoring.review.actPdfOnly'))
      return
    }
    setUploadingActId(violationId)
    try {
      await uploadViolationAct(violationId, file)
      toast.success(t('monitoring.review.actUploaded'))
      loadViolations()
    } catch (err) {
      toast.error(err.response?.data?.detail || t('monitoring.review.actUploadError'))
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
      const matchesTab = tab !== 'violations' || isLowScore(record)
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

  const problemCount = filtered.filter((record) => isLowScore(record)).length
  const avgAttendance = filtered.length
    ? filtered.reduce((sum, record) => sum + Number(record.attendance || 0), 0) / filtered.length
    : 0
  const avgScore = filtered.length
    ? filtered.reduce((sum, record) => sum + Number(record.score || 0), 0) / filtered.length
    : 0

  const tabItems = tabs.map((item) => ({ value: item.id, icon: item.icon, label: t(`monitoring.tabs.${item.id}`) }))

  const analyticsColumns = [
    { key: 'teacher', header: t('monitoring.analytics.colTeacher'), mobile: 'title', minWidth: '12rem',
      cell: (record) => <span className="font-medium">{record.teacher}</span> },
    { key: 'subject', header: t('monitoring.analytics.colSubject'), minWidth: '14rem',
      cell: (record) => <span className="text-fg-muted">{record.subject}</span> },
    { key: 'room', header: t('monitoring.analytics.colRoom'), cell: (record) => <span className="text-fg-muted">{record.room || '—'}</span> },
    { key: 'score', header: t('monitoring.analytics.colScore'), align: 'right', nowrap: true,
      cell: (record) => (
        <span className={cn('font-semibold tabular', isLowScore(record) ? 'text-danger' : 'text-success')}>
          {Number(record.score || 0).toFixed(1)}
        </span>
      ) },
    { key: 'attendance', header: t('monitoring.analytics.colAttendance'), align: 'right', nowrap: true,
      cell: (record) => <span className="tabular text-fg-muted">{Number(record.attendance || 0).toFixed(0)}%</span> },
  ]

  const listTitle = tab === 'violations'
    ? t('monitoring.list.violations')
    : tab === 'archive' ? t('monitoring.list.archive') : t('monitoring.list.live')

  const reviewConfirming = reviewTarget?.status === 'confirmed'

  return (
    <PageStack>
      <PageHeader title={t('monitoring.title')} description={t('monitoring.description')} />

      <Tabs items={tabItems} value={tab} onChange={setTab} ariaLabel={t('monitoring.tabs.label')} />

      <FilterBar>
        <Field label={t('monitoring.filters.date')}>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label={t('monitoring.filters.room')}>
          <SearchInput value={room} onChange={(e) => setRoom(e.target.value)} placeholder={t('monitoring.filters.roomPlaceholder')} />
        </Field>
        <Field label={t('monitoring.filters.teacher')}>
          <SearchInput value={teacher} onChange={(e) => setTeacher(e.target.value)} placeholder={t('monitoring.filters.teacherPlaceholder')} />
        </Field>
      </FilterBar>

      <section className="grid min-w-0 grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label={t('monitoring.metrics.lessons')} value={filtered.length} tone="primary" />
        <StatCard label={t('monitoring.metrics.avgScore')} value={avgScore.toFixed(1)} tone="success" />
        <StatCard label={t('monitoring.metrics.attendance')} value={`${avgAttendance.toFixed(0)}%`} tone="warning" />
        <StatCard label={t('monitoring.metrics.violations')} value={problemCount} tone="danger" />
      </section>

      {tab === 'violations' ? (
        <ViolationsReview
          items={paginatedItems}
          role={role}
          onReview={handleReview}
          onUploadAct={handleUploadAct}
          uploadingActId={uploadingActId}
          loading={violationsLoading}
          error={violationsError}
          onRetry={loadViolations}
        />
      ) : loading ? (
        <Card><LoadingBlock label={t('monitoring.loading')} /></Card>
      ) : error ? (
        <Alert tone="danger" title={error}
          action={<Button variant="secondary" size="sm" icon="refresh" onClick={loadRecords}>{t('ui.retry')}</Button>} />
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState icon="monitor" title={t('monitoring.empty.title')} description={t('monitoring.empty.hint')} />
        </Card>
      ) : tab === 'analytics' ? (
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader title={t('monitoring.analytics.title')} />
            <CardBody className="flex flex-col gap-4">
              <p className="max-w-2xl text-xl font-semibold text-fg">
                {t('monitoring.analytics.summary', { score: avgScore.toFixed(1), attendance: avgAttendance.toFixed(0) })}
              </p>
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={10}
                aria-valuenow={Number(avgScore.toFixed(1))}
                aria-label={t('monitoring.analytics.progressLabel', { score: avgScore.toFixed(1) })}
                className="h-2.5 overflow-hidden rounded-full bg-surface-hover"
              >
                <div className="h-full rounded-full bg-chart-1" style={{ width: `${Math.min(100, avgScore * 10)}%` }} />
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={t('monitoring.analytics.tableTitle')} />
            <DataTable
              columns={analyticsColumns}
              rows={paginatedItems}
              caption={t('monitoring.analytics.tableTitle')}
              empty={<EmptyState icon="chart" title={t('monitoring.empty.title')} compact />}
            />
          </Card>
        </div>
      ) : (
        <section className="flex min-w-0 flex-col gap-4">
          <div className="flex min-w-0 flex-wrap items-end justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-fg">{listTitle}</h2>
              <p className="text-sm text-fg-muted">
                {new Date(`${date}T00:00:00`).toLocaleDateString(dateLocale(i18n.language), { day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            </div>
            <Badge tone="primary">{t('monitoring.list.count', { count: filtered.length })}</Badge>
          </div>
          <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {paginatedItems.map((record) => <LessonCard key={record.id} record={record} onOpen={openViolation} />)}
          </div>
        </section>
      )}

      {!loading && !error && paginationItems.length > 0 && (
        <Pagination
          page={safePage}
          pageCount={pageCount}
          onPageChange={setPage}
          total={paginationItems.length}
          pageSize={pageSize}
          onPageSizeChange={setPageSize}
        />
      )}

      {/* Фиксация нарушения */}
      <Modal
        open={!!selectedLesson}
        onClose={() => setSelectedLesson(null)}
        size="xl"
        title={t('monitoring.form.title')}
        description={selectedLesson ? t('monitoring.form.description', {
          teacher: selectedLesson.teacher,
          subject: selectedLesson.subject || '—',
          room: selectedLesson.room || '—',
        }) : undefined}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setSelectedLesson(null)}>{t('ui.cancel')}</Button>
            <Button type="submit" form="violation-form" icon="check" loading={savingViolation}>
              {savingViolation ? t('monitoring.form.saving') : t('monitoring.form.submit')}
            </Button>
          </>
        )}
      >
        {selectedLesson && (
          <form id="violation-form" onSubmit={saveViolation} className="flex min-w-0 flex-col gap-5">
            {violationNotice && (
              <Alert tone={violationNotice.tone} onClose={() => setViolationNotice(null)} closeLabel={t('ui.close')}>
                {violationNotice.text}
              </Alert>
            )}

            <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
              <div className="flex min-w-0 flex-col gap-5">
                <fieldset className="min-w-0">
                  <legend className="mb-2 text-sm font-medium text-fg">{t('monitoring.form.type')}</legend>
                  <div role="radiogroup" className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
                    {VIOLATION_TYPES.map((type) => {
                      const checked = violationType === type.value
                      return (
                        <label key={type.value}
                          className={cn(
                            'flex min-h-11 min-w-0 cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm transition-colors',
                            'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus',
                            checked
                              ? 'border-primary bg-primary-subtle font-medium text-primary-subtle-fg'
                              : 'border-line bg-surface text-fg hover:bg-surface-hover',
                          )}>
                          <input type="radio" name="violation-type" value={type.value} checked={checked}
                            onChange={() => setViolationType(type.value)}
                            className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[rgb(var(--primary))] focus-visible:outline-none" />
                          <span className="min-w-0 break-words">{t(`monitoring.types.${type.key}`)}</span>
                        </label>
                      )
                    })}
                  </div>
                </fieldset>

                <Field label={t('monitoring.form.date')} required className="sm:max-w-xs">
                  <Input type="date" value={violationDate} onChange={(e) => setViolationDate(e.target.value)} />
                </Field>

                <div className="flex min-w-0 flex-col gap-2">
                  <Field label={t('monitoring.form.situation')}>
                    <Textarea rows={5} placeholder={t('monitoring.form.situationPlaceholder')}
                      value={violationDescription} onChange={(e) => setViolationDescription(e.target.value)} />
                  </Field>
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
                    <p className="min-w-0 flex-1 basis-56 text-xs text-fg-subtle">{t('monitoring.form.aiHint')}</p>
                    <Button variant="secondary" size="sm" icon="sparkles" loading={improvingText}
                      disabled={improvingText || violationDescription.trim().length < 3} onClick={improveDescription}>
                      {improvingText ? t('monitoring.form.aiImproving') : t('monitoring.form.aiImprove')}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="flex min-w-0 flex-col gap-4">
                <div className="flex min-w-0 flex-col gap-2">
                  <p className="text-sm font-medium text-fg">{t('monitoring.form.camera')}</p>
                  {selectedCameraRoom ? (
                    // Развёрнутый режим — в том же элементе (поток камеры не переоткрывается), слой z-modal
                    <div className={cn(
                      'flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface-raised',
                      videoExpanded && 'fixed inset-2 z-modal shadow-3 sm:inset-6',
                    )}>
                      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
                        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="min-w-0 break-words text-sm font-medium text-fg">
                            {t('monitoring.form.cameraRoom', { name: selectedCameraRoom.name })}
                          </span>
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success">
                            <span className="h-2 w-2 animate-pulse rounded-full bg-success" aria-hidden="true" />
                            {t('monitoring.form.live')}
                          </span>
                        </div>
                        <Button variant="ghost" size="sm" icon={videoExpanded ? 'minimize' : 'maximize'}
                          onClick={() => setVideoExpanded((value) => !value)}>
                          {videoExpanded ? t('monitoring.form.collapse') : t('monitoring.form.expand')}
                        </Button>
                      </div>
                      <div className={cn('overflow-hidden', MEDIA_BG, videoExpanded ? 'min-h-0 flex-1' : 'aspect-video')}>
                        <CameraLive roomId={selectedCameraRoom.id}
                          alt={t('monitoring.form.cameraAlt', { name: selectedCameraRoom.name })}
                          className={cn('h-full w-full', videoExpanded ? 'object-contain' : 'object-cover')} />
                      </div>
                    </div>
                  ) : (
                    <div className="flex min-h-40 min-w-0 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-fg-muted">
                      <Icon name="camera" size={22} className="text-fg-subtle" />
                      <p className="min-w-0 break-words">{t('monitoring.form.noCamera', { room: selectedLesson.room || '—' })}</p>
                    </div>
                  )}
                  {selectedCameraRoom && (
                    <div className="flex flex-wrap gap-2">
                      <Button variant="secondary" icon="image" loading={capturing === 'photo'} disabled={Boolean(capturing)}
                        onClick={() => captureEvidence('photo')}>
                        {capturing === 'photo' ? t('monitoring.form.takingPhoto') : t('monitoring.form.takePhoto')}
                      </Button>
                      <Button variant="secondary" icon="video" loading={capturing === 'video'} disabled={Boolean(capturing)}
                        onClick={() => captureEvidence('video')}>
                        {capturing === 'video' ? t('monitoring.form.recordingVideo') : t('monitoring.form.recordVideo')}
                      </Button>
                    </div>
                  )}
                </div>

                {evidence.length > 0 && (
                  <div className="flex min-w-0 flex-col gap-2">
                    <p className="text-sm font-medium text-fg">{t('monitoring.form.media')}</p>
                    <div className="grid min-w-0 grid-cols-3 gap-2">
                      {evidence.map((item) => (
                        <a key={item.id} href={item.url} target="_blank" rel="noreferrer"
                          className="flex min-w-0 flex-col overflow-hidden rounded-md border border-line bg-surface transition-colors hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
                          {item.media_type === 'photo'
                            ? <img src={item.url} alt={t('monitoring.form.snapshotAlt')} className="aspect-video w-full object-cover" />
                            : (
                              <span className={cn('grid aspect-video w-full place-items-center text-fg-inverse', MEDIA_BG)}>
                                <Icon name="video" size={20} />
                              </span>
                            )}
                          <span className="min-w-0 px-2 py-1.5 text-xs font-medium text-fg-muted">
                            {item.media_type === 'photo' ? t('monitoring.form.photo') : t('monitoring.form.video')}
                          </span>
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                <Alert tone="info">{t('monitoring.form.prefilled')}</Alert>
              </div>
            </div>
          </form>
        )}
      </Modal>

      {/* Подтверждение/отклонение нарушения с необязательным комментарием */}
      <Modal
        open={!!reviewTarget}
        onClose={() => setReviewTarget(null)}
        size="sm"
        title={reviewConfirming ? t('monitoring.review.confirmTitle') : t('monitoring.review.rejectTitle')}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setReviewTarget(null)}>{t('ui.cancel')}</Button>
            <Button type="submit" form="violation-review-form" variant={reviewConfirming ? 'success' : 'danger'} loading={reviewing}>
              {reviewConfirming ? t('monitoring.review.confirm') : t('monitoring.review.reject')}
            </Button>
          </>
        )}
      >
        <form id="violation-review-form" onSubmit={submitReview}>
          <Field label={reviewConfirming ? t('monitoring.review.confirmComment') : t('monitoring.review.rejectComment')}>
            <Textarea rows={3} value={reviewComment} onChange={(e) => setReviewComment(e.target.value)} data-autofocus />
          </Field>
        </form>
      </Modal>
    </PageStack>
  )
}
