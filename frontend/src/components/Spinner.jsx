import UISpinner from './ui/Spinner'

const SIZES = { sm: 16, md: 24, lg: 36 }

// Совместимость со старым API: <Spinner size="sm|md|lg" />
export default function Spinner({ size = 'md', className = 'text-primary' }) {
  return <UISpinner size={SIZES[size] || SIZES.md} className={className} />
}
