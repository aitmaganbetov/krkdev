const STATUS_MAP = {
  draft:     { label: 'Черновик',   cls: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300' },
  submitted: { label: 'Отправлено',  cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  approved:  { label: 'Утверждено', cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
  rework:    { label: 'На доработку', cls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300' },
  accepted:  { label: 'Принято', cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
}

export default function StatusBadge({ status }) {
  const cfg = STATUS_MAP[status] ?? { label: status, cls: 'bg-gray-100 text-gray-600' }
  return <span className={`badge ${cfg.cls}`}>{cfg.label}</span>
}
