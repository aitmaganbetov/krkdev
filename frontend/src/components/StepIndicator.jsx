import { useTranslation } from 'react-i18next'
import Icon from './ui/Icon'
import { cn } from './ui/cn'

/**
 * Шаги мастера записи. ≥ sm — все шаги с подписями; < sm — компактно «Шаг N из 4: название»
 * и полоса прогресса, чтобы длинные (казахские) подписи не распирали экран.
 */
export default function StepIndicator({ current }) {
  const { t } = useTranslation()
  const steps = [t('steps.step1'), t('steps.step2'), t('steps.step3'), t('steps.step4')]
  return (
    <nav aria-label={t('steps.label')} className="min-w-0">
      <div className="sm:hidden">
        <p className="text-sm font-medium text-fg">
          <span className="text-fg-subtle">{t('steps.counter', { n: current + 1, total: steps.length })}</span>{' '}
          {steps[current]}
        </p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-hover">
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${((current + 1) / steps.length) * 100}%` }} />
        </div>
      </div>
      <ol className="hidden min-w-0 items-start sm:flex">
        {steps.map((label, i) => {
          const done = i < current
          const active = i === current
          return (
            <li key={label} className={cn('flex min-w-0 items-start', i < steps.length - 1 && 'flex-1')} aria-current={active ? 'step' : undefined}>
              <div className="flex min-w-0 flex-col items-center gap-1.5 text-center">
                <span className={cn(
                  'grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 text-sm font-semibold tabular transition-colors',
                  done && 'border-primary bg-primary text-primary-on',
                  active && 'border-primary text-primary',
                  !done && !active && 'border-line-strong text-fg-subtle',
                )}>
                  {done ? <Icon name="check" size={16} strokeWidth={2.5} /> : i + 1}
                </span>
                <span className={cn('max-w-[9rem] text-xs font-medium', active ? 'text-fg' : 'text-fg-subtle')}>{label}</span>
              </div>
              {i < steps.length - 1 && (
                <div className={cn('mx-2 mt-4 h-0.5 min-w-4 flex-1 rounded-full', done ? 'bg-primary' : 'bg-line')} aria-hidden="true" />
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
