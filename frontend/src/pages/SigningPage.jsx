import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  apiErrorText, getCommitteePdf, getScheduleSigningDocument, getScheduleSigningPdf, getSigningDocument, getSigningList,
  signCommitteeOrder, signScheduleApproval,
} from '../services/api'
import useEcpSign from '../hooks/useEcpSign'
import { Alert, Badge, Button, Card, CardBody, CardHeader, DataTable, EmptyState, LoadingBlock, PageHeader, PageStack } from '../components/ui'
import PdfViewer from '../components/PdfViewer'
import { formatSignedAt } from '../utils/committee'

// Документы на подпись ЭЦП: приказы о составе комитета КРК и графики взаимопосещения, где текущий пользователь —
// подписант. Подпись — в NCALayer ключом НУЦ РК; сервер проверяет её (Kalkan + OCSP) и ИИН сертификата.

const SIGNER_TONE = { signed: 'success', current: 'warning', waiting: 'neutral' }

function SigningList() {
  const { t } = useTranslation()
  const [items, setItems] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    getSigningList().then(setItems).catch((err) => setError(apiErrorText(err, t('signing.loadError'))))
  }, [t])
  const columns = [
    { key: 'document', header: t('signing.document'), mobile: 'title', minWidth: '16rem', cell: (item) => (
      <div className="min-w-0">
        <Link to={item.kind === 'schedule' ? `/signing/schedule/${item.docId}` : `/signing/${item.docId}`}
          className="font-medium text-primary underline-offset-2 hover:underline">
          {item.title}
        </Link>
        {item.subtitle && <p className="text-xs text-fg-subtle">{item.subtitle}</p>}
      </div>
    ) },
    { key: 'sent', header: t('signing.sentAt'), nowrap: true, cell: (item) => <span className="tabular">{formatSignedAt(item.sent_at)}</span> },
  ]
  // У приказа и графика могут совпадать номера — ключ строки включает вид документа
  const rows = (items || []).map((item) => ({ ...item, docId: item.id, id: `${item.kind}-${item.id}` }))
  return (
    <PageStack>
      <PageHeader title={t('signing.title')} description={t('signing.description')} />
      {error && <Alert tone="danger">{error}</Alert>}
      <Card className="overflow-hidden">
        <DataTable columns={columns} rows={rows} loading={items === null && !error} caption={t('signing.title')}
          empty={<EmptyState icon="check-circle" title={t('signing.empty')} />} />
      </Card>
    </PageStack>
  )
}

function DocumentActions({ viewer, ready, canSign, signing, onSign }) {
  const { t } = useTranslation()
  return (
    <>
      <Button icon="download" variant="secondary" disabled={!ready} onClick={() => viewer.current?.download()}>{t('committee.print.downloadPdf')}</Button>
      <Button icon="printer" variant="secondary" disabled={!ready} onClick={() => viewer.current?.print()}>{t('committee.print.print')}</Button>
      {canSign && <Button icon="key" loading={signing} onClick={onSign}>{signing ? t('login.ecp.signing') : t('signing.sign')}</Button>}
    </>
  )
}

function CommitteeDocument({ id }) {
  const { t } = useTranslation()
  const [order, setOrder] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [ready, setReady] = useState(false)
  const viewer = useRef(null)
  const { sign, signing, error, setError } = useEcpSign(setOrder)

  const load = useCallback(() => {
    getSigningDocument(id).then(setOrder).catch((err) => setLoadError(apiErrorText(err, t('signing.loadError'))))
  }, [id, t])
  useEffect(() => { load() }, [load])

  if (!order && !loadError) return <LoadingBlock label={t('ui.loading')} />
  const signed = order?.status === 'signed'
  return (
    <PageStack>
      <PageHeader
        title={order ? t('signing.orderTitle', { number: order.number, year: order.academic_year }) : t('signing.title')}
        description={t('signing.documentHint')}
        back={{ to: '/signing', label: t('signing.back') }}
        actions={order && <DocumentActions viewer={viewer} ready={ready} canSign={Boolean(order.sign_data)} signing={signing}
          onSign={() => sign(order.sign_data, (cms) => signCommitteeOrder(order.id, cms), t('signing.signed'))} />}
      />
      {(loadError || error) && <Alert tone="danger" onClose={() => setError('')} closeLabel={t('ui.close')}>{loadError || error}</Alert>}
      {order && signed && <Alert tone="success">{t('signing.signedAt', { date: formatSignedAt(order.signed_at), signer: order.signed_by })}</Alert>}
      {order && !signed && !order.sign_data && <Alert tone="warning">{t('signing.notSent')}</Alert>}
      {order && !signed && order.sign_data && (
        <Card>
          <CardHeader title={t('signing.checkTitle')} description={t('signing.checkHint', { signer: order.signed_by, count: order.members_count })}
            actions={<Badge tone="warning" dot>{t('committee.order.onSigning')}</Badge>} />
        </Card>
      )}
      {/* После подписи документ перезагружается — уже с QR-кодами */}
      {order && <PdfViewer ref={viewer} source={`${order.id}:${order.status}`} load={() => getCommitteePdf(order.id, { signing: true })} onReady={setReady} />}
    </PageStack>
  )
}

