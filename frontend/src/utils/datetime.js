const UTC_PLUS_5_HOURS = 5
const UTC_PLUS_5_MS = UTC_PLUS_5_HOURS * 60 * 60 * 1000

function pad2(value) {
  return String(value).padStart(2, '0')
}

function parseDatetimeLocal(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null

  const [, y, m, d, hh, mm] = match
  const utcMs = Date.UTC(
    Number(y),
    Number(m) - 1,
    Number(d),
    Number(hh) - UTC_PLUS_5_HOURS,
    Number(mm),
  )
  return new Date(utcMs)
}

function parseToDate(value) {
  if (!value) return null
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    return parseDatetimeLocal(value)
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date
}

function toUtcPlus5Parts(value) {
  const date = parseToDate(value)
  if (!date) return null

  const shifted = new Date(date.getTime() + UTC_PLUS_5_MS)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  }
}

export function formatDateUtcPlus5(value) {
  const parts = toUtcPlus5Parts(value)
  if (!parts) return value || ''

  return `${pad2(parts.day)}.${pad2(parts.month)}.${parts.year}`
}

export function formatDateTimeUtcPlus5(value) {
  const parts = toUtcPlus5Parts(value)
  if (!parts) return value || ''

  return `${pad2(parts.day)}.${pad2(parts.month)}.${parts.year} ${pad2(parts.hour)}:${pad2(parts.minute)} (UTC+5)`
}

export function toDatetimeLocalUtcPlus5(value) {
  const parts = toUtcPlus5Parts(value)
  if (!parts) return ''

  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}T${pad2(parts.hour)}:${pad2(parts.minute)}`
}

export function datetimeLocalToIsoUtcPlus5(value) {
  const date = parseDatetimeLocal(value)
  if (!date) return null
  return date.toISOString()
}
