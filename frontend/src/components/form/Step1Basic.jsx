import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Card, Combobox, Field, FormSection, Input, Select } from '../ui'
import { localizedName } from '../../utils/locale'

// Пустое ли текстовое поле (та же проверка, что в utils/recordForm.js)
const isEmpty = (value) => !(typeof value === 'string' && value.trim())

// Шаг 1: основная информация о занятии
export default function Step1Basic({ data, onChange, catalog, catalogLoading = false, catalogError = '', showErrors = false }) {
  const { t, i18n } = useTranslation()
  const catalogFaculties = catalog?.faculties ?? []
  // Все преподаватели — список пересобирается только при смене справочника, а не на каждый ввод в форме:
  // иначе Combobox заново фильтрует его при каждом нажатии клавиши в любом поле
  const teacherOptions = useMemo(() => (catalog?.teachers ?? []).map((teacher) => (
    { value: teacher.id, label: teacher.full_name, description: teacher.cafedra || '' }
  )), [catalog?.teachers])

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

  // В Platonus у ОП бывают разные группы с одинаковым названием; в записи хранится название — вариант один
  const groupBaseOptions = [...new Map((selectedSpecialization?.groups ?? []).map((group) => [group.name, group])).values()]
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
            <Combobox
              value={data.teacher ?? ''}
              onChange={(text) => onChange({ teacher: text })}
              options={teacherOptions}
              placeholder={t('recordForm.fields.teacherPlaceholder')}
              sheetTitle={t('recordForm.fields.teacher')}
            />
          </Field>
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
              options={facultyOptions.map((faculty) => ({ value: faculty.name_ru, label: localizedName(faculty, 'name', i18n.language) }))}
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
                // Значение — русское (так хранится в записи), подпись — на языке интерфейса
                label: [specialization.code, localizedName(specialization, 'name', i18n.language)].filter(Boolean).join(' - '),
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
