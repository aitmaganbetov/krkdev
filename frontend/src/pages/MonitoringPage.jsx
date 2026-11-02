import { useEffect, useMemo, useRef, useState } from 'react'
import CameraLive from '../components/CameraLive'
import { useTranslation } from 'react-i18next'
import {
  captureRoomPhoto,
  createViolation,
  getRooms,
  getScheduleLessons,
  getViolations,
  improveViolationText,
  recordRoomVideo,
  justifyViolation,
  reviewViolation,
  signViolation,
  syncScheduleFromPlatonus,
  apiErrorText,
} from '../services/api'
import useEcpSign from '../hooks/useEcpSign'
import { toDatetimeLocalUtcPlus5 } from '../utils/datetime'
import { LESSON_STATUS_TONE, lessonPlace, lessonStatus, nowHHMMUtcPlus5 } from '../utils/scheduleLesson'
import { violationTypeLabel } from '../utils/violationTypes'
import { SENT_TO_TEACHER, allowedOutcomes, confirmBlocker, emptyAnswers, isComplete, isLocked, signerOf } from '../utils/videoChecklist'
import {
  ChecklistAnswers, ChecklistQuestions, OutcomeBadge, ReportFields, ResponsesList, deviationLabels, emptyReport, formatStamp, reportPayload,
} from '../components/monitoring/VideoChecklist'
import { ArchiveStats, ArchiveTable, ObservationsAnalytics, isArchived, observationDate } from '../components/monitoring/ObservationsReports'
import { useAuth } from '../context/AuthContext'
import {
  Alert, Badge, Button, Card, CardFooter, Checkbox, DescriptionList, EmptyState, Field,
  FilterBar, Icon, Input, LoadingBlock, Modal, PageHeader, PageStack, Pagination, RadioGroup, SearchInput, SegmentedControl,
  StatCard, Tabs, Textarea, TruncatedText, cn, useUI,
} from '../components/ui'
import { isAdmin, managesWorkspace } from '../utils/roles'
import { useVisibleInterval } from '../hooks/useVisibleInterval'
import { regionLocale } from '../utils/locale'

const tabs = [
  { id: 'live', icon: 'monitor' },
  { id: 'violations', icon: 'alert' },
  { id: 'archive', icon: 'inbox' },
  { id: 'analytics', icon: 'chart' },
]

// Время занятия по расписанию для карточки наблюдения: «10:00–11:50» (у записи КРК — время начала)
const lessonTime = (lesson) => (lesson.start_time
  ? `${lesson.start_time}–${lesson.end_time || ''}`
  : String(lesson.datetime || '').slice(11, 16))
const REPORT_OUTCOMES = ['compliant', 'clarification', 'violation', 'technical']
const sameLogin = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()



// Фон области просмотра медиа: тёмный в обеих темах (единственное допустимое исключение из токенов).
const MEDIA_BG = 'bg-[rgb(6_18_31)]'

// Сегодняшняя дата (YYYY-MM-DD) в часовом поясе приложения (UTC+5)
const todayUtcPlus5 = () => toDatetimeLocalUtcPlus5(new Date()).slice(0, 10)

