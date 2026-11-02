import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  apiErrorText, createPeerVisit, getAcademicYears, getBasicInfoCatalog, getMyPeerVisitSchedule, getPeerVisit, updatePeerVisit,
} from '../services/api'
import {
  Alert, Badge, Button, Card, Combobox, EmptyState, Field, FormSection, Input, LoadingBlock, PageHeader, PageStack,
  RadioGroup, Select, Textarea,
} from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { datetimeLocalToIsoUtcPlus5, toDatetimeLocalUtcPlus5 } from '../utils/datetime'
import { peerVisitFromLesson } from '../utils/scheduleLesson'
import {
  COMMENT_FIELDS, CRITERIA, EDUCATION_LEVELS, FACULTIES, FACULTY_CODE_BY_ID, LANGUAGES, LESSON_TYPES, LEVELS, LEVEL_RANGES, LEVEL_TONE,
  averageLevelScore, createInitialPeerVisit, fromPeerVisit, overallLevel, toPeerVisitPayload, validatePeerVisit,
} from '../utils/peerVisit'

// Данные посещающего запоминаются в браузере и подставляются в следующий отзыв
const VISITOR_STORAGE_KEY = 'peerVisit.visitor'
const VISITOR_FIELDS = ['visitor_name', 'visitor_position', 'visitor_degree']

function loadVisitor() {
  try {
    const saved = JSON.parse(localStorage.getItem(VISITOR_STORAGE_KEY) || '{}')
    return Object.fromEntries(VISITOR_FIELDS.map((f) => [f, typeof saved[f] === 'string' ? saved[f] : '']))
  } catch {
    return {}
  }
}

function saveVisitor(data) {
  try {
    localStorage.setItem(VISITOR_STORAGE_KEY, JSON.stringify(Object.fromEntries(VISITOR_FIELDS.map((f) => [f, data[f] || '']))))
  } catch { /* private mode */ }
}

const COURSES = { bachelor: [1, 2, 3, 4, 5], master: [1, 2] }

