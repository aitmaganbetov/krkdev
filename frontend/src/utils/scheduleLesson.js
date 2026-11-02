// Занятие расписания Platonus (GET /schedule/lessons): статус по времени и заполнение форм
import { toDatetimeLocalUtcPlus5 } from './datetime'
import { FACULTY_CODE_BY_ID } from './peerVisit'

// Текущее время (HH:MM) по UTC+5 — по нему занятие «идёт», «впереди» или «завершено»
export const nowHHMMUtcPlus5 = () => toDatetimeLocalUtcPlus5(new Date()).slice(11, 16)

export function lessonStatus(lesson, today, clock) {
  if (lesson.date !== today) return lesson.date < today ? 'finished' : 'upcoming'
  if (clock < lesson.start_time) return 'upcoming'
  return clock < lesson.end_time ? 'now' : 'finished'
}

export const LESSON_STATUS_TONE = { now: 'success', upcoming: 'info', finished: 'neutral' }

// Вид занятия Platonus («Лекции», «Практические занятия», «Лабораторные занятия»…) → значение формы
function matchType(platonusType, rules) {
  const type = String(platonusType || '').toLowerCase()
  return rules.find(([fragment]) => type.includes(fragment))?.[1] || ''
}

const RECORD_TYPES = [
  ['лекц', 'Лекция'], ['практ', 'Практика'], ['семин', 'Семинар'], ['лаб', 'Лабораторная'],
  ['физ', 'Физическая культура'], ['студ', 'Творческое'], ['творч', 'Творческое'],
]
const PEER_VISIT_TYPES = [
  ['лекц', 'lecture'], ['практ', 'practical'], ['семин', 'practical'], ['лаб', 'laboratory'],
  ['студ', 'studio'], ['творч', 'studio'],
]

// Значения формы проведения записи КРК хранятся в БД как есть (Step2Details FORMATS)
const RECORD_FORMAT_OFFLINE = 'в традиционном очном формате'
const RECORD_FORMAT_ONLINE = 'дистанционное занятие с использованием системы ZOOM'

export const lessonDatetime = (lesson) => `${lesson.date}T${lesson.start_time}`

export const lessonPlace = (lesson) => [lesson.room, lesson.building].filter(Boolean).join(' · ')

/** Поля записи КРК (CreateRecordPage) по занятию расписания. */
export function recordFromLesson(lesson) {
  return {
    teacher: lesson.teacher || '',
    subject: lesson.subject || '',
    faculty: lesson.faculty || '',
    op: lesson.op || '',
    group_name: lesson.group_name || '',
    room: lessonPlace(lesson) || (lesson.online ? 'Онлайн' : ''),
    lesson_type: matchType(lesson.lesson_type, RECORD_TYPES),
    format: lesson.online ? RECORD_FORMAT_ONLINE : RECORD_FORMAT_OFFLINE,
    datetime: lessonDatetime(lesson),
    students_plan: Number(lesson.students_count) || 0,
  }
}

/** Поля отзыва о взаимопосещении (PeerVisitFormPage) по занятию расписания. */
export function peerVisitFromLesson(lesson) {
  const facultyId = lesson.teacher_faculty_id ?? lesson.faculty_id
  return {
    datetime: lessonDatetime(lesson),
    teacher: lesson.teacher || '',
    department: lesson.cafedra || '',
    faculty: FACULTY_CODE_BY_ID[facultyId] || '',
    education_level: lesson.education_level || '',
    course: lesson.course ? String(lesson.course) : '',
    group_name: lesson.student_groups || lesson.group_name || '',
    students_plan: lesson.students_count ? String(lesson.students_count) : '',
    language: lesson.language || '',
    subject: lesson.subject || '',
    lesson_type: matchType(lesson.lesson_type, PEER_VISIT_TYPES),
  }
}
