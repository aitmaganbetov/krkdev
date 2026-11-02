// NCALayer (НУЦ РК) — приложение на компьютере пользователя, слушает wss://127.0.0.1:13579.
// Модуль kz.gov.pki.knca.basics: пользователь выбирает носитель и ключ в окне NCALayer, получаем CMS.
const NCALAYER_URL = 'wss://127.0.0.1:13579/'

export class NcaLayerError extends Error {
  // code: unavailable — NCALayer не запущен; cancelled — окно закрыто; failed — ошибка NCALayer; timeout
  constructor(code, message) {
    super(message || code)
    this.code = code
  }
}

const toBase64 = (text) => btoa(String.fromCharCode(...new TextEncoder().encode(text)))

// Подписывает текст присоединённой CMS (данные внутри подписи), без метки времени
export function signText(text, { locale = 'ru', timeoutMs = 5 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    let socket
    try {
      socket = new WebSocket(NCALAYER_URL)
    } catch {
      reject(new NcaLayerError('unavailable'))
      return
    }
    let opened = false
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { socket.close() } catch { /* уже закрыт */ }
      callback(value)
    }
    // Ждём, пока пользователь выберет ключ и введёт пароль
    const timer = setTimeout(() => finish(reject, new NcaLayerError('timeout')), timeoutMs)

    socket.onopen = () => {
      opened = true
      socket.send(JSON.stringify({
        module: 'kz.gov.pki.knca.basics',
        method: 'sign',
        args: {
          allowedStorages: null,
          format: 'cms',
          data: toBase64(text),
          signingParams: { decode: true, encapsulate: true, digested: false, tsaProfile: null },
          signerParams: { extKeyUsageOids: [], chain: [] },
          locale: locale === 'kz' ? 'kk' : locale,
        },
      }))
    }
    socket.onmessage = (event) => {
      let message
      try {
        message = JSON.parse(event.data)
      } catch {
        return
      }
      // Сразу после подключения NCALayer присылает свою версию — это не ответ на запрос
      if (message?.status === undefined) return
      if (message.status === true) {
        const result = message.body?.result
        const cms = Array.isArray(result) ? result[0] : result
        // Закрытие окна выбора ключа — успешный ответ без результата
        finish(cms ? resolve : reject, cms || new NcaLayerError('cancelled'))
        return
      }
      finish(reject, new NcaLayerError('failed', message.message || message.details))
    }
    socket.onerror = () => finish(reject, new NcaLayerError(opened ? 'failed' : 'unavailable'))
    socket.onclose = () => finish(reject, new NcaLayerError(opened ? 'failed' : 'unavailable'))
  })
}
