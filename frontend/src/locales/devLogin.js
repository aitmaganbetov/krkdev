// Быстрый вход под ролями на странице входа — только dev (routers/dev_login.py)
export default {
  ru: {
    login: {
      dev: {
        title: 'Быстрый вход (dev)',
        hint: 'Только в dev-окружении: вход под выбранной ролью с демо-данными. Преподаватель, пользователь, член комитета и студент — настоящие люди из Platonus.',
        dean: 'Деканат · {{faculty}}',
        person: '{{role}} · {{name}}',
        error: 'Не удалось войти под ролью',
      },
    },
  },
  kz: {
    login: {
      dev: {
        title: 'Жылдам кіру (dev)',
        hint: 'Тек dev ортасында: таңдалған рөлмен демо-деректермен кіру. Оқытушы, пайдаланушы, комитет мүшесі және студент — Platonus-тағы нақты адамдар.',
        dean: 'Деканат · {{faculty}}',
        person: '{{role}} · {{name}}',
        error: 'Рөлмен кіру мүмкін болмады',
      },
    },
  },
  en: {
    login: {
      dev: {
        title: 'Quick sign-in (dev)',
        hint: 'Dev environment only: sign in with the selected role and demo data. Teacher, user, committee member and student are real people from Platonus.',
        dean: 'Dean’s office · {{faculty}}',
        person: '{{role}} · {{name}}',
        error: 'Failed to sign in with this role',
      },
    },
  },
}
