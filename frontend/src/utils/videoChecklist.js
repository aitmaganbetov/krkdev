// Чек-лист ситуационного видеомониторинга — форма Ф. ДСР-9.1.3-2026-16-02 (как backend/services/video_checklist.py).
// negative — ответ, означающий расхождение: у вопроса «Есть ли иное расхождение…» это «да».
export const CHECKLIST_QUESTIONS = [
  { key: 'schedule', negative: 'no' },
  { key: 'teacher', negative: 'no' },
  { key: 'group', negative: 'no' },
  { key: 'activity', negative: 'no' },
  { key: 'continuity', negative: 'no' },
  { key: 'safety', negative: 'no' },
  { key: 'quality', negative: 'no' },
  { key: 'other', negative: 'yes' },
]
export const CHECKLIST_ANSWERS = ['yes', 'no', 'unclear', 'not_visible', 'na']

// Итог наблюдения (violations.status): violation — нарушение ждёт подписи ЭЦП, confirmed — подписано,
// justified — снято по пояснению преподавателя; pending/rejected — записи до формы 16-02
export const OUTCOME_TONE = {
  compliant: 'success', clarification: 'warning', violation: 'danger', confirmed: 'danger', justified: 'success',
  technical: 'neutral', pending: 'warning', rejected: 'neutral',
}
export const FINAL_STATUSES = ['confirmed', 'rejected', 'justified']
// После подписи ЭЦП преподавателю отправляются «соответствует» и нарушение (как SENT_TO_TEACHER на бэкенде)
export const SENT_TO_TEACHER = ['compliant', 'violation']

// Решение принято: подписанные «соответствует» и «технически невозможно оценить» не меняются (is_locked на бэкенде)
export const isLocked = (item) => FINAL_STATUSES.includes(item.status) || (Boolean(item.signed_at) && ['compliant', 'technical'].includes(item.status))

// Кто подписывает чек-лист: наблюдатель; нарушение после уточнения — тот, кто его зафиксировал в отчетности
export const signerOf = (item) => (item.status === 'violation' ? item.reviewed_by : item.created_by)

export const emptyAnswers = () => Object.fromEntries(CHECKLIST_QUESTIONS.map((q) => [q.key, '']))
export const deviations = (answers) => CHECKLIST_QUESTIONS.filter((q) => answers?.[q.key] === q.negative).map((q) => q.key)
export const isComplete = (answers) => CHECKLIST_QUESTIONS.every((q) => CHECKLIST_ANSWERS.includes(answers?.[q.key]))

// Допустимые итоги наблюдения (как validate_new на бэкенде): нарушение — когда расхождение есть и видео чёткое
// (качество — «да»); плохой сигнал — только «технически невозможно оценить» (п. 4.7)
export function allowedOutcomes(answers) {
  if (answers.quality === 'no') return ['technical']
  const found = deviations(answers).length > 0
  if (found && answers.quality === 'yes') return ['violation', 'clarification', 'technical']
  if (found || Object.values(answers).includes('unclear')) return ['clarification', 'technical']
  return ['compliant', 'clarification', 'technical']
}

// Чего не хватает, чтобы наблюдение «требуется уточнение» стало нарушением (как ensure_can_confirm на бэкенде)
export function confirmBlocker(item, report) {
  if (item.checklist) {
    if (item.checklist.quality === 'no') return 'confirmTechnical'
    if (!deviations(item.checklist).length) return 'confirmNoDeviation'
  }
  if (!report.schedule_check.trim() || (!report.repeat_observation_at && !report.onsite_verification.trim())) return 'confirmNeeds'
  return null
}
