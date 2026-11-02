import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { apiErrorText, getScheduleLessons, syncScheduleFromPlatonus } from '../services/api'
import { useAuth } from '../context/AuthContext'
import { toDatetimeLocalUtcPlus5 } from '../utils/datetime'
import { LESSON_STATUS_TONE, lessonPlace, lessonStatus, nowHHMMUtcPlus5 } from '../utils/scheduleLesson'
import {
  Alert, Badge, Button, Card, CardHeader, DataTable, DescriptionList, EmptyState, Field, FilterBar, Input, Modal,
  PageHeader, PageStack, Pagination, SearchInput, Select, useUI,
} from '../components/ui'
import { isAdmin, roleAllowed } from '../utils/roles'
import { useVisibleInterval } from '../hooks/useVisibleInterval'
import { regionLocale } from '../utils/locale'

const PAGE_SIZE = 25
// Роли, которым доступны формы (как RoleGuard /records/new в App.jsx). Роль user оформляет отзыв
// о взаимопосещении только по строке своего плана (peer_visit_service), поэтому расписание ей не открыто.
const RECORD_ROLES = ['admin', 'inspector', 'staff', 'committee', 'dean']
const PEER_VISIT_ROLES = ['admin', 'peer_inspector', 'staff', 'committee', 'dean']

const todayUtcPlus5 = () => toDatetimeLocalUtcPlus5(new Date()).slice(0, 10)

