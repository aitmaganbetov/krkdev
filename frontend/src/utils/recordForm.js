export const ALL_RATING_KEYS = [
  ...Array.from({ length: 7 }, (_, i) => `1.${i + 1}`),
  ...Array.from({ length: 6 }, (_, i) => `2.${i + 1}`),
  ...Array.from({ length: 4 }, (_, i) => `3.${i + 1}`),
]

export function createEmptyRatings() {
  return Object.fromEntries(ALL_RATING_KEYS.map((key) => [key, null]))
}

export function normalizeRatingsForForm(ratings = {}) {
  return Object.fromEntries(
    ALL_RATING_KEYS.map((key) => {
      const value = ratings[key]
      return [key, Number.isInteger(value) ? value : null]
    })
  )
}

export function hasCompleteRatings(ratings = {}) {
  return ALL_RATING_KEYS.every((key) => {
    const value = ratings[key]
    return Number.isInteger(value) && value >= 1 && value <= 10
  })
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0
}

export function getRecordFormStepError(step, data) {
  if (step === 0) {
    const fields = ['teacher', 'subject', 'faculty', 'op', 'group_name', 'room']
    return fields.every((field) => hasText(data[field]))
      ? ''
      : 'Заполните все обязательные поля.'
  }

  if (step === 1) {
    const requiredTextFields = ['lesson_type', 'format', 'topic', 'datetime', 'academic_year']
    if (!requiredTextFields.every((field) => hasText(data[field]))) {
      return 'Заполните все обязательные поля занятия.'
    }

    if (!Number.isInteger(data.students_plan) || data.students_plan < 0) {
      return 'Укажите корректное количество студентов по плану.'
    }

    if (!Number.isInteger(data.students_fact) || data.students_fact < 0) {
      return 'Укажите корректное фактическое количество студентов.'
    }

    if (data.students_fact > data.students_plan) {
      return 'Студентов фактически не может быть больше, чем студентов по плану.'
    }

    return ''
  }

  if (step === 2) {
    return hasCompleteRatings(data.ratings)
      ? ''
      : 'Заполните все рейтинговые категории перед переходом дальше.'
  }

  if (step === 3) {
    return hasText(data.comment)
      ? ''
      : 'Комментарий обязателен.'
  }

  return ''
}

export function getRecordFormError(data) {
  for (let step = 0; step <= 3; step += 1) {
    const error = getRecordFormStepError(step, data)
    if (error) {
      return error
    }
  }

  return ''
}