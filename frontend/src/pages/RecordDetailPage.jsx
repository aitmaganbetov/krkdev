import { useEffect, useState } from 'react'
import { Link, useParams, useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  getRecord, deleteRecord, submitRecord, sendRecordToRework, acceptRecord
} from '../services/api'
import { useAuth } from '../context/AuthContext'
import StatusBadge from '../components/StatusBadge'
import {
  Alert, Button, Card, CardBody, CardHeader, DescriptionList, EmptyState, LoadingBlock, PageHeader, PageStack,
  StatCard, cn, useUI,
} from '../components/ui'
import { isSameIdentity } from '../utils/identity'
import { formatDateTimeUtcPlus5 } from '../utils/datetime'
import { applicableSections, findTemplate, localized, scoreTone, templateMaxScore, useRatingTemplates } from '../utils/ratingTemplate'
import { formatLabel, lessonTypeLabel, templateLang } from '../locales/recordForm'

// Цвет полосы и значения оценки относительно шкалы (пороги — scoreTone)
const BAR_COLOR = { good: 'bg-success-solid', mid: 'bg-warning-solid', bad: 'bg-danger-solid', none: 'bg-line-strong' }
const VALUE_COLOR = { good: 'text-success', mid: 'text-warning', bad: 'text-danger', none: 'text-fg-subtle' }

// Критерий оценки: полный текст переносится (не обрезается), справа — полоса и балл;
// на узком экране полоса уходит под текст.
function RatingRow({ ratingKey, label, value, scaleMax = 10 }) {
  const pct = Math.max(0, Math.min(100, (value / scaleMax) * 100))
  const tone = scoreTone(value, scaleMax)
  return (
    <li className="flex min-w-0 flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:gap-6 print:break-inside-avoid">
      <div className="flex min-w-0 flex-1 gap-3">
        <span className="mt-0.5 w-9 shrink-0 text-xs font-medium tabular text-fg-subtle">{ratingKey}</span>
        <p className="min-w-0 flex-1 text-sm text-fg">{label}</p>
      </div>
      <div className="flex min-w-0 items-center gap-3 pl-12 sm:w-44 sm:shrink-0 sm:pl-0 sm:pt-0.5">
        <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-hover" aria-hidden="true">
          <div className={cn('h-full rounded-full', BAR_COLOR[tone])} style={{ width: `${pct}%` }} />
        </div>
        <span className={cn('w-8 shrink-0 text-right text-sm font-semibold tabular', VALUE_COLOR[tone])}>{value}</span>
      </div>
    </li>
  )
}

