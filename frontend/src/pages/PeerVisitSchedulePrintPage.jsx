import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  apiErrorText, getPeerVisitScheduleTutors, getScheduleApproval, getScheduleApprovalPdf, recallScheduleApproval,
  saveScheduleApproval, sendScheduleApproval,
} from '../services/api'
import { useAuth } from '../context/AuthContext'
import { Alert, Badge, Button, Card, CardBody, CardHeader, Combobox, Field, Input, LoadingBlock, PageHeader, PageStack, useUI } from '../components/ui'
import PdfViewer from '../components/PdfViewer'
import { ApprovalRoute } from './SigningPage'
import { isAdmin } from '../utils/roles'
import { formatSignedAt, tutorOptions } from '../utils/committee'

// График взаимопосещения на утверждение: подписанты — сотрудники Platonus (по умолчанию заведующие кафедрами и декан
// из справочника), маршрут подписания ЭЦП — заведующие кафедрами → согласующие (декан, УОП, МО) → утверждающий.
// Документ — PDF с сервера (services/schedule_pdf.py): проект — с линиями для подписи, подписанный — с QR-кодами.
const STATUS_TONE = { draft: 'warning', on_signing: 'info', approved: 'success' }
const STAGES = [1, 2, 3]
// У заведующих подпись в документе — «Заведующий кафедрой «…»» из графика; у остальных её можно изменить
const labelEditable = (role) => !role.startsWith('cafedra:')

