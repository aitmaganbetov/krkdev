import { useTranslation } from 'react-i18next'
import { formatDateTimeUtcPlus5 } from '../../utils/datetime'
import { computeScore, scoreTone, templateMaxScore } from '../../utils/ratingTemplate'
import { formatLabel, lessonTypeLabel } from '../../locales/recordForm'
import { Card, DescriptionList, Field, Textarea, cn } from '../ui'

const TONE_TEXT = { good: 'text-success', mid: 'text-warning', bad: 'text-danger', none: 'text-fg-subtle' }

const isEmpty = (value) => !(typeof value === 'string' && value.trim())

// Шаг 4: сводка перед сохранением и обязательный комментарий
export default function Step4Review({ data, onChange, template, showErrors = false }) {
  const { t } = useTranslation()
  const score = computeScore(template, data.ratings, data.lesson_type)
  const maxScore = templateMaxScore(template)
  const avg = score === null ? '—' : `${score.toFixed(2)} / ${maxScore}`
  const attendance = data.students_plan
    ? Math.round((data.students_fact / data.students_plan) * 100)
    : 0

  // Пустое значение показываем прочерком
  const item = (label, value, extra) => ({ label, value: value || '—', ...extra })

  const groups = [
    {
      title: t('recordForm.sections.teacherSubject'),
      items: [
        item(t('steps.reviewTeacher'), data.teacher),
        item(t('steps.reviewSubject'), data.subject),
        item(t('steps.reviewSubmittedBy'), data.submitted_by),
      ],
    },
    {
      title: t('recordForm.sections.groupRoom'),
      items: [
        item(t('steps.reviewFaculty'), data.faculty),
        item(t('steps.reviewOp'), data.op),
        item(t('steps.reviewGroup'), data.group_name),
        item(t('steps.reviewRoom'), data.room),
      ],
    },
    {
      title: t('recordForm.sections.lesson'),
      items: [
        item(t('steps.reviewLessonType'), data.lesson_type && lessonTypeLabel(t, data.lesson_type)),
        item(t('steps.reviewFormat'), data.format && formatLabel(t, data.format)),
        item(t('steps.reviewDateTime'), data.datetime ? formatDateTimeUtcPlus5(data.datetime) : '—'),
        item(t('steps.reviewYear'), data.academic_year),
        item(t('steps.reviewTopic'), data.topic, { full: true }),
      ],
    },
    {
      title: t('recordForm.sections.attendance'),
      items: [
        item(t('steps.reviewStudents'), <span className="tabular">{`${data.students_plan} / ${data.students_fact}`}</span>),
        item(t('steps.reviewAttendance'), <span className="tabular">{`${attendance}%`}</span>),
      ],
    },
  ]

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <h2 className="text-lg font-semibold text-fg">{t('steps.reviewTitle')}</h2>

      <div className="grid min-w-0 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="flex min-w-0 flex-col divide-y divide-line">
            {groups.map((group) => (
              <section key={group.title} className="min-w-0 p-4 sm:p-5">
                <h3 className="mb-3 text-sm font-semibold text-fg">{group.title}</h3>
                <DescriptionList items={group.items} />
              </section>
            ))}
          </div>
        </Card>

        {/* Итоговый балл */}
        <div className="flex min-w-0 flex-col gap-3 self-start rounded-lg border border-line bg-surface p-4 shadow-1 sm:p-5">
          <p className="text-sm font-medium text-fg-muted">{t('steps.reviewAvgScore')}</p>
          <p className={cn('text-3xl font-semibold tabular', TONE_TEXT[scoreTone(score, maxScore)])}>{avg}</p>
        </div>
      </div>

      <Card padded>
        <Field
          label={t('recordForm.fields.comment')}
          required
          hint={t('recordForm.fields.commentHint')}
          error={showErrors && isEmpty(data.comment) ? t('recordForm.required') : undefined}
        >
          <Textarea
            autoGrow
            rows={4}
            value={data.comment ?? ''}
            onChange={(e) => onChange({ comment: e.target.value })}
          />
        </Field>
      </Card>
    </div>
  )
}
