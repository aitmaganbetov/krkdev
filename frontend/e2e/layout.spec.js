import { test } from '@playwright/test'
import { PAGES } from './pages.js'
import { STATES } from './states.js'
import { HEIGHTS, LANGS, WIDTHS, expectNoLayoutDefects, open, setupApp } from './support/app.js'

// Каждая страница × язык × ширина: ноль наложений, обрезаний и горизонтального скролла.
for (const pg of PAGES) {
  test.describe(`layout: ${pg.name}`, () => {
    for (const lang of LANGS) {
      for (const width of WIDTHS) {
        test(`${lang} ${width}`, async ({ page }) => {
          await page.setViewportSize({ width, height: HEIGHTS[width] })
          await setupApp(page, { lang, auth: pg.auth !== false })
          await open(page, pg.path)
          await expectNoLayoutDefects(page, `${pg.name} ${lang} ${width}`)
        })
      }
    }
  })
}

// Модалки, меню и другие состояния: проверка в видимой области (слои position:fixed).
for (const st of STATES) {
  test.describe(`layout state: ${st.name}`, () => {
    for (const lang of LANGS) {
      for (const width of st.widths || WIDTHS) {
        test(`${lang} ${width}`, async ({ page }) => {
          await page.setViewportSize({ width, height: HEIGHTS[width] })
          await setupApp(page, { lang })
          await open(page, st.path)
          await st.action(page, lang)
          await page.waitForTimeout(250)
          await expectNoLayoutDefects(page, `${st.name} ${lang} ${width}`, { fullHeight: false })
        })
      }
    }
  })
}
