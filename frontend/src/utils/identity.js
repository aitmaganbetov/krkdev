export function normalizeIdentity(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return ''

  const slashIndex = normalized.lastIndexOf('\\')
  const withoutDomain = slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized

  return withoutDomain
}

export function getIdentityAliases(value) {
  const normalized = normalizeIdentity(value)
  if (!normalized) return []

  const aliases = new Set([normalized])
  const atIndex = normalized.indexOf('@')

  if (atIndex > 0) {
    aliases.add(normalized.slice(0, atIndex))
  }

  return Array.from(aliases)
}

export function isSameIdentity(left, right) {
  const leftAliases = getIdentityAliases(left)
  const rightAliases = new Set(getIdentityAliases(right))

  return leftAliases.some((alias) => rightAliases.has(alias))
}