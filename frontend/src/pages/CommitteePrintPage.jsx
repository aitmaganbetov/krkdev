import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { apiErrorText, getCommitteeOrder, getCommitteePdf } from '../services/api'
import { Alert, Button, Card, EmptyState, Field, LoadingBlock, PageHeader, PageStack, Select } from '../components/ui'
import PdfViewer from '../components/PdfViewer'

// Приказ о составе комитета: проект — на утверждение (подпись от руки), подписанный ЭЦП — электронный документ
// с QR-кодами подписанта и проверки. Документ — PDF с сервера: на каждый язык до двух страниц.
export default function CommitteePrintPage() {
  const { t } = useTranslation()
  const { id } = useParams()
  const [order, setOrder] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [languages, setLanguages] = useState('ru')
  const [ready, setReady] = useState(false)
  const viewer = useRef(null)

  useEffect(() => {
    getCommitteeOrder(id)
      .then(setOrder)
      .catch((err) => setError(apiErrorText(err, t('committee.print.loadError'))))
      .finally(() => setLoading(false))
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <LoadingBlock label={t('ui.loading')} />
  const hasMembers = Boolean(order?.members.length)
  const signed = order?.status === 'signed'

  return (
    <PageStack>
      <PageHeader
        title={signed ? t('committee.print.signedTitle') : t('committee.print.title')}
        description={signed ? t('committee.print.signedDescription') : t('committee.print.description')}
        back={{ to: '/committee', label: t('committee.print.back') }}
        actions={(
          <>
            <Button variant="secondary" icon="download" disabled={!ready} onClick={() => viewer.current?.download()}>{t('committee.print.downloadPdf')}</Button>
            <Button icon="printer" disabled={!ready} onClick={() => viewer.current?.print()}>{t('committee.print.print')}</Button>
          </>
        )}
      />
      {error && <Alert tone="danger">{error}</Alert>}
      {hasMembers && (
        <Field label={t('committee.print.languages')} className="max-w-xs">
          <Select value={languages} onChange={(e) => setLanguages(e.target.value)} options={[
            { value: 'ru', label: t('committee.print.ruOnly') },
            { value: 'kz', label: t('committee.print.kzOnly') },
            { value: 'ru,kz', label: t('committee.print.both') },
          ]}
          />
        </Field>
      )}

      {order && !hasMembers && (
        <Card>
          <EmptyState icon="users" title={t('committee.print.empty')}
            action={<Button as={Link} to="/committee" variant="secondary" size="sm" icon="arrow-left">{t('committee.print.back')}</Button>} />
        </Card>
      )}

      {hasMembers && (
        <PdfViewer ref={viewer} source={`${order.id}:${languages}`} load={() => getCommitteePdf(order.id, { languages })} onReady={setReady} />
      )}
    </PageStack>
  )
}
