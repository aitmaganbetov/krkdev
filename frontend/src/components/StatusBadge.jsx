import { useTranslation } from 'react-i18next'
import Badge from './ui/Badge'

const TONE = {
  draft: 'neutral',
  submitted: 'info',
  rework: 'warning',
  approved: 'success',
  accepted: 'success',
}

export default function StatusBadge({ status }) {
  const { t } = useTranslation()
  const known = status in TONE
  return (
    <Badge tone={TONE[status] || 'neutral'} dot>
      {known ? t(`status.${status}`) : status}
    </Badge>
  )
}
