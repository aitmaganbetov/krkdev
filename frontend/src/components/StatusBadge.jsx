import { useTranslation } from 'react-i18next'

const STATUS_CLS = {
  draft:     'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  submitted: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  approved:  'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  rework:    'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  accepted:  'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
}

export default function StatusBadge({ status }) {
  const { t } = useTranslation()
  const cls = STATUS_CLS[status] ?? 'bg-gray-100 text-gray-600'
  const label = STATUS_CLS[status] ? t(`status.${status}`) : status
  return <span className={`badge ${cls}`}>{label}</span>
}
