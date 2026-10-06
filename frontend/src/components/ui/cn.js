// Склейка классов: пропускает false/null/undefined и пустые строки.
export function cn(...parts) {
  return parts.flat(Infinity).filter(Boolean).join(' ')
}
