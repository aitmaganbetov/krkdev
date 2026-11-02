import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
// Словари собирает vite-plugin-locales.js (базовый src/locales/_base.js и модули src/locales/*.js).
// Русский — основной и запасной язык, он в главном бандле; казахский и английский загружаются
// отдельным файлом только при выборе языка.
import ru from 'virtual:locales/ru'

const LOADERS = {
  kz: () => import('virtual:locales/kz'),
  en: () => import('virtual:locales/en'),
}
const LANGUAGES = ['ru', ...Object.keys(LOADERS)]

// Псевдолокализация для стресс-теста вёрстки (localStorage 'i18n-pseudo' = '1'): каждая строка
// становится в ~2 раза длиннее и получает длинное казахское слово — так проверяется запас на +20–40%.
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)
function pseudoLocalize(node) {
  for (const [k, v] of Object.entries(node)) {
    if (isObj(v)) pseudoLocalize(v)
    else if (typeof v === 'string' && v.trim()) {
      node[k] = `${v} ${v.replace(/{{[^}]+}}/g, '')} Қазақстанреспубликасындағы`.replace(/\s+/g, ' ').trim()
    }
  }
  return node
}
let pseudo = false
let savedLanguage = null
try {
  pseudo = localStorage.getItem('i18n-pseudo') === '1'
  savedLanguage = localStorage.getItem('lang')
} catch { /* localStorage недоступен */ }
const prepare = (dict) => (pseudo ? pseudoLocalize(structuredClone(dict)) : dict)

// Загрузчик i18next: словарь языка подгружается перед переключением (i18n.changeLanguage ждёт его)
const localesBackend = {
  type: 'backend',
  init() {},
  read(lng, _ns, callback) {
    const loader = LOADERS[lng]
    if (!loader) {
      callback(null, {})
      return
    }
    loader().then((mod) => callback(null, prepare(mod.default)), (err) => callback(err, null))
  },
}

// Язык документа — для переносов по слогам (hyphens) и озвучивания; казахский в BCP 47 — «kk».
// Здесь, а не в каркасе: страница входа тоже переключает язык
i18n.on('languageChanged', (lng) => { document.documentElement.lang = lng === 'kz' ? 'kk' : lng })

// Отрисовка ждёт словарь выбранного языка (main.jsx), чтобы не мелькали ключи вместо текста
export const i18nReady = i18n
  .use(localesBackend)
  .use(initReactI18next)
  .init({
    resources: { ru: { translation: prepare(ru) } },
    partialBundledLanguages: true,
    lng: LANGUAGES.includes(savedLanguage) ? savedLanguage : 'ru',
    fallbackLng: 'ru',
    supportedLngs: LANGUAGES,
    interpolation: { escapeValue: false },
  })

export default i18n
