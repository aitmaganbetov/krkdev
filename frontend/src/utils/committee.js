// Комитет КРК: подписант приказа о составе и варианты выбора преподавателей Platonus.

// Должности подписанта (рус. / каз. — для казахского листа приказа)
export const SIGNER_POSITIONS = [
  { ru: 'Ректор', kz: 'Ректор' },
  { ru: 'И.о. ректора', kz: 'Ректордың м.а.' },
  { ru: 'Первый проректор', kz: 'Бірінші проректор' },
  { ru: 'Проректор по академическим вопросам', kz: 'Академиялық мәселелер жөніндегі проректор' },
]

// «Байболова Ляззат Кемербековна» → «Л. Байболова» (как подпись в приказе)
export const signerName = (fullName) => {
  const [surname, firstName] = String(fullName || '').split(/\s+/)
  return [firstName ? `${firstName[0]}.` : '', surname || ''].filter(Boolean).join(' ')
}

// «Ректор Л. Байболова» → должность и ФИО подписанта
export function splitSigner(value) {
  const match = String(value || '').match(/^(.*?)\s+([А-ЯЁӘҒҚҢӨҰҮҺІA-Z]\.\s?.*)$/)
  return match ? { position: match[1], name: match[2] } : { position: value || '', name: '' }
}

// Варианты для выбора преподавателя: подпись уникальна (однофамильцы различаются логином), кафедра — в пояснении
export function tutorOptions(tutors) {
  const counts = {}
  tutors.forEach((tutor) => { counts[tutor.full_name] = (counts[tutor.full_name] || 0) + 1 })
  return tutors.map((tutor) => ({
    value: tutor.id,
    label: counts[tutor.full_name] > 1 ? `${tutor.full_name} (${tutor.login || tutor.id})` : tutor.full_name,
    description: tutor.cafedra || '',
    tutor,
  }))
}

// Вариант по подписи приказа («Л. Байболова»): фамилия и инициал имени
export function findSignerOption(options, name) {
  const [initial, surname] = String(name || '').replace('.', '. ').split(/\s+/).filter(Boolean)
  if (!surname) return null
  return options.find((option) => {
    const [last, first] = option.tutor.full_name.split(/\s+/)
    return last === surname && first?.[0] === initial?.[0]
  }) || null
}

const pad = (value) => String(value).padStart(2, '0')
// Время из API — UTC без пояса; в интерфейсе — время Астаны (UTC+5) с секундами, как в СЭД
export function formatSignedAt(iso) {
  if (!iso) return ''
  const value = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`)
  if (Number.isNaN(value.getTime())) return iso
  const local = new Date(value.getTime() + 5 * 3600 * 1000)
  return `${pad(local.getUTCDate())}.${pad(local.getUTCMonth() + 1)}.${local.getUTCFullYear()} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}`
}

// Страница проверки подлинности документа по QR-коду
export const verifyUrl = (token) => `${window.location.origin}/verify/${token}`
