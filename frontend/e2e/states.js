// Состояния с оверлеями (модалки, меню, диалоги) для тестов вёрстки и визуальной регрессии.
// Кнопки ищутся по подписям из тех же словарей, что использует приложение, на нужном языке.
import ui from '../src/locales/ui.js'
import users from '../src/locales/users.js'

const pick = (dict, lang, keyPath) => keyPath.split('.').reduce((o, k) => o?.[k], dict[lang])

const clickButton = async (page, name) => {
  await page.getByRole('button', { name, exact: true }).first().click()
}

export const STATES = [
  {
    name: 'mobile-menu',
    path: '/records',
    widths: [375, 768],
    visual: true,
    action: (page, lang) => clickButton(page, pick(ui, lang, 'shell.openMenu')),
  },
  {
    name: 'user-menu',
    path: '/records',
    visual: false,
    action: (page, lang) => clickButton(page, pick(ui, lang, 'shell.account')),
  },
  {
    name: 'users-create-modal',
    path: '/users',
    visual: true,
    visualDark: true,
    action: (page, lang) => clickButton(page, pick(users, lang, 'usersPage.add')),
  },
  {
    name: 'confirm-dialog',
    path: '/catalogs/academic-years',
    visual: true,
    // «Удалить» активна только у года без записей и вопросов (в фикстурах — 2027-2028)
    action: (page, lang) => page.locator('main button:visible:not([disabled])', { hasText: pick(ui, lang, 'ui.delete') }).first().click(),
  },
]
