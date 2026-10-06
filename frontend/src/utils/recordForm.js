import { hasCompleteRatings } from './ratingTemplate'

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0
}

export function getRecordFormStepError(step, data, template) {
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
    if (!template) {
      return `Для учебного года ${data.academic_year || ''} не настроен справочник вопросов.`
    }
    return hasCompleteRatings(template, data.ratings, data.lesson_type)
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

export function getRecordFormError(data, template) {
  for (let step = 0; step <= 3; step += 1) {
    const error = getRecordFormStepError(step, data, template)
    if (error) {
      return error
    }
  }

  return ''
}