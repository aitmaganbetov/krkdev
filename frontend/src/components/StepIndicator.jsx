import { useTranslation } from 'react-i18next'



export default function StepIndicator({ current }) {
  const { t } = useTranslation()
  const STEPS = [t('steps.step1'), t('steps.step2'), t('steps.step3'), t('steps.step4')]
  return (
    <ol className="flex items-center w-full mb-8">
      {STEPS.map((label, i) => {
        const done    = i < current
        const active  = i === current
        return (
          <li key={i} className={`flex items-center ${i < STEPS.length - 1 ? 'flex-1' : ''}`}>
            <div className="flex flex-col items-center">
              <div className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold border-2 transition-colors ${
                done   ? 'bg-primary-600 border-primary-600 text-white'
                : active ? 'border-primary-600 text-primary-600 dark:text-primary-400'
                : 'border-gray-300 dark:border-gray-600 text-gray-400'
              }`}>
                {done ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                ) : i + 1}
              </div>
              <span className={`mt-1.5 text-xs font-medium whitespace-nowrap ${
                active ? 'text-primary-600 dark:text-primary-400' : 'text-gray-400 dark:text-gray-500'
              }`}>
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-0.5 mx-2 mb-5 transition-colors ${
                done ? 'bg-primary-600' : 'bg-gray-200 dark:bg-gray-700'
              }`} />
            )}
          </li>
        )
      })}
    </ol>
  )
}
