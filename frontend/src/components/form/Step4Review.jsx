export default function Step4Review({ data, onChange }) {
  const filledRatings = Object.values(data.ratings).filter((value) => Number.isInteger(value))
  const avg = filledRatings.length
    ? (filledRatings.reduce((a, b) => a + b, 0) / filledRatings.length).toFixed(2)
    : '—'
  const attendance = data.students_plan
    ? Math.round((data.students_fact / data.students_plan) * 100)
    : 0

  const rows = [
    ['Преподаватель', data.teacher],
    ['Кто отправляет форму', data.submitted_by],
    ['Дисциплина', data.subject],
    ['Факультет', data.faculty],
    ['ОП', data.op],
    ['Группа', data.group_name],
    ['Аудитория', data.room],
    ['Тип занятия', data.lesson_type],
    ['Формат', data.format],
    ['Тема', data.topic],
    ['Дата и время', data.datetime ? new Date(data.datetime).toLocaleString('ru-RU') : '—'],
    ['Учебный год', data.academic_year],
    ['Студентов (план / факт)', `${data.students_plan} / ${data.students_fact}`],
    ['Посещаемость', `${attendance}%`],
    ['Средний балл (расчет)', avg],
  ]

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Подтверждение</h2>

      {/* Summary table */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm divide-y divide-gray-100 dark:divide-gray-800">
          <tbody>
            {rows.map(([k, v]) => (
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
        <label className="label">Комментарий *</label>
        <textarea
          className="input resize-none"
          rows={3}
          value={data.comment ?? ''}
          onChange={(e) => onChange({ comment: e.target.value })}
          placeholder="Обязательное заполнение комментарий по занятию, отражение пунктов, по которым снижена оценка или что наиболее понравилось в проведение занятия"
          required
        />
      </div>
    </div>
  )
}
