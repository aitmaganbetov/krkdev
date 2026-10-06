import { test } from '@playwright/test'
import { PAGES } from './pages.js'
import { HEIGHTS, expectNoLayoutDefects, open, setupApp } from './support/app.js'

// Стресс-тест: псевдолокализация (каждая строка интерфейса ×2 + длинное казахское слово
// «Қазақстанреспубликасындағы») и длинные данные из фикстур. Вёрстка должна выдержать.
const WIDTHS = [375, 768, 1280]

for (const pg of PAGES) {
  for (const width of WIDTHS) {
    test(`stress: ${pg.name} kz ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: HEIGHTS[width] })
      await setupApp(page, { lang: 'kz', pseudo: true, auth: pg.auth !== false })
      await open(page, pg.path)
      await expectNoLayoutDefects(page, `stress ${pg.name} kz ${width}`)
    })
  }
}
