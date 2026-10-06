import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { getBasicInfoCatalog, getRecord, updateRecord } from '../services/api'
import { useAuth } from '../context/AuthContext'
import StepIndicator from '../components/StepIndicator'
import Step1Basic    from '../components/form/Step1Basic'
import Step2Details  from '../components/form/Step2Details'
import Step3Ratings  from '../components/form/Step3Ratings'
import Step4Review   from '../components/form/Step4Review'
import { Alert, Button, Card, EmptyState, LoadingBlock, PageHeader, PageStack } from '../components/ui'
import { formErrorText } from '../locales/recordForm'
import { getRecordFormError, getRecordFormStepError } from '../utils/recordForm'
import { findTemplate, normalizeRatings, useRatingTemplates } from '../utils/ratingTemplate'
import { datetimeLocalToIsoUtcPlus5, toDatetimeLocalUtcPlus5 } from '../utils/datetime'

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
  const { t } = useTranslation()
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
  // Подсветка незаполненных полей после неудачной попытки перейти дальше / сохранить
  const [showErrors, setShowErrors] = useState(false)
  const stepsRef = useRef(null)
  const firstRender = useRef(true)
  const { templates, loading: templatesLoading } = useRatingTemplates()
  const academicYear = data?.academic_year
  const template = useMemo(() => findTemplate(templates, academicYear), [templates, academicYear])

  // Оценки записи приводим к справочнику её учебного года и вида занятия
  const lessonType = data?.lesson_type
  useEffect(() => {
    if (!template) return
    setData((d) => (d ? { ...d, ratings: normalizeRatings(template, d.ratings, d.lesson_type) } : d))
  }, [template, lessonType])

  useEffect(() => {
    getRecord(id)
      .then((r) => {
        const dt = toDatetimeLocalUtcPlus5(r.datetime)
        setData({
          ...r,
          datetime: dt,
          ratings: r.ratings || {},
        })
      })
      .catch(() => setError(t('common.notFound')))
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
        setCatalogError(err.response?.data?.detail ?? t('common.loadError'))
      })
      .finally(() => setCatalogLoading(false))
  }, [])

  // При смене шага возвращаем к началу формы
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return }
    stepsRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [step])

  if (loading) return <LoadingBlock label={t('ui.loading')} />
  if (!data) {
    return (
      <Card>
        <EmptyState
          icon="file-text"
          title={error || t('common.notFound')}
          action={<Button as={Link} to="/records" variant="secondary" icon="arrow-left">{t('recordForm.backToList')}</Button>}
        />
      </Card>
    )
  }

  const update = (patch) => setData((d) => ({ ...d, ...patch }))

  const next = () => {
    const stepError = getRecordFormStepError(step, data, template)
    if (stepError) {
      setError(stepError)
      setShowErrors(true)
      return
    }

    setError('')
    setShowErrors(false)
    setStep((s) => s + 1)
  }
  const back = () => { setShowErrors(false); setStep((s) => s - 1) }

  const handleSave = async () => {
    const formError = getRecordFormError(data, template)
    if (formError) {
      setError(formError)
      setShowErrors(true)
      return
    }

    setSaving(true)
    setError('')
    try {
      const payload = Object.fromEntries(
        EDITABLE_FIELDS.map((field) => [field, data[field]])
      )
      const datetimeIso = datetimeLocalToIsoUtcPlus5(data.datetime)
      if (!datetimeIso) {
        setError(t('common.error'))
        setSaving(false)
        return
      }
      payload.datetime = datetimeIso

      await updateRecord(id, payload)
      navigate(`/records/${id}`, { state: { notice: t('common.savedOk') } })
    } catch (err) {
      const detail = err.response?.data?.detail
      if (typeof detail === 'string') {
        setError(detail)
      } else {
        setError(t('common.saveError'))
      }
      setSaving(false)
    }
  }

  return (
    <PageStack>
      <PageHeader
        title={t('recordForm.editTitle', { id })}
        back={{ to: `/records/${id}`, label: t('recordForm.backToRecord') }}
      />

      <div ref={stepsRef} className="min-w-0 scroll-mt-20">
        <Card padded>
          <StepIndicator current={step} />
        </Card>
      </div>

      <div className="min-w-0">
        {step === 0 && (
          <Step1Basic
            data={data}
            onChange={update}
            catalog={catalog}
            catalogLoading={catalogLoading}
            catalogError={catalogError}
            showErrors={showErrors}
          />
        )}
        {step === 1 && (
          <Step2Details
            data={{ ...data, academic_year_options: catalog.academic_years || [] }}
            onChange={update}
            showErrors={showErrors}
          />
        )}
        {step === 2 && (
          <Step3Ratings
            ratings={data.ratings}
            onChange={(r) => update({ ratings: r })}
            template={template}
            academicYear={data.academic_year}
            lessonType={data.lesson_type}
            templatesLoading={templatesLoading}
            showErrors={showErrors}
          />
        )}
        {step === 3 && <Step4Review data={data} onChange={update} template={template} showErrors={showErrors} />}
      </div>

      {error && (
        <Alert tone="danger" onClose={() => setError('')} closeLabel={t('ui.close')}>
          {formErrorText(t, error)}
        </Alert>
      )}

      {/* Навигация по шагам */}
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
        {step === 0 ? (
          <Button variant="secondary" onClick={() => navigate(`/records/${id}`)}>{t('common.cancel')}</Button>
        ) : (
          <Button variant="secondary" icon="arrow-left" onClick={back}>{t('recordForm.back')}</Button>
        )}

        {step < 3 ? (
          <Button iconRight="chevron-right" onClick={next}>{t('recordForm.next')}</Button>
        ) : (
          <Button icon="check" onClick={handleSave} loading={saving}>{t('common.saveChanges')}</Button>
        )}
      </div>
    </PageStack>
  )
}
