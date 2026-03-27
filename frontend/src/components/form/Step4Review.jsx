import { useTranslation } from 'react-i18next'

export default function Step4Review({ data, onChange }) {
  const { t } = useTranslation()
  const filledRatings = Object.values(data.ratings).filter((value) => Number.isInteger(value))
  const avg = filledRatings.length
    ? (filledRatings.reduce((a, b) => a + b, 0) / filledRatings.length).toFixed(2)
    : '—'
  const attendance = data.students_plan
    ? Math.round((data.students_fact / data.students_plan) * 100)
    : 0

  const rows = () => [
    [t('steps.reviewTeacher'), data.teacher],
    [t('steps.reviewSubmittedBy'), data.submitted_by],
    [t('steps.reviewSubject'), data.subject],
    [t('steps.reviewFaculty'), data.faculty],
    [t('steps.reviewOp'), data.op],
    [t('steps.reviewGroup'), data.group_name],
    [t('steps.reviewRoom'), data.room],
    [t('steps.reviewLessonType'), data.lesson_type],
    [t('steps.reviewFormat'), data.format],
    [t('steps.reviewTopic'), data.topic],
    [t('steps.reviewDateTime'), data.datetime ? new Date(data.datetime).toLocaleString('ru-RU') : '—'],
    [t('steps.reviewYear'), data.academic_year],
    [t('steps.reviewStudents'), `${data.students_plan} / ${data.students_fact}`],
    [t('steps.reviewAttendance'), `${attendance}%`],
    [t('steps.reviewAvgScore'), avg],
  ]

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">{t('steps.reviewTitle')}</h2>

      {/* Summary table */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm divide-y divide-gray-100 dark:divide-gray-800">
          <tbody>
            {rows().map(([k, v]) => (
              <tr key={k} className="divide-x divide-gray-100 dark:divide-gray-800">
                <td className="px-4 py-2.5 w-48 text-gray-500 dark:text-gray-400 font-medium">{k}</td>
                <td className="px-4 py-2.5 text-gray-800 dark:text-gray-200">{v || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Comment */}
      <div>
        <label className="label">{t('steps.comment')}</label>
        <textarea
          className="input resize-none"
          rows={3}
          value={data.comment ?? ''}
          onChange={(e) => onChange({ comment: e.target.value })}
          placeholder={t('steps.commentPlaceholder')}
          required
        />
      </div>
    </div>
  )
}
