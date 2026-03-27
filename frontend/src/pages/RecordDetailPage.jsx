import { useEffect, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { 
  getRecord, deleteRecord, submitRecord, sendRecordToRework, acceptRecord 
} from '../services/api'
import { useAuth } from '../context/AuthContext'
import Spinner from '../components/Spinner'
import StatusBadge from '../components/StatusBadge'
import { isSameIdentity } from '../utils/identity'

const RATING_KEYS = [
  '1.1','1.2','1.3','1.4','1.5','1.6','1.7',
  '2.1','2.2','2.3','2.4','2.5','2.6',
  '3.1','3.2','3.3','3.4',
]

function RatingBar({ ratingKey, label, value }) {
  const pct = (value / 10) * 100
  const color = value >= 8 ? 'bg-green-500' : value >= 6 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-3 text-sm print:items-start">
      <span className="w-6 text-xs font-mono text-gray-400 print:flex-shrink-0">{ratingKey}</span>
      <span className="flex-1 text-gray-600 dark:text-gray-400 truncate print:truncate-none print:whitespace-normal print:break-words">{label}</span>
      <div className="w-28 bg-gray-200 dark:bg-gray-700 rounded-full h-2 print:w-24 print:flex-shrink-0 print:mt-1">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-5 text-right font-semibold text-gray-800 dark:text-gray-200 print:flex-shrink-0">{value}</span>
    </div>
  )
}

