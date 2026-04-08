import { useTranslation } from 'react-i18next'

// Step 1: Basic class info
export default function Step1Basic({ data, onChange, catalog, catalogLoading = false, catalogError = '' }) {
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
    className: 'input',
    required: true,
  })

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
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">{t('steps.basicTitle')}</h2>

      {catalogLoading && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-300">
          {t('steps.catalogLoading')}
        </div>
      )}

      {catalogError && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm text-yellow-700 dark:border-yellow-900/40 dark:bg-yellow-950/30 dark:text-yellow-300">
          {catalogError}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="label">{t('steps.teacher')}</label>
          <input
            {...field('teacher')}
            list="teacher-options"
            placeholder={t('steps.teacherPlaceholder')}
          />
          <datalist id="teacher-options">
            {teacherOptions.map((teacher) => (
              <option key={teacher.id} value={teacher.full_name} />
            ))}
          </datalist>
        </div>
        <div>
          <label className="label">{t('steps.subject')}</label>
          <input {...field('subject')} placeholder={t('steps.subjectPlaceholder')} />
        </div>
        <div>
          <label className="label">{t('steps.faculty')}</label>
          <select
            value={data.faculty ?? ''}
            onChange={handleFacultyChange}
            className="input"
            required
          >
            <option value="">{t('steps.selectFaculty')}</option>
            {facultyOptions.map((faculty) => (
              <option key={faculty.id} value={faculty.name_ru}>
                {faculty.name_ru}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{t('steps.op')}</label>
          <select
            value={data.op ?? ''}
            onChange={handleSpecializationChange}
            className="input"
            required
            disabled={!data.faculty}
          >
            <option value="">{data.faculty ? t('steps.selectOp') : t('steps.selectFacultyFirst')}</option>
            {specializationOptions.map((specialization) => (
              <option key={specialization.id} value={opValue(specialization)}>
                {opValue(specialization)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{t('steps.group')}</label>
          <select
            value={data.group_name ?? ''}
            onChange={handleGroupChange}
            className="input"
            required
            disabled={!data.op}
          >
            <option value="">{data.op ? t('steps.selectGroup') : t('steps.selectOpFirst')}</option>
            {groupOptions.map((group) => (
              <option key={group.id} value={group.name}>
                {group.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{t('steps.room')}</label>
          <input {...field('room')} placeholder={t('steps.roomPlaceholder')} />
        </div>
      </div>
    </div>
  )
}
