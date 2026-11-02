import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { apiErrorText } from '../services/api'
import { NcaLayerError, signText } from '../services/ncalayer'
import { useUI } from '../components/ui'

/**
 * Подпись в NCALayer и отправка на сервер; ошибки NCALayer — понятным текстом, закрытое окно — не ошибка.
 * sign(data, submit, successMessage): data — строка для подписи, submit(cms) — запрос на сервер;
 * successMessage — текст или функция от ответа. Возвращает ответ сервера или null (не подписано).
 */
export default function useEcpSign(onSigned) {
  const { t, i18n } = useTranslation()
  const { toast } = useUI()
  const [signing, setSigning] = useState(false)
  const [error, setError] = useState('')
  const sign = async (data, submit, successMessage) => {
    setSigning(true)
    setError('')
    try {
      const cms = await signText(data, { locale: i18n.language })
      const result = await submit(cms)
      onSigned?.(result)
      toast.success(typeof successMessage === 'function' ? successMessage(result) : successMessage)
      return result
    } catch (err) {
      if (err instanceof NcaLayerError) {
        if (err.code !== 'cancelled') setError(t(`signing.ncaErrors.${['unavailable', 'timeout'].includes(err.code) ? err.code : 'failed'}`))
      } else {
        setError(apiErrorText(err, t('signing.signError')))
      }
      return null
    } finally {
      setSigning(false)
    }
  }
  return { sign, signing, error, setError }
}
