import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { apiErrorText, getMyAttendance } from '../services/api'
import { toDatetimeLocalUtcPlus5 } from '../utils/datetime'
import { Alert, Badge, Card, CardHeader, EmptyState, Icon, LoadingBlock, PageHeader, PageStack } from '../components/ui'
import { regionLocale } from '../utils/locale'

/** Студент: отметки посещаемости по QR-кодам аудиторий за последние 60 дней. */
export default function MyAttendancePage() {
  const { t, i18n } = useTranslation()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    getMyAttendance()
      .then(setData)
      .catch((err) => setError(apiErrorText(err, t('myAttendance.loadError'))))
  }, [])

  const dateLabel = (value) => new Date(`${value}T00:00:00`).toLocaleDateString(regionLocale(i18n.language), { weekday: 'short', day: 'numeric', month: 'long' })

  return (
    <PageStack>
      <PageHeader
        title={t('nav.myAttendance')}
        description={data?.student ? `${data.student.full_name} · ${data.student.group_name}` : t('myAttendance.description')}
      />

      <Alert tone="info" title={t('myAttendance.howTitle')}>{t('myAttendance.how')}</Alert>

      {error && <Alert tone="danger">{error}</Alert>}
      {!data && !error && <LoadingBlock label={t('scan.loading')} />}
      {data && (
        <Card>
          <CardHeader title={t('myAttendance.listTitle')} description={t('myAttendance.count', { count: data.items.filter((item) => !item.removed).length })} />
          {data.items.length === 0 ? (
            <EmptyState icon="check-circle" title={t('myAttendance.empty')} description={t('myAttendance.emptyHint')} compact />
          ) : (
            <ul className="divide-y divide-line">
              {data.items.map((item) => (
                <li key={item.id} className="flex min-w-0 flex-wrap items-start justify-between gap-2 px-4 py-3 sm:px-5">
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="break-words font-medium text-fg">{(i18n.language === 'kz' && item.subject_kz) || item.subject || '—'}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-fg-muted">
                      <span>{dateLabel(item.date)}, <span className="tabular">{item.start_time}–{item.end_time}</span></span>
                      {item.room && <span><Icon name="pin" size={14} className="mr-1 inline" />{[item.room, item.building].filter(Boolean).join(' · ')}</span>}
                    </p>
                    {item.teacher && <p className="text-xs text-fg-subtle">{item.teacher}</p>}
                  </div>
                  {item.removed
                    ? <Badge tone="neutral">{t('myAttendance.removed')}</Badge>
                    : <Badge tone="success" dot>{t('myAttendance.markedAt', { time: toDatetimeLocalUtcPlus5(item.marked_at).slice(11, 16) })}</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </PageStack>
  )
}
