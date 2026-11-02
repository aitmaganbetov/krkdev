import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { apiErrorText } from '../services/api'
import { Alert, LoadingBlock } from './ui'

/**
 * Документ PDF с сервера (приказ комитета, график взаимопосещения): на экране, при печати и в скачанном файле —
 * один и тот же документ. load() → { blob, name }; source — ключ документа: при его смене PDF загружается заново.
 * ref.print() — печать из встроенного просмотра, ref.download() — сохранить файл.
 */
const PdfViewer = forwardRef(function PdfViewer({ load, source, onReady }, ref) {
  const { t } = useTranslation()
  const [pdf, setPdf] = useState(null)
  const [error, setError] = useState('')
  const frame = useRef(null)

  useEffect(() => {
    let url = ''
    let active = true
    setPdf(null)
    setError('')
    load()
      .then((file) => {
        if (!active) return
        url = URL.createObjectURL(file.blob)
        setPdf({ url, name: file.name })
      })
      .catch((err) => { if (active) setError(apiErrorText(err, t('committee.print.loadError'))) })
    return () => {
      active = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [source, t]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { onReady?.(Boolean(pdf)) }, [pdf, onReady])

  useImperativeHandle(ref, () => ({
    print: () => frame.current?.contentWindow?.print(),
    download: () => {
      if (!pdf) return
      const link = document.createElement('a')
      link.href = pdf.url
      link.download = pdf.name
      link.click()
    },
  }), [pdf])

  if (error) return <Alert tone="danger">{error}</Alert>
  if (!pdf) return <LoadingBlock label={t('ui.loading')} />
  return (
    <iframe
      ref={frame}
      src={pdf.url}
      title={pdf.name}
      className="h-[85vh] min-h-[32rem] w-full rounded-lg border border-line bg-surface-muted"
    />
  )
})

export default PdfViewer