// Начало учебного года (1 сентября) — начало периода «Архива» и «Аналитики» по умолчанию
const academicYearStart = (day) => {
  const [year, month] = day.split('-').map(Number)
  return `${month >= 9 ? year : year - 1}-09-01`
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

// Занятие из расписания Platonus
function ScheduleLessonCard({ lesson, onOpen }) {
  const { t, i18n } = useTranslation()
  const kz = i18n.language === 'kz'
  const subject = (kz && lesson.subject_kz) || lesson.subject
  const lessonType = (kz && lesson.lesson_type_kz) || lesson.lesson_type
  const teacher = lesson.teacher || t('monitoring.schedule.noTeacher')
  const initials = String(lesson.teacher || '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
  const place = lesson.online && !lesson.room
    ? t('monitoring.schedule.online')
    : lessonPlace(lesson) || t('monitoring.schedule.noRoom')

  return (
    <Card as="article" className={cn('flex flex-col gap-4 p-4 sm:p-5', lesson.status === 'now' && 'border-success/40')}>
      <div className="flex min-w-0 items-start gap-3">
        <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary-subtle text-sm font-semibold text-primary-subtle-fg">
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-base font-semibold text-fg" title={teacher}>{teacher}</h3>
          {lessonType && <p className="mt-0.5 break-words text-xs text-fg-muted">{lessonType}</p>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge tone={LESSON_STATUS_TONE[lesson.status]} dot>{t(`monitoring.schedule.status.${lesson.status}`)}</Badge>
            {lesson.camera_enabled && <Badge tone="primary" icon="camera">{t('monitoring.schedule.camera')}</Badge>}
            {lesson.online && <Badge tone="neutral" icon="globe">{t('monitoring.schedule.online')}</Badge>}
          </div>
        </div>
      </div>

      <div className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-3">
        <LessonFact icon="clock" label={t('monitoring.lesson.time')}>
          <span className="tabular">{lesson.start_time}–{lesson.end_time}</span>
          {lesson.pair_number > 0 && <span className="block text-xs font-normal text-fg-muted">{t('monitoring.schedule.pair', { n: lesson.pair_number })}</span>}
        </LessonFact>
        <LessonFact icon="pin" label={t('monitoring.lesson.room')}>
          <span className="break-words">{place}</span>
        </LessonFact>
        <LessonFact icon="book" label={t('monitoring.lesson.subject')} className="col-span-2">
          <TruncatedText lines={2}>{subject || '—'}</TruncatedText>
        </LessonFact>
        <LessonFact icon="users" label={t('monitoring.schedule.groups')} className="col-span-2">
          <span className="break-words">
            {lesson.student_groups || lesson.study_group || '—'}
            {lesson.students_count > 0 && <span className="font-normal text-fg-muted"> · {t('monitoring.schedule.students', { count: lesson.students_count })}</span>}
          </span>
        </LessonFact>
      </div>

      {onOpen && (
        <Button block icon="eye" className="mt-auto" onClick={() => onOpen(lesson)}>
          {t('monitoring.lesson.report')}
        </Button>
      )}
    </Card>
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

// Раздел «Отчетность» наблюдения (у записей до формы 16-02 — только если что-то заполнено)
function ReportSummary({ item }) {
  const { t, i18n } = useTranslation()
  if (!item.checklist && !item.schedule_check) return null
  const repeat = item.repeat_observation_at
    ? new Date(item.repeat_observation_at).toLocaleString(regionLocale(i18n.language), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : t('checklist.report.notRequired')
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-sm font-medium text-fg">{t('checklist.report.title')}</p>
      <DescriptionList items={[
        { label: t('checklist.report.scheduleCheck'), value: item.schedule_check || '—', full: true },
        { label: t('checklist.report.repeat'), value: <span className="tabular">{repeat}</span> },
        { label: t('checklist.report.onsite'), value: item.onsite_verification || t('checklist.report.notRequired') },
        { label: t('checklist.report.ticket'), value: item.tech_ticket || t('checklist.report.none') },
      ]} />
    </div>
  )
}

function ViolationsReview({ items, role, currentUser, onReport, onSign, signingId, onJustify, loading, error, onRetry }) {
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
        const labels = deviationLabels(t, item)
        const summary = item.checklist
          ? (labels.length ? labels.join(' · ') : t('checklist.short.none'))
          : violationTypeLabel(t, item.violation_type)
        const window = [item.observed_from, item.observed_to].filter(Boolean).join('–')
        return (
          <Card as="article" key={item.id}>
            <div className="grid min-w-0 gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
              <div className="flex min-w-0 flex-col gap-4">
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-2">
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="break-words text-sm font-medium text-accent">{summary}</p>
                    <h3 className="mt-0.5 break-words text-lg font-semibold text-fg">{item.teacher}</h3>
                  </div>
                  <OutcomeBadge status={item.status} />
                </div>
                <DescriptionList items={[
                  { label: t('monitoring.review.room'), value: item.room || '—' },
                  { label: t('monitoring.review.date'), value: <span className="tabular">{new Date(`${item.violation_date}T00:00:00`).toLocaleDateString(regionLocale(i18n.language))}</span> },
                  item.checklist && { label: t('checklist.card.window'), value: <span className="tabular">{window || '—'}</span> },
                  item.checklist && { label: t('checklist.card.camera'), value: item.camera || '—' },
                  { label: t('checklist.card.subject'), value: [item.subject, item.group_name].filter(Boolean).join(' · ') || '—', full: true },
                ].filter(Boolean)} />
                {item.checklist ? (
                  <details className="min-w-0">
                    <summary className="cursor-pointer text-sm font-medium text-primary">{t('checklist.questionsTitle')}</summary>
                    <div className="mt-2"><ChecklistAnswers checklist={item.checklist} /></div>
                  </details>
                ) : (
                  <p className="text-xs text-fg-subtle">{t('checklist.legacy')}</p>
                )}
                {item.description && <p className="whitespace-pre-line rounded-md bg-surface-muted p-3 text-sm text-fg-muted">{item.description}</p>}
                <ReportSummary item={item} />
                <ResponsesList responses={item.responses} />
                <div className="flex min-w-0 flex-col gap-1 text-xs text-fg-subtle">
                  <p className="break-words">{t('checklist.observedBy', { name: item.created_by_name || item.created_by })}</p>
                  {item.reviewed_by && (
                    <p className="break-words">
                      {t('checklist.reviewedBy', { name: item.reviewed_by_name || item.reviewed_by })}{item.review_comment ? ` · ${item.review_comment}` : ''}
                    </p>
                  )}
                  {item.signed_at && item.signature_info && (
                    <p className="flex min-w-0 items-start gap-1 break-words font-medium text-success">
                      <Icon name="key" size={14} className="mt-0.5 shrink-0" />
                      {t('checklist.signedBy', { subject: item.signature_info.subject, date: formatStamp(item.signed_at, i18n.language) })}
                    </p>
                  )}
                  {item.sign_data && <p className="break-words font-medium text-danger">{t('checklist.awaitingSign', { name: signerOf(item) })}</p>}
                </div>
                {item.act_url && (
                  <div className="flex flex-wrap gap-2">
                    <Button as="a" href={item.act_url} target="_blank" rel="noreferrer" variant="secondary" size="sm" icon="file-text">
                      {item.checklist ? t('checklist.openForm') : t('monitoring.review.openAct')}
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
            {managesWorkspace(role) && (!isLocked(item) || (item.status === 'confirmed' && item.responses?.length > 0)) && (
              <CardFooter>
                {!isLocked(item) && (
                  <Button variant="secondary" icon="edit" onClick={() => onReport(item)}>{t('checklist.reportButton')}</Button>
                )}
                {/* Подписывает наблюдатель (сервер сверяет ИИН сертификата); «соответствует» и нарушение уходят преподавателю */}
                {item.sign_data && sameLogin(signerOf(item), currentUser) && (
                  <Button icon="key" loading={signingId === item.id} disabled={Boolean(signingId)} onClick={() => onSign(item)}>
                    {signingId === item.id ? t('checklist.signing') : t(SENT_TO_TEACHER.includes(item.status) ? 'checklist.signAndSend' : 'checklist.sign')}
                  </Button>
                )}
                {item.status === 'confirmed' && item.responses?.length > 0 && (
                  <Button variant="secondary" icon="check" onClick={() => onJustify(item)}>{t('checklist.justify')}</Button>
                )}
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
  const { role, currentUser } = useAuth()
  // Член комитета КРК смотрит мониторинг, но нарушения не фиксирует (POST /violations ему закрыт)
  const canReport = role !== 'committee'
  const [rooms, setRooms] = useState([])
  const [violations, setViolations] = useState([])
  const [violationsLoading, setViolationsLoading] = useState(true)
  const [violationsError, setViolationsError] = useState('')
  const [tab, setTab] = useState('live')
  const [date, setDate] = useState(todayUtcPlus5)
  // Период «Архива» и «Аналитики» (по дате наблюдения): с начала учебного года по сегодня
  const [periodFrom, setPeriodFrom] = useState(() => academicYearStart(todayUtcPlus5()))
  const [periodTo, setPeriodTo] = useState(todayUtcPlus5)
  const [teacher, setTeacher] = useState('')
  const [room, setRoom] = useState('')
  const [selectedLesson, setSelectedLesson] = useState(null)
  // Чек-лист 16-02: дата и фактическое окно наблюдения, ответы, итог, отчетность, комментарий
  const [violationDate, setViolationDate] = useState(todayUtcPlus5)
  const [observedFrom, setObservedFrom] = useState('')
  const [observedTo, setObservedTo] = useState('')
  const [answers, setAnswers] = useState(emptyAnswers)
  const [answersInvalid, setAnswersInvalid] = useState(false)
  const [outcome, setOutcome] = useState('compliant')
  const [newReport, setNewReport] = useState(() => emptyReport())
  const [violationDescription, setViolationDescription] = useState('')
  const [savingViolation, setSavingViolation] = useState(false)
  // Сообщение внутри формы фиксации: { tone, text }
  const [violationNotice, setViolationNotice] = useState(null)
  const [evidence, setEvidence] = useState([])
  const [capturing, setCapturing] = useState('')
  const [videoExpanded, setVideoExpanded] = useState(false)
  const [improvingText, setImprovingText] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  // Диалог «Отчетность и статус» по наблюдению (деканат, администратор)
  const [reportTarget, setReportTarget] = useState(null)
  const [reportStatus, setReportStatus] = useState('clarification')
  const [report, setReport] = useState(() => emptyReport())
  const [reportComment, setReportComment] = useState('')
  const [reportError, setReportError] = useState('')
  const [reporting, setReporting] = useState(false)
  // Подпись нарушения ЭЦП и снятие нарушения по пояснению преподавателя
  const { sign, error: signError, setError: setSignError } = useEcpSign()
  const [signingId, setSigningId] = useState(null)
  const [justifyTarget, setJustifyTarget] = useState(null)
  const [justifyComment, setJustifyComment] = useState('')
  const [justifying, setJustifying] = useState(false)
  // Вкладка «Онлайн»: занятия по расписанию Platonus на выбранную дату
  const [schedule, setSchedule] = useState(null)
  const [scheduleLoading, setScheduleLoading] = useState(true)
  const [scheduleError, setScheduleError] = useState('')
  const [liveMode, setLiveMode] = useState('now')
  const [cameraOnly, setCameraOnly] = useState(false)
  const [syncingSchedule, setSyncingSchedule] = useState(false)
  const [clock, setClock] = useState(nowHHMMUtcPlus5)
  const scheduleRequest = useRef(0)
  // Сообщение формы — вверху длинного окна: прокручиваем к нему, чтобы его было видно при нажатии «Сохранить»
  const noticeRef = useRef(null)
  useEffect(() => {
    if (violationNotice || reportError) noticeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [violationNotice, reportError])

  // Список кабинетов открыт только администратору (GET /rooms) — остальным он не нужен и вернул бы 403
  useEffect(() => {
    if (!isAdmin(role)) return
    getRooms().then((data) => setRooms(data || [])).catch(() => setRooms([]))
  }, [role])

  const loadViolations = () => {
    setViolationsLoading(true)
    getViolations()
      .then((data) => { setViolations(data || []); setViolationsError('') })
      .catch(() => { setViolations([]); setViolationsError(t('monitoring.review.loadError')) })
      .finally(() => setViolationsLoading(false))
  }

  useEffect(() => loadViolations(), [])

  const loadSchedule = (silent = false) => {
    // Ответ на устаревшую дату (её успели переключить) не должен перезаписать текущий
    const request = ++scheduleRequest.current
    if (!silent) setScheduleLoading(true)
    getScheduleLessons(date)
      .then((data) => {
        if (request !== scheduleRequest.current) return
        setSchedule(data && !Array.isArray(data) ? data : null)
        setScheduleError('')
      })
      .catch(() => {
        if (request !== scheduleRequest.current) return
        if (!silent) setSchedule(null)
        setScheduleError(t('monitoring.schedule.loadError'))
      })
      .finally(() => { if (request === scheduleRequest.current) setScheduleLoading(false) })
  }

  useEffect(() => { loadSchedule() }, [date])

  // Пока открыт сегодняшний день, статусы пересчитываются по часам, а расписание подтягивается заново
  // В скрытой вкладке часы и обновление расписания стоят; при возврате — сразу, если подошёл срок
  const viewingToday = date === todayUtcPlus5()
  useEffect(() => {
    if (viewingToday) setClock(nowHHMMUtcPlus5())
  }, [viewingToday])
  useVisibleInterval(() => setClock(nowHHMMUtcPlus5()), 30_000, { enabled: viewingToday })
  useVisibleInterval(() => loadSchedule(true), 5 * 60_000, { enabled: viewingToday })

  const syncSchedule = async () => {
    setSyncingSchedule(true)
    try {
      const result = await syncScheduleFromPlatonus()
      toast.success(t('monitoring.schedule.syncDone', { count: result.lessons }))
      loadSchedule(true)
    } catch (err) {
      toast.error(apiErrorText(err, t('monitoring.schedule.syncError')))
    } finally {
      setSyncingSchedule(false)
    }
  }

  const selectedCameraRoom = useMemo(() => {
    if (!selectedLesson) return null
    // Занятие расписания уже знает свой кабинет: список кабинетов (только для админа) не нужен
    if ('room_id' in selectedLesson) {
      return selectedLesson.room_id && selectedLesson.camera_enabled
        ? { id: selectedLesson.room_id, name: selectedLesson.room }
        : null
    }
    const lessonRoom = String(selectedLesson.room || '').toLowerCase()
    return rooms.find((item) => lessonRoom.includes(String(item.name || '').toLowerCase()) && item.camera_enabled) || null
  }, [rooms, selectedLesson])

  // Итог первого наблюдения — только из допустимых по ответам (п. 4.5, 4.7)
  const outcomeOptions = allowedOutcomes(answers)
  const effectiveOutcome = outcomeOptions.includes(outcome) ? outcome : outcomeOptions[0]

  const openViolation = (lesson) => {
    setSelectedLesson(lesson)
    setViolationDate(String(lesson.datetime || date).slice(0, 10))
    setObservedFrom(nowHHMMUtcPlus5())
    setObservedTo('')
    setAnswers(emptyAnswers())
    setAnswersInvalid(false)
    setOutcome('compliant')
    setNewReport(emptyReport())
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
        text: apiErrorText(err, t(kind === 'photo' ? 'monitoring.form.photoError' : 'monitoring.form.videoError')),
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
      setViolationNotice({ tone: 'danger', text: apiErrorText(err, t('monitoring.form.aiError')) })
    } finally {
      setImprovingText(false)
    }
  }

  // signAfter — сразу подписать ЭЦП (и отправить преподавателю); без подписи чек-лист можно подписать позже из списка
  const saveViolation = async (event, signAfter = true) => {
    event?.preventDefault()
    if (!selectedLesson) return
    if (!isComplete(answers)) {
      setAnswersInvalid(true)
      setViolationNotice({ tone: 'warning', text: t('checklist.needAnswers') })
      return
    }
    if (answers.other === 'yes' && !violationDescription.trim()) {
      setViolationNotice({ tone: 'warning', text: t('checklist.needComment') })
      return
    }
    setSavingViolation(true)
    setViolationNotice(null)
    let created = null
    try {
      created = await createViolation({
        // Занятие расписания: schedule-<lessonID Platonus>-<дата>; запись КРК — её id
        lesson_ref: String(selectedLesson.id),
        teacher: selectedLesson.teacher || t('monitoring.schedule.noTeacher'),
        room: lessonPlace(selectedLesson).slice(0, 255),
        subject: String(selectedLesson.subject || '').slice(0, 255),
        group_name: String(selectedLesson.student_groups || selectedLesson.study_group || selectedLesson.group_name || '').slice(0, 500),
        camera: selectedCameraRoom ? String(selectedCameraRoom.name).slice(0, 255) : '',
        scheduled_time: lessonTime(selectedLesson),
        observed_from: observedFrom,
        // Окончание окна — момент сохранения, если не указано
        observed_to: observedTo || nowHHMMUtcPlus5(),
        violation_date: violationDate,
        checklist: answers,
        status: effectiveOutcome,
        description: violationDescription,
        ...reportPayload(newReport),
        evidence_ids: evidence.map((item) => item.id),
      })
      setSelectedLesson(null)
      loadViolations()
      setTab('violations')
    } catch (err) {
      setViolationNotice({ tone: 'danger', text: apiErrorText(err, t('checklist.createError')) })
    } finally {
      setSavingViolation(false)
    }
    if (!created) return
    // Закрыли окно NCALayer — подписать можно позже из списка
    if (signAfter && created.sign_data) {
      if (!await signItem(created)) toast.warning(t('checklist.signLater'))
    } else {
      toast.success(t('checklist.created'))
    }
  }

  const signItem = async (item) => {
    setSigningId(item.id)
    const signed = await sign(item.sign_data, (cms) => signViolation(item.id, cms), (saved) => {
      if (saved.status === 'confirmed') return t(saved.teacher_notified ? 'checklist.signedNotified' : 'checklist.signedNotNotified')
      if (saved.status === 'compliant') return t(saved.teacher_notified ? 'checklist.sentCompliant' : 'checklist.signedNotNotified')
      return t('checklist.signedOnly')
    })
    setSigningId(null)
    loadViolations()
    return signed
  }

  const submitJustify = async (event) => {
    event.preventDefault()
    setJustifying(true)
    try {
      await justifyViolation(justifyTarget.id, justifyComment.trim())
      toast.success(t('checklist.justified'))
      setJustifyTarget(null)
      loadViolations()
    } catch (err) {
      toast.error(apiErrorText(err, t('checklist.justifyError')))
    } finally {
      setJustifying(false)
    }
  }

  const openReport = (item) => {
    setReportTarget(item)
    setReportStatus(item.status === 'pending' ? 'clarification' : item.status)
    setReport(emptyReport(item))
    setReportComment('')
    setReportError('')
  }

  const submitReport = async (event) => {
    event.preventDefault()
    if (!reportTarget) return
    // Те же правила, что на сервере: подтверждение — после проверок (п. 4.5), плохой сигнал — не против преподавателя (п. 4.7)
    const blocker = reportStatus === 'violation' && reportTarget.status !== 'violation'
      ? confirmBlocker(reportTarget, report)
      : reportStatus === 'compliant' && reportTarget.checklist?.quality === 'no' ? 'technicalOnly' : null
    if (blocker) {
      setReportError(t(`checklist.${blocker}`))
      return
    }
    setReporting(true)
    setReportError('')
    let saved = null
    try {
      saved = await reviewViolation(reportTarget.id, { status: reportStatus, comment: reportComment, ...reportPayload(report) })
      setReportTarget(null)
      loadViolations()
    } catch (err) {
      setReportError(apiErrorText(err, t('checklist.saveError')))
    } finally {
      setReporting(false)
    }
    if (!saved) return
    // Нарушение после уточнения тоже подписывается ЭЦП тем, кто его зафиксировал
    if (saved.status === 'violation' && saved.sign_data) {
      if (!await signItem(saved)) toast.warning(t('checklist.signLater'))
    } else {
      toast.success(t('checklist.saved'))
    }
  }

  const today = todayUtcPlus5()
  const isToday = date === today
  // «Идут сейчас» имеет смысл только для сегодняшней даты
  const effectiveMode = isToday ? liveMode : 'day'

  const scheduleLessons = useMemo(() => {
    const queryTeacher = teacher.trim().toLowerCase()
    const queryRoom = room.trim().toLowerCase()
    return (schedule?.lessons || [])
      .map((lesson) => ({ ...lesson, status: lessonStatus(lesson, today, clock), datetime: `${lesson.date}T${lesson.start_time}:00` }))
      .filter((lesson) => String(lesson.teacher || '').toLowerCase().includes(queryTeacher)
        && `${lesson.room || ''} ${lesson.building || ''}`.toLowerCase().includes(queryRoom))
  }, [schedule, today, clock, teacher, room])

  const liveLessons = useMemo(() => scheduleLessons.filter((lesson) => (
    (effectiveMode === 'day' || lesson.status === 'now') && (!cameraOnly || lesson.camera_enabled)
  )), [scheduleLessons, effectiveMode, cameraOnly])

  const lessonsNow = scheduleLessons.filter((lesson) => lesson.status === 'now')

  const filteredViolations = useMemo(() => {
    const queryTeacher = teacher.trim().toLowerCase()
    const queryRoom = room.trim().toLowerCase()
    return violations.filter((item) => (
      String(item.teacher || '').toLowerCase().includes(queryTeacher)
      && String(item.room || '').toLowerCase().includes(queryRoom)
    ))
  }, [violations, teacher, room])

  // «Архив» и «Аналитика» — наблюдения за период по дате наблюдения; в архиве — с принятым решением
  const periodViolations = useMemo(() => filteredViolations.filter((item) => {
    const day = observationDate(item)
    return (!periodFrom || day >= periodFrom) && (!periodTo || day <= periodTo)
  }), [filteredViolations, periodFrom, periodTo])
  const archiveItems = useMemo(() => periodViolations.filter(isArchived)
    .sort((a, b) => observationDate(b).localeCompare(observationDate(a)) || b.id - a.id), [periodViolations])
  const usesPeriod = tab === 'archive' || tab === 'analytics'

  const paginationItems = tab === 'violations' ? filteredViolations : tab === 'live' ? liveLessons : tab === 'archive' ? archiveItems : []
  const pageCount = Math.max(1, Math.ceil(paginationItems.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const paginatedItems = paginationItems.slice((safePage - 1) * pageSize, safePage * pageSize)

  useEffect(() => {
    setPage(1)
  }, [tab, date, periodFrom, periodTo, teacher, room, pageSize, liveMode, cameraOnly])

  // Показатели вкладки «Наблюдения» — по итогам чек-листа ситуационного видеомониторинга (те же фильтры, что у списка)
  const observationStats = useMemo(() => {
    const count = (...statuses) => filteredViolations.filter((item) => statuses.includes(item.status)).length
    return {
      total: filteredViolations.length,
      compliant: count('compliant'),
      clarification: count('clarification'),
      technical: count('technical'),
      violations: count('violation', 'confirmed'),
      signed: count('confirmed'),
      justified: count('justified'),
      unsigned: filteredViolations.filter((item) => REPORT_OUTCOMES.includes(item.status) && !item.signed_at).length,
    }
  }, [filteredViolations])

  const tabItems = tabs.map((item) => ({ value: item.id, icon: item.icon, label: t(`monitoring.tabs.${item.id}`) }))

  return (
    <PageStack>
      <PageHeader title={t('monitoring.title')} description={t('monitoring.description')} />

      <Tabs items={tabItems} value={tab} onChange={setTab} ariaLabel={t('monitoring.tabs.label')} />

      <FilterBar>
        {usesPeriod ? (
          <>
            <Field label={t('monitoring.filters.periodFrom')}>
              <Input type="date" value={periodFrom} max={periodTo || undefined} onChange={(e) => setPeriodFrom(e.target.value)} />
            </Field>
            <Field label={t('monitoring.filters.periodTo')}>
              <Input type="date" value={periodTo} min={periodFrom || undefined} onChange={(e) => setPeriodTo(e.target.value)} />
            </Field>
          </>
        ) : (
          <Field label={t('monitoring.filters.date')}>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        )}
        <Field label={t('monitoring.filters.room')}>
          <SearchInput value={room} onChange={(e) => setRoom(e.target.value)} placeholder={t('monitoring.filters.roomPlaceholder')} />
        </Field>
        <Field label={t('monitoring.filters.teacher')}>
          <SearchInput value={teacher} onChange={(e) => setTeacher(e.target.value)} placeholder={t('monitoring.filters.teacherPlaceholder')} />
        </Field>
      </FilterBar>

      {tab === 'live' ? (
        <section className="grid min-w-0 grid-cols-2 gap-4 xl:grid-cols-4">
          <StatCard label={t('monitoring.schedule.metrics.now')} value={isToday ? lessonsNow.length : '—'} tone="success" />
          <StatCard label={t('monitoring.schedule.metrics.day')} value={scheduleLessons.length} tone="primary" />
          <StatCard label={t('monitoring.schedule.metrics.camera')} value={isToday ? lessonsNow.filter((lesson) => lesson.camera_enabled).length : '—'} />
          <StatCard label={t('monitoring.schedule.metrics.online')} value={isToday ? lessonsNow.filter((lesson) => lesson.online).length : '—'} />
        </section>
      ) : tab === 'violations' ? (
        <section className="grid min-w-0 grid-cols-2 gap-4 xl:grid-cols-4">
          <StatCard label={t('monitoring.metrics.observations.total')} value={observationStats.total} tone="primary"
            hint={t('monitoring.metrics.observations.totalHint', { count: observationStats.compliant })} />
          <StatCard label={t('monitoring.metrics.observations.clarification')} value={observationStats.clarification} tone="warning"
            hint={t('monitoring.metrics.observations.clarificationHint', { count: observationStats.technical })} />
          <StatCard label={t('monitoring.metrics.observations.violations')} value={observationStats.violations} tone="danger"
            hint={t('monitoring.metrics.observations.violationsHint', { signed: observationStats.signed, justified: observationStats.justified })} />
          <StatCard label={t('monitoring.metrics.observations.unsigned')} value={observationStats.unsigned}
            hint={t('monitoring.metrics.observations.unsignedHint')} />
        </section>
      ) : tab === 'archive' ? (
        <ArchiveStats items={archiveItems} />
      ) : null}

      {tab === 'violations' ? (
        <>
        {signError && <Alert tone="danger" onClose={() => setSignError('')} closeLabel={t('ui.close')}>{signError}</Alert>}
        <ViolationsReview
          items={paginatedItems}
          role={role}
          currentUser={currentUser}
          onReport={openReport}
          onSign={signItem}
          signingId={signingId}
          onJustify={(item) => { setJustifyComment(''); setJustifyTarget(item) }}
          loading={violationsLoading}
          error={violationsError}
          onRetry={loadViolations}
        />
        </>
      ) : tab === 'live' ? (
        <section className="flex min-w-0 flex-col gap-4">
          <div className="flex min-w-0 flex-wrap items-end justify-between gap-x-4 gap-y-3">
            <div className="min-w-0 flex-1 basis-64">
              <h2 className="text-lg font-semibold text-fg">{t('monitoring.schedule.title')}</h2>
              <p className="text-sm text-fg-muted">
                {new Date(`${date}T00:00:00`).toLocaleDateString(regionLocale(i18n.language), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                {schedule?.week ? ` · ${t('monitoring.schedule.info', { week: schedule.week, term: schedule.term, year: schedule.study_year, next: schedule.study_year + 1 })}` : ''}
              </p>
              <p className="mt-0.5 text-xs text-fg-subtle">
                {schedule?.synced_at
                  ? t('monitoring.schedule.synced', { time: new Date(`${schedule.synced_at}Z`).toLocaleString(regionLocale(i18n.language), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) })
                  : t('monitoring.schedule.notSynced')}
              </p>
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Badge tone="primary">{t('monitoring.schedule.count', { count: liveLessons.length })}</Badge>
              {isAdmin(role) && (
                <Button variant="secondary" size="sm" icon="refresh" loading={syncingSchedule} disabled={syncingSchedule} onClick={syncSchedule}>
                  {syncingSchedule ? t('monitoring.schedule.syncing') : t('monitoring.schedule.sync')}
                </Button>
              )}
            </div>
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-3">
            {isToday && (
              <SegmentedControl
                ariaLabel={t('monitoring.schedule.modeLabel')}
                className="sm:[&_span]:whitespace-nowrap"
                value={liveMode}
                onChange={setLiveMode}
                options={[
                  { value: 'now', label: t('monitoring.schedule.now'), icon: 'clock' },
                  { value: 'day', label: t('monitoring.schedule.day'), icon: 'calendar' },
                ]}
              />
            )}
            <Checkbox label={t('monitoring.schedule.cameraOnly')} checked={cameraOnly} onChange={(e) => setCameraOnly(e.target.checked)} />
          </div>

          {scheduleError && (
            <Alert tone="danger" title={scheduleError}
              action={<Button variant="secondary" size="sm" icon="refresh" onClick={() => loadSchedule()}>{t('ui.retry')}</Button>} />
          )}

          {scheduleLoading && !schedule ? (
            <Card><LoadingBlock label={t('monitoring.loading')} /></Card>
          ) : !schedule ? null : !schedule.synced_at ? (
            <Card><EmptyState icon="calendar" title={t('monitoring.schedule.notSynced')} /></Card>
          ) : schedule.term == null ? (
            <Card><EmptyState icon="calendar" title={t('monitoring.empty.title')} description={t('monitoring.schedule.outOfTerm')} /></Card>
          ) : liveLessons.length === 0 ? (
            <Card>
              {effectiveMode === 'now' ? (
                <EmptyState icon="clock" title={t('monitoring.schedule.emptyNow')} description={t('monitoring.schedule.emptyNowHint')}
                  action={<Button variant="secondary" icon="calendar" onClick={() => setLiveMode('day')}>{t('monitoring.schedule.day')}</Button>} />
              ) : (
                <EmptyState icon="monitor" title={t('monitoring.empty.title')} description={t('monitoring.empty.hint')} />
              )}
            </Card>
          ) : (
            <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {paginatedItems.map((lesson) => <ScheduleLessonCard key={lesson.id} lesson={lesson} onOpen={canReport ? openViolation : undefined} />)}
            </div>
          )}
        </section>
      ) : tab === 'archive' ? (
        <ArchiveTable rows={paginatedItems} total={archiveItems.length} loading={violationsLoading}
          error={violationsError} onRetry={loadViolations} />
      ) : (
        <ObservationsAnalytics items={periodViolations} loading={violationsLoading} error={violationsError} onRetry={loadViolations} />
      )}

      {(tab === 'live' ? !scheduleLoading : !violationsLoading) && paginationItems.length > 0 && (
        <Pagination
          page={safePage}
          pageCount={pageCount}
          onPageChange={setPage}
          total={paginationItems.length}
          pageSize={pageSize}
          onPageSizeChange={setPageSize}
        />
      )}

      {/* Чек-лист ситуационного видеомониторинга (форма 16-02) */}
      <Modal
        open={!!selectedLesson}
        onClose={() => setSelectedLesson(null)}
        size="xl"
        title={t('checklist.title')}
        description={selectedLesson ? `${t('checklist.code')} · ${t('monitoring.form.description', {
          teacher: selectedLesson.teacher,
          subject: selectedLesson.subject || '—',
          room: selectedLesson.room || '—',
        })}` : undefined}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setSelectedLesson(null)}>{t('ui.cancel')}</Button>
            <Button variant="secondary" disabled={savingViolation} onClick={() => saveViolation(null, false)}>{t('checklist.saveDraft')}</Button>
            <Button type="submit" form="violation-form" icon="key" loading={savingViolation}>
              {savingViolation ? t('checklist.saving') : t(SENT_TO_TEACHER.includes(effectiveOutcome) ? 'checklist.signAndSend' : 'checklist.sign')}
            </Button>
          </>
        )}
      >
        {selectedLesson && (
          <form id="violation-form" onSubmit={saveViolation} className="flex min-w-0 flex-col gap-5">
            {violationNotice && (
              <div ref={noticeRef}>
                <Alert tone={violationNotice.tone} onClose={() => setViolationNotice(null)} closeLabel={t('ui.close')}>
                  {violationNotice.text}
                </Alert>
              </div>
            )}

            <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
              <div className="flex min-w-0 flex-col gap-6">
                <Alert tone="info">{t('checklist.rules')}</Alert>

                <section className="flex min-w-0 flex-col gap-3">
                  <h3 className="text-sm font-semibold text-fg">{t('checklist.card.title')}</h3>
                  <DescriptionList items={[
                    { label: t('checklist.card.teacher'), value: selectedLesson.teacher || '—' },
                    { label: t('checklist.card.observer'), value: currentUser || '—' },
                    { label: t('checklist.card.room'), value: lessonPlace(selectedLesson) || '—' },
                    { label: t('checklist.card.camera'), value: selectedCameraRoom?.name || t('checklist.card.noCamera') },
                    { label: t('checklist.card.schedule'), value: <span className="tabular">{lessonTime(selectedLesson) || '—'}</span> },
                    {
                      label: t('checklist.card.subject'),
                      value: [selectedLesson.subject, selectedLesson.student_groups || selectedLesson.study_group || selectedLesson.group_name]
                        .filter(Boolean).join(' · ') || '—',
                    },
                  ]} />
                  <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-3">
                    <Field label={t('checklist.card.date')} required>
                      <Input type="date" value={violationDate} onChange={(e) => setViolationDate(e.target.value)} />
                    </Field>
                    <Field label={t('checklist.card.from')}>
                      <Input type="time" value={observedFrom} onChange={(e) => setObservedFrom(e.target.value)} />
                    </Field>
                    <Field label={t('checklist.card.to')}>
                      <Input type="time" value={observedTo} onChange={(e) => setObservedTo(e.target.value)} />
                    </Field>
                  </div>
                  <p className="text-xs text-fg-subtle">{t('checklist.card.window')}: {t('checklist.card.windowHint')}</p>
                </section>

                <section className="flex min-w-0 flex-col gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-fg">{t('checklist.questionsTitle')}</h3>
                    <p className="mt-0.5 text-xs text-fg-subtle">{t('checklist.answersHint')}</p>
                  </div>
                  <ChecklistQuestions answers={answers} invalid={answersInvalid}
                    onChange={(next) => { setAnswers(next); setAnswersInvalid(false) }} />
                </section>

                <section className="flex min-w-0 flex-col gap-4">
                  <h3 className="text-sm font-semibold text-fg">{t('checklist.report.title')}</h3>
                  <RadioGroup legend={t('checklist.report.status')} required columns={1} value={effectiveOutcome} onChange={setOutcome}
                    options={outcomeOptions.map((value) => ({
                      value, label: t(`checklist.outcomes.${value}`), description: t(`checklist.outcomeHints.${value}`),
                    }))} />
                  <Alert tone="warning">{t('checklist.firstObservation')}</Alert>
                  <ReportFields value={newReport} onChange={setNewReport} />
                </section>

                <div className="flex min-w-0 flex-col gap-2">
                  <Field label={t('checklist.report.comment')} required={answers.other === 'yes'}>
                    <Textarea rows={4} placeholder={t('checklist.report.commentPlaceholder')}
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

              {/* Камера остаётся на виду, пока заполняется чек-лист */}
              <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-0 lg:self-start">
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
                              // Первый кадр записи (запись начинается с опорного кадра) и значок поверх
                              <span className={cn('relative block aspect-video w-full overflow-hidden', MEDIA_BG)}>
                                <video muted preload="metadata" className="h-full w-full object-cover"><source src={`${item.url}#t=0.1`} type="video/mp4" /></video>
                                <span className="absolute inset-0 grid place-items-center text-fg-inverse"><Icon name="video" size={20} /></span>
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

              </div>
            </div>
          </form>
        )}
      </Modal>

      {/* Отчетность по наблюдению: сверка, повторное наблюдение, очная верификация, итог (п. 4.5) */}
      <Modal
        open={!!reportTarget}
        onClose={() => setReportTarget(null)}
        size="lg"
        title={reportTarget ? t('checklist.reportTitle', { id: reportTarget.id }) : ''}
        description={reportTarget?.teacher}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setReportTarget(null)}>{t('ui.cancel')}</Button>
            <Button type="submit" form="violation-report-form" icon="check" loading={reporting}>{t('checklist.saveReport')}</Button>
          </>
        )}
      >
        {reportTarget && (
          <form id="violation-report-form" onSubmit={submitReport} className="flex min-w-0 flex-col gap-5">
            {reportError && (
              <div ref={noticeRef}>
                <Alert tone="danger" onClose={() => setReportError('')} closeLabel={t('ui.close')}>{reportError}</Alert>
              </div>
            )}
            <Alert tone="info">{t('checklist.firstObservation')}</Alert>
            <ReportFields value={report} onChange={setReport} />
            <RadioGroup legend={t('checklist.report.status')} required columns={2} value={reportStatus} onChange={setReportStatus}
              options={REPORT_OUTCOMES.map((value) => ({
                value, label: t(`checklist.outcomes.${value}`), description: t(`checklist.outcomeHints.${value}`),
              }))} />
            <Field label={t('checklist.reviewComment')}>
              <Textarea rows={3} value={reportComment} onChange={(e) => setReportComment(e.target.value)} />
            </Field>
          </form>
        )}
      </Modal>

      {/* Снять нарушение по пояснению преподавателя */}
      <Modal
        open={!!justifyTarget}
        onClose={() => setJustifyTarget(null)}
        size="sm"
        title={justifyTarget ? t('checklist.justifyTitle', { id: justifyTarget.id }) : ''}
        description={justifyTarget?.teacher}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setJustifyTarget(null)}>{t('ui.cancel')}</Button>
            <Button type="submit" form="violation-justify-form" icon="check" loading={justifying} disabled={justifyComment.trim().length < 3}>
              {t('checklist.justify')}
            </Button>
          </>
        )}
      >
        <form id="violation-justify-form" onSubmit={submitJustify}>
          <Field label={t('checklist.justifyComment')} required>
            <Textarea rows={3} value={justifyComment} onChange={(e) => setJustifyComment(e.target.value)} data-autofocus />
          </Field>
        </form>
      </Modal>
    </PageStack>
  )
}
