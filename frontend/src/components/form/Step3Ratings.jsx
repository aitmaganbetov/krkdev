import { useTranslation } from 'react-i18next'

// Step 3: Ratings matrix (values 1-10)
const SECTIONS = [
  {
    id: 1,
    titleKey: 'ratings.section1',
    criteria: [
      { key: '1.1' }, { key: '1.2' }, { key: '1.3' }, { key: '1.4' },
      { key: '1.5' }, { key: '1.6' }, { key: '1.7' },
    ],
  },
  {
    id: 2,
    titleKey: 'ratings.section2',
    criteria: [
      { key: '2.1' }, { key: '2.2' }, { key: '2.3' },
      { key: '2.4' }, { key: '2.5' }, { key: '2.6' },
    ],
  },
  {
    id: 3,
    titleKey: 'ratings.section3',
    criteria: [
      { key: '3.1' }, { key: '3.2' }, { key: '3.3' }, { key: '3.4' },
    ],
  },
]

function ScoreInput({ value, onChange }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-2">
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className="input"
      >
        <option value="">{t('steps.selectDefault')}</option>
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
  const { t } = useTranslation()
  const filledRatings = Object.values(ratings).filter((value) => Number.isInteger(value))
  const avg = filledRatings.length
    ? (filledRatings.reduce((a, b) => a + b, 0) / filledRatings.length).toFixed(2)
    : '—'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">{t('steps.ratingsTitle')}</h2>
        <div className="text-sm">
          {t('steps.avgScore')}{' '}
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
        <p>{t('steps.scaleNote')}</p>
        <p>{t('steps.levelsNote')}</p>
      </div>

      {SECTIONS.map((section) => (
        <div key={section.id} className="card p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t(section.titleKey)}</h3>
          {section.criteria.map(({ key }) => (
            <div key={key} className="grid grid-cols-[1fr_2fr] items-center gap-4">
              <span className="text-sm text-gray-600 dark:text-gray-400">
                <span className="font-mono text-xs text-gray-400 dark:text-gray-500 mr-1">{key}</span>
                {t(`ratings.${key}`)}
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
