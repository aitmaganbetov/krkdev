import { expect, test } from '@playwright/test'
import { pageByName } from './pages.js'
import { STATES } from './states.js'
import { open, setupApp } from './support/app.js'

// Визуальная регрессия ключевых страниц и модалок (toHaveScreenshot). Эталоны: e2e/__screenshots__.
// Обновить после намеренных изменений: npm run test:e2e:update (в Docker: e2e/run-in-docker.sh --update-snapshots)
const KEY_PAGES = ['login', 'dashboard', 'monitoring', 'records', 'record-detail', 'records-new', 'catalogs-questions', 'users']
// Очень длинные страницы (редактор вопросов ~11 000px с липкими блоками) снимаем по видимой области
const VIEWPORT_ONLY = new Set(['catalogs-questions'])
const VARIANTS = [
  { id: 'desktop-light', width: 1440, height: 900, theme: 'light', lang: 'ru' },
  { id: 'desktop-dark', width: 1440, height: 900, theme: 'dark', lang: 'ru' },
  { id: 'mobile-kz', width: 375, height: 812, theme: 'light', lang: 'kz' },
]

for (const name of KEY_PAGES) {
  const pg = pageByName(name)
  for (const v of VARIANTS) {
    test(`visual: ${name} ${v.id}`, async ({ page }) => {
      await page.setViewportSize({ width: v.width, height: v.height })
      await setupApp(page, { lang: v.lang, theme: v.theme, auth: pg.auth !== false })
      await open(page, pg.path)
      await expect(page).toHaveScreenshot(`${name}-${v.id}.png`, { fullPage: !VIEWPORT_ONLY.has(name) })
    })
  }
}

for (const st of STATES.filter((s) => s.visual)) {
  for (const v of VARIANTS.filter((x) => x.id !== 'desktop-dark' || st.visualDark)) {
    if (st.widths && !st.widths.includes(v.width)) continue
    test(`visual: ${st.name} ${v.id}`, async ({ page }) => {
      await page.setViewportSize({ width: v.width, height: v.height })
      await setupApp(page, { lang: v.lang, theme: v.theme })
      await open(page, st.path)
      await st.action(page, v.lang)
      await page.waitForTimeout(300)
      await expect(page).toHaveScreenshot(`${st.name}-${v.id}.png`)
    })
  }
}
