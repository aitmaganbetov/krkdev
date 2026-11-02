// Виды нарушений ситуационного мониторинга. value уходит в API по-русски (violations.violation_type),
// key — подпись monitoring.types.* на языке интерфейса.
export const VIOLATION_TYPES = [
  { value: 'Отсутствие', key: 'absence' },
  { value: 'Опоздание (>15 мин)', key: 'late' },
  { value: 'Нарушение методики преподавания', key: 'methodology' },
  { value: 'Отпускает раньше времени', key: 'earlyRelease' },
  { value: 'Отсутствовали студенты', key: 'noStudents' },
  { value: 'Нарушение учебной дисциплины', key: 'studyDiscipline' },
  { value: 'Несвоевременное заполнение LMS', key: 'lms' },
  { value: 'Нарушение трудовой дисциплины', key: 'laborDiscipline' },
  { value: 'Ненадлежащий контроль при экзамене', key: 'examControl' },
  { value: 'Прочее', key: 'other' },
]

// Краткое содержание наблюдения по чек-листу 16-02 (violation_type с сервера, services/video_checklist.py)
const CHECKLIST_SUMMARIES = {
  'Несоответствие расписанию': 'checklist.short.schedule',
  'Преподаватель не наблюдается': 'checklist.short.teacher',
  'Группа не наблюдается': 'checklist.short.group',
  'Нет видимой учебной деятельности': 'checklist.short.activity',
  'Длительное прекращение занятия': 'checklist.short.continuity',
  'Риск безопасности': 'checklist.short.safety',
  'Недостаточное качество видеосигнала': 'checklist.short.quality',
  'Иное расхождение': 'checklist.short.other',
  'Без замечаний': 'checklist.short.none',
  'Технически невозможно оценить': 'checklist.outcomes.technical',
}

// Подпись типа нарушения (или содержания наблюдения) на текущем языке; неизвестное значение показываем как есть.
export function violationTypeLabel(t, value) {
  if (CHECKLIST_SUMMARIES[value]) return t(CHECKLIST_SUMMARIES[value])
  const found = VIOLATION_TYPES.find((item) => item.value === value)
  return found ? t(`monitoring.types.${found.key}`) : value
}
