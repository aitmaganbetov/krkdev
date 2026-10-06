// Локаль для Intl (даты, числа) по языку интерфейса. Казахский в Intl — 'kk'; если браузер его не знает
// (урезанный ICU), лучше показать дату по-русски, чем откатиться на английский.
export function intlLocale(lang) {
  if (lang === 'kz') {
    try {
      return Intl.DateTimeFormat.supportedLocalesOf(['kk']).length ? 'kk' : 'ru'
    } catch {
      return 'ru'
    }
  }
  return lang || 'ru'
}
