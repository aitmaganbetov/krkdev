import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { createRecord, getBasicInfoCatalog } from '../services/api'
import { useAuth } from '../context/AuthContext'
import StepIndicator from '../components/StepIndicator'
import Step1Basic    from '../components/form/Step1Basic'
import Step2Details  from '../components/form/Step2Details'
import Step3Ratings  from '../components/form/Step3Ratings'
import Step4Review   from '../components/form/Step4Review'
import Spinner from '../components/Spinner'
import { createEmptyRatings, getRecordFormError, getRecordFormStepError } from '../utils/recordForm'

function createInitial() {
  return {
    teacher: '', subject: '', faculty: '', op: '', group_name: '', room: '',
    lesson_type: '', format: '', topic: '', datetime: '', academic_year: '',
    students_plan: 0, students_fact: 0,
    ratings: createEmptyRatings(),
    comment: '',
  }
}

export default function CreateRecordPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const [step, setStep]     = useState(0)
  const [data, setData]     = useState(() => createInitial())
  const [catalog, setCatalog] = useState({ faculties: [], academic_years: [] })
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  useEffect(() => {
    if (currentUser) {
      setData((prev) => (
        prev.submitted_by ? prev : { ...prev, submitted_by: currentUser }
      ))
    }
  }, [currentUser])

  useEffect(() => {
    getBasicInfoCatalog()
      .then((result) => {
        setCatalog(result)
        setCatalogError('')
      })
      .catch((err) => {
        setCatalog({ faculties: [], academic_years: [] })
        setCatalogError(err.response?.data?.detail ?? t('common.loadError'))
      })
      .finally(() => setCatalogLoading(false))
  }, [])

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
  const back = () => { setError(''); setStep((s) => s - 1) }

  const handleSubmit = async () => {
    const formError = getRecordFormError(data)
    if (formError) {
      setError(formError)
      return
    }

    setSaving(true)
    setError('')
    try {
      const payload = {
        ...data,
        datetime: new Date(data.datetime).toISOString(),
      }
      delete payload.submitted_by
      const created = await createRecord(payload)
      navigate(`/records/${created.id}`, { state: { notice: t('common.saved') } })
    } catch (err) {
      setError(err.response?.data?.detail ?? t('common.saveError'))
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('createRecord.title')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('createRecord.subtitle')}</p>
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
            onClick={step === 0 ? () => navigate('/records') : back}
            className="btn-secondary"
          >
            {step === 0 ? t('common.cancel') : t('common.back')}
          </button>

          {step < 3 ? (
            <button type="button" onClick={next} className="btn-primary">
              {t('common.next')}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={saving}
              className="btn-primary"
            >
              {saving ? <Spinner size="sm" /> : t('common.save')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