export default function RecordDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useTranslation()
  const [record, setRecord] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState('')
  const [actionsLoading, setActionsLoading] = useState(false)
  const { role, currentUser } = useAuth()
  const isOwner = isSameIdentity(record?.submitted_by, currentUser)

  const canEdit = ((role === 'admin' || role === 'inspector') && record?.status !== 'accepted')
    || (role === 'staff' && ['draft', 'rework'].includes(record?.status) && isOwner)
  const canDelete = (role === 'admin' || role === 'inspector') && record?.status !== 'accepted'
  const canSubmit = role === 'staff' && ['draft', 'rework'].includes(record?.status) && isOwner
  const canSendToRework = (role === 'admin' || role === 'inspector') && record?.status === 'submitted'
  const canAccept = (role === 'admin' || role === 'inspector') && ['submitted', 'rework'].includes(record?.status)

  useEffect(() => {
    getRecord(id)
      .then(setRecord)
      .catch(() => setError(t('record.notFound')))
      .finally(() => setLoading(false))
  }, [id])

  const handleDelete = async () => {
    if (!window.confirm(t('record.deleteConfirm'))) return
    setActionsLoading(true)
    try {
      await deleteRecord(id)
      navigate('/records')
    } catch (err) {
      setError(err.response?.data?.detail ?? 'Ошибка при удалении')
      setActionsLoading(false)
    }
  }

  const handleSubmit = async () => {
    if (!window.confirm(t('record.submitConfirm'))) return
    setActionsLoading(true)
    try {
      const updated = await submitRecord(id)
      setRecord(updated)
      setActionsLoading(false)
    } catch (err) {
      setError(err.response?.data?.detail ?? 'Ошибка при отправке')
      setActionsLoading(false)
    }
  }

  const handleSendToRework = async () => {
    if (!window.confirm(t('record.reworkConfirm'))) return
    setActionsLoading(true)
    try {
      const updated = await sendRecordToRework(id)
      setRecord(updated)
      setActionsLoading(false)
    } catch (err) {
      setError(err.response?.data?.detail ?? 'Ошибка при отправке на доработку')
      setActionsLoading(false)
    }
  }

  const handleAccept = async () => {
    if (!window.confirm(t('record.acceptConfirm'))) return
    setActionsLoading(true)
    try {
      const updated = await acceptRecord(id)
      setRecord(updated)
      setActionsLoading(false)
    } catch (err) {
      setError(err.response?.data?.detail ?? 'Ошибка при принятии')
      setActionsLoading(false)
    }
  }

  const handlePrint = () => {
    window.print()
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>
  if (!record) return <p className="text-red-500 text-center mt-20">{error || t('record.notFound')}</p>

  const { ratings = {} } = record

  return (
    <div className="space-y-5 print:max-w-none print:space-y-4">
      {location.state?.notice && (
        <div className="rounded-xl border border-green-200 bg-green-50 text-green-800 px-4 py-3 text-sm dark:bg-green-900/20 dark:border-green-800 dark:text-green-300 print:hidden">
          {location.state.notice}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 text-red-800 px-4 py-3 text-sm dark:bg-red-900/20 dark:border-red-800 dark:text-red-300 print:hidden">
          {error}
          <button 
            className="ml-2 font-semibold hover:underline"
            onClick={() => setError('')}
          >
            ✕
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 print:block">
        <div>
          <button
            className="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 mb-2 print:hidden"
            onClick={() => navigate(-1)}
          >
            {t('record.back')}
          </button>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{record.subject}</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">{record.teacher}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end print:hidden">
          <StatusBadge status={record.status} />
          <div className="flex gap-2 flex-wrap justify-end">
            <button
              className="btn-secondary text-sm"
              onClick={handlePrint}
              type="button"
            >
              {t('record.print')}
            </button>
            {canEdit && (
              <button
                className="btn-secondary text-sm"
                onClick={() => navigate(`/records/${id}/edit`)}
              >
                {t('record.edit')}
              </button>
            )}
            {canSubmit && (
              <button 
                className="btn-primary text-sm" 
                onClick={handleSubmit}
                disabled={actionsLoading}
              >
                {actionsLoading ? '...' : t('record.submit')}
              </button>
            )}
            {canSendToRework && (
              <button 
                className="btn-warning text-sm" 
                onClick={handleSendToRework}
                disabled={actionsLoading}
              >
                {actionsLoading ? '...' : t('record.toRework')}
              </button>
            )}
            {canAccept && (
              <button 
                className="btn-success text-sm" 
                onClick={handleAccept}
                disabled={actionsLoading}
              >
                {actionsLoading ? '...' : t('record.accept')}
              </button>
            )}
            {canDelete && (
              <button 
                className="btn-danger text-sm" 
                onClick={handleDelete}
                disabled={actionsLoading}
              >
                {actionsLoading ? '...' : t('record.deleteBtn')}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 print:grid-cols-1 print:gap-3">        {/* Scores */}
        <div className="lg:col-span-1 space-y-4 print:grid print:grid-cols-2 print:gap-3 print:space-y-0">
          <div className="card p-4 text-center">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{t('record.totalScore')}</p>
            <p className={`text-5xl font-bold ${
              record.score >= 7 ? 'text-green-600 dark:text-green-400'
              : record.score >= 5 ? 'text-yellow-500 dark:text-yellow-400'
              : 'text-red-600 dark:text-red-400'
            }`}>{record.score.toFixed(1)}</p>
            <p className="text-xs text-gray-400 mt-1">{t('record.outOf10')}</p>
          </div>
          <div className="card p-4 text-center">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{t('record.attendance')}</p>
            <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">
              {record.attendance.toFixed(0)}%
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {record.students_fact} / {record.students_plan} {t('record.students')}
            </p>
          </div>
        </div>

        {/* Details */}
        <div className="lg:col-span-2 space-y-4">
          <div className="card p-4">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">{t('record.info')}</h2>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm print:grid-cols-1">
              {[
                [t('record.faculty'), record.faculty],
                [t('record.op'), record.op],
                [t('record.group'), record.group_name],
                [t('record.room'), record.room],
                [t('record.type'), record.lesson_type],
                [t('record.format'), record.format],
                [t('record.submittedBy'), record.submitted_by_display || record.submitted_by || '—'],
                [t('record.reviewedBy'), record.reviewed_by_display || record.reviewed_by || '—'],
                [t('record.academicYear'), record.academic_year],
                [t('record.date'), new Date(record.datetime).toLocaleString('ru-RU')],
              ].map(([k, v]) => (
                <div key={k} className="flex gap-2 print:block">
                  <dt className="text-gray-400 w-28 flex-shrink-0 print:w-auto print:mb-1">{k}:</dt>
                  <dd className="text-gray-800 dark:text-gray-200 font-medium break-words whitespace-normal">{v}</dd>
                </div>
              ))}
            </dl>
            {record.topic && (
              <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800 text-sm">
                <span className="text-gray-400">{t('record.topic')}: </span>
                <span className="text-gray-800 dark:text-gray-200 break-words whitespace-normal">{record.topic}</span>
              </div>
            )}
            {record.comment && (
              <div className="mt-2 text-sm">
                <span className="text-gray-400">{t('record.comment')}: </span>
                <span className="text-gray-600 dark:text-gray-400 italic break-words whitespace-normal">{record.comment}</span>
              </div>
            )}
          </div>

          {/* Ratings breakdown */}
          <div className="card p-4">
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">{t('record.ratings')}</h2>
            <div className="space-y-2">
              {RATING_KEYS.map((key) => (
                <RatingBar key={key} ratingKey={key} label={t(`ratings.${key}`)} value={ratings[key] ?? 0} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
