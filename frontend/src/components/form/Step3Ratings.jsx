// Step 3: Ratings matrix (values 1-10)
const SECTIONS = [
  {
    id: 1,
    title: '1. Оценка содержания и методики проведения занятия',
    criteria: [
      { key: '1.1', label: 'Соответствие темы и содержания занятия силлабусу' },
      { key: '1.2', label: 'Системность и логическая последовательность в содержании материала' },
      { key: '1.3', label: 'Содержание и изложение учебного материала' },
      { key: '1.4', label: 'Организация самостоятельной работы обучающихся' },
      { key: '1.5', label: 'Использование эффективных методов контроля хода занятия и результатов выполнения заданий обучающимися' },
      { key: '1.6', label: 'Рациональность использования времени на изучение учебных вопросов' },
      { key: '1.7', label: 'Соответствие преподавания дисциплины заявленному языку обучения (казахский, английский, русский)' },
    ],
  },
  {
    id: 2,
    title: '2. Оценка педагогических данных преподавателя',
    criteria: [
      { key: '2.1', label: 'Использование приемов поддержания внимания обучающихся и способность установить с ними контакт' },
      { key: '2.2', label: 'Умение вызвать и поддержать интерес аудитории к дисциплине' },
      { key: '2.3', label: 'Ясность и доступность учебного материала' },
      { key: '2.4', label: 'Культура речи, дикция, эрудиция, внешний вид, манера поведения, умение держаться перед аудиторией' },
      { key: '2.5', label: 'Доброжелательность и такт по отношению к обучающемуся' },
      { key: '2.6', label: 'Организация и активизация деятельности обучающихся, побуждение к высказыванию и анализ выступлений' },
    ],
  },
  {
    id: 3,
    title: '3. Оценка научно-практических работ преподавателя',
    criteria: [
      { key: '3.1', label: 'Использование ТСО, современных интерактивных методов, цифровых ресурсов и наглядных материалов' },
      { key: '3.2', label: 'Творческий подход и интерес к своему делу' },
      { key: '3.3', label: 'Практическое применение знаний. Практико-ориентированность' },
      { key: '3.4', label: 'Актуальность и новизна предлагаемого материала' },
    ],
  },
]

function ScoreInput({ value, onChange }) {
  return (
    <div className="flex items-center gap-2">
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className="input"
      >
        <option value="">— выберите —</option>
        {Array.from({ length: 10 }, (_, index) => 10 - index).map((score) => (
          <option key={score} value={score}>{score}</option>
        ))}
      </select>
      <span className={`w-12 text-center text-sm font-bold ${
        value >= 8 ? 'text-green-600 dark:text-green-400'
        : value >= 6 ? 'text-yellow-600 dark:text-yellow-400'
        : value >= 1 ? 'text-red-600 dark:text-red-400'
        : 'text-gray-400 dark:text-gray-500'
      }`}>
        {value ?? '—'}
      </span>
    </div>
  )
}

export default function Step3Ratings({ ratings, onChange }) {
  const filledRatings = Object.values(ratings).filter((value) => Number.isInteger(value))
  const avg = filledRatings.length
    ? (filledRatings.reduce((a, b) => a + b, 0) / filledRatings.length).toFixed(2)
    : '—'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Рейтинговые оценки</h2>
        <div className="text-sm">
          Средний балл:{' '}
          <span className={`font-bold text-base ${
            avg >= 8 ? 'text-green-600 dark:text-green-400'
            : avg >= 6 ? 'text-yellow-600 dark:text-yellow-400'
            : 'text-red-600 dark:text-red-400'
          }`}>
            {avg}
          </span>
        </div>
      </div>

      <div className="card p-3 text-xs text-gray-600 dark:text-gray-400 space-y-1">
        <p>Шкала посещения/оценки: 10 = 100%, 9 = 90%, 8 = 80%, 7 = 70%, 6 = 60%, 5 = 50%, 4 = 40%, 3 = 30%, 2 = 20%, 1 = 10%.</p>
        <p>Уровни: высокий (10-9), достаточно высокий (8-7), недостаточно высокий (6-5), низкий (4-3), критерий не соответствует ожиданиям (2-1).</p>
      </div>

      {SECTIONS.map((section) => (
        <div key={section.id} className="card p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{section.title}</h3>
          {section.criteria.map(({ key, label }) => (
            <div key={key} className="grid grid-cols-[1fr_2fr] items-center gap-4">
              <span className="text-sm text-gray-600 dark:text-gray-400">
                <span className="font-mono text-xs text-gray-400 dark:text-gray-500 mr-1">{key}</span>
                {label}
              </span>
              <ScoreInput
                value={ratings[key] ?? null}
                onChange={(v) => onChange({ ...ratings, [key]: v })}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
