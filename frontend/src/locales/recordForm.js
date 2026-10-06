// Карточка записи и мастер создания/редактирования записи (шаги 1–4).
// Подписи полей здесь без «*»: обязательность показывает Field (required).
export default {
  ru: {
    recordForm: {
      back: 'Назад',
      next: 'Далее',
      backToList: 'К списку записей',
      backToRecord: 'К записи',
      editTitle: 'Редактирование записи №{{id}}',
      required: 'Обязательное поле',
      sections: {
        teacherSubject: 'Преподаватель и дисциплина',
        groupRoom: 'Группа и аудитория',
        lesson: 'Занятие',
        attendance: 'Посещаемость',
        review: 'Проверка',
      },
      fields: {
        teacher: 'Преподаватель',
        teacherPlaceholder: 'Начните вводить ФИО',
        subject: 'Дисциплина',
        faculty: 'Факультет',
        op: 'Образовательная программа (ОП)',
        group: 'Группа',
        room: 'Аудитория',
        lessonType: 'Тип занятия',
        format: 'Форма проведения',
        topic: 'Тема занятия',
        dateTime: 'Дата и время',
        academicYear: 'Учебный год',
        studentsPlan: 'Студентов по плану',
        studentsFact: 'Студентов фактически',
        attendance: 'Посещаемость',
        comment: 'Комментарий',
        commentHint: 'Отметьте пункты, по которым снижена оценка, и то, что особенно удалось на занятии.',
      },
      lessonTypes: {
        lecture: 'Лекция',
        practice: 'Практика',
        seminar: 'Семинар',
        lab: 'Лабораторная',
        pe: 'Физическая культура',
        creative: 'Творческое',
      },
      formats: {
        offline: 'В традиционном очном формате',
        zoom: 'Дистанционное занятие с использованием системы ZOOM',
      },
      calcMethods: {
        average: 'среднее всех ответов',
        weighted: 'взвешенное среднее по вопросам',
        sections: 'среднее по разделам с весами разделов',
        sum: 'сумма баллов',
      },
      errors: {
        step1: 'Заполните все обязательные поля.',
        step2: 'Заполните все обязательные поля занятия.',
        studentsPlan: 'Укажите корректное количество студентов по плану.',
        studentsFact: 'Укажите корректное фактическое количество студентов.',
        factExceedsPlan: 'Студентов фактически не может быть больше, чем студентов по плану.',
        noTemplate: 'Для учебного года {{year}} не настроен справочник вопросов.',
        ratings: 'Заполните все рейтинговые категории перед переходом дальше.',
        comment: 'Комментарий обязателен.',
      },
      ratings: {
        avgScore: 'Средний балл',
        progress: 'Оценено {{done}} из {{total}}',
        templateInfo: 'Учебный год {{year}}: шкала {{min}}–{{max}}, расчёт — {{method}}.',
        noTemplate: 'Для учебного года {{year}} не настроен справочник вопросов. Обратитесь к администратору.',
        missingModule: 'Для вида занятия «{{type}}» модуль по виду занятия не предусмотрен. Его вес распределяется между остальными разделами пропорционально.',
        signs: 'Наблюдаемые признаки',
        scoreFor: 'Оценка по критерию {{code}}',
        notRated: 'Выберите оценку',
      },
      detail: {
        recordNo: 'Запись №{{id}}',
        deleted: 'Запись удалена',
        submitted: 'Запись отправлена на проверку',
        reworked: 'Запись отправлена на доработку',
        accepted: 'Запись принята',
        deleteError: 'Не удалось удалить запись',
        submitError: 'Не удалось отправить запись',
        reworkError: 'Не удалось отправить запись на доработку',
        acceptError: 'Не удалось принять запись',
        studentsHint: '{{fact}} из {{plan}} студентов',
        noRatings: 'Оценки не выставлены',
      },
    },
  },
  kz: {
    recordForm: {
      back: 'Артқа',
      next: 'Келесі',
      backToList: 'Жазбалар тізіміне',
      backToRecord: 'Жазбаға оралу',
      editTitle: '№{{id}} жазбаны өңдеу',
      required: 'Міндетті өріс',
      sections: {
        teacherSubject: 'Оқытушы және пән',
        groupRoom: 'Топ және аудитория',
        lesson: 'Сабақ',
        attendance: 'Қатысу',
        review: 'Тексеру',
      },
      fields: {
        teacher: 'Оқытушы',
        teacherPlaceholder: 'Аты-жөнін енгізіңіз',
        subject: 'Пән',
        faculty: 'Факультет',
        op: 'Білім беру бағдарламасы (ББ)',
        group: 'Топ',
        room: 'Аудитория',
        lessonType: 'Сабақ түрі',
        format: 'Өткізу түрі',
        topic: 'Сабақ тақырыбы',
        dateTime: 'Күні мен уақыты',
        academicYear: 'Оқу жылы',
        studentsPlan: 'Жоспар бойынша студенттер саны',
        studentsFact: 'Іс жүзінде келген студенттер саны',
        attendance: 'Қатысу',
        comment: 'Түсініктеме',
        commentHint: 'Бағасы төмендетілген тармақтарды және сабақта ерекше сәтті болған тұстарды атап өтіңіз.',
      },
      lessonTypes: {
        lecture: 'Дәріс',
        practice: 'Практикалық сабақ',
        seminar: 'Семинар',
        lab: 'Зертханалық сабақ',
        pe: 'Дене шынықтыру',
        creative: 'Шығармашылық сабақ',
      },
      formats: {
        offline: 'Дәстүрлі күндізгі форматта',
        zoom: 'ZOOM жүйесі арқылы қашықтан өткізілетін сабақ',
      },
      calcMethods: {
        average: 'барлық жауаптардың орташа мәні',
        weighted: 'сұрақтар бойынша салмақталған орташа мән',
        sections: 'бөлімдердің салмағы ескерілген бөлімдер бойынша орташа мән',
        sum: 'баллдардың қосындысы',
      },
      errors: {
        step1: 'Барлық міндетті өрістерді толтырыңыз.',
        step2: 'Сабақтың барлық міндетті өрістерін толтырыңыз.',
        studentsPlan: 'Жоспар бойынша студенттер санын дұрыс көрсетіңіз.',
        studentsFact: 'Іс жүзінде келген студенттер санын дұрыс көрсетіңіз.',
        factExceedsPlan: 'Іс жүзінде келген студенттер саны жоспардағыдан көп болмауы керек.',
        noTemplate: '{{year}} оқу жылы үшін сұрақтар анықтамалығы бапталмаған.',
        ratings: 'Келесі қадамға өтпес бұрын барлық рейтингтік өлшемдерді толтырыңыз.',
        comment: 'Түсініктеме міндетті.',
      },
      ratings: {
        avgScore: 'Орташа балл',
        progress: '{{total}} өлшемнің {{done}} бағаланды',
        templateInfo: '{{year}} оқу жылы: шкала {{min}}–{{max}}, есептеу — {{method}}.',
        noTemplate: '{{year}} оқу жылы үшін сұрақтар анықтамалығы бапталмаған. Әкімшіге хабарласыңыз.',
        missingModule: '«{{type}}» сабақ түрі үшін сабақ түріне арналған модуль қарастырылмаған. Оның салмағы қалған бөлімдерге пропорционалды бөлінеді.',
        signs: 'Байқалатын белгілер',
        scoreFor: '{{code}} өлшемі бойынша баға',
        notRated: 'Бағаны таңдаңыз',
      },
      detail: {
        recordNo: '№{{id}} жазба',
        deleted: 'Жазба жойылды',
        submitted: 'Жазба тексеруге жіберілді',
        reworked: 'Жазба қайта өңдеуге жіберілді',
        accepted: 'Жазба қабылданды',
        deleteError: 'Жазбаны жою мүмкін болмады',
        submitError: 'Жазбаны жіберу мүмкін болмады',
        reworkError: 'Жазбаны қайта өңдеуге жіберу мүмкін болмады',
        acceptError: 'Жазбаны қабылдау мүмкін болмады',
        studentsHint: '{{plan}} студенттің {{fact}} қатысты',
        noRatings: 'Бағалар қойылмаған',
      },
    },
  },
  en: {
    recordForm: {
      back: 'Back',
      next: 'Next',
      backToList: 'Back to records',
      backToRecord: 'Back to record',
      editTitle: 'Edit record #{{id}}',
      required: 'Required field',
      sections: {
        teacherSubject: 'Teacher and course',
        groupRoom: 'Group and room',
        lesson: 'Class',
        attendance: 'Attendance',
        review: 'Review',
      },
      fields: {
        teacher: 'Teacher',
        teacherPlaceholder: 'Start typing a name',
        subject: 'Course',
        faculty: 'Faculty',
        op: 'Educational program (EP)',
        group: 'Group',
        room: 'Room',
        lessonType: 'Class type',
        format: 'Delivery format',
        topic: 'Class topic',
        dateTime: 'Date and time',
        academicYear: 'Academic year',
        studentsPlan: 'Students planned',
        studentsFact: 'Students present',
        attendance: 'Attendance',
        comment: 'Comment',
        commentHint: 'Note the points where the score was lowered and what went especially well in the class.',
      },
      lessonTypes: {
        lecture: 'Lecture',
        practice: 'Practical class',
        seminar: 'Seminar',
        lab: 'Laboratory class',
        pe: 'Physical education',
        creative: 'Creative class',
      },
      formats: {
        offline: 'Traditional in-person class',
        zoom: 'Remote class via ZOOM',
      },
      calcMethods: {
        average: 'average of all answers',
        weighted: 'weighted average by question',
        sections: 'average by section with section weights',
        sum: 'sum of scores',
      },
      errors: {
        step1: 'Fill in all required fields.',
        step2: 'Fill in all required class fields.',
        studentsPlan: 'Enter a valid number of planned students.',
        studentsFact: 'Enter a valid number of students present.',
        factExceedsPlan: 'Students present cannot exceed students planned.',
        noTemplate: 'No question set is configured for academic year {{year}}.',
        ratings: 'Rate all criteria before moving on.',
        comment: 'A comment is required.',
      },
      ratings: {
        avgScore: 'Average score',
        progress: '{{done}} of {{total}} rated',
        templateInfo: 'Academic year {{year}}: scale {{min}}–{{max}}, calculation: {{method}}.',
        noTemplate: 'No question set is configured for academic year {{year}}. Contact the administrator.',
        missingModule: 'There is no class-type module for “{{type}}”. Its weight is distributed proportionally among the other sections.',
        signs: 'Observable signs',
        scoreFor: 'Score for criterion {{code}}',
        notRated: 'Select a score',
      },
      detail: {
        recordNo: 'Record #{{id}}',
        deleted: 'Record deleted',
        submitted: 'Record submitted for review',
        reworked: 'Record sent for rework',
        accepted: 'Record accepted',
        deleteError: 'Failed to delete the record',
        submitError: 'Failed to submit the record',
        reworkError: 'Failed to send the record for rework',
        acceptError: 'Failed to accept the record',
        studentsHint: '{{fact}} of {{plan}} students',
        noRatings: 'No scores yet',
      },
    },
  },
}

