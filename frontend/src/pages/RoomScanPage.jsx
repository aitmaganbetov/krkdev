import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import CameraLive from '../components/CameraLive'
import { apiErrorText, getLessonAttendance, getRoomScan, markRoomAttendance, removeAttendanceMark } from '../services/api'
import { toDatetimeLocalUtcPlus5 } from '../utils/datetime'
import { LESSON_STATUS_TONE } from '../utils/scheduleLesson'
import {
  Alert, Badge, Button, Card, CardHeader, EmptyState, Icon, LoadingBlock, Modal, PageHeader, PageStack, useUI,
} from '../components/ui'
import { formatMoney } from '../utils/locale'

const CONDITION_TONE = { good: 'success', repair: 'warning', written_off: 'neutral' }

// Время отметки (сервер хранит UTC) — только часы и минуты по UTC+5
const markTime = (value) => (value ? toDatetimeLocalUtcPlus5(value).slice(11, 16) : '')

function LessonTime({ lesson, t }) {
  return (
    <span className="tabular">
      {lesson.start_time}–{lesson.end_time}
      {lesson.pair_number > 0 && <span className="text-fg-muted"> · {t('monitoring.schedule.pair', { n: lesson.pair_number })}</span>}
    </span>
  )
}

/** Список потока и отметки на занятии: преподаватель и проверяющие могут снять отметку. */
function AttendanceModal({ lesson, date, onClose, onChanged }) {
  const { t } = useTranslation()
  const { toast } = useUI()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(null)

  const load = () => {
    getLessonAttendance(lesson.lesson_id, date)
      .then((result) => { setData(result); setError('') })
      .catch((err) => setError(apiErrorText(err, t('scan.attendance.loadError'))))
  }
  useEffect(() => { if (lesson) { setData(null); load() } }, [lesson?.lesson_id])

  const remove = async (student) => {
    setBusy(student.attendance_id)
    try {
      await removeAttendanceMark(student.attendance_id)
      toast.success(t('scan.attendance.removed', { name: student.full_name }))
      load()
      onChanged?.()
    } catch (err) {
      toast.error(apiErrorText(err, t('scan.attendance.removeError')))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal
      open={!!lesson}
      onClose={onClose}
      size="lg"
      title={lesson ? t('scan.attendance.title', { subject: lesson.subject }) : ''}
      description={data ? t('scan.attendance.summary', { present: data.present, total: data.total }) : undefined}
      footer={<Button variant="secondary" onClick={onClose}>{t('ui.close')}</Button>}
    >
      {error && <Alert tone="danger">{error}</Alert>}
      {!data && !error && <LoadingBlock label={t('scan.loading')} />}
      {data && (data.students.length === 0 ? (
        <EmptyState icon="users" title={t('scan.attendance.empty')} compact />
      ) : (
        <ul className="divide-y divide-line">
          {data.students.map((student) => {
            const present = student.marked_at && !student.removed
            return (
              <li key={student.student_id} className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5">
                <div className="min-w-0 flex-1 basis-48">
                  <p className="break-words text-sm font-medium text-fg">{student.full_name}</p>
                  <p className="text-xs text-fg-muted">{student.group_name}</p>
                </div>
                <div className="flex items-center gap-2">
                  {present && <Badge tone="success" dot>{t('scan.attendance.present', { time: markTime(student.marked_at) })}</Badge>}
                  {student.removed && <Badge tone="neutral">{t('scan.attendance.removedBadge')}</Badge>}
                  {!student.marked_at && <Badge tone="warning">{t('scan.attendance.absent')}</Badge>}
                  {present && (
                    <Button size="sm" variant="danger-ghost" icon="x" loading={busy === student.attendance_id}
                      onClick={() => remove(student)}>
                      {t('scan.attendance.remove')}
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      ))}
    </Modal>
  )
}

function StudentView({ data, result, onRetry, retrying }) {
  const { t, i18n } = useTranslation()
  const subjectOf = (lesson) => (i18n.language === 'kz' && lesson.subject_kz) || lesson.subject
  // Повторить — только если отметка не удалась, а занятие ещё открыто для отметки
  const canRetry = result?.tone !== 'success' && data.lessons.some((lesson) => lesson.attendance_open && !lesson.marked)

  return (
    <PageStack>
      <PageHeader title={t('scan.roomTitle', { name: data.room.name })} description={data.room.building} />

      {result && (
        <Card className={result.tone === 'success' ? 'border-success/40' : undefined}>
          <div className="flex min-w-0 flex-col items-center gap-3 px-5 py-8 text-center">
            <span className={`grid h-14 w-14 place-items-center rounded-full ${result.tone === 'success' ? 'bg-success-subtle text-success' : 'bg-warning-subtle text-warning'}`}>
              <Icon name={result.tone === 'success' ? 'check-circle' : 'alert'} size={28} />
            </span>
            <h2 className="text-xl font-semibold text-fg">{result.title}</h2>
            {result.text && <p className="max-w-md break-words text-sm text-fg-muted">{result.text}</p>}
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              {canRetry && <Button icon="refresh" loading={retrying} onClick={onRetry}>{t('scan.student.retry')}</Button>}
              <Button as={Link} to="/my-attendance" variant="secondary" icon="check-circle">{t('nav.myAttendance')}</Button>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title={t('scan.student.todayTitle')} />
        {data.lessons.length === 0 ? (
          <EmptyState icon="calendar" title={t('scan.noLessons')} compact />
        ) : (
          <ul className="divide-y divide-line">
            {data.lessons.map((lesson) => (
              <li key={lesson.lesson_id} className="flex min-w-0 flex-wrap items-start justify-between gap-2 px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="break-words font-medium text-fg">{subjectOf(lesson)}</p>
                  <p className="mt-0.5 text-sm text-fg-muted"><LessonTime lesson={lesson} t={t} /> · {lesson.teacher}</p>
                </div>
                {lesson.marked
                  ? <Badge tone="success" dot>{t('scan.student.markedBadge')}</Badge>
                  : <Badge tone={LESSON_STATUS_TONE[lesson.status]} dot>{t(`monitoring.schedule.status.${lesson.status}`)}</Badge>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </PageStack>
  )
}

function StaffView({ data, onReload }) {
  const { t, i18n } = useTranslation()
  const [cameraOpen, setCameraOpen] = useState(false)
  const [attendanceLesson, setAttendanceLesson] = useState(null)
  const subjectOf = (lesson) => (i18n.language === 'kz' && lesson.subject_kz) || lesson.subject
  const money = (value) => formatMoney(value, i18n.language)
  const { room } = data
  const details = [
    room.building,
    room.floor && t('roomsPage.floor', { floor: room.floor }),
    room.room_type,
    room.capacity ? t('roomsPage.capacityValue', { count: room.capacity }) : null,
    room.area ? t('roomsPage.areaValue', { value: new Intl.NumberFormat(i18n.language === 'en' ? 'en-GB' : 'ru-RU', { maximumFractionDigits: 1 }).format(room.area) }) : null,
  ].filter(Boolean).join(' · ')

  return (
    <PageStack>
      <PageHeader
        title={t('scan.roomTitle', { name: room.name })}
        description={details}
        actions={data.camera_available && (
          <Button icon="video" onClick={() => setCameraOpen(true)}>{t('scan.staff.camera')}</Button>
        )}
      />

      <Card>
        <CardHeader title={t('scan.staff.lessonsTitle')} description={t('scan.staff.lessonsHint')} />
        {data.lessons.length === 0 ? (
          <EmptyState icon="calendar" title={t('scan.noLessons')} compact />
        ) : (
          <ul className="divide-y divide-line">
            {data.lessons.map((lesson) => (
              <li key={lesson.lesson_id} className="flex min-w-0 flex-col gap-2 px-4 py-4 sm:px-5">
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="text-sm text-fg-muted"><LessonTime lesson={lesson} t={t} /></p>
                    <p className="mt-0.5 break-words text-base font-semibold text-fg">{subjectOf(lesson)}</p>
                    <p className="text-sm text-fg-muted">{[lesson.lesson_type, lesson.teacher].filter(Boolean).join(' · ')}</p>
                  </div>
                  <Badge tone={LESSON_STATUS_TONE[lesson.status]} dot>{t(`monitoring.schedule.status.${lesson.status}`)}</Badge>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                  <span className="min-w-0 break-words text-fg">
                    <Icon name="users" size={16} className="mr-1.5 inline text-fg-subtle" />
                    {lesson.student_groups || lesson.study_group || '—'}
                  </span>
                  <span className="tabular text-fg-muted">{t('monitoring.schedule.students', { count: lesson.students_count })}</span>
                  <Badge tone={lesson.marked_count ? 'primary' : 'neutral'}>
                    {t('scan.staff.marked', { marked: lesson.marked_count, total: lesson.students_count })}
                  </Badge>
                </div>
                {lesson.can_view_attendance && (
                  <div>
                    <Button size="sm" variant="secondary" icon="check-circle" onClick={() => setAttendanceLesson(lesson)}>
                      {t('scan.staff.attendance')}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          title={t('scan.staff.inventoryTitle')}
          description={data.inventory_total != null ? `${t('roomsPage.inventory.total')}: ${money(data.inventory_total)}` : null}
        />
        {data.inventory.length === 0 ? (
          <EmptyState icon="inbox" title={t('roomsPage.inventory.empty')} compact />
        ) : (
          <ul className="divide-y divide-line">
            {data.inventory.map((item, index) => (
              <li key={`${item.name}-${index}`} className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-4 py-2.5 sm:px-5">
                <div className="min-w-0 flex-1 basis-48">
                  <p className="break-words text-sm font-medium text-fg">{item.name}</p>
                  {item.category && <p className="text-xs text-fg-muted">{item.category}</p>}
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="tabular text-fg-muted">× {item.quantity}</span>
                  {item.total != null && <span className="tabular font-medium">{money(item.total)}</span>}
                  <Badge tone={CONDITION_TONE[item.condition] || 'neutral'} dot>{t(`roomsPage.inventory.conditions.${item.condition}`)}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        size="xl"
        title={t('roomsPage.live.title', { name: room.name })}
        footer={<Button variant="secondary" onClick={() => setCameraOpen(false)}>{t('roomsPage.live.close')}</Button>}
      >
        {cameraOpen && (
          // Видео на тёмной подложке в обеих темах (как на странице кабинетов)
          <div className="dark grid aspect-video w-full min-w-0 place-items-center overflow-hidden rounded-md bg-[rgb(6_18_31)]">
            <CameraLive roomId={room.id} alt={t('roomsPage.live.alt', { name: room.name })}
              className="h-full w-full object-contain text-sm text-fg-muted"
              onError={(event) => { event.currentTarget.alt = t('roomsPage.live.error') }} />
          </div>
        )}
      </Modal>

      <AttendanceModal lesson={attendanceLesson} date={data.now.slice(0, 10)}
        onClose={() => setAttendanceLesson(null)} onChanged={onReload} />
    </PageStack>
  )
}

export default function RoomScanPage() {
  const { code } = useParams()
  const { t, i18n } = useTranslation()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [marking, setMarking] = useState(false)
  const autoMarked = useRef(false)

  const subjectOf = (lesson) => (i18n.language === 'kz' && lesson.subject_kz) || lesson.subject

  const mark = async () => {
    setMarking(true)
    try {
      const response = await markRoomAttendance(code)
      setResult({
        tone: 'success',
        title: t(response.status === 'already' ? 'scan.student.already' : 'scan.student.marked'),
        text: `${subjectOf(response.lesson)} · ${response.lesson.start_time}–${response.lesson.end_time} · ${response.lesson.teacher}`,
      })
      setData(await getRoomScan(code))
    } catch (err) {
      setResult({ tone: 'warning', title: t('scan.student.notMarked'), text: apiErrorText(err, t('scan.student.markError')) })
    } finally {
      setMarking(false)
    }
  }

  const load = () => getRoomScan(code)
    .then((scan) => {
      setData(scan)
      setError('')
      // Студент отмечается сразу при сканировании, если сейчас идёт занятие
      if (scan.mode === 'student' && !autoMarked.current) {
        autoMarked.current = true
        const already = scan.lessons.find((lesson) => lesson.attendance_open && lesson.marked)
        if (already) {
          setResult({ tone: 'success', title: t('scan.student.already'), text: `${subjectOf(already)} · ${already.start_time}–${already.end_time}` })
        } else if (scan.lessons.some((lesson) => lesson.attendance_open)) {
          mark()
        } else {
          setResult({ tone: 'warning', title: t('scan.student.noLessonNow'), text: t('scan.student.noLessonHint') })
        }
      }
    })
    .catch((err) => setError(apiErrorText(err, t('scan.loadError'))))

  useEffect(() => { autoMarked.current = false; setData(null); setResult(null); load() }, [code])

  if (error) {
    return <PageStack><Alert tone="danger" title={error} /></PageStack>
  }
  if (!data) return <LoadingBlock label={t('scan.loading')} />
  return data.mode === 'student'
    ? <StudentView data={data} result={result} onRetry={mark} retrying={marking} />
    : <StaffView data={data} onReload={load} />
}
