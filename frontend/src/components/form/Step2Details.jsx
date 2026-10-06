import { useTranslation } from 'react-i18next'
import { LESSON_TYPES } from '../../utils/ratingTemplate'
import { formatLabel, lessonTypeLabel } from '../../locales/recordForm'
import { Card, Field, FormSection, Input, Select, Textarea, cn } from '../ui'

// Значения формы проведения хранятся в БД как есть; подписи переводятся (formatLabel)
const FORMATS = ['в традиционном очном формате', 'дистанционное занятие с использованием системы ZOOM']

const isEmpty = (value) => !(typeof value === 'string' && value.trim())

// Шаг 2: детали занятия
export default function Step2Details({ data, onChange, showErrors = false }) {
  const { t } = useTranslation()
  const academicYears = data.academic_year_options ?? []
  const field = (name) => ({
    value: data[name] ?? '',
    onChange: (e) => onChange({ [name]: e.target.value }),
  })
  const errorFor = (name) => (showErrors && isEmpty(data[name]) ? t('recordForm.required') : undefined)

  const factExceedsPlan = (data.students_fact ?? 0) > (data.students_plan ?? 0)
  const attendance = data.students_plan > 0
    ? Math.round((data.students_fact / data.students_plan) * 100)
    : null

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <h2 className="text-lg font-semibold text-fg">{t('steps.detailsTitle')}</h2>

      <Card padded>
        <FormSection title={t('recordForm.sections.lesson')}>
          <Field label={t('recordForm.fields.lessonType')} required error={errorFor('lesson_type')}>
            <Select
              {...field('lesson_type')}
              placeholder={t('steps.selectDefault')}
              options={LESSON_TYPES.map((type) => ({ value: type, label: lessonTypeLabel(t, type) }))}
            />
          </Field>
          <Field label={t('recordForm.fields.format')} required error={errorFor('format')}>
            <Select
              {...field('format')}
              placeholder={t('steps.selectDefault')}
              options={FORMATS.map((format) => ({ value: format, label: formatLabel(t, format) }))}
            />
          </Field>
          <Field label={t('recordForm.fields.dateTime')} required error={errorFor('datetime')}>
            <Input type="datetime-local" {...field('datetime')} />
          </Field>
          <Field label={t('recordForm.fields.academicYear')} required error={errorFor('academic_year')}>
            <Select
              {...field('academic_year')}
              placeholder={t('steps.selectDefault')}
              options={academicYears.map((year) => ({ value: year, label: year }))}
            />
          </Field>
          <Field label={t('recordForm.fields.topic')} required error={errorFor('topic')} className="sm:col-span-2">
            <Textarea {...field('topic')} autoGrow rows={2} placeholder={t('steps.topicPlaceholder')} />
          </Field>
        </FormSection>
      </Card>

      <Card padded>
        <FormSection title={t('recordForm.sections.attendance')} columns={3}>
          <Field label={t('recordForm.fields.studentsPlan')} required>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              value={data.students_plan ?? ''}
              onChange={(e) => onChange({ students_plan: parseInt(e.target.value) || 0 })}
              className="tabular"
            />
          </Field>
          <Field
            label={t('recordForm.fields.studentsFact')}
            required
            error={factExceedsPlan ? t('recordForm.errors.factExceedsPlan') : undefined}
          >
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              max={data.students_plan ?? 0}
              value={data.students_fact ?? ''}
              onChange={(e) => onChange({ students_fact: parseInt(e.target.value) || 0 })}
              className="tabular"
            />
          </Field>
          {/* Предпросмотр посещаемости (только чтение) */}
          <div className="flex min-w-0 flex-col gap-1.5">
            <p className="text-sm font-medium text-fg">{t('recordForm.fields.attendance')}</p>
            <output
              aria-live="polite"
              className={cn(
                'flex min-h-10 items-center rounded-md border border-line bg-surface-muted px-3 text-sm font-semibold tabular',
                attendance === null ? 'text-fg-subtle' : factExceedsPlan ? 'text-danger' : 'text-fg',
              )}
            >
              {attendance === null ? '—' : `${attendance}%`}
            </output>
          </div>
        </FormSection>
      </Card>
    </div>
  )
}
