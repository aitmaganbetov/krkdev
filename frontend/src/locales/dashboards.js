// Дашборд: переключатель модулей и дашборды «Взаимопосещение» и «Ситуационный мониторинг».
// Тексты дашборда записей КРК — в dashboard.js и i18n.js (dash.*).
export default {
  ru: {
    dashModules: {
      label: 'Модуль дашборда',
      krk: 'Записи КРК',
      peer: 'Взаимопосещение',
      monitoring: 'Ситуационный мониторинг',
      descriptions: {
        krk: 'Результаты контроля проведения занятий: баллы, посещаемость и проблемные записи.',
        peer: 'Отзывы о взаимопосещении и выполнение графика по факультетам.',
        monitoring: 'Нарушения, зафиксированные в ходе ситуационного мониторинга.',
      },
    },
    peerDash: {
      kpi: {
        total: 'Отзывов', totalHint: 'Принято: {{count}}',
        review: 'На проверке', reviewHint: 'На доработке: {{count}}',
        level: 'Средний итог', levelHint: 'Средний балл {{score}} из 5', noScore: 'Нет оценённых отзывов',
        problems: 'Требуют внимания', problemsHint: 'Несоответствие Syllabus или уровень ниже удовлетворительного',
      },
      schedule: {
        title: 'Выполнение графика', description: 'Посещение засчитывается, когда отзыв по строке графика принят',
        progress: 'Выполнено', target: 'Строк графика: {{total}}', display: '{{done}} из {{total}}',
        overdue: 'Просрочено', inProgress: 'В работе', planned: 'Запланировано', late: 'Выполнено не в срок',
        overdueNote: 'Месяц прошёл, отзыва нет', inProgressNote: 'Отзыв создан, ещё не принят',
        plannedNote: 'Срок ещё не наступил', lateNote: 'Посещение не в плановый месяц', empty: 'Графика на этот учебный год нет',
      },
      levels: { title: 'Итоговые уровни', description: 'Отзывы на проверке и принятые', empty: 'Нет оценённых отзывов' },
      statuses: { title: 'Статусы отзывов', description: 'Черновики не учитываются', empty: 'Отзывов пока нет' },
      faculties: {
        title: 'По факультетам', description: 'Отзывы и выполнение графика',
        colFaculty: 'Факультет', colTotal: 'Отзывов', colAccepted: 'Принято', colLevel: 'Средний итог',
        colProblems: 'Проблемных', colSchedule: 'График', colOverdue: 'Просрочено', empty: 'Нет данных за выбранный период',
      },
      filter: { faculty: 'Факультет', all: 'Все факультеты' },
      loadError: 'Не удалось загрузить дашборд взаимопосещения',
    },
    monDash: {
      kpi: {
        total: 'Наблюдений', totalHint: 'За выбранный учебный год',
        confirmed: 'Подтверждено несоответствий', confirmedHint: 'Требуют уточнения: {{clarification}} · технически невозможно оценить: {{technical}}',
        notified: 'Преподаватель уведомлён', notifiedHint: '{{count}} из {{total}} подтверждённых — найден в справочнике Platonus',
        evidence: 'С фото или видео', evidenceHint: '{{count}} из {{total}} наблюдений',
      },
      byType: { title: 'По расхождениям', empty: 'Расхождений нет' },
      byMonth: { title: 'Наблюдения по месяцам', empty: 'Наблюдений нет' },
      byFaculty: { title: 'По факультетам', description: 'Факультет — по кафедре преподавателя в Platonus', unknown: 'Не определён', empty: 'Наблюдений нет' },
      top: { title: 'Подтверждённые несоответствия', description: 'Только после повторного наблюдения, сверки и верификации (п. 4.5)', colTeacher: 'Преподаватель', colCount: 'Подтверждено', empty: 'Подтверждённых несоответствий нет' },
      loadError: 'Не удалось загрузить дашборд мониторинга',
    },
  },
  kz: {
    dashModules: {
      label: 'Басқару тақтасының модулі',
      krk: 'КРК жазбалары',
      peer: 'Өзара сабаққа қатысу',
      monitoring: 'Ситуациялық мониторинг',
      descriptions: {
        krk: 'Сабақ өткізуді бақылау нәтижелері: балдар, қатысу және проблемалық жазбалар.',
        peer: 'Өзара қатысу туралы пікірлер және факультеттер бойынша кестенің орындалуы.',
        monitoring: 'Ситуациялық мониторинг барысында тіркелген бұзушылықтар.',
      },
    },
    peerDash: {
      kpi: {
        total: 'Пікірлер', totalHint: 'Қабылданды: {{count}}',
        review: 'Тексерілуде', reviewHint: 'Пысықтауда: {{count}}',
        level: 'Орташа қорытынды', levelHint: 'Орташа балл: 5-тен {{score}}', noScore: 'Бағаланған пікірлер жоқ',
        problems: 'Назар аударуды қажет етеді', problemsHint: 'Syllabus-қа сәйкессіздік немесе қанағаттанарлықтан төмен деңгей',
      },
      schedule: {
        title: 'Кестенің орындалуы', description: 'Кесте жолы бойынша пікір қабылданғанда қатысу есептеледі',
        progress: 'Орындалды', target: 'Кесте жолдары: {{total}}', display: '{{total}} ішінен {{done}}',
        overdue: 'Мерзімі өтті', inProgress: 'Жұмыста', planned: 'Жоспарланған', late: 'Мерзімінен тыс орындалды',
        overdueNote: 'Ай өтті, пікір жоқ', inProgressNote: 'Пікір жасалды, әлі қабылданбады',
        plannedNote: 'Мерзімі әлі келмеді', lateNote: 'Қатысу жоспарлы айда емес', empty: 'Бұл оқу жылына кесте жоқ',
      },
      levels: { title: 'Қорытынды деңгейлер', description: 'Тексерілудегі және қабылданған пікірлер', empty: 'Бағаланған пікірлер жоқ' },
      statuses: { title: 'Пікір мәртебелері', description: 'Жобалар есепке алынбайды', empty: 'Әзірге пікір жоқ' },
      faculties: {
        title: 'Факультеттер бойынша', description: 'Пікірлер және кестенің орындалуы',
        colFaculty: 'Факультет', colTotal: 'Пікірлер', colAccepted: 'Қабылданды', colLevel: 'Орташа қорытынды',
        colProblems: 'Проблемалық', colSchedule: 'Кесте', colOverdue: 'Мерзімі өтті', empty: 'Таңдалған кезеңде деректер жоқ',
      },
      filter: { faculty: 'Факультет', all: 'Барлық факультеттер' },
      loadError: 'Өзара қатысу тақтасын жүктеу мүмкін болмады',
    },
    monDash: {
      kpi: {
        total: 'Бақылаулар', totalHint: 'Таңдалған оқу жылында',
        confirmed: 'Расталған сәйкессіздіктер', confirmedHint: 'Нақтылау қажет: {{clarification}} · техникалық тұрғыдан бағалау мүмкін емес: {{technical}}',
        notified: 'Оқытушыға хабарланды', notifiedHint: '{{total}} расталғанның {{count}} — Platonus анықтамалығынан табылды',
        evidence: 'Фото немесе бейнемен', evidenceHint: '{{total}} бақылаудың {{count}}',
      },
      byType: { title: 'Сәйкессіздіктер бойынша', empty: 'Сәйкессіздік жоқ' },
      byMonth: { title: 'Айлар бойынша бақылаулар', empty: 'Бақылау жоқ' },
      byFaculty: { title: 'Факультеттер бойынша', description: 'Факультет — Platonus-тағы оқытушы кафедрасы бойынша', unknown: 'Анықталмаған', empty: 'Бақылау жоқ' },
      top: { title: 'Расталған сәйкессіздіктер', description: 'Тек қайталама бақылаудан, салыстырудан және верификациядан кейін (4.5-т.)', colTeacher: 'Оқытушы', colCount: 'Расталды', empty: 'Расталған сәйкессіздік жоқ' },
      loadError: 'Мониторинг тақтасын жүктеу мүмкін болмады',
    },
  },
  en: {
    dashModules: {
      label: 'Dashboard module',
      krk: 'KRK records',
      peer: 'Peer observation',
      monitoring: 'Situational monitoring',
      descriptions: {
        krk: 'Class control results: scores, attendance and problem records.',
        peer: 'Peer observation reviews and schedule completion by faculty.',
        monitoring: 'Violations recorded during situational monitoring.',
      },
    },
    peerDash: {
      kpi: {
        total: 'Reviews', totalHint: 'Accepted: {{count}}',
        review: 'Under review', reviewHint: 'In rework: {{count}}',
        level: 'Average result', levelHint: 'Average score {{score}} of 5', noScore: 'No rated reviews',
        problems: 'Need attention', problemsHint: 'Not matching the syllabus or below satisfactory',
      },
      schedule: {
        title: 'Schedule completion', description: 'An observation counts once its review is accepted',
        progress: 'Done', target: 'Schedule rows: {{total}}', display: '{{done}} of {{total}}',
        overdue: 'Overdue', inProgress: 'In progress', planned: 'Planned', late: 'Done late',
        overdueNote: 'Month passed, no review', inProgressNote: 'Review created, not accepted yet',
        plannedNote: 'Not due yet', lateNote: 'Observed outside the planned month', empty: 'No schedule for this academic year',
      },
      levels: { title: 'Result levels', description: 'Submitted and accepted reviews', empty: 'No rated reviews' },
      statuses: { title: 'Review statuses', description: 'Drafts are not counted', empty: 'No reviews yet' },
      faculties: {
        title: 'By faculty', description: 'Reviews and schedule completion',
        colFaculty: 'Faculty', colTotal: 'Reviews', colAccepted: 'Accepted', colLevel: 'Average result',
        colProblems: 'Problems', colSchedule: 'Schedule', colOverdue: 'Overdue', empty: 'No data for the selected period',
      },
      filter: { faculty: 'Faculty', all: 'All faculties' },
      loadError: 'Failed to load the peer observation dashboard',
    },
    monDash: {
      kpi: {
        total: 'Observations', totalHint: 'In the selected academic year',
        confirmed: 'Confirmed non-compliance', confirmedHint: 'Need clarification: {{clarification}} · technically impossible to assess: {{technical}}',
        notified: 'Teacher notified', notifiedHint: '{{count}} of {{total}} confirmed — found in the Platonus catalog',
        evidence: 'With photo or video', evidenceHint: '{{count}} of {{total}} observations',
      },
      byType: { title: 'By discrepancy', empty: 'No discrepancies' },
      byMonth: { title: 'Observations by month', empty: 'No observations' },
      byFaculty: { title: 'By faculty', description: 'Faculty by the teacher’s department in Platonus', unknown: 'Unknown', empty: 'No observations' },
      top: { title: 'Confirmed non-compliance', description: 'Only after a repeat observation, a check and verification (4.5)', colTeacher: 'Teacher', colCount: 'Confirmed', empty: 'No confirmed non-compliance' },
      loadError: 'Failed to load the monitoring dashboard',
    },
  },
}
