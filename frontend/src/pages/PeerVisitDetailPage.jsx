import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  acceptPeerVisit, apiErrorText, deletePeerVisit, getPeerVisit, sendPeerVisitToRework, submitPeerVisit,
} from '../services/api'
import { useAuth } from '../context/AuthContext'
import StatusBadge from '../components/StatusBadge'
import {
  Alert, Badge, Button, Card, CardBody, CardHeader, DescriptionList, EmptyState, LoadingBlock, PageHeader, PageStack,
  StatCard, useUI,
} from '../components/ui'
import { isSameIdentity } from '../utils/identity'
import { formatDateTimeUtcPlus5 } from '../utils/datetime'
import { COMMENT_FIELDS, CRITERIA, LEVEL_TONE, PERSONAL_ROLES, overallLevel } from '../utils/peerVisit'
import { managesWorkspace } from '../utils/roles'

export default function PeerVisitDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useTranslation()
  const { toast, confirm } = useUI()
  const { role, currentUser } = useAuth()
  const [visit, setVisit] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pendingAction, setPendingAction] = useState('')

  useEffect(() => {
    getPeerVisit(id)
      .then(setVisit)
      .catch((err) => setError(apiErrorText(err, t('peerVisits.notFound'))))
      .finally(() => setLoading(false))
  }, [id])

  // Те же правила, что на сервере и у записей КРК
  const isOwner = isSameIdentity(visit?.submitted_by, currentUser)
  const isReviewer = managesWorkspace(role) || role === 'peer_inspector'
  // Деканат возвращает на доработку и принимает отзывы своего факультета, но не правит и не удаляет их
  const canReview = isReviewer || role === 'dean'
  const canEdit = (isReviewer && visit?.status !== 'accepted')
    || (PERSONAL_ROLES.includes(role) && isOwner && ['draft', 'rework'].includes(visit?.status))
  const canDelete = isReviewer && visit?.status !== 'accepted'
  const canSubmit = PERSONAL_ROLES.includes(role) && isOwner && ['draft', 'rework'].includes(visit?.status)
  const canSendToRework = canReview && visit?.status === 'submitted'
  const canAccept = canReview && ['submitted', 'rework'].includes(visit?.status)

  // Смена статуса: подтверждение → запрос → обновлённый отзыв и уведомление
  const runAction = async (name, request, labelKey) => {
    const ok = await confirm({ message: t(`peerVisits.confirm.${name}`), confirmLabel: t(`peerVisits.actions.${labelKey}`) })
    if (!ok) return
    setPendingAction(name)
    try {
      setVisit(await request(id))
      toast.success(t(`peerVisits.toast.${{ submit: 'submitted', rework: 'reworked', accept: 'accepted' }[name]}`))
    } catch (err) {
      setError(apiErrorText(err, t(`peerVisits.apiErrors.${name}`)))
    } finally {
      setPendingAction('')
    }
  }

  const handleDelete = async () => {
    const ok = await confirm({
      title: t('peerVisits.confirm.deleteTitle'),
      message: t('peerVisits.confirm.delete', { teacher: visit.teacher }),
      confirmLabel: t('peerVisits.actions.delete'),
      tone: 'danger',
    })
    if (!ok) return
    setPendingAction('delete')
    try {
      await deletePeerVisit(id)
      toast.success(t('peerVisits.toast.deleted'))
      navigate('/peer-visits')
    } catch (err) {
      setError(apiErrorText(err, t('peerVisits.apiErrors.delete')))
      setPendingAction('')
    }
  }

  // «Назад» возвращает на предыдущую страницу; если отзыв открыт по прямой ссылке — к списку
  const handleBack = (event) => {
    if (window.history.state?.idx > 0) {
      event.preventDefault()
      navigate(-1)
    }
  }

  if (loading) return <LoadingBlock label={t('ui.loading')} />
  if (!visit) {
    return (
      <Card>
        <EmptyState
          icon="file-text"
          title={error || t('peerVisits.notFound')}
          action={<Button as={Link} to="/peer-visits" variant="secondary" icon="arrow-left">{t('peerVisits.backToList')}</Button>}
        />
      </Card>
    )
  }

  const level = overallLevel(visit.score)
  const busy = Boolean(pendingAction)
  const label = (group, value) => t(`peerVisits.${group}.${value}`, { defaultValue: value })
  const lessonItems = [
    { label: t('peerVisits.fields.datetime'), value: formatDateTimeUtcPlus5(visit.datetime) },
    { label: t('peerVisits.fields.academicYear'), value: visit.academic_year },
    { label: t('peerVisits.fields.department'), value: visit.department },
    { label: t('peerVisits.fields.faculty'), value: label('faculties', visit.faculty) },
    { label: t('peerVisits.fields.educationLevel'), value: label('educationLevels', visit.education_level) },
    { label: t('peerVisits.fields.course'), value: visit.course },
    { label: t('peerVisits.fields.group'), value: visit.group_name },
    { label: t('peerVisits.fields.language'), value: label('languages', visit.language) },
    { label: t('peerVisits.fields.subject'), value: visit.subject },
    { label: t('peerVisits.fields.lessonType'), value: label('lessonTypes', visit.lesson_type) },
    { label: t('peerVisits.fields.topic'), value: visit.topic, full: true },
  ]
  const visitorItems = [
    { label: t('peerVisits.fields.visitorName'), value: visit.visitor_name },
    { label: t('peerVisits.fields.visitorPosition'), value: visit.visitor_position },
    { label: t('peerVisits.fields.visitorDegree'), value: visit.visitor_degree || '—' },
    { label: t('peerVisits.detail.submittedBy'), value: visit.submitted_by_display || visit.submitted_by || '—' },
    { label: t('peerVisits.detail.reviewedBy'), value: visit.reviewed_by_display || visit.reviewed_by || '—' },
  ]
  const comments = COMMENT_FIELDS.filter((name) => visit[name])

  const answerFor = (criterion) => {
    if (criterion.kind === 'syllabus') {
      return (
        <Badge tone={visit.syllabus_compliant ? 'success' : 'danger'}>
          {t(`peerVisits.syllabus.${visit.syllabus_compliant ? 'yes' : 'no'}`)}
        </Badge>
      )
    }
    if (criterion.kind === 'level') {
      const value = visit.ratings?.[criterion.code]
      if (!value) return <span className="text-sm text-fg-subtle">—</span>
      return <Badge tone={LEVEL_TONE[value] || 'neutral'}>{label('levels', value)}</Badge>
    }
    return <p className="whitespace-pre-line text-sm text-fg">{visit[criterion.field] || '—'}</p>
  }

  return (
    <PageStack className="print:gap-4">
      {location.state?.notice && <Alert tone="success" className="print:hidden">{location.state.notice}</Alert>}
      {error && (
        <Alert tone="danger" onClose={() => setError('')} closeLabel={t('ui.close')} className="print:hidden">{error}</Alert>
      )}

      {/* Шапка бланка — только при печати */}
      <div className="hidden text-center print:block">
        <p className="text-sm">{t('peerVisits.org')}</p>
        <p className="mt-2 text-base font-semibold uppercase">{t('peerVisits.formTitle')}</p>
      </div>

      <PageHeader
        title={visit.teacher}
        back={{ to: '/peer-visits', label: t('peerVisits.back'), onClick: handleBack }}
        className="print:[&_a]:hidden"
        actions={(
          <div className="flex min-w-0 flex-wrap items-center gap-2 print:hidden">
            <Button variant="secondary" icon="printer" onClick={() => window.print()}>{t('peerVisits.actions.print')}</Button>
            {canEdit && (
              <Button as={Link} to={`/peer-visits/${id}/edit`} variant="secondary" icon="edit">{t('peerVisits.actions.edit')}</Button>
            )}
            {canSubmit && (
              <Button icon="send" disabled={busy} loading={pendingAction === 'submit'}
                onClick={() => runAction('submit', submitPeerVisit, 'submit')}>
                {t('peerVisits.actions.submit')}
              </Button>
            )}
            {canSendToRework && (
              <Button variant="secondary" icon="rotate-ccw" disabled={busy} loading={pendingAction === 'rework'}
                onClick={() => runAction('rework', sendPeerVisitToRework, 'toRework')}>
                {t('peerVisits.actions.toRework')}
              </Button>
            )}
            {canAccept && (
              <Button variant="success" icon="check" disabled={busy} loading={pendingAction === 'accept'}
                onClick={() => runAction('accept', acceptPeerVisit, 'accept')}>
                {t('peerVisits.actions.accept')}
              </Button>
            )}
            {canDelete && (
              <Button variant="danger-ghost" icon="trash" disabled={busy} loading={pendingAction === 'delete'} onClick={handleDelete}>
                {t('peerVisits.actions.delete')}
              </Button>
            )}
          </div>
        )}
      >
        <p className="mt-1 text-base text-fg-muted">{visit.subject}</p>
        <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <span className="print:hidden"><StatusBadge status={visit.status} /></span>
          <span className="text-sm text-fg-subtle tabular">{t('peerVisits.detail.no', { id })}</span>
          {visit.schedule_id && <Badge tone="info" icon="calendar">{t('peerVisits.fromScheduleShort')}</Badge>}
          {visit.is_problem && (
            <Badge tone="danger" icon="alert" title={t('peerVisits.summary.problemHint')}>{t('peerVisits.summary.problem')}</Badge>
          )}
        </div>
      </PageHeader>

      <div className="grid min-w-0 gap-6 lg:grid-cols-3 print:block">
        <aside className="grid min-w-0 grid-cols-2 gap-4 self-start lg:col-start-3 lg:row-start-1 lg:grid-cols-1 print:mb-4">
          <StatCard
            label={t('peerVisits.summary.overall')}
            tone={level ? LEVEL_TONE[level] : 'neutral'}
            value={level ? t(`peerVisits.levelsShort.${level}`) : '—'}
            hint={level ? t('peerVisits.summary.score', { score: Number(visit.score).toFixed(2) }) : undefined}
          />
          <StatCard
            label={t('peerVisits.fields.attendance')}
            tone="primary"
            value={`${Number(visit.attendance || 0).toFixed(0)}%`}
            hint={t('peerVisits.summary.studentsHint', { fact: visit.students_fact, plan: visit.students_plan })}
          />
        </aside>

        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2 lg:col-start-1 lg:row-start-1 print:gap-4">
          <Card className="print:break-inside-avoid">
            <CardHeader title={t('peerVisits.sections.lesson')} />
            <CardBody><DescriptionList items={lessonItems} /></CardBody>
          </Card>

          <Card>
            <CardHeader title={t('peerVisits.sections.evaluation')} />
            <CardBody>
              <ol className="flex min-w-0 flex-col divide-y divide-line">
                {CRITERIA.map((criterion) => (
                  <li key={criterion.code}
                    className="flex min-w-0 flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:gap-6 print:break-inside-avoid">
                    <div className="flex min-w-0 flex-1 gap-3">
                      <span className="mt-0.5 w-6 shrink-0 text-xs font-medium tabular text-fg-subtle">{criterion.code}.</span>
                      <p className="min-w-0 flex-1 text-sm text-fg">{t(`peerVisits.criteria.${criterion.code}.title`)}</p>
                    </div>
                    <div className={criterion.kind === 'text' ? 'min-w-0 pl-9 sm:w-72 sm:shrink-0 sm:pl-0' : 'min-w-0 pl-9 sm:shrink-0 sm:pl-0'}>
                      {answerFor(criterion)}
                    </div>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>

          {comments.length > 0 && (
            <Card className="print:break-inside-avoid">
              <CardHeader title={t('peerVisits.sections.comments')} />
              <CardBody className="flex flex-col gap-4">
                {comments.map((name) => (
                  <div key={name} className="min-w-0">
                    <h3 className="text-xs font-medium text-fg-subtle">{t(`peerVisits.comments.${name}`)}</h3>
                    <p className="mt-1 whitespace-pre-line text-sm text-fg">{visit[name]}</p>
                  </div>
                ))}
              </CardBody>
            </Card>
          )}

          <Card className="print:break-inside-avoid">
            <CardHeader title={t('peerVisits.sections.visitor')} />
            <CardBody>
              <DescriptionList items={visitorItems} />
              <p className="mt-6 hidden text-sm print:block">{t('peerVisits.detail.signature')}: ______________________</p>
            </CardBody>
          </Card>
        </div>
      </div>
    </PageStack>
  )
}