/** Маршрут подписания графика: этапы и подписанты с отметками о подписи. */
export function ApprovalRoute({ approval }) {
  const { t } = useTranslation()
  return (
    <div className="grid min-w-0 gap-4 md:grid-cols-3">
      {[1, 2, 3].map((stage) => (
        <div key={stage} className="min-w-0">
          <p className="mb-2 text-xs font-semibold text-fg-subtle">{stage}. {t(`scheduleApproval.stages.${stage}`)}</p>
          <ul className="flex flex-col gap-2">
            {approval.signers.filter((signer) => signer.stage === stage).map((signer) => (
              <li key={signer.id ?? signer.role} className="min-w-0 rounded-md border border-line px-3 py-2">
                <p className="text-xs text-fg-subtle">{signer.label}</p>
                <p className="text-sm font-medium text-fg">{signer.tutor_name || signer.name || '—'}</p>
                <Badge tone={SIGNER_TONE[signer.state]} dot className="mt-1">
                  {signer.state === 'signed'
                    ? t('scheduleApproval.signedAt', { date: formatSignedAt(signer.signed_at) })
                    : t(`scheduleApproval.signerStates.${signer.state}`)}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function ScheduleDocument({ id }) {
  const { t } = useTranslation()
  const [approval, setApproval] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [ready, setReady] = useState(false)
  const viewer = useRef(null)
  const { sign, signing, error, setError } = useEcpSign(setApproval)

  useEffect(() => {
    getScheduleSigningDocument(id).then(setApproval).catch((err) => setLoadError(apiErrorText(err, t('signing.loadError'))))
  }, [id, t])

  if (!approval && !loadError) return <LoadingBlock label={t('ui.loading')} />
  const signedCount = approval ? approval.signers.filter((s) => s.signed_at).length : 0
  return (
    <PageStack>
      <PageHeader
        title={approval ? t('scheduleApproval.documentTitle', { title: approval.title }) : t('signing.title')}
        description={approval ? t('scheduleApproval.documentSubtitle', { year: approval.academic_year, period: approval.period }) : undefined}
        back={{ to: '/signing', label: t('signing.back') }}
        actions={approval && <DocumentActions viewer={viewer} ready={ready} canSign={Boolean(approval.sign_data)} signing={signing}
          onSign={() => sign(approval.sign_data, (cms) => signScheduleApproval(approval.id, cms), t('scheduleApproval.signed'))} />}
      />
      {(loadError || error) && <Alert tone="danger" onClose={() => setError('')} closeLabel={t('ui.close')}>{loadError || error}</Alert>}
      {approval && (
        <Card>
          <CardHeader
            title={t('scheduleApproval.routeTitle')}
            description={t('scheduleApproval.progress', { signed: signedCount, total: approval.signers.length })}
            actions={<Badge tone={approval.status === 'approved' ? 'success' : 'warning'} dot>{t(`scheduleApproval.statuses.${approval.status}`)}</Badge>}
          />
          <CardBody>
            {approval.sign_data && <Alert tone="info" className="mb-4">{t('scheduleApproval.yourTurn')}</Alert>}
            <ApprovalRoute approval={approval} />
          </CardBody>
        </Card>
      )}
      {/* После каждой подписи документ перезагружается — с новым QR-кодом */}
      {approval && (
        <PdfViewer ref={viewer} source={`${approval.id}:${signedCount}`} load={() => getScheduleSigningPdf(approval.id)} onReady={setReady} />
      )}
    </PageStack>
  )
}

export default function SigningPage({ kind }) {
  const { id } = useParams()
  if (!id) return <SigningList />
  return kind === 'schedule' ? <ScheduleDocument id={id} /> : <CommitteeDocument id={id} />
}
