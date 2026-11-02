import { useTranslation } from 'react-i18next'
import { Badge, Button, Field, Input, SegmentedControl, Textarea, cn } from '../ui'
import { CHECKLIST_ANSWERS, CHECKLIST_QUESTIONS, OUTCOME_TONE, deviations } from '../../utils/videoChecklist'
import { regionLocale } from '../../utils/locale'

// Части формы Ф. ДСР-9.1.3-2026-16-02 (чек-лист ситуационного видеомониторинга): вопросы, отчетность, итог.

export function OutcomeBadge({ status }) {
  const { t } = useTranslation()
  return <Badge tone={OUTCOME_TONE[status] || 'neutral'} dot>{t(`checklist.outcomes.${status}`, { defaultValue: status })}</Badge>
}

// «Наблюдения устанавливаются по вопросам»: по каждому — да / нет / неясно / не видно / НП
export function ChecklistQuestions({ answers, onChange, invalid }) {
  const { t } = useTranslation()
  const options = CHECKLIST_ANSWERS.map((value) => ({ value, label: t(`checklist.answers.${value}`) }))
  return (
    <ol className="flex min-w-0 flex-col gap-3">
      {CHECKLIST_QUESTIONS.map((question, index) => {
        const answer = answers[question.key]
        const deviation = answer === question.negative
        return (
          <li key={question.key}
            className={cn(
              'flex min-w-0 flex-col gap-2 rounded-md border p-3',
              deviation ? 'border-warning bg-warning-subtle' : invalid && !answer ? 'border-danger' : 'border-line',
            )}>
            <div className="min-w-0">
              <p className="text-sm font-medium text-fg">{index + 1}. {t(`checklist.questions.${question.key}.q`)}</p>
              <p className="mt-0.5 text-xs text-fg-subtle">{t(`checklist.questions.${question.key}.hint`)}</p>
            </div>
            <SegmentedControl size="sm" className="w-full" options={options} value={answer}
              ariaLabel={t(`checklist.questions.${question.key}.q`)}
              onChange={(value) => onChange({ ...answers, [question.key]: value })} />
          </li>
        )
      })}
    </ol>
  )
}

// Раздел «Отчетность» (без статуса и комментария): value — { schedule_check, repeat_observation_at, onsite_verification, tech_ticket }
export function ReportFields({ value, onChange }) {
  const { t } = useTranslation()
  const set = (key) => (e) => onChange({ ...value, [key]: e.target.value })
  return (
    <div className="grid min-w-0 gap-4 sm:grid-cols-2">
      <Field label={t('checklist.report.scheduleCheck')} className="sm:col-span-2">
        <Textarea rows={2} value={value.schedule_check} onChange={set('schedule_check')} />
      </Field>
      <Field label={t('checklist.report.repeat')} hint={t('checklist.report.repeatHint')}>
        <Input type="datetime-local" value={value.repeat_observation_at} onChange={set('repeat_observation_at')} />
      </Field>
      <Field label={t('checklist.report.onsite')} hint={t('checklist.report.onsiteHint')}>
        <Input value={value.onsite_verification} maxLength={255} onChange={set('onsite_verification')} />
      </Field>
      <Field label={t('checklist.report.ticket')} hint={t('checklist.report.ticketHint')}>
        <Input value={value.tech_ticket} maxLength={100} onChange={set('tech_ticket')} />
      </Field>
    </div>
  )
}

export const emptyReport = (item) => ({
  schedule_check: item?.schedule_check || '',
  // datetime-local: «YYYY-MM-DDTHH:MM»
  repeat_observation_at: item?.repeat_observation_at ? item.repeat_observation_at.slice(0, 16) : '',
  onsite_verification: item?.onsite_verification || '',
  tech_ticket: item?.tech_ticket || '',
})

export const reportPayload = (report) => ({ ...report, repeat_observation_at: report.repeat_observation_at || null })

// Краткое содержание наблюдения: расхождения по чек-листу (у записей до формы — пусто, показывается вид нарушения)
export function deviationLabels(t, item) {
  if (!item.checklist) return []
  return deviations(item.checklist).map((key) => t(`checklist.short.${key}`))
}

// Ответы чек-листа (только чтение): расхождения выделены
export function ChecklistAnswers({ checklist }) {
  const { t } = useTranslation()
  return (
    <ol className="flex min-w-0 flex-col divide-y divide-line rounded-md border border-line text-sm">
      {CHECKLIST_QUESTIONS.map((question, index) => {
        const answer = checklist[question.key]
        const deviation = answer === question.negative
        return (
          <li key={question.key} className="flex min-w-0 items-start justify-between gap-3 px-3 py-2">
            <span className="min-w-0 text-fg-muted">{index + 1}. {t(`checklist.questions.${question.key}.q`)}</span>
            <Badge tone={deviation ? 'warning' : answer === 'unclear' ? 'info' : 'neutral'} className="shrink-0">
              {answer ? t(`checklist.answers.${answer}`) : '—'}
            </Badge>
          </li>
        )
      })}
    </ol>
  )
}

export const formatStamp = (value, lang) => (value
  ? new Date(/[zZ+]/.test(value.slice(10)) ? value : `${value}Z`)
    .toLocaleString(regionLocale(lang), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  : '')

// Пояснения преподавателя к подписанному нарушению: объяснительная или справка, ЭЦП или скан
export function ResponsesList({ responses }) {
  const { t, i18n } = useTranslation()
  if (!responses?.length) return null
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-sm font-medium text-fg">{t('checklist.responses')}</p>
      <ul className="flex min-w-0 flex-col gap-2">
        {responses.map((response) => (
          <li key={response.id} className="flex min-w-0 flex-col gap-1.5 rounded-md border border-line p-3 text-sm">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="font-medium text-fg">{t(`checklist.responseKinds.${response.kind}`)}</span>
              <Badge tone={response.method === 'ecp' ? 'success' : 'neutral'} icon={response.method === 'ecp' ? 'key' : 'file-text'}>
                {t(`checklist.responseMethods.${response.method}`)}
              </Badge>
              <span className="text-xs text-fg-subtle tabular">{formatStamp(response.created_at, i18n.language)}</span>
            </div>
            {response.signer && <p className="text-xs text-fg-subtle">{response.signer}</p>}
            {response.text && <p className="whitespace-pre-line text-fg-muted">{response.text}</p>}
            {response.file_url && (
              <Button as="a" href={response.file_url} target="_blank" rel="noreferrer" variant="secondary" size="sm" icon="file-text" className="self-start">
                {response.original_name || t('checklist.openFile')}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
