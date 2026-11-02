import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { addViolationResponse, apiErrorText, getMyViolations } from '../services/api'
import { Alert, Badge, Button, Card, DataTable, EmptyState, Field, Modal, PageHeader, PageStack, RadioGroup, Textarea, useUI } from '../components/ui'
import { formatDateUtcPlus5 } from '../utils/datetime'
import { violationTypeLabel } from '../utils/violationTypes'
import { ResponsesList, deviationLabels } from '../components/monitoring/VideoChecklist'
import useEcpSign from '../hooks/useEcpSign'

const STATUS_TONE = { confirmed: 'danger', compliant: 'success', justified: 'success', pending: 'warning', rejected: 'neutral' }
const RESPONSE_FILE_TYPES = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png'

// SHA-256 текста (UTF-8) и следом байтов файла — как на сервере (POST /violations/{id}/responses)
async function responseDigest(text, file) {
  const textBytes = new TextEncoder().encode(text)
  const fileBytes = file ? new Uint8Array(await file.arrayBuffer()) : new Uint8Array()
  const all = new Uint8Array(textBytes.length + fileBytes.length)
  all.set(textBytes)
  all.set(fileBytes, textBytes.length)
  const hash = await crypto.subtle.digest('SHA-256', all)
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Нарушения у текущего пользователя как у преподавателя (GET /violations/my): подписанные ЭЦП и снятые по пояснению.
 *  К подписанному нарушению прикладывается объяснительная или оправдательная справка — с ЭЦП в системе или сканом. */
export default function MyViolationsPage() {
  const { t } = useTranslation()
  const { toast } = useUI()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  // Окно пояснения: нарушение, вид документа, способ (ЭЦП или скан), текст, файл
  const [target, setTarget] = useState(null)
  const [kind, setKind] = useState('explanation')
  const [method, setMethod] = useState('ecp')
  const [text, setText] = useState('')
  const [file, setFile] = useState(null)
  const [formError, setFormError] = useState('')
  const [sending, setSending] = useState(false)
  const { sign, signing, error: signError, setError: setSignError } = useEcpSign()

  const load = () => getMyViolations()
    .then(setItems)
    .catch(() => setError(true))
    .finally(() => setLoading(false))
  useEffect(() => { load() }, [])

  const openResponse = (item) => {
    setTarget(item)
    setKind('explanation')
    setMethod('ecp')
    setText('')
    setFile(null)
    setFormError('')
    setSignError('')
  }

  const formData = (cms) => {
    const form = new FormData()
    form.append('kind', kind)
    form.append('method', method)
    form.append('text', text.trim())
    if (cms) form.append('cms', cms)
    if (file) form.append('file', file)
    return form
  }

  const done = (saved) => {
    setItems((list) => list.map((item) => (item.id === saved.id ? saved : item)))
    setTarget(null)
  }

  const submit = async (event) => {
    event.preventDefault()
    if (method === 'scan' && !file) return setFormError(t('myViolations.response.needFile'))
    if (method === 'ecp' && !text.trim() && !file) return setFormError(t('myViolations.response.needText'))
    setFormError('')
    if (method === 'ecp') {
      // Подписывается отпечаток текста и файла; сервер сверяет его и ИИН сертификата с ИИН преподавателя
      const digest = await responseDigest(text.trim(), file)
      const saved = await sign(`krk-violation-response:${target.id}:${kind}:${digest}`,
        (cms) => addViolationResponse(target.id, formData(cms)), t('myViolations.response.sent'))
      if (saved) done(saved)
      return
    }
    setSending(true)
    try {
      done(await addViolationResponse(target.id, formData()))
      toast.success(t('myViolations.response.sent'))
    } catch (err) {
      setFormError(apiErrorText(err, t('myViolations.response.sendError')))
    } finally {
      setSending(false)
    }
  }

  const columns = [
    { key: 'date', header: t('myViolations.columns.date'), nowrap: true, cell: (v) => <span className="tabular">{formatDateUtcPlus5(v.violation_date)}</span> },
    {
      key: 'type',
      header: t('myViolations.columns.type'),
      mobile: 'title',
      minWidth: '12rem',
      cell: (v) => <span className="font-medium text-fg">{deviationLabels(t, v).join(' · ') || violationTypeLabel(t, v.violation_type)}</span>,
    },
    { key: 'subject', header: t('myViolations.columns.subject'), minWidth: '12rem', cell: (v) => v.subject || '—' },
    { key: 'room', header: t('myViolations.columns.room'), nowrap: true, cell: (v) => v.room || '—' },
    {
      key: 'status',
      header: t('myViolations.columns.status'),
      nowrap: true,
      cell: (v) => <Badge tone={STATUS_TONE[v.status] || 'neutral'} dot>{t(`myViolations.statuses.${v.status}`, { defaultValue: v.status })}</Badge>,
    },
    {
      key: 'response',
      header: t('myViolations.columns.response'),
      nowrap: true,
      cell: (v) => (
        <span className="inline-flex flex-wrap items-center gap-2">
          {v.responses?.length > 0 && <Badge tone="info">{t('myViolations.response.count', { count: v.responses.length })}</Badge>}
          {v.status === 'confirmed' && (
            <Button variant="secondary" size="sm" icon="upload" onClick={() => openResponse(v)}>{t('myViolations.response.open')}</Button>
          )}
        </span>
      ),
    },
    {
      key: 'act',
      header: t('myViolations.columns.act'),
      align: 'right',
      nowrap: true,
      cell: (v) => (v.act_url ? (
        <Button as="a" href={v.act_url} target="_blank" rel="noopener" variant="secondary" size="sm" icon="file-text">
          {v.checklist ? t('checklist.openForm') : t('myViolations.openAct', { id: v.id })}
        </Button>
      ) : <span className="text-sm text-fg-subtle">{t('myViolations.noAct')}</span>),
    },
  ]

  const busy = sending || signing
  return (
    <PageStack>
      <PageHeader title={t('myViolations.title')} description={t('myViolations.description')} />
      {error ? (
        <Alert tone="danger">{t('myViolations.loadError')}</Alert>
      ) : (
        <Card className="overflow-hidden">
          {!loading && items.length > 0 && (
            <div className="border-b border-line px-4 py-3 text-sm text-fg-muted sm:px-5">{t('myViolations.count', { count: items.length })}</div>
          )}
          <DataTable
            columns={columns}
            rows={items}
            loading={loading}
            skeletonRows={4}
            caption={t('myViolations.title')}
            empty={<EmptyState icon="check-circle" title={t('myViolations.emptyTitle')} description={t('myViolations.emptyHint')} />}
          />
        </Card>
      )}

      <Modal
        open={!!target}
        onClose={() => setTarget(null)}
        size="lg"
        title={target ? t('myViolations.response.title', { id: target.id }) : ''}
        description={target ? `${formatDateUtcPlus5(target.violation_date)} · ${target.subject || ''}` : undefined}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setTarget(null)}>{t('ui.cancel')}</Button>
            <Button type="submit" form="violation-response-form" icon={method === 'ecp' ? 'key' : 'upload'} loading={busy}>
              {method === 'ecp' ? t('myViolations.response.submitEcp') : t('myViolations.response.submitScan')}
            </Button>
          </>
        )}
      >
        {target && (
          <form id="violation-response-form" onSubmit={submit} className="flex min-w-0 flex-col gap-5">
            {(formError || signError) && <Alert tone="danger">{formError || signError}</Alert>}
            <ResponsesList responses={target.responses} />
            <RadioGroup legend={t('myViolations.response.kind')} columns={2} value={kind} onChange={setKind}
              options={['explanation', 'certificate'].map((value) => ({ value, label: t(`checklist.responseKinds.${value}`) }))} />
            <RadioGroup legend={t('myViolations.response.method')} columns={2} value={method} onChange={setMethod}
              options={['ecp', 'scan'].map((value) => ({
                value, label: t(`myViolations.response.methods.${value}`), description: t(`myViolations.response.methodHints.${value}`),
              }))} />
            <Field label={t('myViolations.response.text')} required={method === 'ecp' && !file}>
              <Textarea rows={5} value={text} placeholder={t('myViolations.response.textPlaceholder')} onChange={(e) => setText(e.target.value)} />
            </Field>
            <Field label={t('myViolations.response.file')} hint={t('myViolations.response.fileHint')} required={method === 'scan'}>
              <input type="file" accept={RESPONSE_FILE_TYPES} onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="block w-full min-w-0 text-sm text-fg file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:py-2 file:text-sm file:font-medium file:text-fg hover:file:bg-surface-hover" />
            </Field>
          </form>
        )}
      </Modal>
    </PageStack>
  )
}
