import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getBasicInfoCatalog, getRecord, updateRecord } from '../services/api'
import { useAuth } from '../context/AuthContext'
import Spinner from '../components/Spinner'
import StepIndicator from '../components/StepIndicator'
import Step1Basic    from '../components/form/Step1Basic'
import Step2Details  from '../components/form/Step2Details'
import Step3Ratings  from '../components/form/Step3Ratings'
import Step4Review   from '../components/form/Step4Review'
import {
  getRecordFormError,
  getRecordFormStepError,
  normalizeRatingsForForm,
} from '../utils/recordForm'

const EDITABLE_FIELDS = [
  'teacher',
  'subject',
  'faculty',
  'op',
  'group_name',
  'room',
  'lesson_type',
  'format',
  'topic',
  'datetime',
  'students_plan',
  'students_fact',
  'academic_year',
  'ratings',
  'comment',
]

export default function EditRecordPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { currentUser } = useAuth()

  const [step, setStep]     = useState(0)
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [catalog, setCatalog] = useState({ faculties: [], academic_years: [] })
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  useEffect(() => {
    getRecord(id)
      .then((r) => {
        // Normalize datetime for datetime-local input
        const dt = r.datetime ? r.datetime.slice(0, 16) : ''
        setData({
          ...r,
          datetime: dt,
          ratings: normalizeRatingsForForm(r.ratings),
        })
      })
      .catch(() => setError('Запись не найдена'))
      .finally(() => setLoading(false))
  }, [id, currentUser])

  useEffect(() => {
    getBasicInfoCatalog()
      .then((result) => {
        setCatalog(result)
        setCatalogError('')
      })
      .catch((err) => {
        setCatalog({ faculties: [], academic_years: [] })
        setCatalogError(err.response?.data?.detail ?? 'Не удалось загрузить справочники основной информации.')
      })
      .finally(() => setCatalogLoading(false))
  }, [])

  if (loading) return <div className="flex justify-center py-20"><Spinner size="lg" /></div>
  if (!data)   return <p className="text-red-500 text-center mt-20">{error}</p>

  const update = (patch) => setData((d) => ({ ...d, ...patch }))

  const next = () => {
    const stepError = getRecordFormStepError(step, data)
    if (stepError) {
      setError(stepError)
      return
    }

    setError('')
    setStep((s) => s + 1)
  }
  const back = () => setStep((s) => s - 1)

  const handleSave = async () => {
    const formError = getRecordFormError(data)
    if (formError) {
      setError(formError)
      return
    }

    setSaving(true)
    setError('')
    try {
      const payload = Object.fromEntries(
        EDITABLE_FIELDS.map((field) => [field, data[field]])
      )
      payload.datetime = new Date(data.datetime).toISOString()

      await updateRecord(id, payload)
      navigate(`/records/${id}`, { state: { notice: 'Успешно сохранено' } })
    } catch (err) {
      const detail = err.response?.data?.detail
      if (typeof detail === 'string') {
        setError(detail)
      } else {
        setError('Ошибка сохранения. Проверьте корректность данных формы.')
      }
      setSaving(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Редактирование записи #{id}</h1>
      </div>

      <div className="card p-6">
        <StepIndicator current={step} />

        <div className="min-h-[320px]">
          {step === 0 && (
            <Step1Basic
              data={data}
              onChange={update}
              catalog={catalog}
              catalogLoading={catalogLoading}
              catalogError={catalogError}
            />
          )}
          {step === 1 && <Step2Details data={{ ...data, academic_year_options: catalog.academic_years || [] }} onChange={update} />}
          {step === 2 && <Step3Ratings ratings={data.ratings} onChange={(r) => update({ ratings: r })} />}
          {step === 3 && <Step4Review data={data} onChange={update} />}
        </div>

        {error && (
          <div className="mt-4 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-100 dark:border-gray-800">
          <button
            type="button"
            onClick={step === 0 ? () => navigate(`/records/${id}`) : back}
            className="btn-secondary"
          >
            {step === 0 ? 'Отмена' : '← Назад'}
          </button>

          {step < 3 ? (
            <button type="button" onClick={next} className="btn-primary">Далее →</button>
          ) : (
            <button type="button" onClick={handleSave} disabled={saving} className="btn-primary">
              {saving ? <Spinner size="sm" /> : 'Сохранить изменения'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
