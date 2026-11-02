// Страница входа: фирменная панель, подписи формы, переключатель языка.
export default {
  ru: {
    login: {
      subtitle: 'Корпоративная учётная запись университета',
      usernamePlaceholder: 'Логин и пароль от Platonus',
      tagline: 'Ректорский контроль',
      systemName: 'Система ректорского контроля',
      systemCaption: 'Sapa Monitoring · КазУТБ',
      langRu: 'Русский',
      langKz: 'Қазақша',
      langEn: 'English',
      ecp: {
        or: 'или',
        button: 'Войти по ЭЦП',
        signing: 'Подпишите в NCALayer…',
        hint: 'Для преподавателей и студентов: ключ НУЦ РК и запущенный NCALayer',
        errors: {
          unavailable: 'NCALayer не запущен. Запустите NCALayer и повторите вход.',
          timeout: 'Время ожидания подписи истекло. Попробуйте ещё раз.',
          failed: 'Не удалось подписать в NCALayer. Попробуйте ещё раз.',
        },
      },
    },
  },
  kz: {
    login: {
      subtitle: 'Университеттің корпоративтік есептік жазбасы',
      usernamePlaceholder: 'Platonus логині мен құпиясөзі',
      tagline: 'Ректорлық бақылау',
      systemName: 'Ректорлық бақылау жүйесі',
      systemCaption: 'Sapa Monitoring · ҚазТБУ',
      langRu: 'Русский',
      langKz: 'Қазақша',
      langEn: 'English',
      ecp: {
        or: 'немесе',
        button: 'ЭЦҚ арқылы кіру',
        signing: 'NCALayer-де қол қойыңыз…',
        hint: 'Оқытушылар мен студенттерге: ҰКО кілті және іске қосылған NCALayer',
        errors: {
          unavailable: 'NCALayer іске қосылмаған. NCALayer-ді іске қосып, қайта кіріңіз.',
          timeout: 'Қол қою уақыты бітті. Қайталап көріңіз.',
          failed: 'NCALayer-де қол қою мүмкін болмады. Қайталап көріңіз.',
        },
      },
    },
  },
  en: {
    login: {
      subtitle: 'University corporate account',
      usernamePlaceholder: 'Your Platonus login and password',
      tagline: "Rector's control",
      systemName: "Rector's Control System",
      systemCaption: 'Sapa Monitoring · KazUTB',
      langRu: 'Русский',
      langKz: 'Қазақша',
      langEn: 'English',
      ecp: {
        or: 'or',
        button: 'Sign in with EDS',
        signing: 'Sign in NCALayer…',
        hint: 'For teachers and students: NCA RK key and NCALayer running',
        errors: {
          unavailable: 'NCALayer is not running. Start NCALayer and try again.',
          timeout: 'Signing timed out. Please try again.',
          failed: 'Could not sign in NCALayer. Please try again.',
        },
      },
    },
  },
}
