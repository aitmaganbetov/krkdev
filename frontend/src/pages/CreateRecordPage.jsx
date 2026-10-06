import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { createRecord, getAcademicYears, getBasicInfoCatalog } from '../services/api'
import { useAuth } from '../context/AuthContext'
import StepIndicator from '../components/StepIndicator'
import Step1Basic    from '../components/form/Step1Basic'
import Step2Details  from '../components/form/Step2Details'
import Step3Ratings  from '../components/form/Step3Ratings'
import Step4Review   from '../components/form/Step4Review'
import { Alert, Button, Card, PageHeader, PageStack } from '../components/ui'
import { formErrorText } from '../locales/recordForm'
import { getRecordFormError, getRecordFormStepError } from '../utils/recordForm'
import { findTemplate, normalizeRatings, useRatingTemplates } from '../utils/ratingTemplate'
import { datetimeLocalToIsoUtcPlus5 } from '../utils/datetime'

function createInitial() {
  return {
    teacher: '', subject: '', faculty: '', op: '', group_name: '', room: '',
    lesson_type: '', format: '', topic: '', datetime: '', academic_year: '',
    students_plan: 0, students_fact: 0,
    ratings: {},
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
  // Подсветка незаполненных полей после неудачной попытки перейти дальше / сохранить
  const [showErrors, setShowErrors] = useState(false)
  const stepsRef = useRef(null)
  const firstRender = useRef(true)
  const { templates, loading: templatesLoading } = useRatingTemplates()
  const template = useMemo(() => findTemplate(templates, data.academic_year), [templates, data.academic_year])

  // При смене учебного года или вида занятия оставляем только вопросы, которые к ним относятся
  useEffect(() => {
    setData((d) => ({ ...d, ratings: normalizeRatings(template, d.ratings, d.lesson_type) }))
  }, [template, data.lesson_type])

  useEffect(() => {
    if (currentUser) {
      setData((prev) => (
        prev.submitted_by ? prev : { ...prev, submitted_by: currentUser }
      ))
    }
  }, [currentUser])

  // Учебный год по умолчанию из справочника (выбран админом или текущий по дате)
  useEffect(() => {
    getAcademicYears()
      .then((years) => {
        const defaultYear = years.find((year) => year.is_default)?.name
        if (defaultYear) setData((d) => (d.academic_year ? d : { ...d, academic_year: defaultYear }))
      })
      .catch(() => {})
  }, [])

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
  const back = () => { setError(''); setShowErrors(false); setStep((s) => s - 1) }

  const handleSubmit = async () => {
    const formError = getRecordFormError(data, template)
    if (formError) {
      setError(formError)
      setShowErrors(true)
      return
    }

    setSaving(true)
    setError('')
    try {
      const datetimeIso = datetimeLocalToIsoUtcPlus5(data.datetime)
      if (!datetimeIso) {
        setError(t('common.error'))
        setSaving(false)
        return
      }

      const payload = {
        ...data,
        datetime: datetimeIso,
      }
      delete payload.submitted_by
      const created = await createRecord(payload)
      navigate(`/records/${created.id}`, { state: { notice: t('common.saved') } })
    } catch (err) {
      setError(err.response?.data?.detail ?? t('common.saveError'))
      setSaving(false)
    }
  }

  // Ошибка проверки формы — на языке интерфейса; ответ сервера — как есть
  const errorMessage = typeof error === 'string' ? formErrorText(t, error) : t('common.saveError')

  return (
    <PageStack>
      <PageHeader
        title={t('createRecord.title')}
        description={t('createRecord.subtitle')}
        back={{ to: '/records', label: t('recordForm.backToList') }}
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
          {errorMessage}
        </Alert>
      )}

      {/* Навигация по шагам */}
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
        {step === 0 ? (
          <Button variant="secondary" onClick={() => navigate('/records')}>{t('common.cancel')}</Button>
        ) : (
          <Button variant="secondary" icon="arrow-left" onClick={back}>{t('recordForm.back')}</Button>
        )}

        {step < 3 ? (
          <Button iconRight="chevron-right" onClick={next}>{t('recordForm.next')}</Button>
        ) : (
          <Button icon="check" onClick={handleSubmit} loading={saving}>{t('common.save')}</Button>
        )}
      </div>
    </PageStack>
  )
}