export default function PeerVisitFormPage() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const [searchParams] = useSearchParams()
  const scheduleId = isEdit ? null : Number(searchParams.get('schedule')) || null
  // Строка графика, по которой заполняется отзыв (из «Моего плана посещений»)
  const [scheduleRow, setScheduleRow] = useState(null)
  const { t } = useTranslation()
  const navigate = useNavigate()
  // Занятие со страницы «Расписание»: отзыв открывается заполненным по нему
  const locationLesson = useLocation().state?.lesson
  const lesson = isEdit ? null : locationLesson
  const [data, setData] = useState(() => (isEdit
    ? createInitialPeerVisit()
    : { ...createInitialPeerVisit(), ...loadVisitor(), ...(lesson ? peerVisitFromLesson(lesson) : {}) }))
  const [status, setStatus] = useState('draft')
  const [loading, setLoading] = useState(isEdit)
  const [loadError, setLoadError] = useState('')
  const [academicYears, setAcademicYears] = useState([])
  const [catalog, setCatalog] = useState({ teachers: [], groups: [], cafedras: [] })
  const [showErrors, setShowErrors] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getAcademicYears()
      .then((years) => {
        setAcademicYears(years.map((year) => year.name))
        const defaultYear = years.find((year) => year.is_default)?.name
        if (defaultYear && !isEdit) setData((d) => (d.academic_year ? d : { ...d, academic_year: defaultYear }))
      })
      .catch(() => {})
    // Подсказки ФИО и групп из справочника Platonus; без него поля заполняются вручную
    getBasicInfoCatalog()
      .then((result) => {
        const groups = new Set()
        ;(result.faculties || []).forEach((f) => (f.specializations || []).forEach((s) => (s.groups || []).forEach((g) => g.name && groups.add(g.name))))
        setCatalog({
          teachers: result.teachers || [],
          groups: Array.from(groups).sort((a, b) => a.localeCompare(b)),
          cafedras: (result.cafedras || []).map((c) => c.name_ru).filter(Boolean),
        })
      })
      .catch(() => {})
  }, [isEdit])

  // Отзыв по графику: посещаемый, кафедра, факультет и данные посещающего — из строки графика
  useEffect(() => {
    if (!scheduleId) return
    getMyPeerVisitSchedule()
      .then((rows) => {
        const row = rows.find((item) => item.id === scheduleId)
        if (!row) return
        setScheduleRow(row)
        setData((d) => ({
          ...d,
          teacher: row.visited_name,
          department: row.cafedra_name || d.department,
          faculty: FACULTY_CODE_BY_ID[row.faculty_id] || d.faculty,
          academic_year: row.academic_year || d.academic_year,
          visitor_name: row.visitor_name || d.visitor_name,
          visitor_position: row.visitor_position || d.visitor_position,
        }))
      })
      .catch(() => {})
  }, [scheduleId])

  useEffect(() => {
    if (!isEdit) return
    getPeerVisit(id)
      .then((visit) => {
        setData({ ...fromPeerVisit(visit), datetime: toDatetimeLocalUtcPlus5(visit.datetime) })
        setStatus(visit.status)
      })
      .catch((err) => setLoadError(apiErrorText(err, t('peerVisits.notFound'))))
      .finally(() => setLoading(false))
  }, [id, isEdit])

  const errors = useMemo(() => validatePeerVisit(data), [data])
  const errorFor = (name) => {
    if (!showErrors || !errors[name]) return undefined
    return t(`peerVisits.errors.${errors[name]}`)
  }

  const update = (patch) => setData((d) => ({ ...d, ...patch }))
  const field = (name) => ({ value: data[name] ?? '', onChange: (e) => update({ [name]: e.target.value }) })
  // Кафедра преподавателя из Platonus подставляется, если поле ещё пустое
  const handleTeacherChange = (teacher, option) => {
    const cafedra = option?.description
    setData((d) => ({ ...d, teacher, department: !d.department.trim() && cafedra ? cafedra : d.department }))
  }
  // Варианты выпадающих списков с поиском: преподаватели (с кафедрой), кафедры, группы
  const teacherOptions = useMemo(
    () => catalog.teachers.map((item) => ({ value: item.id, label: item.full_name, description: item.cafedra || '' })),
    [catalog.teachers],
  )
  const cafedraOptions = useMemo(() => catalog.cafedras.map((name) => ({ value: name, label: name })), [catalog.cafedras])
  const groupOptions = useMemo(() => catalog.groups.map((name) => ({ value: name, label: name })), [catalog.groups])
  const setRating = (code, level) => setData((d) => ({ ...d, ratings: { ...d.ratings, [code]: level } }))

  const handleLevelChange = (level) => {
    // Курс вне диапазона нового уровня образования сбрасывается
    const keepCourse = COURSES[level].includes(Number(data.course))
    update({ education_level: level, course: keepCourse ? data.course : '' })
  }

  const score = averageLevelScore(data.ratings)
  const level = overallLevel(score)
  const { role, facultyId } = useAuth()
  // Деканат оформляет отзывы только по своему факультету
  const facultyChoices = role === 'dean' && FACULTY_CODE_BY_ID[facultyId] ? [FACULTY_CODE_BY_ID[facultyId]] : FACULTIES
  useEffect(() => {
    const own = role === 'dean' ? FACULTY_CODE_BY_ID[facultyId] : null
    if (!isEdit && own) setData((d) => (d.faculty === own ? d : { ...d, faculty: own }))
  }, [role, facultyId, isEdit])
  // «Пользователь» заполняет отзыв только по строке своего графика (из «Моего плана посещений»)
  const needsSchedule = !isEdit && (role === 'user' || role === 'teacher') && !scheduleId
  const locked = (isEdit && status === 'accepted') || needsSchedule

  const handleSubmit = async (event) => {
    event.preventDefault()
    const datetimeIso = datetimeLocalToIsoUtcPlus5(data.datetime)
    if (Object.keys(errors).length || !datetimeIso) {
      setShowErrors(true)
      setError(t('peerVisits.errors.form'))
      // Фокус на первое незаполненное поле — после отрисовки подсветки ошибок
      requestAnimationFrame(() => {
        document.querySelector('[aria-invalid="true"] input, input[aria-invalid="true"], select[aria-invalid="true"], textarea[aria-invalid="true"]')?.focus()
      })
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload = toPeerVisitPayload(data, datetimeIso)
      if (scheduleRow) payload.schedule_id = scheduleRow.id
      const saved = isEdit ? await updatePeerVisit(id, payload) : await createPeerVisit(payload)
      saveVisitor(data)
      navigate(`/peer-visits/${saved.id}`, { state: { notice: t('peerVisits.toast.saved') } })
    } catch (err) {
      setError(apiErrorText(err, t('peerVisits.apiErrors.save')))
      setSaving(false)
    }
  }

  const backTo = isEdit ? `/peer-visits/${id}` : '/peer-visits'

  if (loading) return <LoadingBlock label={t('ui.loading')} />
  if (loadError) {
    return (
      <Card>
        <EmptyState
          icon="file-text"
          title={loadError}
          action={<Button as={Link} to="/peer-visits" variant="secondary" icon="arrow-left">{t('peerVisits.backToList')}</Button>}
        />
      </Card>
    )
  }

  const choice = (values, group) => values.map((value) => ({ value, label: t(`peerVisits.${group}.${value}`) }))
  const courseOptions = (COURSES[data.education_level] || COURSES.bachelor).map((n) => ({ value: String(n), label: String(n) }))

  return (
    <PageStack>
      <PageHeader
        title={isEdit ? t('peerVisits.editTitle', { id }) : t('peerVisits.newTitle')}
        description={isEdit ? undefined : t('peerVisits.newSubtitle')}
        back={{ to: backTo, label: isEdit ? t('peerVisits.back') : t('peerVisits.backToList') }}
      />

      {isEdit && status === 'accepted' && <Alert tone="warning">{t('peerVisits.confirm.accept')}</Alert>}
      {needsSchedule && <Alert tone="info">{t('peerVisits.myPlan.onlyFromPlan')}</Alert>}
      {lesson && (
        <Alert tone="info">
          {t('schedulePage.prefilled', { subject: lesson.subject, date: lesson.date.split('-').reverse().join('.'), time: lesson.start_time })}
        </Alert>
      )}
      {scheduleRow && (
        <Alert tone="info">
          {t('peerVisits.fromSchedule', { month: `${t(`schedule.months.${scheduleRow.month}`)} ${scheduleRow.academic_year}`, teacher: scheduleRow.visited_name })}
        </Alert>
      )}

      <form noValidate onSubmit={handleSubmit} className="flex min-w-0 flex-col gap-6">
        <Card padded>
          <FormSection title={t('peerVisits.sections.lesson')}>
            <Field label={t('peerVisits.fields.datetime')} required error={errorFor('datetime')}>
              <Input type="datetime-local" {...field('datetime')} />
            </Field>
            <Field label={t('peerVisits.fields.academicYear')} required error={errorFor('academic_year')}>
              <Select
                {...field('academic_year')}
                placeholder={t('peerVisits.fields.select')}
                options={Array.from(new Set([...academicYears, data.academic_year].filter(Boolean))).map((y) => ({ value: y, label: y }))}
              />
            </Field>
            <Field label={t('peerVisits.fields.teacher')} required error={errorFor('teacher')}>
              <Combobox value={data.teacher} onChange={handleTeacherChange} options={teacherOptions}
                placeholder={t('peerVisits.fields.teacherPlaceholder')} sheetTitle={t('peerVisits.fields.teacher')} />
            </Field>
            <Field label={t('peerVisits.fields.department')} required error={errorFor('department')}>
              <Combobox value={data.department} onChange={(text) => update({ department: text })} options={cafedraOptions}
                sheetTitle={t('peerVisits.fields.department')} />
            </Field>
            <RadioGroup
              className="sm:col-span-2"
              legend={t('peerVisits.fields.faculty')}
              required
              columns={3}
              options={choice(facultyChoices, 'faculties')}
              value={data.faculty}
              onChange={(value) => update({ faculty: value })}
              error={errorFor('faculty')}
            />
            <RadioGroup
              legend={t('peerVisits.fields.educationLevel')}
              required
              options={choice(EDUCATION_LEVELS, 'educationLevels')}
              value={data.education_level}
              onChange={handleLevelChange}
              error={errorFor('education_level')}
            />
            <div className="grid min-w-0 gap-4 sm:grid-cols-2">
              <Field label={t('peerVisits.fields.course')} required error={errorFor('course')}>
                <Select {...field('course')} placeholder={t('peerVisits.fields.select')} options={courseOptions} />
              </Field>
              <Field label={t('peerVisits.fields.group')} required error={errorFor('group_name')}>
                <Combobox value={data.group_name} onChange={(text) => update({ group_name: text })} options={groupOptions}
                  sheetTitle={t('peerVisits.fields.group')} />
              </Field>
            </div>
            <Field label={t('peerVisits.fields.studentsPlan')} required error={errorFor('students_plan')}>
              <Input type="number" min="0" inputMode="numeric" {...field('students_plan')} />
            </Field>
            <Field label={t('peerVisits.fields.studentsFact')} required error={errorFor('students_fact')}>
              <Input type="number" min="0" inputMode="numeric" {...field('students_fact')} />
            </Field>
            <Field label={t('peerVisits.fields.language')} required error={errorFor('language')}>
              <Select {...field('language')} placeholder={t('peerVisits.fields.select')} options={choice(LANGUAGES, 'languages')} />
            </Field>
            <Field label={t('peerVisits.fields.subject')} required error={errorFor('subject')}>
              <Input {...field('subject')} />
            </Field>
            <RadioGroup
              className="sm:col-span-2"
              legend={t('peerVisits.fields.lessonType')}
              required
              columns={4}
              options={choice(LESSON_TYPES, 'lessonTypes')}
              value={data.lesson_type}
              onChange={(value) => update({ lesson_type: value })}
              error={errorFor('lesson_type')}
            />
            <Field label={t('peerVisits.fields.topic')} required error={errorFor('topic')} className="sm:col-span-2">
              <Textarea rows={2} {...field('topic')} />
            </Field>
          </FormSection>
        </Card>

        <Card padded>
          <FormSection title={t('peerVisits.sections.evaluation')} columns={1}>
            <ol className="flex min-w-0 flex-col divide-y divide-line">
              {CRITERIA.map((criterion) => {
                const hint = t(`peerVisits.criteria.${criterion.code}.hint`, { defaultValue: '' })
                const legend = (
                  <span className="flex min-w-0 gap-2">
                    <span className="shrink-0 tabular text-fg-subtle">{criterion.code}.</span>
                    <span className="min-w-0">
                      {t(`peerVisits.criteria.${criterion.code}.title`)}
                      {criterion.kind !== 'text' && <span className="ml-0.5 text-danger" aria-hidden="true">*</span>}
                      {hint && <span className="mt-0.5 block text-xs font-normal text-fg-subtle">{hint}</span>}
                    </span>
                  </span>
                )
                return (
                  <li key={criterion.code} className="min-w-0 py-4 first:pt-0 last:pb-0">
                    {criterion.kind === 'syllabus' && (
                      <RadioGroup
                        legend={legend}
                        required
                        requiredMark={false}
                        options={[
                          { value: true, label: t('peerVisits.syllabus.yes') },
                          { value: false, label: t('peerVisits.syllabus.no') },
                        ]}
                        value={data.syllabus_compliant}
                        onChange={(value) => update({ syllabus_compliant: value })}
                        error={errorFor('syllabus_compliant')}
                      />
                    )}
                    {criterion.kind === 'level' && (
                      <RadioGroup
                        legend={legend}
                        required
                        requiredMark={false}
                        columns={5}
                        options={LEVELS.map((value) => ({
                          value,
                          label: t(`peerVisits.levelsShort.${value}`),
                          description: LEVEL_RANGES[value],
                        }))}
                        value={data.ratings[criterion.code]}
                        onChange={(value) => setRating(criterion.code, value)}
                        error={errorFor(`rating_${criterion.code}`)}
                      />
                    )}
                    {criterion.kind === 'text' && (
                      <Field label={legend}>
                        <Textarea rows={2} {...field(criterion.field)} />
                      </Field>
                    )}
                  </li>
                )
              })}
            </ol>
            {/* Итог считается так же, как на сервере (средний балл уровней) */}
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-md bg-surface-muted px-4 py-3">
              <span className="text-sm font-medium text-fg">{t('peerVisits.summary.overall')}:</span>
              {level ? (
                <>
                  <Badge tone={LEVEL_TONE[level]}>{t(`peerVisits.levelsShort.${level}`)}</Badge>
                  <span className="text-sm text-fg-muted tabular">{t('peerVisits.summary.score', { score: score.toFixed(2) })}</span>
                </>
              ) : (
                <span className="text-sm text-fg-subtle">{t('peerVisits.summary.notRated')}</span>
              )}
            </div>
          </FormSection>
        </Card>

        <Card padded>
          <FormSection title={t('peerVisits.sections.comments')} columns={1}>
            {COMMENT_FIELDS.map((name) => (
              <Field key={name} label={t(`peerVisits.comments.${name}`)}>
                <Textarea rows={2} {...field(name)} />
              </Field>
            ))}
          </FormSection>
        </Card>

        <Card padded>
          <FormSection title={t('peerVisits.sections.visitor')} columns={3}>
            <Field label={t('peerVisits.fields.visitorName')} required error={errorFor('visitor_name')}>
              <Input {...field('visitor_name')} autoComplete="name" />
            </Field>
            <Field label={t('peerVisits.fields.visitorPosition')} required error={errorFor('visitor_position')}>
              <Input {...field('visitor_position')} />
            </Field>
            <Field label={t('peerVisits.fields.visitorDegree')}>
              <Input {...field('visitor_degree')} />
            </Field>
          </FormSection>
        </Card>

        {error && (
          <Alert tone="danger" onClose={() => setError('')} closeLabel={t('ui.close')}>{error}</Alert>
        )}

        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
          <Button variant="secondary" onClick={() => navigate(backTo)}>{t('common.cancel')}</Button>
          <Button type="submit" icon="check" loading={saving} disabled={locked}>{t('peerVisits.actions.save')}</Button>
        </div>
      </form>
    </PageStack>
  )
}
