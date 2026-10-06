import { useEffect, useState } from 'react'
import { getRatingTemplates } from '../services/api'

export const CALC_METHOD_LABELS = {
  average: 'Среднее всех ответов',
  weighted: 'Взвешенное среднее по вопросам',
  sections: 'Среднее по разделам с весами разделов',
  sum: 'Сумма баллов',
}

let templatesPromise = null

export function loadRatingTemplates({ force = false } = {}) {
  if (force || !templatesPromise) {
    templatesPromise = getRatingTemplates().catch((err) => {
      templatesPromise = null
      throw err
    })
  }
  return templatesPromise
}

export function invalidateRatingTemplates() {
  templatesPromise = null
}

export function useRatingTemplates() {
  const [state, setState] = useState({ templates: [], loading: true, error: '' })

  useEffect(() => {
    let active = true
    loadRatingTemplates()
      .then((templates) => active && setState({ templates, loading: false, error: '' }))
      .catch((err) => active && setState({
        templates: [],
        loading: false,
        error: err.response?.data?.detail ?? 'Не удалось загрузить справочник вопросов',
      }))
    return () => { active = false }
  }, [])

  return state
}

export function findTemplate(templates, academicYear) {
  return (templates || []).find((template) => template.academic_year === academicYear) || null
}

export function localized(value, lang) {
  if (!value) return ''
  if (typeof value === 'string') return value
  const short = String(lang || 'ru').slice(0, 2)
  return value[short] || value.ru || value.kk || value.en || ''
}

export const LESSON_TYPES = ['Лекция', 'Практика', 'Семинар', 'Лабораторная', 'Физическая культура', 'Творческое']

// Разделы без lesson_types действуют всегда, остальные — только для своих видов занятия
// (тот же отбор, что в backend applicable_sections).
export function applicableSections(template, lessonType) {
  const lesson = String(lessonType || '').trim().toLowerCase()
  return (template?.sections || []).filter((section) => {
    const types = (section.lesson_types || []).map((t) => String(t).trim().toLowerCase()).filter(Boolean)
    return !types.length || types.includes(lesson)
  })
}

export function hasLessonTypeModules(template) {
  return (template?.sections || []).some((section) => (section.lesson_types || []).length > 0)
}

export function templateQuestions(template, lessonType) {
  return applicableSections(template, lessonType).flatMap((section) => section.questions || [])
}

export function templateQuestionCodes(template, lessonType) {
  return templateQuestions(template, lessonType).map((question) => question.code)
}

// Оставляет только вопросы выбранного года и вида занятия, уже выставленные оценки сохраняются.
export function normalizeRatings(template, ratings = {}, lessonType) {
  if (!template) return ratings || {}
  return Object.fromEntries(
    templateQuestionCodes(template, lessonType).map((code) => {
      const value = ratings?.[code]
      return [code, isValidRating(template, value) ? value : null]
    })
  )
}

export function isValidRating(template, value) {
  return Number.isInteger(value) && value >= template.scale_min && value <= template.scale_max
}

export function hasCompleteRatings(template, ratings = {}, lessonType) {
  if (!template) return false
  const codes = templateQuestionCodes(template, lessonType)
  return codes.length > 0 && codes.every((code) => isValidRating(template, ratings?.[code]))
}

// Тот же расчёт, что в backend/services/rating_template_service.py:compute_score
export function computeScore(template, ratings = {}, lessonType) {
  if (!template) return null
  const sections = applicableSections(template, lessonType)
  const values = []
  sections.forEach((section) => {
    (section.questions || []).forEach((question) => {
      const value = ratings?.[question.code]
      if (Number.isInteger(value)) values.push({ section, question, value })
    })
  })
  if (!values.length) return null

  let score
  if (template.calc_method === 'sum') {
    score = values.reduce((sum, item) => sum + item.value, 0)
  } else if (template.calc_method === 'weighted') {
    const totalWeight = values.reduce((sum, item) => sum + Number(item.question.weight || 1), 0)
    score = totalWeight
      ? values.reduce((sum, item) => sum + item.value * Number(item.question.weight || 1), 0) / totalWeight
      : 0
  } else if (template.calc_method === 'sections') {
    let weightedSum = 0
    let totalWeight = 0
    sections.forEach((section) => {
      const sectionValues = values.filter((item) => item.section === section).map((item) => item.value)
      if (!sectionValues.length) return
      const weight = Number(section.weight || 1)
      weightedSum += weight * (sectionValues.reduce((a, b) => a + b, 0) / sectionValues.length)
      totalWeight += weight
    })
    score = totalWeight ? weightedSum / totalWeight : 0
  } else {
    score = values.reduce((sum, item) => sum + item.value, 0) / values.length
  }
  return Math.round(score * 100) / 100
}

export function templateMaxScore(template) {
  if (!template) return 10
  if (template.max_score) return Number(template.max_score)
  return template.calc_method === 'sum'
    ? template.scale_max * templateQuestionCodes(template).length
    : template.scale_max
}

// Цвет оценки относительно шкалы: >= 80% зелёный, >= 60% жёлтый, иначе красный.
export function scoreTone(value, max) {
  if (!Number.isFinite(Number(value)) || value === null) return 'none'
  const share = max ? Number(value) / max : 0
  if (share >= 0.8) return 'good'
  if (share >= 0.6) return 'mid'
  return 'bad'
}
