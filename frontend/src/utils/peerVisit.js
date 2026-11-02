// Взаимопосещение занятий: значения полей формы (те же коды, что в backend/schemas/peer_visit.py),
// проверка заполнения и итог по критериям. Подписи — в locales/peerVisits.js.

export const FACULTIES = ['eb', 'tf', 'iit']
// Код факультета формы ↔ FacultyID справочника Platonus (как FACULTY_ID_BY_CODE в peer_visit_service.py)
export const FACULTY_CODE_BY_ID = { 1: 'tf', 3: 'eb', 5: 'iit' }
// Роли, которые видят и правят только свои отзывы (как PERSONAL_ROLES в peer_visit_service.py)
export const PERSONAL_ROLES = ['staff', 'committee', 'user', 'teacher']
// Выполнение строки графика взаимопосещения (peer_visit_schedule_service.py)
export const SCHEDULE_STATUSES = ['done', 'in_progress', 'overdue', 'planned']
export const SCHEDULE_STATUS_TONE = { done: 'success', in_progress: 'info', overdue: 'danger', planned: 'neutral' }
export const EDUCATION_LEVELS = ['bachelor', 'master']
export const LANGUAGES = ['kz', 'ru', 'en']
export const LESSON_TYPES = ['lecture', 'practical', 'laboratory', 'studio']
export const LEVELS = ['high', 'medium', 'satisfactory', 'low', 'fail']
export const STATUSES = ['draft', 'submitted', 'rework', 'accepted']
// Диапазоны уровней из формы (подписи уровней — peerVisits.levelsShort)
export const LEVEL_RANGES = { high: '90–100 %', medium: '80–89 %', satisfactory: '70–79 %', low: '60–69 %', fail: '0–59 %' }

// Порядок пунктов формы: level — оценка уровнем, text — текстовый ответ, syllabus — п.1
export const CRITERIA = [
  { code: '1', kind: 'syllabus' },
  { code: '2', kind: 'level' },
  { code: '3', kind: 'level' },
  { code: '4', kind: 'level' },
  { code: '5', kind: 'level' },
  { code: '6', kind: 'text', field: 'technologies_used' },
  { code: '7', kind: 'level' },
  { code: '8', kind: 'text', field: 'methods_used' },
  { code: '9', kind: 'level' },
  { code: '10', kind: 'level' },
]
export const LEVEL_CRITERIA = CRITERIA.filter((c) => c.kind === 'level').map((c) => c.code)

export const COMMENT_FIELDS = ['strengths', 'remarks', 'recommendations', 'note']

const LEVEL_POINTS = { high: 5, medium: 4, satisfactory: 3, low: 2, fail: 1 }

const REQUIRED_TEXT = ['teacher', 'department', 'group_name', 'subject', 'topic', 'academic_year', 'visitor_name', 'visitor_position']
const REQUIRED_CHOICE = ['faculty', 'education_level', 'language', 'lesson_type']
const OPTIONAL_TEXT = ['technologies_used', 'methods_used', ...COMMENT_FIELDS, 'visitor_degree']

export function createInitialPeerVisit() {
  return {
    datetime: '', teacher: '', department: '', faculty: '', education_level: '', course: '',
    group_name: '', students_plan: '', students_fact: '', language: '', subject: '', lesson_type: '',
    topic: '', academic_year: '', syllabus_compliant: null, ratings: {},
    technologies_used: '', methods_used: '',
    strengths: '', remarks: '', recommendations: '', note: '',
    visitor_name: '', visitor_position: '', visitor_degree: '',
  }
}

const isBlank = (v) => v === null || v === undefined || String(v).trim() === ''

/** Ошибки по полям: { field: 'required' | 'studentsFact' | 'course' }. Пустой объект — всё заполнено. */
export function validatePeerVisit(data) {
  const errors = {}
  ;[...REQUIRED_TEXT, ...REQUIRED_CHOICE, 'datetime'].forEach((f) => { if (isBlank(data[f])) errors[f] = 'required' })
  const course = Number(data.course)
  if (isBlank(data.course)) errors.course = 'required'
  else if (!Number.isInteger(course) || course < 1 || course > 6) errors.course = 'course'
  ;['students_plan', 'students_fact'].forEach((f) => {
    if (isBlank(data[f]) || Number(data[f]) < 0) errors[f] = 'required'
  })
  if (!errors.students_plan && !errors.students_fact && Number(data.students_fact) > Number(data.students_plan)) {
    errors.students_fact = 'studentsFact'
  }
  if (data.syllabus_compliant !== true && data.syllabus_compliant !== false) errors.syllabus_compliant = 'required'
  LEVEL_CRITERIA.forEach((code) => { if (!LEVELS.includes(data.ratings?.[code])) errors[`rating_${code}`] = 'required' })
  return errors
}

/** Средний балл уровней (1–5) — как на сервере (peer_visit_service.compute_score). */
export function averageLevelScore(ratings) {
  const points = LEVEL_CRITERIA.map((code) => LEVEL_POINTS[ratings?.[code]]).filter(Boolean)
  if (!points.length) return 0
  return Math.round((points.reduce((a, b) => a + b, 0) / points.length) * 100) / 100
}

/** Итоговый уровень по среднему баллу: 4.5+ высокий, 3.5+ средний, 2.5+ удовлетворительный, 1.5+ низкий. */
export function overallLevel(score) {
  if (!score) return null
  if (score >= 4.5) return 'high'
  if (score >= 3.5) return 'medium'
  if (score >= 2.5) return 'satisfactory'
  if (score >= 1.5) return 'low'
  return 'fail'
}

export const LEVEL_TONE = { high: 'success', medium: 'success', satisfactory: 'warning', low: 'danger', fail: 'danger' }

/** Отзыв с сервера → данные формы (datetime подставляет вызывающий). */
export function fromPeerVisit(visit) {
  const data = { ...createInitialPeerVisit() }
  Object.keys(data).forEach((key) => {
    if (visit[key] !== undefined && visit[key] !== null) data[key] = visit[key]
  })
  data.course = String(visit.course ?? '')
  data.students_plan = String(visit.students_plan ?? '')
  data.students_fact = String(visit.students_fact ?? '')
  data.ratings = { ...(visit.ratings || {}) }
  return data
}

/** Данные формы → тело запроса (числа, пустые необязательные поля — null). */
export function toPeerVisitPayload(data, datetimeIso) {
  const payload = {
    ...data,
    datetime: datetimeIso,
    course: Number(data.course),
    students_plan: Number(data.students_plan),
    students_fact: Number(data.students_fact),
    ratings: Object.fromEntries(LEVEL_CRITERIA.map((code) => [code, data.ratings[code]])),
  }
  OPTIONAL_TEXT.forEach((f) => { payload[f] = isBlank(data[f]) ? null : String(data[f]).trim() })
  return payload
}
