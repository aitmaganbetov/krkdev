import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from '@playwright/test'
import { layoutChecks, BLOCKING } from './layout-checks.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = JSON.parse(fs.readFileSync(path.join(here, '..', 'fixtures', 'api.json'), 'utf8'))

export const WIDTHS = [375, 768, 1280, 1440, 1920]
export const LANGS = ['ru', 'kz', 'en']
export const HEIGHTS = { 375: 812, 768: 1024, 1280: 800, 1440: 900, 1920: 1080 }
export const FIXED_NOW = new Date(FIXTURES.__now || '2026-10-06T10:30:00+05:00')

/** Ответ фикстуры для запроса: точное совпадение «METHOD /path?query», затем «METHOD /path», затем префикс. */
function lookup(method, url) {
  const u = new URL(url)
  const p = u.pathname.replace(/^\/api/, '')
  const keys = [`${method} ${p}${u.search}`, `${method} ${p}`]
  for (const k of keys) if (k in FIXTURES) return FIXTURES[k]
  // /records/123 -> /records/:id
  const generic = `${method} ${p.replace(/\/\d+(?=\/|$)/g, '/:id')}`
  if (generic in FIXTURES) return FIXTURES[generic]
  return undefined
}

/**
 * Подготовка страницы: подмена API, язык, тема, роль, фиксированное время, стресс-режим.
 * Не найденные в фикстурах GET-запросы получают пустой ответ — и попадают в page.__apiMisses для отладки.
 */
export async function setupApp(page, { lang = 'ru', theme = 'light', role = 'admin', pseudo = false, auth = true } = {}) {
  page.__apiMisses = []
  await page.clock.setFixedTime(FIXED_NOW)
  await page.addInitScript(({ lang, theme, role, pseudo, auth }) => {
    try {
      localStorage.setItem('lang', lang)
      localStorage.setItem('krk-white-control-theme', theme)
      localStorage.setItem('sapa-sidebar-collapsed', '0')
      if (pseudo) localStorage.setItem('i18n-pseudo', '1')
      if (auth) {
        localStorage.setItem('username', 'demo.admin')
        localStorage.setItem('role', role)
      }
    } catch { /* noop */ }
  }, { lang, theme, role, pseudo, auth })

  await page.route('**/api/**', async (route) => {
    const req = route.request()
    const method = req.method()
    if (method === 'GET' && /\/auth\/me$/.test(new URL(req.url()).pathname)) {
      if (!auth) return route.fulfill({ status: 401, json: { detail: 'Not authenticated' } })
      return route.fulfill({ json: { username: 'demo.admin', role, auth_source: 'local' } })
    }
    const body = lookup(method, req.url())
    if (body !== undefined) return route.fulfill({ json: body })
    if (method !== 'GET') return route.fulfill({ json: { status: 'ok' } })
    page.__apiMisses.push(req.url())
    return route.fulfill({ json: [] })
  })
  // Медиа (камеры, фото) — заглушки, чтобы не ходить в сеть
  await page.route(/\.(mp4|webm|m3u8|jpg|jpeg|png)(\?.*)?$/, (route) =>
    route.request().url().includes('/assets/') ? route.continue() : route.fulfill({ status: 204, body: '' }))
}

/** Переход на страницу и ожидание стабильного состояния (сеть, шрифты, анимации). */
export async function open(page, url) {
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(300)
}

/** Запуск детектора на всей высоте страницы. Возвращает блокирующие дефекты. */
export async function findLayoutDefects(page, { fullHeight = true } = {}) {
  const vp = page.viewportSize()
  if (fullHeight) {
    const h = await page.evaluate(() => document.documentElement.scrollHeight)
    await page.setViewportSize({ width: vp.width, height: Math.min(Math.max(h, vp.height), 16000) })
    await page.waitForTimeout(150)
  }
  const issues = await page.evaluate(layoutChecks)
  if (fullHeight) await page.setViewportSize(vp)
  return issues.filter((i) => BLOCKING.includes(i.type))
}

export async function expectNoLayoutDefects(page, label, opts) {
  const defects = await findLayoutDefects(page, opts)
  expect(defects, `${label}:\n${defects.map((d) => `  ${d.type} | ${d.selector} | ${d.text || ''} | ${d.size || d.overlap || ''}`).join('\n')}`).toEqual([])
}
