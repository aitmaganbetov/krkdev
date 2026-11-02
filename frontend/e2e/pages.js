// Маршруты, которые проверяют тесты вёрстки и визуальной регрессии.
// RECORD_ID — запись из фикстур (e2e/fixtures/api.json).
export const RECORD_ID = 1001

export const PAGES = [
  { name: 'login', path: '/login', auth: false },
  { name: 'dashboard', path: '/dashboard' },
  { name: 'monitoring', path: '/monitoring' },
  { name: 'schedule', path: '/schedule' },
  { name: 'records', path: '/records' },
  { name: 'records-new', path: '/records/new' },
  { name: 'record-detail', path: `/records/${RECORD_ID}` },
  { name: 'record-edit', path: `/records/${RECORD_ID}/edit` },
  { name: 'catalogs-questions', path: '/catalogs/questions' },
  { name: 'catalogs-academic-years', path: '/catalogs/academic-years' },
  { name: 'users', path: '/users' },
  // Системные разделы доступны только суперадминистратору
  { name: 'ldap-users', path: '/ldap-users', role: 'superadmin' },
  { name: 'rooms-settings', path: '/rooms-settings', role: 'superadmin' },
  { name: 'settings', path: '/settings', role: 'superadmin' },
  { name: 'audit-logs', path: '/audit-logs', role: 'superadmin' },
]

export const pageByName = (name) => PAGES.find((p) => p.name === name)
