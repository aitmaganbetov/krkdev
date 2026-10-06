import { useTranslation } from 'react-i18next'
import { Alert, Card, Field, FormSection, Input, Select } from '../ui'

// Пустое ли текстовое поле (та же проверка, что в utils/recordForm.js)
const isEmpty = (value) => !(typeof value === 'string' && value.trim())

// Шаг 1: основная информация о занятии
export default function Step1Basic({ data, onChange, catalog, catalogLoading = false, catalogError = '', showErrors = false }) {
  const { t } = useTranslation()
  const catalogFaculties = catalog?.faculties ?? []
  const teacherOptions = catalog?.teachers ?? []

  const selectedFaculty = catalogFaculties.find((faculty) => faculty.name_ru === data.faculty)
  const facultyOptions = selectedFaculty || !data.faculty
    ? catalogFaculties
    : [{ id: `legacy-faculty-${data.faculty}`, name_ru: data.faculty, specializations: [] }, ...catalogFaculties]

  const specializationBaseOptions = selectedFaculty?.specializations ?? []
  const opValue = (s) => s.code ? `${s.code} - ${s.name_ru}` : s.name_ru
  const selectedSpecialization = specializationBaseOptions.find((s) => opValue(s) === data.op || s.name_ru === data.op)
  const specializationOptions = selectedSpecialization || !data.op
    ? specializationBaseOptions
    : [{ id: `legacy-specialization-${data.op}`, name_ru: data.op, groups: [] }, ...specializationBaseOptions]

  const groupBaseOptions = selectedSpecialization?.groups ?? []
  const groupOptions = groupBaseOptions.some((group) => group.name === data.group_name) || !data.group_name
    ? groupBaseOptions
    : [{ id: `legacy-group-${data.group_name}`, name: data.group_name }, ...groupBaseOptions]

  const field = (name) => ({
    value: data[name] ?? '',
    onChange: (e) => onChange({ [name]: e.target.value }),
  })

  // Ошибка под полем появляется после неудачной попытки перейти дальше
  const errorFor = (name) => (showErrors && isEmpty(data[name]) ? t('recordForm.required') : undefined)

  const handleFacultyChange = (e) => {
    onChange({ faculty: e.target.value, op: '', group_name: '' })
  }

  const handleSpecializationChange = (e) => {
    onChange({ op: e.target.value, group_name: '' })
  }

  const handleGroupChange = (e) => {
    onChange({ group_name: e.target.value })
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <h2 className="text-lg font-semibold text-fg">{t('steps.basicTitle')}</h2>

      {catalogLoading && <Alert tone="info">{t('steps.catalogLoading')}</Alert>}
      {catalogError && <Alert tone="warning">{catalogError}</Alert>}

      <Card padded>
        <FormSection title={t('recordForm.sections.teacherSubject')}>
          <Field label={t('recordForm.fields.teacher')} required error={errorFor('teacher')}>
            <Input
              {...field('teacher')}
              list="teacher-options"
              autoComplete="off"
              placeholder={t('recordForm.fields.teacherPlaceholder')}
            />
          </Field>
          <datalist id="teacher-options">
            {teacherOptions.map((teacher) => (
              <option key={teacher.id} value={teacher.full_name} />
            ))}
          </datalist>
          <Field label={t('recordForm.fields.subject')} required error={errorFor('subject')}>
            <Input {...field('subject')} placeholder={t('steps.subjectPlaceholder')} />
          </Field>
        </FormSection>
      </Card>

      <Card padded>
        <FormSection title={t('recordForm.sections.groupRoom')}>
          <Field label={t('recordForm.fields.faculty')} required error={errorFor('faculty')} className="sm:col-span-2">
            <Select
              value={data.faculty ?? ''}
              onChange={handleFacultyChange}
              placeholder={t('steps.selectFaculty')}
              options={facultyOptions.map((faculty) => ({ value: faculty.name_ru, label: faculty.name_ru }))}
            />
          </Field>
          <Field label={t('recordForm.fields.op')} required error={errorFor('op')} className="sm:col-span-2">
            <Select
              value={data.op ?? ''}
              onChange={handleSpecializationChange}
              disabled={!data.faculty}
              placeholder={data.faculty ? t('steps.selectOp') : t('steps.selectFacultyFirst')}
              options={specializationOptions.map((specialization) => ({
                value: opValue(specialization),
                label: opValue(specialization),
              }))}
            />
          </Field>
          <Field label={t('recordForm.fields.group')} required error={errorFor('group_name')}>
            <Select
              value={data.group_name ?? ''}
              onChange={handleGroupChange}
              disabled={!data.op}
              placeholder={data.op ? t('steps.selectGroup') : t('steps.selectOpFirst')}
              options={groupOptions.map((group) => ({ value: group.name, label: group.name }))}
            />
          </Field>
          <Field label={t('recordForm.fields.room')} required error={errorFor('room')}>
            <Input {...field('room')} placeholder={t('steps.roomPlaceholder')} />
          </Field>
        </FormSection>
      </Card>
    </div>
  )
}
