// Step 2: Lesson details
const LESSON_TYPES = ['Лекция', 'Практика', 'Лабораторная', 'Семинар']
const FORMATS      = ['в традиционном очном формате', 'дистанционное занятие с использованием системы ZOOM']

export default function Step2Details({ data, onChange }) {
  const academicYears = data.academic_year_options ?? []
  const field = (name) => ({
    value: data[name] ?? '',
    onChange: (e) => onChange({ [name]: e.target.value }),
    className: 'input',
    required: true,
  })

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Детали занятия</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="label">Тип занятия *</label>
          <select {...field('lesson_type')}>
            <option value="">— выберите —</option>
            {LESSON_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Форма проведения *</label>
          <select {...field('format')}>
            <option value="">— выберите —</option>
            {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>

        <div className="sm:col-span-2">
          <label className="label">Тема занятия *</label>
          <textarea
            {...field('topic')}
            rows={2}
            placeholder="Введите тему занятия"
            className="input resize-none"
          />
        </div>

        <div>
          <label className="label">Дата и время *</label>
          <input type="datetime-local" {...field('datetime')} />
        </div>
        <div>
          <label className="label">Учебный год *</label>
          <select {...field('academic_year')}>
            <option value="">— выберите —</option>
            {academicYears.map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
        </div>

        <div>
          <label className="label">Студентов по плану *</label>
          <input
            type="number"
            min={0}
            value={data.students_plan ?? ''}
            onChange={(e) => onChange({ students_plan: parseInt(e.target.value) || 0 })}
            className="input"
            required
          />
        </div>
        <div>
          <label className="label">Студентов фактически *</label>
          <input
            type="number"
            min={0}
            max={data.students_plan ?? 0}
            value={data.students_fact ?? ''}
            onChange={(e) => onChange({ students_fact: parseInt(e.target.value) || 0 })}
            className="input"
            required
          />
        </div>
      </div>

      {/* Attendance preview */}
      {data.students_plan > 0 && (
        <div className="text-sm text-gray-500 dark:text-gray-400">
          Посещаемость:{' '}
          <span className="font-semibold text-gray-700 dark:text-gray-300">
            {Math.round((data.students_fact / data.students_plan) * 100)}%
          </span>
        </div>
      )}
    </div>
  )
}