export default function PeerVisitSchedulePrintPage() {
  const { t } = useTranslation()
  const { toast, confirm } = useUI()
  const [params] = useSearchParams()
  const { role, facultyId: deanFacultyId } = useAuth()
  const canEdit = isAdmin(role) || role === 'dean'
  // Деканат работает только со своим факультетом
  const facultyId = Number(role === 'dean' ? deanFacultyId : params.get('faculty_id')) || null
  const academicYear = params.get('academic_year') || ''
  const period = Number(params.get('period')) || 1

  const [approval, setApproval] = useState(null)
  const [form, setForm] = useState(null)
  const [tutors, setTutors] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [ready, setReady] = useState(false)
  const viewer = useRef(null)

  const apply = useCallback((data) => {
    setApproval(data)
    setForm({
      title: data.title,
      signers: data.signers.map((s) => ({ role: s.role, stage: s.stage, label: s.label, tutor_id: s.tutor_id, text: s.tutor_name || '' })),
    })
  }, [])

  useEffect(() => {
    if (!facultyId || !academicYear) return
    getScheduleApproval({ academic_year: academicYear, period, faculty_id: facultyId })
      .then(apply)
      .catch((err) => setError(apiErrorText(err, t('schedule.loadError'))))
  }, [facultyId, academicYear, period, apply, t])
  useEffect(() => {
    if (canEdit) getPeerVisitScheduleTutors({ faculty_id: facultyId || undefined }).then(setTutors).catch(() => {})
  }, [canEdit, facultyId])

  const options = useMemo(() => tutorOptions(tutors), [tutors])
  const byLabel = useMemo(() => new Map(options.map((option) => [option.label, option.value])), [options])
  const editable = canEdit && approval?.status === 'draft'

  const setSigner = (index, patch) => setForm((f) => ({ ...f, signers: f.signers.map((s, i) => (i === index ? { ...s, ...patch } : s)) }))
  // Пока список сотрудников загружается, сохранённые ФИО считаются выбранными
  const tutorIdOf = (signer) => {
    const text = signer.text.trim()
    if (!text) return null
    return byLabel.get(text) ?? (options.length ? undefined : signer.tutor_id)
  }
  const missing = form ? form.signers.filter((s) => tutorIdOf(s) === undefined).map((s) => s.role) : []

  const payload = () => ({
    academic_year: academicYear,
    period,
    faculty_id: facultyId,
    title: form.title,
    signers: form.signers.map((s) => ({ role: s.role, label: s.label, tutor_id: tutorIdOf(s) ?? null })),
  })

  const run = async (name, action, message) => {
    setBusy(name)
    setError('')
    try {
      apply(await action())
      if (message) toast.success(message)
    } catch (err) {
      setError(apiErrorText(err, t('scheduleApproval.actionError')))
    } finally {
      setBusy('')
    }
  }

  const handleSave = () => run('save', () => saveScheduleApproval(payload()), t('scheduleApproval.saved'))
  const handleSend = async () => {
    const ok = await confirm({ message: t('scheduleApproval.sendConfirm'), confirmLabel: t('scheduleApproval.send') })
    if (!ok) return
    // Перед отправкой сохраняются текущие подписанты
    run('send', async () => sendScheduleApproval((await saveScheduleApproval(payload())).id), t('scheduleApproval.sent'))
  }
  const handleRecall = async () => {
    const ok = await confirm({ message: t('scheduleApproval.recallConfirm'), confirmLabel: t('scheduleApproval.recall'), tone: 'danger' })
    if (ok) run('recall', () => recallScheduleApproval(approval.id), t('scheduleApproval.recalled'))
  }

  if (!facultyId) {
    return (
      <PageStack>
        <PageHeader title={t('schedule.print.title')} back={{ to: '/peer-visits/schedule', label: t('schedule.print.back') }} />
        <Alert tone="warning">{t('schedule.print.needFaculty')}</Alert>
      </PageStack>
    )
  }
  if (!approval && !error) return <LoadingBlock label={t('ui.loading')} />

  const signedCount = approval ? approval.signers.filter((s) => s.signed_at).length : 0
  return (
    <PageStack>
      <PageHeader
        title={t('schedule.print.title')}
        description={t('scheduleApproval.description')}
        back={{ to: '/peer-visits/schedule', label: t('schedule.print.back') }}
        actions={(
          <>
            <Button variant="secondary" icon="download" disabled={!ready} onClick={() => viewer.current?.download()}>{t('committee.print.downloadPdf')}</Button>
            <Button variant="secondary" icon="printer" disabled={!ready} onClick={() => viewer.current?.print()}>{t('schedule.print.print')}</Button>
          </>
        )}
      />
      {error && <Alert tone="danger" onClose={() => setError('')} closeLabel={t('ui.close')}>{error}</Alert>}
      {approval && !approval.rows_count && <Alert tone="warning">{t('schedule.print.empty')}</Alert>}

      {approval && form && (
        <Card>
          <CardHeader
            title={t('scheduleApproval.routeTitle')}
            description={approval.status === 'draft'
              ? t('scheduleApproval.draftHint')
              : t('scheduleApproval.progress', { signed: signedCount, total: approval.signers.length })}
            actions={(
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={STATUS_TONE[approval.status]} dot>{t(`scheduleApproval.statuses.${approval.status}`)}</Badge>
                {editable && (
                  <Button variant="secondary" size="sm" icon="check" loading={busy === 'save'} disabled={missing.length > 0} onClick={handleSave}>
                    {t('scheduleApproval.save')}
                  </Button>
                )}
                {editable && (
                  <Button size="sm" icon="send" loading={busy === 'send'} disabled={missing.length > 0 || !approval.rows_count} onClick={handleSend}>
                    {t('scheduleApproval.send')}
                  </Button>
                )}
                {canEdit && approval.status === 'on_signing' && (
                  <Button variant="danger-ghost" size="sm" icon="rotate-ccw" loading={busy === 'recall'} onClick={handleRecall}>{t('scheduleApproval.recall')}</Button>
                )}
              </div>
            )}
          />
          <CardBody>
            {approval.status === 'approved' && (
              <Alert tone="success" className="mb-4">{t('scheduleApproval.approvedHint', { date: formatSignedAt(approval.approved_at) })}</Alert>
            )}
            {editable ? (
              <div className="flex min-w-0 flex-col gap-6">
                <Field label={t('schedule.print.documentTitle')} className="max-w-xl">
                  <Input value={form.title} maxLength={255} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
                </Field>
                {STAGES.map((stage) => (
                  <div key={stage} className="min-w-0">
                    <p className="mb-3 text-sm font-semibold text-fg">{stage}. {t(`scheduleApproval.stages.${stage}`)}</p>
                    <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {form.signers.map((signer, index) => (signer.stage !== stage ? null : (
                        <div key={signer.role} className="flex min-w-0 flex-col gap-2 rounded-md border border-line p-3">
                          {labelEditable(signer.role) ? (
                            <Field label={t('scheduleApproval.signerLabel')}>
                              <Input size="sm" value={signer.label} maxLength={500} onChange={(e) => setSigner(index, { label: e.target.value })} />
                            </Field>
                          ) : <p className="text-xs font-medium text-fg-subtle">{signer.label}</p>}
                          <Field label={t('scheduleApproval.signerPerson')}
                            error={missing.includes(signer.role) ? t('committee.memberForm.tutorNotFound') : undefined}>
                            <Combobox value={signer.text} options={options} sheetTitle={signer.label}
                              placeholder={t('committee.memberForm.tutorPlaceholder')} onChange={(text) => setSigner(index, { text })} />
                          </Field>
                        </div>
                      )))}
                    </div>
                  </div>
                ))}
              </div>
            ) : <ApprovalRoute approval={approval} />}
          </CardBody>
        </Card>
      )}

      {/* PDF — по сохранённому состоянию: после сохранения, отправки и каждой подписи перезагружается */}
      {approval?.id && approval.rows_count > 0 && (
        <PdfViewer
          ref={viewer}
          source={`${approval.id}:${approval.status}:${signedCount}:${approval.title}:${approval.signers.map((s) => `${s.tutor_id}/${s.label}`).join('|')}`}
          load={() => getScheduleApprovalPdf(approval.id)}
          onReady={setReady}
        />
      )}
      {approval && !approval.id && approval.rows_count > 0 && <Alert tone="info">{t('scheduleApproval.saveForPreview')}</Alert>}
    </PageStack>
  )
}
