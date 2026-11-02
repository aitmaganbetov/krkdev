import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { apiErrorText, getMySchedule } from '../services/api'
import { LESSON_STATUS_TONE, lessonPlace, lessonStatus, nowHHMMUtcPlus5 } from '../utils/scheduleLesson'
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Icon, LoadingBlock, PageHeader, PageStack, cn } from '../components/ui'
import { useVisibleInterval } from '../hooks/useVisibleInterval'
import { regionLocale } from '../utils/locale'

// Сдвиг даты YYYY-MM-DD на n дней (локальная полночь — без сдвига из-за часового пояса)
const addDays = (isoDate, days) => {
  const day = new Date(`${isoDate}T00:00:00`)
  day.setDate(day.getDate() + days)
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
}

// «понедельник, 19 октября» → «Понедельник, 19 октября» (CSS capitalize подняло бы и месяц)
const capitalizeFirst = (text) => text.charAt(0).toUpperCase() + text.slice(1)

/** Студент: своё расписание по неделям (потоки из Platonus) с отметками посещаемости. */
export default function MySchedulePage() {
  const { t, i18n } = useTranslation()
  const locale = regionLocale(i18n.language)
  const [anchor, setAnchor] = useState(null)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [clock, setClock] = useState(nowHHMMUtcPlus5)
  const request = useRef(0)

  useEffect(() => {
    // Ответ на неделю, которую уже пролистали, не должен перезаписать текущую
    const current = ++request.current
    setError('')
    getMySchedule(anchor || undefined)
      .then((result) => { if (current === request.current) setData(result) })
      .catch((err) => { if (current === request.current) setError(apiErrorText(err, t('mySchedule.loadError'))) })
  }, [anchor])

  useVisibleInterval(() => setClock(nowHHMMUtcPlus5()), 30_000)

  const subjectOf = (lesson) => (i18n.language === 'kz' && lesson.subject_kz) || lesson.subject
  const typeOf = (lesson) => (i18n.language === 'kz' && lesson.lesson_type_kz) || lesson.lesson_type
  const dateLabel = (iso, options) => new Date(`${iso}T00:00:00`).toLocaleDateString(locale, options)
  const weekRange = data?.week_start
    ? `${dateLabel(data.week_start, { day: 'numeric', month: 'long' })} — ${dateLabel(addDays(data.week_start, 6), { day: 'numeric', month: 'long' })}`
    : ''
  const isCurrentWeek = data && data.days.some((day) => day.date === data.today)
  const teachingWeek = data?.days.find((day) => day.week)?.week
  // Суббота и воскресенье без пар не показываются — у большинства групп занятий в эти дни нет
  const visibleDays = (data?.days || []).filter((day, index) => index < 5 || day.lessons.length > 0)
  const totalLessons = (data?.days || []).reduce((sum, day) => sum + day.lessons.length, 0)

  return (
    <PageStack>
      <PageHeader
        title={t('nav.mySchedule')}
        description={data?.student ? `${data.student.full_name} · ${data.student.group_name}` : t('mySchedule.description')}
      />

      {error && <Alert tone="danger">{error}</Alert>}
      {!data && !error && <LoadingBlock label={t('scan.loading')} />}
      {data && !data.student && <Alert tone="warning">{t('mySchedule.notFound')}</Alert>}

      {data?.student && (
        <>
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-base font-semibold text-fg">{weekRange}</p>
              <p className="text-sm text-fg-muted">
                {teachingWeek ? t('mySchedule.teachingWeek', { week: teachingWeek }) : t('mySchedule.noTerm')}
                {' · '}{t('mySchedule.lessonsCount', { count: totalLessons })}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" icon="chevron-left" iconOnly aria-label={t('mySchedule.prevWeek')}
                onClick={() => setAnchor(addDays(data.week_start, -7))} />
              {!isCurrentWeek && (
                <Button variant="secondary" size="sm" onClick={() => setAnchor(null)}>{t('mySchedule.currentWeek')}</Button>
              )}
              <Button variant="secondary" size="sm" icon="chevron-right" iconOnly aria-label={t('mySchedule.nextWeek')}
                onClick={() => setAnchor(addDays(data.week_start, 7))} />
            </div>
          </div>

          {visibleDays.map((day) => {
            const isToday = day.date === data.today
            return (
              <Card key={day.date} className={cn(isToday && 'border-primary/40')}>
                <CardHeader
                  title={capitalizeFirst(dateLabel(day.date, { weekday: 'long', day: 'numeric', month: 'long' }))}
                  actions={isToday ? <Badge tone="primary">{t('mySchedule.today')}</Badge> : null}
                />
                {day.lessons.length === 0 ? (
                  <p className="px-4 py-4 text-sm text-fg-subtle sm:px-5">{t('mySchedule.noLessons')}</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {day.lessons.map((lesson) => {
                      const status = lessonStatus({ ...lesson, date: day.date }, data.today, clock)
                      return (
                        <li key={`${lesson.lesson_id}-${day.date}`}
                          className={cn('flex min-w-0 gap-3 px-4 py-3 sm:px-5', isToday && status === 'now' && 'bg-success-subtle/40')}>
                          <div className="w-14 shrink-0 text-sm">
                            <p className="tabular font-semibold text-fg">{lesson.start_time}</p>
                            <p className="tabular text-fg-subtle">{lesson.end_time}</p>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="break-words font-medium text-fg">{subjectOf(lesson)}</p>
                            <p className="mt-0.5 break-words text-sm text-fg-muted">
                              {[typeOf(lesson), lesson.teacher].filter(Boolean).join(' · ')}
                            </p>
                            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                              <span className="inline-flex min-w-0 items-center gap-1 text-fg">
                                <Icon name={lesson.online ? 'globe' : 'pin'} size={14} className="shrink-0 text-fg-subtle" />
                                <span className="break-words">
                                  {lesson.online && !lesson.room ? t('monitoring.schedule.online') : lessonPlace(lesson) || t('monitoring.schedule.noRoom')}
                                </span>
                              </span>
                              {lesson.pair_number > 0 && <span className="text-fg-subtle">{t('monitoring.schedule.pair', { n: lesson.pair_number })}</span>}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            {isToday && <Badge tone={LESSON_STATUS_TONE[status]} dot>{t(`monitoring.schedule.status.${status}`)}</Badge>}
                            {lesson.attendance === 'marked' && <Badge tone="success" icon="check">{t('mySchedule.marked')}</Badge>}
                            {lesson.attendance === 'removed' && <Badge tone="neutral">{t('myAttendance.removed')}</Badge>}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </Card>
            )
          })}

          {totalLessons === 0 && (
            <Card><EmptyState icon="calendar" title={t('mySchedule.emptyWeek')} description={t('mySchedule.emptyWeekHint')} compact /></Card>
          )}
        </>
      )}
    </PageStack>
  )
}
