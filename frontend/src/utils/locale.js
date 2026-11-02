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

// Региональная локаль для Intl там, где нужен формат региона (дд.мм.гггг, en — британский)
const REGION_LOCALES = { ru: 'ru-RU', kz: 'kk-KZ', en: 'en-GB' }
export const regionLocale = (lang) => REGION_LOCALES[lang] || 'ru-RU'

// Стоимость в тенге: целые суммы без копеек, иначе — два знака
export function formatMoney(value, lang) {
  return new Intl.NumberFormat(regionLocale(lang), {
    style: 'currency', currency: 'KZT', currencyDisplay: 'narrowSymbol', minimumFractionDigits: 0, maximumFractionDigits: 2,
  }).format(Number(value) || 0)
}

// Название из справочника Platonus на языке интерфейса (казахское/английское может быть пустым — тогда русское).
// Только для подписей: в записях хранятся русские названия
export function localizedName(row, prefix, lang) {
  if (!row) return ''
  const suffix = { ru: 'ru', kz: 'kz', en: 'en' }[lang] || 'ru'
  return row[`${prefix}_${suffix}`] || row[`${prefix}_ru`] || ''
}