// ——— Перевод значений, которые хранятся в БД на русском (сами значения не меняются) ———

// Вид занятия (значения из LESSON_TYPES) → ключ подписи
const LESSON_TYPE_KEYS = {
  'Лекция': 'lecture',
  'Практика': 'practice',
  'Семинар': 'seminar',
  'Лабораторная': 'lab',
  'Физическая культура': 'pe',
  'Творческое': 'creative',
}

// Форма проведения (значения из Step2Details) → ключ подписи
const FORMAT_KEYS = {
  'в традиционном очном формате': 'offline',
  'дистанционное занятие с использованием системы ZOOM': 'zoom',
}

export function lessonTypeLabel(t, value) {
  const key = LESSON_TYPE_KEYS[value]
  return key ? t(`recordForm.lessonTypes.${key}`) : value
}

export function formatLabel(t, value) {
  const key = FORMAT_KEYS[value]
  return key ? t(`recordForm.formats.${key}`) : value
}

// Язык текстов справочника вопросов: в интерфейсе казахский — «kz», в справочнике — «kk»
export function templateLang(language) {
  return String(language || 'ru').startsWith('kz') ? 'kk' : language
}

// Сообщения проверки формы (utils/recordForm.js) приходят по-русски — показываем их на языке интерфейса.
const FORM_ERROR_KEYS = {
  'Заполните все обязательные поля.': 'step1',
  'Заполните все обязательные поля занятия.': 'step2',
  'Укажите корректное количество студентов по плану.': 'studentsPlan',
  'Укажите корректное фактическое количество студентов.': 'studentsFact',
  'Студентов фактически не может быть больше, чем студентов по плану.': 'factExceedsPlan',
  'Заполните все рейтинговые категории перед переходом дальше.': 'ratings',
  'Комментарий обязателен.': 'comment',
}

export function formErrorText(t, message) {
  if (!message || typeof message !== 'string') return message
  const key = FORM_ERROR_KEYS[message]
  if (key) return t(`recordForm.errors.${key}`)
  const noTemplate = message.match(/^Для учебного года (.*) не настроен справочник вопросов\.$/)
  if (noTemplate) return t('recordForm.errors.noTemplate', { year: noTemplate[1].trim() || '—' })
  return message
}
