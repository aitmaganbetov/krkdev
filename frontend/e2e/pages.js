// Маршруты, которые проверяют тесты вёрстки и визуальной регрессии.
// RECORD_ID — запись из фикстур (e2e/fixtures/api.json).
export const RECORD_ID = 1001

export const PAGES = [
  { name: 'login', path: '/login', auth: false },
  { name: 'dashboard', path: '/dashboard' },
  { name: 'monitoring', path: '/monitoring' },
  { name: 'records', path: '/records' },
  { name: 'records-new', path: '/records/new' },
  { name: 'record-detail', path: `/records/${RECORD_ID}` },
  { name: 'record-edit', path: `/records/${RECORD_ID}/edit` },
  { name: 'catalogs-questions', path: '/catalogs/questions' },
  { name: 'catalogs-academic-years', path: '/catalogs/academic-years' },
  { name: 'users', path: '/users' },
  { name: 'ldap-users', path: '/ldap-users' },
  { name: 'rooms-settings', path: '/rooms-settings' },
  { name: 'settings', path: '/settings' },
  { name: 'audit-logs', path: '/audit-logs' },
]

export const pageByName = (name) => PAGES.find((p) => p.name === name)