export default function SchedulePage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { toast } = useUI()
  const { role } = useAuth()
  const locale = regionLocale(i18n.language)
  const kz = i18n.language === 'kz'

  const [date, setDate] = useState(todayUtcPlus5)
  const [search, setSearch] = useState('')
  const [roomQuery, setRoomQuery] = useState('')
  const [pair, setPair] = useState('')
  const [page, setPage] = useState(1)
  const [schedule, setSchedule] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [selected, setSelected] = useState(null)
  const [clock, setClock] = useState(nowHHMMUtcPlus5)
  const request = useRef(0)

  const load = (silent = false) => {
    // Ответ на устаревшую дату (её успели переключить) не должен перезаписать текущий
    const current = ++request.current
    if (!silent) setLoading(true)
    getScheduleLessons(date)
      .then((data) => {
        if (current !== request.current) return
        setSchedule(data && !Array.isArray(data) ? data : null)
        setError('')
      })
      .catch((err) => {
        if (current !== request.current) return
        if (!silent) setSchedule(null)
        setError(apiErrorText(err, t('monitoring.schedule.loadError')))
      })
      .finally(() => { if (current === request.current) setLoading(false) })
  }

  useEffect(() => { load() }, [date])
  useEffect(() => { setPair('') }, [date])

  // Сегодня статусы «идёт / впереди / завершено» пересчитываются по часам
  useEffect(() => {
    if (date === todayUtcPlus5()) setClock(nowHHMMUtcPlus5())
  }, [date])
  useVisibleInterval(() => setClock(nowHHMMUtcPlus5()), 30_000, { enabled: date === todayUtcPlus5() })

  const today = todayUtcPlus5()
  const isToday = date === today

  const lessons = useMemo(() => (schedule?.lessons || [])
    .map((lesson) => ({ ...lesson, status: lessonStatus(lesson, today, clock) })), [schedule, today, clock])

  const pairOptions = useMemo(() => {
    const seen = new Map()
    lessons.forEach((lesson) => {
      if (!seen.has(lesson.start_time)) seen.set(lesson.start_time, lesson)
    })
    return [...seen.values()].map((lesson) => ({
      value: lesson.start_time,
      label: lesson.pair_number
        ? t('schedulePage.pairOption', { n: lesson.pair_number, time: `${lesson.start_time}–${lesson.end_time}` })
        : `${lesson.start_time}–${lesson.end_time}`,
    }))
  }, [lessons, t])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    const roomText = roomQuery.trim().toLowerCase()
    return lessons.filter((lesson) => (
      (!pair || lesson.start_time === pair)
      && (!query || [lesson.teacher, lesson.subject, lesson.subject_kz, lesson.student_groups, lesson.study_group]
        .some((value) => String(value || '').toLowerCase().includes(query)))
      && (!roomText || lessonPlace(lesson).toLowerCase().includes(roomText))
    ))
  }, [lessons, search, roomQuery, pair])

  useEffect(() => setPage(1), [date, search, roomQuery, pair])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageLessons = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const syncSchedule = async () => {
    setSyncing(true)
    try {
      const result = await syncScheduleFromPlatonus()
      toast.success(t('monitoring.schedule.syncDone', { count: result.lessons }))
      load(true)
    } catch (err) {
      toast.error(apiErrorText(err, t('monitoring.schedule.syncError')))
    } finally {
      setSyncing(false)
    }
  }

  const subjectOf = (lesson) => (kz && lesson.subject_kz) || lesson.subject || '—'
  const typeOf = (lesson) => (kz && lesson.lesson_type_kz) || lesson.lesson_type
  const placeOf = (lesson) => lessonPlace(lesson) || (lesson.online ? t('monitoring.schedule.online') : t('monitoring.schedule.noRoom'))

  const openForm = (path) => {
    const lesson = selected
    setSelected(null)
    navigate(path, { state: { lesson } })
  }

  const columns = [
    {
      key: 'time',
      header: t('schedulePage.columns.time'),
      nowrap: true,
      cell: (lesson) => (
        <div className="flex flex-col items-start gap-1">
          <span className="tabular font-medium">{lesson.start_time}–{lesson.end_time}</span>
          {lesson.pair_number > 0 && <span className="text-xs text-fg-muted">{t('monitoring.schedule.pair', { n: lesson.pair_number })}</span>}
          {isToday && <Badge tone={LESSON_STATUS_TONE[lesson.status]} dot>{t(`monitoring.schedule.status.${lesson.status}`)}</Badge>}
        </div>
      ),
    },
    {
      key: 'subject',
      header: t('schedulePage.columns.subject'),
      mobile: 'title',
      minWidth: '14rem',
      cell: (lesson) => (
        <div className="min-w-0">
          <p className="break-words font-medium text-fg">{subjectOf(lesson)}</p>
          {typeOf(lesson) && <p className="mt-0.5 break-words text-xs text-fg-muted">{typeOf(lesson)}</p>}
        </div>
      ),
    },
    {
      key: 'teacher',
      header: t('schedulePage.columns.teacher'),
      minWidth: '12rem',
      cell: (lesson) => <span className="break-words">{lesson.teacher || t('monitoring.schedule.noTeacher')}</span>,
    },
    {
      key: 'groups',
      header: t('schedulePage.columns.groups'),
      minWidth: '10rem',
      cell: (lesson) => (
        <span className="break-words">
          {lesson.student_groups || lesson.study_group || '—'}
          {lesson.students_count > 0 && <span className="text-fg-muted"> · {t('monitoring.schedule.students', { count: lesson.students_count })}</span>}
        </span>
      ),
    },
    {
      key: 'room',
      header: t('schedulePage.columns.room'),
      minWidth: '8rem',
      cell: (lesson) => (lesson.online && !lesson.room
        ? <Badge tone="neutral" icon="globe">{t('monitoring.schedule.online')}</Badge>
        : <span className="break-words">{placeOf(lesson)}</span>),
    },
  ]

  const canRecord = roleAllowed(role, RECORD_ROLES)
  const canPeerVisit = roleAllowed(role, PEER_VISIT_ROLES)

  return (
    <PageStack>
      <PageHeader
        title={t('nav.schedule')}
        description={t('schedulePage.description')}
        actions={isAdmin(role) && (
          <Button variant="secondary" icon="refresh" loading={syncing} disabled={syncing} onClick={syncSchedule}>
            {syncing ? t('monitoring.schedule.syncing') : t('monitoring.schedule.sync')}
          </Button>
        )}
      />

      <FilterBar ariaLabel={t('schedulePage.filters')}>
        <Field label={t('schedulePage.date')}>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value || todayUtcPlus5())} />
        </Field>
        <Field label={t('schedulePage.searchLabel')}>
          <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('schedulePage.searchPlaceholder')} />
        </Field>
        <Field label={t('schedulePage.roomLabel')}>
          <SearchInput value={roomQuery} onChange={(e) => setRoomQuery(e.target.value)} placeholder={t('schedulePage.roomPlaceholder')} />
        </Field>
        <Field label={t('schedulePage.pairLabel')}>
          <Select value={pair} onChange={(e) => setPair(e.target.value)} placeholder={t('schedulePage.allPairs')} options={pairOptions} />
        </Field>
      </FilterBar>

      {error && (
        <Alert tone="danger" title={error}
          action={<Button variant="secondary" size="sm" icon="refresh" onClick={() => load()}>{t('ui.retry')}</Button>} />
      )}

      {!loading && schedule && !schedule.synced_at ? (
        <Card><EmptyState icon="calendar" title={t('monitoring.schedule.notSynced')} /></Card>
      ) : !loading && schedule && schedule.term == null ? (
        <Card><EmptyState icon="calendar" title={t('schedulePage.nothingFound')} description={t('monitoring.schedule.outOfTerm')} /></Card>
      ) : (
        <Card>
          <CardHeader
            title={new Date(`${date}T00:00:00`).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            description={schedule?.week
              ? `${t('monitoring.schedule.info', { week: schedule.week, term: schedule.term, year: schedule.study_year, next: schedule.study_year + 1 })} · ${t('monitoring.schedule.count', { count: filtered.length })}`
              : null}
          />
          <DataTable
            columns={columns}
            rows={pageLessons}
            loading={loading}
            onRowClick={setSelected}
            caption={t('schedulePage.listTitle')}
            empty={<EmptyState icon="search" title={t('schedulePage.nothingFound')} description={t('schedulePage.nothingFoundHint')} compact />}
          />
          {totalPages > 1 && (
            <div className="border-t border-line px-4 py-3 sm:px-5">
              <Pagination page={currentPage} pageCount={totalPages} onPageChange={setPage} total={filtered.length} pageSize={PAGE_SIZE} />
            </div>
          )}
        </Card>
      )}

      {/* Занятие: подробности и создание записи КРК / отзыва о взаимопосещении */}
      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        size="md"
        title={selected ? subjectOf(selected) : ''}
        description={selected ? (selected.teacher || t('monitoring.schedule.noTeacher')) : undefined}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setSelected(null)}>{t('schedulePage.details.close')}</Button>
            {canPeerVisit && (
              <Button variant={canRecord ? 'secondary' : 'primary'} icon="user-check" onClick={() => openForm('/peer-visits/new')}>
                {t('schedulePage.actions.peerVisit')}
              </Button>
            )}
            {canRecord && (
              <Button icon="records" onClick={() => openForm('/records/new')}>{t('schedulePage.actions.record')}</Button>
            )}
          </>
        )}
      >
        {selected && (
          <div className="flex min-w-0 flex-col gap-4">
            <DescriptionList items={[
              {
                label: t('schedulePage.details.time'),
                value: (
                  <span className="tabular">
                    {new Date(`${selected.date}T00:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'long' })}
                    {', '}{selected.start_time}–{selected.end_time}
                    {selected.pair_number > 0 && ` · ${t('monitoring.schedule.pair', { n: selected.pair_number })}`}
                  </span>
                ),
              },
              { label: t('schedulePage.details.room'), value: placeOf(selected) },
              { label: t('schedulePage.details.type'), value: typeOf(selected) || '—' },
              { label: t('schedulePage.details.course'), value: selected.course ? t('schedulePage.details.courseValue', { course: selected.course }) : '—' },
              {
                label: t('schedulePage.details.groups'),
                value: (
                  <>
                    {selected.student_groups || selected.study_group || '—'}
                    {selected.students_count > 0 && <span className="text-fg-muted"> · {t('monitoring.schedule.students', { count: selected.students_count })}</span>}
                  </>
                ),
                full: true,
              },
              selected.cafedra && { label: t('schedulePage.details.cafedra'), value: selected.cafedra, full: true },
            ]} />
            {(canRecord || canPeerVisit) && <Alert tone="info">{t('schedulePage.details.hint')}</Alert>}
          </div>
        )}
      </Modal>
    </PageStack>
  )
}
