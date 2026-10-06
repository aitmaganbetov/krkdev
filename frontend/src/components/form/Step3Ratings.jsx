import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CALC_METHOD_LABELS,
  applicableSections,
  computeScore,
  hasLessonTypeModules,
  isValidRating,
  localized,
  scoreTone,
  templateMaxScore,
} from '../../utils/ratingTemplate'
import { lessonTypeLabel, templateLang } from '../../locales/recordForm'
import { Alert, Card, CardHeader, Field, LoadingBlock, Select, cn } from '../ui'

// Цвет оценки относительно шкалы (пороги — scoreTone)
const TONE_TEXT = {
  good: 'text-success',
  mid: 'text-warning',
  bad: 'text-danger',
  none: 'text-fg-subtle',
}

function ScoreInput({ value, onChange, scaleMin, scaleMax, labelledBy, error }) {
  const { t } = useTranslation()
  const options = []
  for (let score = scaleMax; score >= scaleMin; score -= 1) options.push({ value: score, label: String(score) })
  return (
    <Field error={error} className="w-full sm:w-52">
      <div className="flex min-w-0 items-center gap-3">
        <Select
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          placeholder={t('steps.selectDefault')}
          options={options}
          aria-labelledby={labelledBy}
          className="tabular"
        />
        <span aria-hidden="true" className={cn('w-8 shrink-0 text-center text-base font-semibold tabular', TONE_TEXT[scoreTone(value, scaleMax)])}>
          {value ?? '—'}
        </span>
      </div>
    </Field>
  )
}

// Строка критерия: полный текст переносится, контроль оценки справа (на мобильном — под текстом)
function QuestionRow({ question, lang, value, onChange, template, showErrors }) {
  const { t } = useTranslation()
  const uid = useId()
  const text = localized(question.text, lang)
  const hint = localized(question.hint, lang)
  const missing = showErrors && !isValidRating(template, value)
  return (
    <li className="flex min-w-0 flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:gap-6">
      <div className="flex min-w-0 flex-1 gap-3">
        <span className="mt-0.5 w-9 shrink-0 text-xs font-medium tabular text-fg-subtle">{question.code}</span>
        <div className="min-w-0 flex-1">
          <p id={`${uid}-label`} className="text-sm font-medium text-fg">
            <span className="sr-only">{t('recordForm.ratings.scoreFor', { code: question.code })}: </span>
            {text}
          </p>
          {hint && (
            <p className="mt-1 whitespace-pre-line text-xs text-fg-muted">
              <span className="font-medium text-fg-subtle">{t('recordForm.ratings.signs')}: </span>
              {hint}
            </p>
          )}
        </div>
      </div>
      <div className="min-w-0 pl-12 sm:shrink-0 sm:pl-0">
        <ScoreInput
          value={value}
          scaleMin={template.scale_min}
          scaleMax={template.scale_max}
          labelledBy={`${uid}-label`}
          error={missing ? t('recordForm.ratings.notRated') : undefined}
          onChange={onChange}
        />
      </div>
    </li>
  )
}

// Шаг 3: вопросы и шкала из справочника учебного года
export default function Step3Ratings({ ratings, onChange, template, academicYear, lessonType, templatesLoading, showErrors = false }) {
  const { t, i18n } = useTranslation()
  const lang = templateLang(i18n.language)

  if (templatesLoading) {
    return <LoadingBlock label={t('ui.loading')} />
  }

  if (!template) {
    return <Alert tone="warning">{t('recordForm.ratings.noTemplate', { year: academicYear || '—' })}</Alert>
  }

  const sections = applicableSections(template, lessonType)
  const missingModule = hasLessonTypeModules(template)
    && !sections.some((section) => (section.lesson_types || []).length > 0)
  const score = computeScore(template, ratings, lessonType)
  const maxScore = templateMaxScore(template)
  const note = localized(template.note, lang)
  const method = t(`recordForm.calcMethods.${template.calc_method}`, {
    defaultValue: (CALC_METHOD_LABELS[template.calc_method] || template.calc_method || '').toLowerCase(),
  })
  const codes = sections.flatMap((section) => (section.questions || []).map((question) => question.code))
  const rated = codes.filter((code) => isValidRating(template, ratings[code])).length

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex min-w-0 flex-wrap items-end justify-between gap-4">
        <h2 className="min-w-0 text-lg font-semibold text-fg">{t('steps.ratingsTitle')}</h2>
        {/* Итог по ходу заполнения */}
        <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-line bg-surface-muted px-4 py-2.5" aria-live="polite">
          <p className="text-xs font-medium text-fg-muted">{t('recordForm.ratings.avgScore')}</p>
          <p className="text-2xl font-semibold tabular">
            <span className={TONE_TEXT[scoreTone(score, maxScore)]}>{score ?? '—'}</span>
            <span className="text-base font-medium text-fg-subtle"> / {maxScore}</span>
          </p>
          <p className="text-xs text-fg-subtle tabular">{t('recordForm.ratings.progress', { done: rated, total: codes.length })}</p>
        </div>
      </div>

      <Alert tone="info">
        <p>
          {t('recordForm.ratings.templateInfo', {
            year: template.academic_year,
            min: template.scale_min,
            max: template.scale_max,
            method,
          })}
        </p>
        {note && note.split('\n').map((line, index) => <p key={index}>{line}</p>)}
      </Alert>

      {missingModule && (
        <Alert tone="warning">{t('recordForm.ratings.missingModule', { type: lessonTypeLabel(t, lessonType) || '—' })}</Alert>
      )}

      {sections.map((section, sectionIndex) => (
        <Card key={`${section.code}-${sectionIndex}`}>
          <CardHeader title={localized(section.title, lang)} titleAs="h3" />
          <ul className="flex min-w-0 flex-col divide-y divide-line p-4 sm:p-5">
            {(section.questions || []).map((question) => (
              <QuestionRow
                key={question.code}
                question={question}
                lang={lang}
                template={template}
                showErrors={showErrors}
                value={ratings[question.code] ?? null}
                onChange={(v) => onChange({ ...ratings, [question.code]: v })}
              />
            ))}
          </ul>
        </Card>
      ))}
    </div>
  )
}