export default function RecordDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { t, i18n } = useTranslation()
  const { toast, confirm } = useUI()
  const { templates } = useRatingTemplates()
  const [record, setRecord] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState('')
  const [actionsLoading, setActionsLoading] = useState(false)
  // Какое действие выполняется — для индикатора на нужной кнопке
  const [pendingAction, setPendingAction] = useState('')
  const { role, currentUser } = useAuth()
  const isOwner = isSameIdentity(record?.submitted_by, currentUser)

  const canEdit = ((role === 'admin' || role === 'inspector') && record?.status !== 'accepted')
    || (role === 'staff' && ['draft', 'rework'].includes(record?.status) && isOwner)
  const canDelete = (role === 'admin' || role === 'inspector') && record?.status !== 'accepted'
  const canSubmit = role === 'staff' && ['draft', 'rework'].includes(record?.status) && isOwner
  const canSendToRework = (role === 'admin' || role === 'inspector') && record?.status === 'submitted'
  const canAccept = (role === 'admin' || role === 'inspector') && ['submitted', 'rework'].includes(record?.status)

  useEffect(() => {
    getRecord(id)
      .then(setRecord)
      .catch(() => setError(t('record.notFound')))
      .finally(() => setLoading(false))
  }, [id])

  const startAction = (name) => { setActionsLoading(true); setPendingAction(name) }
  const stopAction = () => { setActionsLoading(false); setPendingAction('') }

  const handleDelete = async () => {
    const ok = await confirm({ message: t('record.deleteConfirm'), confirmLabel: t('record.deleteBtn'), tone: 'danger' })
    if (!ok) return
    startAction('delete')
    try {
      await deleteRecord(id)
      toast.success(t('recordForm.detail.deleted'))
      navigate('/records')
    } catch (err) {
      setError(err.response?.data?.detail ?? t('recordForm.detail.deleteError'))
      stopAction()
    }
  }

  const handleSubmit = async () => {
    const ok = await confirm({ message: t('record.submitConfirm'), confirmLabel: t('record.submit') })
    if (!ok) return
    startAction('submit')
    try {
      const updated = await submitRecord(id)
      setRecord(updated)
      stopAction()
      toast.success(t('recordForm.detail.submitted'))
    } catch (err) {
      setError(err.response?.data?.detail ?? t('recordForm.detail.submitError'))
      stopAction()
    }
  }

  const handleSendToRework = async () => {
    const ok = await confirm({ message: t('record.reworkConfirm'), confirmLabel: t('record.toRework') })
    if (!ok) return
    startAction('rework')
    try {
      const updated = await sendRecordToRework(id)
      setRecord(updated)
      stopAction()
      toast.success(t('recordForm.detail.reworked'))
    } catch (err) {
      setError(err.response?.data?.detail ?? t('recordForm.detail.reworkError'))
      stopAction()
    }
  }

  const handleAccept = async () => {
    const ok = await confirm({ message: t('record.acceptConfirm'), confirmLabel: t('record.accept') })
    if (!ok) return
    startAction('accept')
    try {
      const updated = await acceptRecord(id)
      setRecord(updated)
      stopAction()
      toast.success(t('recordForm.detail.accepted'))
    } catch (err) {
      setError(err.response?.data?.detail ?? t('recordForm.detail.acceptError'))
      stopAction()
    }
  }

  const handlePrint = () => {
    window.print()
  }

  // «Назад» возвращает на предыдущую страницу; если запись открыта по прямой ссылке — к списку
  const handleBack = (event) => {
    if (window.history.state?.idx > 0) {
      event.preventDefault()
      navigate(-1)
    }
  }

  // Ответ сервера может прийти не строкой (ошибки валидации) — тогда общий текст
  const errorText = typeof error === 'string' ? error : t('common.error')

  if (loading) return <LoadingBlock label={t('ui.loading')} />
  if (!record) {
    return (
      <Card>
        <EmptyState
          icon="file-text"
          title={errorText || t('record.notFound')}
          action={<Button as={Link} to="/records" variant="secondary" icon="arrow-left">{t('recordForm.backToList')}</Button>}
        />
      </Card>
    )
  }

  const { ratings = {} } = record
  const lang = templateLang(i18n.language)
  const template = findTemplate(templates, record.academic_year)
  const maxScore = templateMaxScore(template)
  const scoreShare = maxScore ? record.score / maxScore : 0
  const totalTone = scoreShare >= 0.7 ? 'success' : scoreShare >= 0.5 ? 'warning' : 'danger'
  // Записи без справочника (не должно быть) показываем по ключам как есть
  const ratingSections = template
    ? applicableSections(template, record.lesson_type)
    : [{ code: '', title: '', questions: Object.keys(ratings).sort().map((code) => ({ code, text: t(`ratings.${code}`) })) }]
  const hasRatings = ratingSections.some((section) => (section.questions || []).length > 0)

  const infoGroups = [
    {
      title: t('recordForm.sections.lesson'),
      items: [
        { label: t('record.date'), value: formatDateTimeUtcPlus5(record.datetime) },
        { label: t('recordForm.fields.lessonType'), value: record.lesson_type ? lessonTypeLabel(t, record.lesson_type) : '—' },
        { label: t('record.format'), value: record.format ? formatLabel(t, record.format) : '—' },
        { label: t('record.academicYear'), value: record.academic_year || '—' },
        record.topic && { label: t('record.topic'), value: record.topic, full: true },
      ],
    },
    {
      title: t('recordForm.sections.groupRoom'),
      items: [
        { label: t('record.faculty'), value: record.faculty || '—' },
        { label: t('record.op'), value: record.op || '—' },
        { label: t('record.group'), value: record.group_name || '—' },
        { label: t('record.room'), value: record.room || '—' },
      ],
    },
    {
      title: t('recordForm.sections.review'),
      items: [
        { label: t('record.submittedBy'), value: record.submitted_by_display || record.submitted_by || '—' },
        { label: t('record.reviewedBy'), value: record.reviewed_by_display || record.reviewed_by || '—' },
      ],
    },
  ]

  return (
    <PageStack className="print:gap-4">
      {location.state?.notice && (
        <Alert tone="success" className="print:hidden">{location.state.notice}</Alert>
      )}

      {error && (
        <Alert tone="danger" onClose={() => setError('')} closeLabel={t('ui.close')} className="print:hidden">
          {errorText}
        </Alert>
      )}

      <PageHeader
        title={record.subject}
        back={{ to: '/records', label: t('recordForm.back'), onClick: handleBack }}
        className="print:[&_a]:hidden"
        actions={
          <div className="flex min-w-0 flex-wrap items-center gap-2 print:hidden">
            <Button variant="secondary" icon="printer" onClick={handlePrint}>{t('record.print')}</Button>
            {canEdit && (
              <Button as={Link} to={`/records/${id}/edit`} variant="secondary" icon="edit">{t('record.edit')}</Button>
            )}
            {canSubmit && (
              <Button icon="send" onClick={handleSubmit} disabled={actionsLoading} loading={pendingAction === 'submit'}>
                {t('record.submit')}
              </Button>
            )}
            {canSendToRework && (
              <Button variant="secondary" icon="rotate-ccw" onClick={handleSendToRework} disabled={actionsLoading}
                loading={pendingAction === 'rework'}>
                {t('record.toRework')}
              </Button>
            )}
            {canAccept && (
              <Button variant="success" icon="check" onClick={handleAccept} disabled={actionsLoading}
                loading={pendingAction === 'accept'}>
                {t('record.accept')}
              </Button>
            )}
            {canDelete && (
              <Button variant="danger-ghost" icon="trash" onClick={handleDelete} disabled={actionsLoading}
                loading={pendingAction === 'delete'}>
                {t('record.deleteBtn')}
              </Button>
            )}
          </div>
        }
      >
        <p className="mt-1 text-base text-fg-muted">{record.teacher}</p>
        <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <StatusBadge status={record.status} />
          <span className="text-sm text-fg-subtle tabular">{t('recordForm.detail.recordNo', { id })}</span>
        </div>
      </PageHeader>

      <div className="grid min-w-0 gap-6 lg:grid-cols-3 print:block">
        {/* Итоги: общий балл и посещаемость */}
        <aside className="grid min-w-0 grid-cols-2 gap-4 self-start lg:col-start-3 lg:row-start-1 lg:grid-cols-1 print:mb-4">
          <StatCard
            label={t('record.totalScore')}
            tone={totalTone}
            value={(
              <>
                {typeof record.score === 'number' ? record.score.toFixed(1) : '—'}
                <span className="text-base font-medium text-fg-subtle"> / {maxScore}</span>
              </>
            )}
          />
          <StatCard
            label={t('record.attendance')}
            tone="primary"
            value={typeof record.attendance === 'number' ? `${record.attendance.toFixed(0)}%` : '—'}
            hint={t('recordForm.detail.studentsHint', { fact: record.students_fact, plan: record.students_plan })}
          />
        </aside>

        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2 lg:col-start-1 lg:row-start-1 print:gap-4">
          {/* Сведения о занятии */}
          <Card>
            <CardHeader title={t('record.info')} />
            <div className="flex min-w-0 flex-col divide-y divide-line">
              {infoGroups.map((group) => (
                <section key={group.title} className="min-w-0 p-4 sm:p-5 print:break-inside-avoid">
                  <h3 className="mb-3 text-sm font-semibold text-fg">{group.title}</h3>
                  <DescriptionList items={group.items} />
                </section>
              ))}
            </div>
          </Card>

          {record.comment && (
            <Card className="print:break-inside-avoid">
              <CardHeader title={t('record.comment')} />
              <CardBody>
                <p className="whitespace-pre-line text-sm text-fg">{record.comment}</p>
              </CardBody>
            </Card>
          )}

          {/* Оценки по критериям, сгруппированные по разделам справочника */}
          <Card>
            <CardHeader title={t('record.ratings')} />
            <CardBody className="flex flex-col gap-6">
              {!hasRatings && <EmptyState icon="star" title={t('recordForm.detail.noRatings')} compact />}
              {ratingSections.map((section, sectionIndex) => (
                (section.questions || []).length > 0 && (
                  <section key={`${section.code}-${sectionIndex}`} className="min-w-0">
                    {section.title && (
                      <h3 className="mb-3 text-sm font-semibold text-fg">{localized(section.title, lang)}</h3>
                    )}
                    <ul className="flex min-w-0 flex-col divide-y divide-line">
                      {section.questions.map((question) => (
                        <RatingRow
                          key={question.code}
                          ratingKey={question.code}
                          label={localized(question.text, lang)}
                          value={ratings[question.code] ?? 0}
                          scaleMax={template?.scale_max ?? 10}
                        />
                      ))}
                    </ul>
                  </section>
                )
              ))}
            </CardBody>
          </Card>
        </div>
      </div>
    </PageStack>
  )
}
