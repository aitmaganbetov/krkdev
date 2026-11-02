import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { apiErrorText, verifyDocument } from '../services/api'
import { Alert, Badge, Card, CardBody, CardHeader, DescriptionList, LoadingBlock } from '../components/ui'
import logo from '../assets/brand/kaztbu-logo.png'
import { formatSignedAt } from '../utils/committee'

// Проверка подлинности документа по QR-коду — открытая страница без входа в систему.
// Показывает реквизиты, подписанта и сертификат ЭЦП и сверяет содержимое с подписанным отпечатком.
export default function VerifyDocumentPage() {
  const { t, i18n } = useTranslation()
  const { token } = useParams()
  const [doc, setDoc] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    verifyDocument(token).then(setDoc).catch((err) => setError(apiErrorText(err, t('verify.notFound'))))
  }, [token, t])

  const title = doc && ((i18n.language === 'kz' && doc.title_kz) || doc.title_ru)
  const signature = doc?.signature || {}
  return (
    <main className="min-h-screen bg-canvas px-4 py-10">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <div className="flex items-center gap-4">
          <img src={logo} alt="" className="h-14 w-14" />
          <div>
            <p className="text-sm font-semibold text-fg">{t('verify.university')}</p>
            <p className="text-xs text-fg-subtle">{t('verify.system')}</p>
          </div>
        </div>
        {!doc && !error && <LoadingBlock label={t('ui.loading')} />}
        {error && <Alert tone="danger">{error}</Alert>}
        {doc?.kind === 'schedule' && (
          <>
            <Alert tone={doc.intact ? (doc.status === 'approved' ? 'success' : 'info') : 'danger'}>
              {!doc.intact ? t('verify.changed') : doc.status === 'approved' ? t('verify.valid') : t('verify.inProgress')}
            </Alert>
            <Card>
              <CardHeader title={doc.title} description={doc.subtitle}
                actions={doc.status === 'approved' ? <Badge tone="success" dot>{t('verify.approved')}</Badge> : undefined} />
              <CardBody>
                {/* Подписи по маршруту утверждения: кто, когда и каким сертификатом */}
                <ul className="flex flex-col gap-3">
                  {doc.signers.map((signer, index) => (
                    <li key={index} className="rounded-md border border-line px-3 py-2">
                      <p className="text-xs text-fg-subtle">{signer.label}</p>
                      <p className="text-sm font-medium text-fg">{signer.name}</p>
                      {signer.signed_at ? (
                        <p className="mt-1 text-xs text-fg-muted">
                          {t('verify.signedLine', { date: formatSignedAt(signer.signed_at), owner: signer.signature?.subject || '—', issuer: signer.signature?.issuer || '—' })}
                        </p>
                      ) : <Badge tone="neutral" className="mt-1">{t('verify.notSigned')}</Badge>}
                    </li>
                  ))}
                </ul>
                <p className="mt-4 break-all font-mono text-xs text-fg-subtle">{t('verify.hash')}: {doc.document_hash}</p>
              </CardBody>
            </Card>
            <p className="text-xs text-fg-subtle">{t('verify.note')}</p>
          </>
        )}
        {doc?.kind === 'checklist' && (
          <>
            <Alert tone={doc.intact ? 'success' : 'danger'}>{doc.intact ? t('verify.valid') : t('verify.changed')}</Alert>
            <Card>
              {/* Чек-лист видеомониторинга: преподаватель и итог наблюдения на открытой странице не раскрываются */}
              <CardHeader title={t('verify.checklistTitle', { number: doc.number })}
                description={t('verify.checklistDate', { date: (doc.observation_date || '').split('-').reverse().join('.') })} />
              <CardBody>
                <DescriptionList items={[
                  { label: t('verify.signedBy'), value: doc.signed_by || '—' },
                  { label: t('verify.signedAt'), value: `${formatSignedAt(doc.signed_at)} (UTC+5)` },
                  { label: t('verify.certificateOwner'), value: signature.subject || '—' },
                  { label: t('verify.certificateSerial'), value: <span className="break-all font-mono text-xs">{signature.certificate_serial || '—'}</span> },
                  { label: t('verify.issuer'), value: signature.issuer || '—' },
                  { label: t('verify.validity'), value: [signature.valid_from, signature.valid_to].filter(Boolean).join(' — ') || '—', full: true },
                  { label: t('verify.hash'), value: <span className="break-all font-mono text-xs">{doc.document_hash}</span>, full: true },
                ]}
                />
              </CardBody>
            </Card>
            <p className="text-xs text-fg-subtle">{t('verify.note')}</p>
          </>
        )}
        {doc && !['schedule', 'checklist'].includes(doc.kind) && (
          <>
            <Alert tone={doc.intact ? 'success' : 'danger'}>{doc.intact ? t('verify.valid') : t('verify.changed')}</Alert>
            <Card>
              <CardHeader
                title={title}
                description={t('verify.orderNumber', { number: doc.number, date: (doc.order_date || '').split('-').reverse().join('.') })}
                actions={doc.is_active ? <Badge tone="success" dot>{t('verify.active')}</Badge> : undefined}
              />
              <CardBody>
                <DescriptionList items={[
                  { label: t('verify.academicYear'), value: doc.academic_year },
                  { label: t('verify.signedBy'), value: [doc.signed_by, doc.signer_full_name && `(${doc.signer_full_name})`].filter(Boolean).join(' ') },
                  { label: t('verify.signedAt'), value: `${formatSignedAt(doc.signed_at)} (UTC+5)` },
                  { label: t('verify.certificateOwner'), value: signature.subject || '—' },
                  { label: t('verify.certificateSerial'), value: <span className="break-all font-mono text-xs">{signature.certificate_serial || '—'}</span> },
                  { label: t('verify.issuer'), value: signature.issuer || '—' },
                  { label: t('verify.validity'), value: [signature.valid_from, signature.valid_to].filter(Boolean).join(' — ') || '—', full: true },
                  { label: t('verify.hash'), value: <span className="break-all font-mono text-xs">{doc.document_hash}</span>, full: true },
                ]}
                />
              </CardBody>
            </Card>
            <p className="text-xs text-fg-subtle">{t('verify.note')}</p>
          </>
        )}
      </div>
    </main>
  )
}
