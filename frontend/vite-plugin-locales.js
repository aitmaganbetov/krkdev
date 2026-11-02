// Словари по языкам: virtual:locales/<язык> — базовый словарь (src/locales/_base.js) и поверх него
// словари модулей (src/locales/*.js по алфавиту, глубокое слияние). Модули экспортируют { ru, kz, en }
// и содержат только данные, поэтому собираются в Node при сборке; браузер загружает один язык,
// а не все три в главном бандле.
import { readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const LANGUAGES = ['ru', 'kz', 'en']
const PREFIX = 'virtual:locales/'
const RESOLVED = '\0' + PREFIX

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)
function deepMerge(target, src) {
  for (const [k, v] of Object.entries(src || {})) {
    if (isObj(v)) target[k] = deepMerge(isObj(target[k]) ? target[k] : {}, v)
    else target[k] = v
  }
  return target
}

export default function localesPlugin() {
  const dir = resolve('src/locales')
  const files = () => readdirSync(dir).filter((name) => name.endsWith('.js') && name !== '_base.js').sort()
  // Node кеширует модули по URL: метка времени изменения даёт свежий словарь при правке в dev
  const load = async (name) => {
    const path = join(dir, name)
    return { path, dict: (await import(`${pathToFileURL(path).href}?v=${statSync(path).mtimeMs}`)).default }
  }

  return {
    name: 'krk-locales',
    resolveId(id) {
      return id.startsWith(PREFIX) ? '\0' + id : null
    },
    async load(id) {
      if (!id.startsWith(RESOLVED)) return null
      const lng = id.slice(RESOLVED.length)
      if (!LANGUAGES.includes(lng)) throw new Error(`Неизвестный язык словаря: ${lng}`)
      const base = await load('_base.js')
      this.addWatchFile(base.path)
      const translation = deepMerge({}, base.dict[lng]?.translation)
      for (const name of files()) {
        const mod = await load(name)
        this.addWatchFile(mod.path)
        deepMerge(translation, mod.dict[lng])
      }
      // JSON.parse разбирается быстрее объектного литерала того же размера
      return `export default JSON.parse(${JSON.stringify(JSON.stringify(translation))})`
    },
  }
}
