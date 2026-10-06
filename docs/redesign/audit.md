# Аудит вёрстки КРК Мониторинг — до редизайна

Дата: 2026-10-06 · Стенд: dev (`http://127.0.0.1:5175`, `krkdev_*`) · Роль: admin (фиктивный пользователь `ui-audit`)

Покрытие: 14 маршрутов, 423 снимков состояний (страница × состояние × язык × ширина), ширины 375 / 768 / 1280 / 1440 / 1920, языки RU / KZ / EN. Состояния: страница по умолчанию, мобильное меню (375/768), модалки (пользователь: создание; кабинет: форма/Live; мониторинг: фиксация нарушения), инлайн-редактирование пользователя, вкладки мониторинга, «Записи» с данными за 2025-2026 (по умолчанию выбран пустой 2026-2027).

> **Скриншоты** (`docs/redesign/screenshots/`) сняты с dev-стенда с реальной базой и содержат персональные данные сотрудников, поэтому в репозиторий не публикуются (`.gitignore`) и лежат только локально на сервере в `/home/admkrk/krk dev/docs/redesign/screenshots/`. Анонимизированные эталоны визуальных тестов — в `frontend/e2e/__screenshots__/`.

Метод: Playwright (Chromium) + детектор в `page.evaluate` — см. раздел «Методика» в конце.

## Сводка

Уникальная проблема = (страница, состояние, тип, селектор); одна и та же проблема на разных ширинах/языках считается один раз.

| Приоритет | Тип | Уникальных | 
|---|---|---|
| P1 | Текст вылезает из своего блока и уходит под соседний | 3 |
| P1 | Текст в textarea срезан (фиксированная высота) | 50 |
| P1 | Горизонтальный скролл страницы | 2 |
| P2 | Модалка выше экрана, скроллится целиком (шапка/футер уезжают) | 1 |
| P2 | Горизонтальный скролл основной области | 9 |
| P2 | Значение/placeholder не помещается в поле | 35 |
| P2 | Содержимое вылезает за родителя | 20 |
| P2 | Обрезка многоточием без title/tooltip | 91 |
| P3 | Мелкая зона нажатия (<32px) на мобильном | 77 |
| P3 | Обрезка многоточием (есть title) | 2 |
| | **Всего** | **290** |

### По страницам (уникальные проблемы P1 / P2 / P3)

| Страница | Маршрут | P1 | P2 | P3 |
|---|---|---|---|---|
| [login](#login) | `/login` |  |  |  |
| [dashboard](#dashboard) | `/dashboard` | 1 | 13 |  |
| [monitoring](#monitoring) | `/monitoring` |  | 22 |  |
| [records](#records) | `/records` | 2 | 17 | 2 |
| [records-new](#records-new) | `/records/new` |  | 10 |  |
| [record-detail](#record-detail) | `/records/84` |  | 6 | 2 |
| [record-edit](#record-edit) | `/records/84/edit` |  | 8 |  |
| [catalogs-questions](#catalogs-questions) | `/catalogs/questions` | 49 | 21 | 62 |
| [catalogs-academic-years](#catalogs-academic-years) | `/catalogs/academic-years` | 2 | 4 | 4 |
| [users](#users) | `/users` |  | 24 |  |
| [ldap-users](#ldap-users) | `/ldap-users` |  | 4 | 2 |
| [rooms-settings](#rooms-settings) | `/rooms-settings` |  | 17 | 1 |
| [settings](#settings) | `/settings` | 1 | 6 | 4 |
| [audit-logs](#audit-logs) | `/audit-logs` |  | 4 | 2 |

### По ширинам (все срабатывания, без дедупликации)

| Ширина | P1 | P2 | P3 |
|---|---|---|---|
| 375 | 156 | 1091 | 1065 |
| 768 | 90 | 1107 | 300 |
| 1280 | 111 | 671 | 150 |
| 1440 | 87 | 629 | 135 |
| 1920 | 12 | 87 | 102 |

## Ключевые дефекты (ручная проверка скриншотов + корневые причины в коде)

Автоматика находит симптомы; ниже — сгруппированные по причине дефекты, которые видны глазами, с указанием места в коде. Это основной список к исправлению.

| # | Пр. | Где | Что видно | Причина в коде |
|---|---|---|---|---|
| 1 | P1 | Дашборд, 375–1440 | Карточки «Контрольные ориентиры», «Сравнение по факультетам», «Распределение записей», «Рейтинг подразделений» шире своей колонки: на 375 значения KPI (8.9/10, 69.6%), колонки таблицы и полосы срезаны правым краем экрана; на 1440 легенда «Факультет Инжиниринга и информацион…» уходит под соседнюю карточку. | Элементы CSS Grid без `min-w-0` (`min-width:auto`) растягиваются по самому широкому потомку: `table.min-w-[680px]` (`DashboardPage.jsx:397`), `lg:grid-cols-[200px_1fr]` с `whitespace-nowrap` в легенде. |
| 2 | P1 | Записи, 768–1280, особенно KZ | Поле поиска схлопывается в пустой квадрат ~34px, последний фильтр («Барлық мәртебелер») выезжает за карточку. На 768 у `main` горизонтальный скролл (903 > 768). | `RecordsPage.jsx:516` — ряд `flex sm:flex-row` без переноса: `input flex-1` + 4 `select` с `.input` (`w-full`) и `sm:w-52`; длинные KZ-подписи распирают селекты. |
| 3 | P1 | Пользователи, инлайн-редактирование, 768–1440 | Селект роли в строке таблицы сжат до 0px полезной ширины — роль не читается. | `UsersPage.jsx:398` — `select.input` (`w-full px-4`) в `td` без `min-width`; в режиме редактирования соседние ячейки превращаются в поля и сжимают колонку. Попутно `h-9` не действует: `.input` задаёт `min-height:48px`. |
| 4 | P1 | Справочник → Вопросы, все ширины | `textarea` с фиксированной высотой: текст вопроса и «Наблюдаемых признаков» обрезан посреди строки (виден верх следующей строки). Названия разделов в `input` не помещаются (до 499px текста в 208–368px поля). | `RatingTemplatesPage.jsx:480,504` — `textarea rows={2}` / `rows={1}` без авто-роста (у подсказки ещё `!min-h-0`); название раздела — однострочный `input` (`:427`). |
| 5 | P1 | Справочник → Учебный год, 375 | Горизонтальный скролл всей страницы (492px при ширине 375). | Таблица в `card overflow-x-auto` (`AcademicYearsPage.jsx:138`) скроллится правильно, но `span.sr-only` «Действия» в `th` — `position:absolute` без `relative`-предка, поэтому выпадает из скролл-контейнера и растягивает документ. |
| 6 | P1 | Мониторинг, 1280–1440 KZ/RU | Вкладка «АНАЛИТИКА» обрезана («АНАЛИ…») внутри панели вкладок без индикации прокрутки. | Панель вкладок `overflow-x-auto` фиксированной ширины рядом с заголовком; моноширинный uppercase с `tracking` увеличивает ширину. |
| 7 | P2 | Мониторинг → «Фиксация нарушения», 375–1280 | Модалка выше экрана (до 1747px на 375) и прокручивается целиком: заголовок и кнопки «Сохранить/Закрыть» уезжают. Типы нарушений — мелкий моноширинный uppercase. | `MonitoringPage.jsx:574` — `fixed inset-0 overflow-y-auto` + `form.my-auto` без `max-height` и без внутреннего скролла тела. |
| 8 | P2 | Карточка записи, 375–768 | Тексты критериев оценки обрезаны многоточием до ~125px без title/tooltip — критерий невозможно прочитать. | `RecordDetailPage.jsx` — `span.flex-1.truncate`. |
| 9 | P2 | Мониторинг, карточки занятий | Название факультета (`truncate`) и ФИО (`line-clamp-2`) обрезаются без title. | `MonitoringPage.jsx` — карточка занятия. |
| 10 | P2 | Записи, 375 | Заголовок «Жазбалар» вплотную к кнопкам; кнопки «Excel-ге экспорт» / «+ Жазба қосу» ломаются в 2 строки. | Шапка страницы `flex justify-between` без переноса группы кнопок. |
| 11 | P2 | Сайдбар, все страницы | Подзаголовок бренда «Ректорлық бақылау комитеті» обрезан многоточием (KZ). При высоте экрана ≤ 800 последний пункт меню («Аудит логтары») срезан пополам без индикации скролла. | `Sidebar.jsx` — фиксированная ширина бренда + `truncate`; навигация в скролл-контейнере между шапкой и футером. |
| 12 | P2 | Справочник → Вопросы, 375 | ~560 мелких кнопок (<32px): ↑ ↓ ✕ и чипы типов занятий. | Иконки-кнопки без минимальной области нажатия. |
| 13 | P3 | LDAP-пользователи | DN обрезаны многоточием (title есть) — допустимо, но колонка DN занимает основную ширину таблицы. | — |

### Несогласованность дизайна (не ломает вёрстку, но мешает единому стилю)

- 7 модалок реализованы вручную, у каждой свои отступы, радиусы (`rounded-lg` / 20px), фон подложки (`/55`, `/70`, `/75`), z-index (`z-50`, `z-[60]`, `z-[70]`); единого компонента `Modal` и шкалы z-index нет.
- Три параллельные системы стилей: Material 3 токены (`--md-sys-*`), слой совместимости `.platform-white` поверх Tailwind-классов (`bg-white`, `border-slate-200` и т.д. переопределяются в `index.css`), и «кибер»-стиль (`.cyber-screen`, моноширинные uppercase-надзаголовки «KRK // SECURITY OPERATIONS CENTER»). Радиусы: 12/4px (поля), 18/20px (карточки), `rounded-lg`, `rounded-full` (кнопки).
- Поля ввода в стиле M3 filled (серый фон, нижняя граница) соседствуют с outlined-полями (мониторинг).
- Шрифт Roboto Flex + Roboto Mono для всех элементов с `tracking-[...]` — моноширинный uppercase плохо читается на кириллице, особенно казахской.
- Фон страницы с радиальными градиентами (`.soc-shell`), тени трёх разных видов.

### Локализация (влияет на стресс-тест KZ)

- ~325 строк захардкожены на русском прямо в JSX: Мониторинг 81, Логи аудита 56, Дашборд 40, Справочник вопросов 40, Кабинеты 36, Настройки 22, Записи 23, Учебные годы 11 и др. На этих экранах выбор KZ/EN почти ничего не меняет (см. скриншоты `monitoring__*__kz__*`).
- В шапке захардкожено «Система защищена»; на странице входа в KZ подзаголовок «Корпоративная учётная запись университета» и placeholder «Логин и пароль от Platonus» — по-русски; бренд «Комитет ректорского контроля» на входе не переводится.
- В EN нет 5 ключей: `records.exportExcel`, `records.exporting`, `records.exportError`, `records.count_few`, `records.count_many` (падают на RU-fallback).
- Казахские строки словаря в среднем той же длины, что русские (медиана 1.0, p90 — 1.21×), т.е. запас на +20–40% сейчас реально не проверяется — нужен синтетический стресс-тест (этап 5).

### Прочее

- `recharts` в зависимостях, но не используется — графики дашборда нарисованы вручную (SVG/div).
- Нет линтера, typecheck (проект на JS) и тестов — на этапе 5 проверять «ничего не сломалось» можно только сборкой `vite build` и новыми Playwright-тестами.
- Тёмная тема существует (переключатель в сайдбаре) — в задаче не упомянута; аудит проводился в светлой.


## Детально по страницам

### login

Автоматическая проверка проблем не нашла.

### dashboard

| Пр. | Тип | Состояние | Селектор | Пример текста / размеры | Ширины | Языки | Скриншот |
|---|---|---|---|---|---|---|---|
| P1 | Текст вылезает из своего блока и уходит под соседний | default | `….gap-4 > article.rounded-lg.border.border-slate-200 > div.grid.gap-5.p-5 > div.space-y-3` | Факультет экономики и бизнеса 105 (47.1%) Факульте — +260px past parent div.cyber-dashboard.w-full.space-y-5:nth-of-type(2) > section.grid.gap-4:nth-of-type(4) > article.rounded-lg.border.border-slate-200:nth-of-type(1) > div.grid.gap-5.p-5:nth-of-type(2) · under div.cyber-dashboard.w-full.space-y-5:nth-of-type(2) > section.grid.gap-4:nth-of-type(4) > article.rounded-lg.border.border-slate-200:nth-of-type(2) > div.grid.gap-5.p-5:nth-of-type(2) | 1280, 1440 | RU, KZ, EN | [img](screenshots/before/dashboard__default__kz__1280.jpg) |
| P2 | Горизонтальный скролл основной области | default | `main` |  — scrollWidth 694 > 375 | 375 | RU, KZ, EN | [img](screenshots/before/dashboard__default__kz__375.jpg) |
| P2 | Горизонтальный скролл основной области | mobile-menu | `main` |  — scrollWidth 694 > 375 | 375 | RU, KZ, EN | [img](screenshots/before/dashboard__mobile-menu__kz__375.jpg) |
| P2 | Содержимое вылезает за родителя | default | `…board.w-full.space-y-5 > section.grid.gap-4 > article.rounded-lg.border.border-slate-200` | КОНТРОЛЬНЫЕ ОРИЕНТИРЫ Выполнение ключевых показате — +331px past parent main#main-content > div.cyber-dashboard.w-full.space-y-5:nth-of-type(2) > section.grid.gap-4:nth-of-type(3) | 375, 1280 | RU, KZ, EN | [img](screenshots/before/dashboard__default__kz__375.jpg) |
| P2 | Содержимое вылезает за родителя | default | `….gap-4 > article.rounded-lg.border.border-slate-200 > div.grid.gap-5.p-5 > div.space-y-3` | Нормальные записи 91.9% Проблемные записи 8.1% — +14px past parent div.cyber-dashboard.w-full.space-y-5:nth-of-type(2) > section.grid.gap-4:nth-of-type(4) > article.rounded-lg.border.border-slate-200:nth-of-type(2) > div.grid.gap-5.p-5:nth-of-type(2) | 1280 | RU, KZ, EN | [img](screenshots/before/dashboard__default__kz__1280.jpg) |
| P2 | Содержимое вылезает за родителя | mobile-menu | `…board.w-full.space-y-5 > section.grid.gap-4 > article.rounded-lg.border.border-slate-200` | КОНТРОЛЬНЫЕ ОРИЕНТИРЫ Выполнение ключевых показате — +331px past parent main#main-content > div.cyber-dashboard.w-full.space-y-5:nth-of-type(2) > section.grid.gap-4:nth-of-type(3) | 375 | RU, KZ, EN | [img](screenshots/before/dashboard__mobile-menu__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | default | `…lex-1 > div.flex.items-center.justify-between > span.truncate.font-medium.text-slate-700` | Факультет Инжиниринга и информационных технологий — scroll 371 / client 355 | 375, 1280, 1440 | RU, KZ, EN | [img](screenshots/before/dashboard__default__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | default | `…-y-4.p-5 > div > div.mb-1.5.flex.items-center > span.truncate.font-medium.text-slate-700` | Факультет Инжиниринга и информационных технологий — scroll 371 / client 348 | 375 | RU, KZ, EN | [img](screenshots/before/dashboard__default__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | default | `…center.gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > span.mt-0.5.block.truncate` | Ректорлық бақылау комитеті — scroll 191 / client 179 | 375, 768 | RU, KZ | [img](screenshots/before/dashboard__default__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | default | `….gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > p.mt-0.5.truncate.text-slate-500` | Система мониторинга университета — scroll 188 / client 179 | 375, 768 | RU | [img](screenshots/before/dashboard__default__ru__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | mobile-menu | `…lex-1 > div.flex.items-center.justify-between > span.truncate.font-medium.text-slate-700` | Факультет Инжиниринга и информационных технологий — scroll 371 / client 355 | 375 | RU, KZ, EN | [img](screenshots/before/dashboard__mobile-menu__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | mobile-menu | `…-y-4.p-5 > div > div.mb-1.5.flex.items-center > span.truncate.font-medium.text-slate-700` | Факультет Инжиниринга и информационных технологий — scroll 371 / client 348 | 375 | RU, KZ, EN | [img](screenshots/before/dashboard__mobile-menu__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | mobile-menu | `…center.gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > span.mt-0.5.block.truncate` | Ректорлық бақылау комитеті — scroll 191 / client 179 | 375, 768 | RU, KZ | [img](screenshots/before/dashboard__mobile-menu__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | mobile-menu | `….gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > p.mt-0.5.truncate.text-slate-500` | Система мониторинга университета — scroll 188 / client 179 | 375, 768 | RU | [img](screenshots/before/dashboard__mobile-menu__ru__375.jpg) |

### monitoring

| Пр. | Тип | Состояние | Селектор | Пример текста / размеры | Ширины | Языки | Скриншот |
|---|---|---|---|---|---|---|---|
| P2 | Модалка выше экрана, скроллится целиком (шапка/футер уезжают) | modal-violation | `…yber-screen.relative.min-h-full > div.fixed.inset-0.z-50 > form.my-auto.w-full.max-w-5xl` | Фиксация нарушения ПРЕПОДАВАТЕЛЬ: БАУЫРЖАНОВА ШЫНА — panel 351x1747 at top 12 / vp 375x812 | 375, 768, 1280, 1440 | RU, KZ, EN | [img](screenshots/before/monitoring__modal-violation__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | default | `…div.flex.items-start.gap-3 > div.min-w-0.flex-1 > h3.line-clamp-2.font-bold.leading-snug` | [ФИО] — scroll 129 / client 129 | 375, 768 | RU, KZ, EN | [img](screenshots/before/monitoring__default__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | default | `…low-hidden > div.flex.items-start.gap-3 > div.min-w-0.flex-1 > p.mt-1.truncate.font-bold` | ФАКУЛЬТЕТ ЭКОНОМИКИ И БИЗНЕСА — scroll 220 / client 129 | 375, 768, 1280, 1440, 1920 | RU, KZ, EN | [img](screenshots/before/monitoring__default__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | default | `…center.gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > span.mt-0.5.block.truncate` | Ректорлық бақылау комитеті — scroll 191 / client 179 | 375, 768 | RU, KZ | [img](screenshots/before/monitoring__default__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | default | `….gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > p.mt-0.5.truncate.text-slate-500` | Система мониторинга университета — scroll 188 / client 179 | 375, 768 | RU | [img](screenshots/before/monitoring__default__ru__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | mobile-menu | `…div.flex.items-start.gap-3 > div.min-w-0.flex-1 > h3.line-clamp-2.font-bold.leading-snug` | [ФИО] — scroll 129 / client 129 | 375, 768 | RU, KZ, EN | [img](screenshots/before/monitoring__mobile-menu__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | mobile-menu | `…low-hidden > div.flex.items-start.gap-3 > div.min-w-0.flex-1 > p.mt-1.truncate.font-bold` | ФАКУЛЬТЕТ ЭКОНОМИКИ И БИЗНЕСА — scroll 220 / client 129 | 375, 768 | RU, KZ, EN | [img](screenshots/before/monitoring__mobile-menu__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | mobile-menu | `…center.gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > span.mt-0.5.block.truncate` | Ректорлық бақылау комитеті — scroll 191 / client 179 | 375, 768 | RU, KZ | [img](screenshots/before/monitoring__mobile-menu__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | mobile-menu | `….gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > p.mt-0.5.truncate.text-slate-500` | Система мониторинга университета — scroll 188 / client 179 | 375, 768 | RU | [img](screenshots/before/monitoring__mobile-menu__ru__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | modal-violation | `…div.flex.items-start.gap-3 > div.min-w-0.flex-1 > h3.line-clamp-2.font-bold.leading-snug` | [ФИО] — scroll 129 / client 129 | 375, 768 | RU, KZ, EN | [img](screenshots/before/monitoring__modal-violation__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | modal-violation | `…low-hidden > div.flex.items-start.gap-3 > div.min-w-0.flex-1 > p.mt-1.truncate.font-bold` | ФАКУЛЬТЕТ ЭКОНОМИКИ И БИЗНЕСА — scroll 220 / client 129 | 375, 768, 1280, 1440, 1920 | RU, KZ, EN | [img](screenshots/before/monitoring__modal-violation__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | modal-violation | `…center.gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > span.mt-0.5.block.truncate` | Ректорлық бақылау комитеті — scroll 191 / client 179 | 375, 768 | RU, KZ | [img](screenshots/before/monitoring__modal-violation__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | modal-violation | `….gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > p.mt-0.5.truncate.text-slate-500` | Система мониторинга университета — scroll 188 / client 179 | 375, 768 | RU | [img](screenshots/before/monitoring__modal-violation__ru__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | tab-analytics | `…center.gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > span.mt-0.5.block.truncate` | Ректорлық бақылау комитеті — scroll 191 / client 179 | 375, 768 | RU, KZ | [img](screenshots/before/monitoring__tab-analytics__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | tab-analytics | `….gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > p.mt-0.5.truncate.text-slate-500` | Система мониторинга университета — scroll 188 / client 179 | 375, 768 | RU | [img](screenshots/before/monitoring__tab-analytics__ru__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | tab-archive | `…div.flex.items-start.gap-3 > div.min-w-0.flex-1 > h3.line-clamp-2.font-bold.leading-snug` | [ФИО] — scroll 129 / client 129 | 375, 768 | RU, KZ, EN | [img](screenshots/before/monitoring__tab-archive__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | tab-archive | `…low-hidden > div.flex.items-start.gap-3 > div.min-w-0.flex-1 > p.mt-1.truncate.font-bold` | ФАКУЛЬТЕТ ЭКОНОМИКИ И БИЗНЕСА — scroll 220 / client 129 | 375, 768, 1280, 1440, 1920 | RU, KZ, EN | [img](screenshots/before/monitoring__tab-archive__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | tab-archive | `…> div.flex.items-start.gap-3 > div.min-w-0 > p.line-clamp-2.font-semibold.text-slate-700` | Мейрамхана және мейманхана бизнесіндегі кәсіпкерлі — scroll 255 / client 255 | 375, 768 | RU, KZ, EN | [img](screenshots/before/monitoring__tab-archive__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | tab-archive | `…center.gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > span.mt-0.5.block.truncate` | Ректорлық бақылау комитеті — scroll 191 / client 179 | 375, 768 | RU, KZ | [img](screenshots/before/monitoring__tab-archive__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | tab-archive | `….gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > p.mt-0.5.truncate.text-slate-500` | Система мониторинга университета — scroll 188 / client 179 | 375, 768 | RU | [img](screenshots/before/monitoring__tab-archive__ru__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | tab-violations | `…center.gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > span.mt-0.5.block.truncate` | Ректорлық бақылау комитеті — scroll 191 / client 179 | 375, 768 | RU, KZ | [img](screenshots/before/monitoring__tab-violations__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | tab-violations | `….gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > p.mt-0.5.truncate.text-slate-500` | Система мониторинга университета — scroll 188 / client 179 | 375, 768 | RU | [img](screenshots/before/monitoring__tab-violations__ru__375.jpg) |

### records

| Пр. | Тип | Состояние | Селектор | Пример текста / размеры | Ширины | Языки | Скриншот |
|---|---|---|---|---|---|---|---|
| P1 | Текст вылезает из своего блока и уходит под соседний | default | `main#main-content > div.space-y-5 > div.card.p-4.flex > select.input` | All statuses Draft Submitted Rework Accepted — +151px past parent main#main-content > div.space-y-5:nth-of-type(2) > div.card.p-4.flex:nth-of-type(2) · under main#main-content > div.space-y-5:nth-of-type(2) > div.card.p-4.flex:nth-of-type(2) > select.input:nth-of-type(3) | 768 | RU, KZ, EN | [img](screenshots/before/records__default__kz__768.jpg) |
| P1 | Текст вылезает из своего блока и уходит под соседний | with-data | `main#main-content > div.space-y-5 > div.card.p-4.flex > select.input` | All statuses Draft Submitted Rework Accepted — +151px past parent main#main-content > div.space-y-5:nth-of-type(2) > div.card.p-4.flex:nth-of-type(2) · under main#main-content > div.space-y-5:nth-of-type(2) > div.card.p-4.flex:nth-of-type(2) > select.input:nth-of-type(3) | 768 | RU, KZ, EN | [img](screenshots/before/records__with-data__kz__768.jpg) |
| P2 | Горизонтальный скролл основной области | default | `main` |  — scrollWidth 903 > 768 | 768, 1280 | RU, KZ, EN | [img](screenshots/before/records__default__kz__768.jpg) |
| P2 | Горизонтальный скролл основной области | mobile-menu | `main` |  — scrollWidth 903 > 768 | 768 | RU, KZ, EN | [img](screenshots/before/records__mobile-menu__kz__768.jpg) |
| P2 | Горизонтальный скролл основной области | with-data | `main` |  — scrollWidth 903 > 768 | 768, 1280 | RU, KZ, EN | [img](screenshots/before/records__with-data__kz__768.jpg) |
| P2 | Значение/placeholder не помещается в поле | default | `main#main-content > div.space-y-5 > div.card.p-4.flex > input.input.flex-1` | Search (teacher, subject, group, EP, saved by)… — need 289px / avail 283px | 375, 768, 1280, 1440 | RU, KZ, EN | [img](screenshots/before/records__default__ru__375.jpg) |
| P2 | Значение/placeholder не помещается в поле | mobile-menu | `main#main-content > div.space-y-5 > div.card.p-4.flex > input.input.flex-1` | Search (teacher, subject, group, EP, saved by)… — need 289px / avail 283px | 375, 768 | RU, KZ, EN | [img](screenshots/before/records__mobile-menu__ru__375.jpg) |
| P2 | Значение/placeholder не помещается в поле | with-data | `main#main-content > div.space-y-5 > div.card.p-4.flex > input.input.flex-1` | Search (teacher, subject, group, EP, saved by)… — need 289px / avail 283px | 375, 768, 1280, 1440 | RU, KZ, EN | [img](screenshots/before/records__with-data__ru__375.jpg) |
| P2 | Содержимое вылезает за родителя | default | `main#main-content > div.space-y-5 > div.card.p-4.flex > select.input` | All EPs 6B02100 - Дизайн 6B02101 - Графический диз — +15px past parent main#main-content > div.space-y-5:nth-of-type(2) > div.card.p-4.flex:nth-of-type(2) | 768, 1280 | RU, KZ, EN | [img](screenshots/before/records__default__kz__768.jpg) |
| P2 | Содержимое вылезает за родителя | mobile-menu | `main#main-content > div.space-y-5 > div.card.p-4.flex > select.input` | All EPs 6B02100 - Дизайн 6B02101 - Графический диз — +15px past parent main#main-content > div.space-y-5:nth-of-type(2) > div.card.p-4.flex:nth-of-type(2) · under div#root > div.platform-white.soc-shell.min-h-screen > button.fixed.inset-0.z-30 | 768 | RU, KZ, EN | [img](screenshots/before/records__mobile-menu__kz__768.jpg) |
| P2 | Содержимое вылезает за родителя | with-data | `main#main-content > div.space-y-5 > div.card.p-4.flex > select.input` | All EPs 6B02100 - Дизайн 6B02101 - Графический диз — +15px past parent main#main-content > div.space-y-5:nth-of-type(2) > div.card.p-4.flex:nth-of-type(2) | 768, 1280 | RU, KZ, EN | [img](screenshots/before/records__with-data__kz__768.jpg) |
| P2 | Обрезка многоточием без title/tooltip | default | `…center.gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > span.mt-0.5.block.truncate` | Ректорлық бақылау комитеті — scroll 191 / client 179 | 375, 768 | RU, KZ | [img](screenshots/before/records__default__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | default | `….gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > p.mt-0.5.truncate.text-slate-500` | Система мониторинга университета — scroll 188 / client 179 | 375, 768 | RU | [img](screenshots/before/records__default__ru__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | mobile-menu | `…center.gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > span.mt-0.5.block.truncate` | Ректорлық бақылау комитеті — scroll 191 / client 179 | 375, 768 | RU, KZ | [img](screenshots/before/records__mobile-menu__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | mobile-menu | `….gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > p.mt-0.5.truncate.text-slate-500` | Система мониторинга университета — scroll 188 / client 179 | 375, 768 | RU | [img](screenshots/before/records__mobile-menu__ru__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | with-data | `… > div.flex.items-start.justify-between > div.min-w-0 > p.text-sm.text-gray-500.truncate` | Әлем халықтарының салт-дәстүрлері — scroll 241 / client 227 | 375 | RU, KZ, EN | [img](screenshots/before/records__with-data__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | with-data | `…-sm > tbody.divide-y.divide-gray-100 > tr.transition-colors > td.px-4.py-3.text-gray-600` | 6B04105 - Менеджмент — scroll 183 / client 120 | 768, 1280, 1440, 1920 | RU, KZ, EN | [img](screenshots/before/records__with-data__kz__768.jpg) |
| P2 | Обрезка многоточием без title/tooltip | with-data | `…center.gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > span.mt-0.5.block.truncate` | Ректорлық бақылау комитеті — scroll 191 / client 179 | 375, 768 | RU, KZ | [img](screenshots/before/records__with-data__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | with-data | `….gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > p.mt-0.5.truncate.text-slate-500` | Система мониторинга университета — scroll 188 / client 179 | 375, 768 | RU | [img](screenshots/before/records__with-data__ru__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | with-data | `…ide-gray-100 > div.p-4.transition-colors > div.mt-2.flex.gap-3 > button.text-primary-600` | Edit — 21x16 | 375 | RU, KZ, EN | [img](screenshots/before/records__with-data__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | with-data | `….divide-gray-100 > div.p-4.transition-colors > div.mt-2.flex.gap-3 > button.text-red-500` | Del. — 21x16 | 375 | RU, KZ, EN | [img](screenshots/before/records__with-data__kz__375.jpg) |

### records-new

| Пр. | Тип | Состояние | Селектор | Пример текста / размеры | Ширины | Языки | Скриншот |
|---|---|---|---|---|---|---|---|
| P2 | Горизонтальный скролл основной области | default | `main` |  — scrollWidth 383 > 375 | 375 | RU | [img](screenshots/before/records-new__default__ru__375.jpg) |
| P2 | Горизонтальный скролл основной области | mobile-menu | `main` |  — scrollWidth 383 > 375 | 375 | RU | [img](screenshots/before/records-new__mobile-menu__ru__375.jpg) |
| P2 | Значение/placeholder не помещается в поле | default | `div.space-y-4 > div.grid.grid-cols-1.gap-4 > div > input.input` | Аты-жөнін таңдаңыз немесе теруді бастаңыз — need 288px / avail 267px | 375 | KZ | [img](screenshots/before/records-new__default__kz__375.jpg) |
| P2 | Значение/placeholder не помещается в поле | mobile-menu | `div.space-y-4 > div.grid.grid-cols-1.gap-4 > div > input.input` | Аты-жөнін таңдаңыз немесе теруді бастаңыз — need 288px / avail 267px | 375 | KZ | [img](screenshots/before/records-new__mobile-menu__kz__375.jpg) |
| P2 | Содержимое вылезает за родителя | default | `div.w-full > div.card.p-6 > ol.flex.items-center.w-full > li.flex.items-center` | 4 Подтверждение — +45px past parent main#main-content > div.w-full:nth-of-type(2) > div.card.p-6:nth-of-type(2) > ol.flex.items-center.w-full | 375 | RU | [img](screenshots/before/records-new__default__ru__375.jpg) |
| P2 | Содержимое вылезает за родителя | mobile-menu | `div.w-full > div.card.p-6 > ol.flex.items-center.w-full > li.flex.items-center` | 4 Подтверждение — +45px past parent main#main-content > div.w-full:nth-of-type(2) > div.card.p-6:nth-of-type(2) > ol.flex.items-center.w-full · under div#root > div.platform-white.soc-shell.min-h-screen > button.fixed.inset-0.z-30 | 375 | RU | [img](screenshots/before/records-new__mobile-menu__ru__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | default | `…center.gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > span.mt-0.5.block.truncate` | Ректорлық бақылау комитеті — scroll 191 / client 179 | 375, 768 | RU, KZ | [img](screenshots/before/records-new__default__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | default | `….gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > p.mt-0.5.truncate.text-slate-500` | Система мониторинга университета — scroll 188 / client 179 | 375, 768 | RU | [img](screenshots/before/records-new__default__ru__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | mobile-menu | `…center.gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > span.mt-0.5.block.truncate` | Ректорлық бақылау комитеті — scroll 191 / client 179 | 375, 768 | RU, KZ | [img](screenshots/before/records-new__mobile-menu__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | mobile-menu | `….gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > p.mt-0.5.truncate.text-slate-500` | Система мониторинга университета — scroll 188 / client 179 | 375, 768 | RU | [img](screenshots/before/records-new__mobile-menu__ru__375.jpg) |

### record-detail

| Пр. | Тип | Состояние | Селектор | Пример текста / размеры | Ширины | Языки | Скриншот |
|---|---|---|---|---|---|---|---|
| P2 | Обрезка многоточием без title/tooltip | default | `…e-y-4 > div.space-y-2 > div.flex.items-center.gap-3 > span.flex-1.text-gray-600.truncate` | Conformity of topic and content with the syllabus — scroll 295 / client 125 | 375, 768, 1280, 1440 | RU, KZ, EN | [img](screenshots/before/record-detail__default__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | default | `…center.gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > span.mt-0.5.block.truncate` | Ректорлық бақылау комитеті — scroll 191 / client 179 | 375, 768 | RU, KZ | [img](screenshots/before/record-detail__default__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | default | `….gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > p.mt-0.5.truncate.text-slate-500` | Система мониторинга университета — scroll 188 / client 179 | 375, 768 | RU | [img](screenshots/before/record-detail__default__ru__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | mobile-menu | `…e-y-4 > div.space-y-2 > div.flex.items-center.gap-3 > span.flex-1.text-gray-600.truncate` | Conformity of topic and content with the syllabus — scroll 295 / client 125 | 375, 768 | RU, KZ, EN | [img](screenshots/before/record-detail__mobile-menu__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | mobile-menu | `…center.gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > span.mt-0.5.block.truncate` | Ректорлық бақылау комитеті — scroll 191 / client 179 | 375, 768 | RU, KZ | [img](screenshots/before/record-detail__mobile-menu__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | mobile-menu | `….gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > p.mt-0.5.truncate.text-slate-500` | Система мониторинга университета — scroll 188 / client 179 | 375, 768 | RU | [img](screenshots/before/record-detail__mobile-menu__ru__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | default | `div.space-y-5 > div.flex.flex-col.gap-4 > div > button.text-sm.text-gray-400.mb-2` | ← Back — 48x20 | 375 | RU, KZ, EN | [img](screenshots/before/record-detail__default__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | mobile-menu | `div.space-y-5 > div.flex.flex-col.gap-4 > div > button.text-sm.text-gray-400.mb-2` | ← Back — 48x20 | 375 | RU, KZ, EN | [img](screenshots/before/record-detail__mobile-menu__kz__375.jpg) |

### record-edit

| Пр. | Тип | Состояние | Селектор | Пример текста / размеры | Ширины | Языки | Скриншот |
|---|---|---|---|---|---|---|---|
| P2 | Горизонтальный скролл основной области | default | `main` |  — scrollWidth 383 > 375 | 375 | RU | [img](screenshots/before/record-edit__default__ru__375.jpg) |
| P2 | Горизонтальный скролл основной области | mobile-menu | `main` |  — scrollWidth 383 > 375 | 375 | RU | [img](screenshots/before/record-edit__mobile-menu__ru__375.jpg) |
| P2 | Содержимое вылезает за родителя | default | `div.w-full > div.card.p-6 > ol.flex.items-center.w-full > li.flex.items-center` | 4 Подтверждение — +45px past parent main#main-content > div.w-full:nth-of-type(2) > div.card.p-6:nth-of-type(2) > ol.flex.items-center.w-full | 375 | RU | [img](screenshots/before/record-edit__default__ru__375.jpg) |
| P2 | Содержимое вылезает за родителя | mobile-menu | `div.w-full > div.card.p-6 > ol.flex.items-center.w-full > li.flex.items-center` | 4 Подтверждение — +45px past parent main#main-content > div.w-full:nth-of-type(2) > div.card.p-6:nth-of-type(2) > ol.flex.items-center.w-full · under div#root > div.platform-white.soc-shell.min-h-screen > button.fixed.inset-0.z-30 | 375 | RU | [img](screenshots/before/record-edit__mobile-menu__ru__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | default | `…center.gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > span.mt-0.5.block.truncate` | Ректорлық бақылау комитеті — scroll 191 / client 179 | 375, 768 | RU, KZ | [img](screenshots/before/record-edit__default__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | default | `….gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > p.mt-0.5.truncate.text-slate-500` | Система мониторинга университета — scroll 188 / client 179 | 375, 768 | RU | [img](screenshots/before/record-edit__default__ru__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | mobile-menu | `…center.gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > span.mt-0.5.block.truncate` | Ректорлық бақылау комитеті — scroll 191 / client 179 | 375, 768 | RU, KZ | [img](screenshots/before/record-edit__mobile-menu__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | mobile-menu | `….gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > p.mt-0.5.truncate.text-slate-500` | Система мониторинга университета — scroll 188 / client 179 | 375, 768 | RU | [img](screenshots/before/record-edit__mobile-menu__ru__375.jpg) |

### catalogs-questions

| Пр. | Тип | Состояние | Селектор | Пример текста / размеры | Ширины | Языки | Скриншот |
|---|---|---|---|---|---|---|---|
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#note` | Шкала: 1–2 — критерий практически не проявлен; 3–4 — content 320px / visible 80px | 375, 768, 1280, 1440, 1920 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-0-0` | Соответствуют ли фактическая тема, задания и виды  — content 100px / visible 60px | 375, 1280 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-hint-0-0` | Совпадают дисциплина, тема, вид занятия и содержан — content 172px / visible 28px | 375, 768, 1280, 1440 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-hint-0-1` | Цель сформулирована или однозначно следует из зада — content 204px / visible 28px | 375, 768, 1280, 1440 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-0-2` | Является ли содержание академически корректным, ак — content 100px / visible 60px | 375, 1280 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-hint-0-2` | Используются корректные понятия, данные и источник — content 188px / visible 28px | 375, 768, 1280, 1440 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-hint-0-3` | К концу занятия имеется наблюдаемое подтверждение: — content 220px / visible 28px | 375, 768, 1280, 1440, 1920 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-hint-1-0` | Выделяются начало, основная работа и завершение; п — content 172px / visible 28px | 375, 768, 1280, 1440 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-hint-1-1` | Применённые объяснения, обсуждения, задания, упраж — content 188px / visible 28px | 375, 768, 1280, 1440 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-hint-1-2` | Нет необоснованных пауз и затягивания; темп учитыв — content 188px / visible 28px | 375, 768, 1280, 1440 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-hint-1-3` | Термины раскрываются, приводятся примеры и связи,  — content 204px / visible 28px | 375, 768, 1280, 1440 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-2-0` | Вовлечено ли большинство присутствующих студентов  — content 100px / visible 60px | 375, 1280 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-hint-2-0` | Большинство слушает с заданием, отвечает, обсуждае — content 204px / visible 28px | 375, 768, 1280, 1440 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-2-1` | Создаёт ли преподаватель условия для самостоятельн — content 80px / visible 60px | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-hint-2-1` | Используются вопросы, проблемные ситуации, сравнен — content 204px / visible 28px | 375, 768, 1280, 1440 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-2-2` | Получают ли студенты возможность задавать вопросы  — content 80px / visible 60px | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-hint-2-2` | Есть содержательный обмен между преподавателем и г — content 204px / visible 28px | 375, 768, 1280, 1440, 1920 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-2-3` | Поддерживает ли преподаватель уважительную и инклю — content 80px / visible 60px | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-hint-2-3` | Корректное обращение, отсутствие унижения и дискри — content 220px / visible 28px | 375, 768, 1280, 1440 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-3-0` | Понятны ли студентам требования к заданию и призна — content 100px / visible 60px | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-hint-3-0` | Указано, что нужно выполнить, в каком формате, за  — content 124px / visible 28px | 375, 768, 1280, 1440 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-3-1` | Проверяет ли преподаватель понимание и ход выполне — content 80px / visible 60px | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-hint-3-1` | Используются содержательные вопросы, наблюдение за — content 188px / visible 28px | 375, 768, 1280, 1440 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-3-2` | Получают ли студенты конкретную и полезную обратну — content 80px / visible 60px | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-hint-3-2` | Обратная связь показывает, что выполнено верно, чт — content 140px / visible 28px | 375, 768, 1280, 1440 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-3-3` | Есть ли наблюдаемые подтверждения достижения резул — content 100px / visible 60px | 375, 1280 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-hint-3-3` | Студенты демонстрируют понимание, выполняют действ — content 188px / visible 28px | 375, 768, 1280, 1440 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-4-0` | Связан ли новый материал с ранее изученным и общей — content 80px / visible 60px | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-hint-4-0` | Актуализированы базовые знания, показаны связи меж — content 76px / visible 28px | 375, 1280 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-4-1` | Подкреплены ли ключевые положения доказательствами — content 100px / visible 60px | 375, 1280 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-hint-4-1` | Используются корректные данные, источники, примеры — content 108px / visible 28px | 375, 1280 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-hint-4-2` | Есть вопросы, мини-задание, резюме студентами или  — content 124px / visible 28px | 375, 768, 1280, 1440 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-5-0` | Применяют ли обучающиеся теорию при выполнении зад — content 80px / visible 60px | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-hint-5-0` | Основная часть времени отведена решению, анализу,  — content 140px / visible 28px | 375, 768, 1280, 1440 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-5-1` | Соответствуют ли задания уровню подготовки и посте — content 80px / visible 60px | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-hint-5-1` | Задания посильны, но требуют осмысленного применен — content 156px / visible 28px | 375, 768, 1280, 1440 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-hint-5-2` | Студенты объясняют ход решения, сравнивают подходы — content 124px / visible 28px | 375, 768, 1280, 1440 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-6-0` | Даны ли необходимые инструкции и обеспечено ли соб — content 100px / visible 60px | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-hint-6-0` | До начала работы понятны порядок действий, огранич — content 108px / visible 28px | 375, 768, 1280, 1440 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-6-1` | Самостоятельно ли обучающиеся выполняют предусмотр — content 80px / visible 60px | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-hint-6-1` | Студенты работают с оборудованием, программой или  — content 156px / visible 28px | 375, 768, 1280, 1440 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-6-2` | Фиксируются и интерпретируются ли результаты работ — content 80px / visible 60px | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-hint-6-2` | Результаты измерены или записаны, проанализированы — content 124px / visible 28px | 375, 768, 1280, 1440 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-7-0` | Обеспечены ли инструктаж, демонстрация и безопасна — content 80px / visible 60px | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-hint-7-0` | Понятна техника выполнения; пространство и оборудо — content 108px / visible 28px | 375, 768, 1280, 1440 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-7-1` | Имеют ли обучающиеся достаточное время для практич — content 80px / visible 60px | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-hint-7-1` | Большая часть занятия направлена на выполнение упр — content 124px / visible 28px | 375, 768, 1280, 1440 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-7-2` | Получают ли обучающиеся индивидуализированную корр — content 100px / visible 60px | 375, 1280 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P1 | Текст в textarea срезан (фиксированная высота) | default | `textarea#q-hint-7-2` | Преподаватель наблюдает, корректирует и учитывает  — content 124px / visible 28px | 375, 768, 1280, 1440 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P2 | Значение/placeholder не помещается в поле | default | `input#section-1` | B. Методика и организация обучения — need 250px / avail 203px | 375, 1280 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P2 | Значение/placeholder не помещается в поле | default | `input#section-2` | C. Учебная активность и взаимодействие — need 282px / avail 203px | 375, 1280 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P2 | Значение/placeholder не помещается в поле | default | `input#section-3` | D. Оценивание и обратная связь — need 218px / avail 203px | 375, 1280 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P2 | Значение/placeholder не помещается в поле | default | `input#section-4` | E. Модуль по виду занятия: лекция — need 233px / avail 203px | 375, 1280 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P2 | Значение/placeholder не помещается в поле | default | `input#section-5` | E. Модуль по виду занятия: практика или семинар — need 337px / avail 203px | 375, 1280 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P2 | Значение/placeholder не помещается в поле | default | `input#section-6` | E. Модуль по виду занятия: лабораторная работа — need 330px / avail 203px | 375, 1280 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P2 | Значение/placeholder не помещается в поле | default | `input#section-7` | E. Модуль по виду занятия: физическая культура или — need 499px / avail 203px | 375, 768, 1280, 1440 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P2 | Значение/placeholder не помещается в поле | default | `select#calc-method` | Среднее по разделам с весами разделов — need 266px / avail 233px | 1280 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__1280.jpg) |
| P2 | Значение/placeholder не помещается в поле | mobile-menu | `input#section-1` | B. Методика и организация обучения — need 250px / avail 203px | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__mobile-menu__kz__375.jpg) |
| P2 | Значение/placeholder не помещается в поле | mobile-menu | `input#section-2` | C. Учебная активность и взаимодействие — need 282px / avail 203px | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__mobile-menu__kz__375.jpg) |
| P2 | Значение/placeholder не помещается в поле | mobile-menu | `input#section-3` | D. Оценивание и обратная связь — need 218px / avail 203px | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__mobile-menu__kz__375.jpg) |
| P2 | Значение/placeholder не помещается в поле | mobile-menu | `input#section-4` | E. Модуль по виду занятия: лекция — need 233px / avail 203px | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__mobile-menu__kz__375.jpg) |
| P2 | Значение/placeholder не помещается в поле | mobile-menu | `input#section-5` | E. Модуль по виду занятия: практика или семинар — need 337px / avail 203px | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__mobile-menu__kz__375.jpg) |
| P2 | Значение/placeholder не помещается в поле | mobile-menu | `input#section-6` | E. Модуль по виду занятия: лабораторная работа — need 330px / avail 203px | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__mobile-menu__kz__375.jpg) |
| P2 | Значение/placeholder не помещается в поле | mobile-menu | `input#section-7` | E. Модуль по виду занятия: физическая культура или — need 499px / avail 203px | 375, 768 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__mobile-menu__kz__375.jpg) |
| P2 | Содержимое вылезает за родителя | default | `…-y-6 > div.grid.grid-cols-1.gap-6 > section.min-w-0.space-y-4 > div.sticky.bottom-0.z-10` | Изменён: admin Удалить Отменить Сохранить — +4px past parent div.w-full.space-y-6:nth-of-type(2) > div.w-full.space-y-6:nth-of-type(2) > div.grid.grid-cols-1.gap-6 > section.min-w-0.space-y-4 | 375, 768, 1280, 1440, 1920 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P2 | Содержимое вылезает за родителя | mobile-menu | `…-y-6 > div.grid.grid-cols-1.gap-6 > section.min-w-0.space-y-4 > div.sticky.bottom-0.z-10` | Изменён: admin Удалить Отменить Сохранить — +4px past parent div.w-full.space-y-6:nth-of-type(2) > div.w-full.space-y-6:nth-of-type(2) > div.grid.grid-cols-1.gap-6 > section.min-w-0.space-y-4 | 375, 768 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__mobile-menu__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | default | `…center.gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > span.mt-0.5.block.truncate` | Ректорлық бақылау комитеті — scroll 191 / client 179 | 375, 768 | RU, KZ | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | default | `….gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > p.mt-0.5.truncate.text-slate-500` | Система мониторинга университета — scroll 188 / client 179 | 375, 768 | RU | [img](screenshots/before/catalogs-questions__default__ru__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | mobile-menu | `…center.gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > span.mt-0.5.block.truncate` | Ректорлық бақылау комитеті — scroll 191 / client 179 | 375, 768 | RU, KZ | [img](screenshots/before/catalogs-questions__mobile-menu__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | mobile-menu | `….gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > p.mt-0.5.truncate.text-slate-500` | Система мониторинга университета — scroll 188 / client 179 | 375, 768 | RU | [img](screenshots/before/catalogs-questions__mobile-menu__ru__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | default | `…1.gap-6 > aside.space-y-4 > p.px-1.text-xs.text-gray-500 > a.font-semibold.text-blue-700` | «Учебный год» — 320x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | default | `…div.card.space-y-4.p-5 > div.flex.flex-wrap.items-center > button.rounded-full.px-3.py-1` | Для всех занятий — 127x24 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | default | `input#q-report-0-0` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | default | `input#q-report-0-1` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | default | `input#q-report-0-2` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | default | `input#q-report-0-3` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | default | `… > div.space-y-3.border-l-2.border-gray-100 > button.text-sm.font-semibold.text-blue-700` | + Добавить вопрос — 126x20 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | default | `input#q-report-1-0` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | default | `input#q-report-1-1` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | default | `input#q-report-1-2` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | default | `input#q-report-1-3` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | default | `input#q-report-2-0` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | default | `input#q-report-2-1` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | default | `input#q-report-2-2` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | default | `input#q-report-2-3` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | default | `input#q-report-3-0` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | default | `input#q-report-3-1` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | default | `input#q-report-3-2` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | default | `input#q-report-3-3` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | default | `input#q-report-4-0` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | default | `input#q-report-4-1` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | default | `input#q-report-4-2` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | default | `input#q-report-5-0` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | default | `input#q-report-5-1` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | default | `input#q-report-5-2` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | default | `input#q-report-6-0` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | default | `input#q-report-6-1` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | default | `input#q-report-6-2` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | default | `input#q-report-7-0` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | default | `input#q-report-7-1` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | default | `input#q-report-7-2` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__default__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | mobile-menu | `…1.gap-6 > aside.space-y-4 > p.px-1.text-xs.text-gray-500 > a.font-semibold.text-blue-700` | «Учебный год» — 320x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__mobile-menu__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | mobile-menu | `…div.card.space-y-4.p-5 > div.flex.flex-wrap.items-center > button.rounded-full.px-3.py-1` | Для всех занятий — 127x24 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__mobile-menu__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | mobile-menu | `input#q-report-0-0` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__mobile-menu__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | mobile-menu | `input#q-report-0-1` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__mobile-menu__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | mobile-menu | `input#q-report-0-2` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__mobile-menu__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | mobile-menu | `input#q-report-0-3` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__mobile-menu__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | mobile-menu | `… > div.space-y-3.border-l-2.border-gray-100 > button.text-sm.font-semibold.text-blue-700` | + Добавить вопрос — 126x20 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__mobile-menu__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | mobile-menu | `input#q-report-1-0` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__mobile-menu__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | mobile-menu | `input#q-report-1-1` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__mobile-menu__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | mobile-menu | `input#q-report-1-2` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__mobile-menu__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | mobile-menu | `input#q-report-1-3` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__mobile-menu__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | mobile-menu | `input#q-report-2-0` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__mobile-menu__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | mobile-menu | `input#q-report-2-1` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__mobile-menu__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | mobile-menu | `input#q-report-2-2` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__mobile-menu__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | mobile-menu | `input#q-report-2-3` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__mobile-menu__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | mobile-menu | `input#q-report-3-0` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__mobile-menu__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | mobile-menu | `input#q-report-3-1` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__mobile-menu__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | mobile-menu | `input#q-report-3-2` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__mobile-menu__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | mobile-menu | `input#q-report-3-3` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__mobile-menu__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | mobile-menu | `input#q-report-4-0` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__mobile-menu__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | mobile-menu | `input#q-report-4-1` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__mobile-menu__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | mobile-menu | `input#q-report-4-2` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__mobile-menu__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | mobile-menu | `input#q-report-5-0` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__mobile-menu__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | mobile-menu | `input#q-report-5-1` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__mobile-menu__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | mobile-menu | `input#q-report-5-2` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__mobile-menu__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | mobile-menu | `input#q-report-6-0` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__mobile-menu__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | mobile-menu | `input#q-report-6-1` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__mobile-menu__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | mobile-menu | `input#q-report-6-2` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__mobile-menu__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | mobile-menu | `input#q-report-7-0` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__mobile-menu__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | mobile-menu | `input#q-report-7-1` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__mobile-menu__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | mobile-menu | `input#q-report-7-2` |  — 181x30 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-questions__mobile-menu__kz__375.jpg) |

### catalogs-academic-years

| Пр. | Тип | Состояние | Селектор | Пример текста / размеры | Ширины | Языки | Скриншот |
|---|---|---|---|---|---|---|---|
| P1 | Горизонтальный скролл страницы | default | `html` |  — scrollWidth 492 > 375 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-academic-years__default__kz__375.jpg) |
| P1 | Горизонтальный скролл страницы | mobile-menu | `html` |  — scrollWidth 492 > 375 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-academic-years__mobile-menu__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | default | `…center.gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > span.mt-0.5.block.truncate` | Ректорлық бақылау комитеті — scroll 191 / client 179 | 375, 768 | RU, KZ | [img](screenshots/before/catalogs-academic-years__default__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | default | `….gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > p.mt-0.5.truncate.text-slate-500` | Система мониторинга университета — scroll 188 / client 179 | 375, 768 | RU | [img](screenshots/before/catalogs-academic-years__default__ru__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | mobile-menu | `…center.gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > span.mt-0.5.block.truncate` | Ректорлық бақылау комитеті — scroll 191 / client 179 | 375, 768 | RU, KZ | [img](screenshots/before/catalogs-academic-years__mobile-menu__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | mobile-menu | `….gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > p.mt-0.5.truncate.text-slate-500` | Система мониторинга университета — scroll 188 / client 179 | 375, 768 | RU | [img](screenshots/before/catalogs-academic-years__mobile-menu__ru__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | default | `tbody.divide-y.divide-gray-100 > tr > td.px-4.py-3 > a.text-blue-700` | Заведены — 65x16 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-academic-years__default__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | default | `…vide-gray-100 > tr > td.px-4.py-3.text-right > button.text-sm.font-semibold.text-red-600` | Удалить — 56x20 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-academic-years__default__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | mobile-menu | `tbody.divide-y.divide-gray-100 > tr > td.px-4.py-3 > a.text-blue-700` | Заведены — 65x16 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-academic-years__mobile-menu__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | mobile-menu | `…vide-gray-100 > tr > td.px-4.py-3.text-right > button.text-sm.font-semibold.text-red-600` | Удалить — 56x20 | 375 | RU, KZ, EN | [img](screenshots/before/catalogs-academic-years__mobile-menu__kz__375.jpg) |

### users

| Пр. | Тип | Состояние | Селектор | Пример текста / размеры | Ширины | Языки | Скриншот |
|---|---|---|---|---|---|---|---|
| P2 | Значение/placeholder не помещается в поле | default | `…ide-gray-100 > tr.transition-colors > td.px-4.py-3.text-gray-700 > select.input.h-9.py-1` | admin — need 39px / avail 0px | 768, 1280, 1440 | RU, KZ, EN | [img](screenshots/before/users__default__kz__768.jpg) |
| P2 | Значение/placeholder не помещается в поле | default | `div.divide-y.divide-gray-100 > div.p-4.space-y-2 > div.flex.gap-2 > select.input.h-8.py-1` | admin — need 35px / avail 0px | 375 | RU | [img](screenshots/before/users__default__ru__375.jpg) |
| P2 | Значение/placeholder не помещается в поле | inline-edit | `…ide-gray-100 > tr.transition-colors > td.px-4.py-3.text-gray-700 > select.input.h-9.py-1` | admin — need 39px / avail 0px | 768, 1280, 1440 | RU, KZ, EN | [img](screenshots/before/users__inline-edit__kz__768.jpg) |
| P2 | Значение/placeholder не помещается в поле | inline-edit | `div.divide-y.divide-gray-100 > div.p-4.space-y-2 > div.flex.gap-2 > select.input.h-8.py-1` | admin — need 35px / avail 0px | 375 | RU | [img](screenshots/before/users__inline-edit__ru__375.jpg) |
| P2 | Значение/placeholder не помещается в поле | mobile-menu | `…ide-gray-100 > tr.transition-colors > td.px-4.py-3.text-gray-700 > select.input.h-9.py-1` | admin — need 39px / avail 0px | 768 | RU, KZ, EN | [img](screenshots/before/users__mobile-menu__kz__768.jpg) |
| P2 | Значение/placeholder не помещается в поле | mobile-menu | `div.divide-y.divide-gray-100 > div.p-4.space-y-2 > div.flex.gap-2 > select.input.h-8.py-1` | admin — need 35px / avail 0px | 375 | RU | [img](screenshots/before/users__mobile-menu__ru__375.jpg) |
| P2 | Значение/placeholder не помещается в поле | modal-create | `…ide-gray-100 > tr.transition-colors > td.px-4.py-3.text-gray-700 > select.input.h-9.py-1` | admin — need 39px / avail 0px | 768, 1280, 1440 | RU, KZ, EN | [img](screenshots/before/users__modal-create__kz__768.jpg) |
| P2 | Значение/placeholder не помещается в поле | modal-create | `div.divide-y.divide-gray-100 > div.p-4.space-y-2 > div.flex.gap-2 > select.input.h-8.py-1` | admin — need 35px / avail 0px | 375 | RU | [img](screenshots/before/users__modal-create__ru__375.jpg) |
| P2 | Содержимое вылезает за родителя | default | `…-100 > div.p-4.space-y-2 > div.flex.items-start.justify-between > span.text-xs.px-2.py-1` | staff — +21px past parent div.card.overflow-hidden:nth-of-type(4) > div.divide-y.divide-gray-100:nth-of-type(1) > div.p-4.space-y-2:nth-of-type(20) > div.flex.items-start.justify-between:nth-of-type(1) | 375 | RU, KZ, EN | [img](screenshots/before/users__default__kz__375.jpg) |
| P2 | Содержимое вылезает за родителя | default | `…divide-gray-100 > div.p-4.space-y-2 > div.flex.gap-2 > button.btn-secondary.text-xs.px-3` | Удалить — +3px past parent div.card.overflow-hidden:nth-of-type(4) > div.divide-y.divide-gray-100:nth-of-type(1) > div.p-4.space-y-2:nth-of-type(1) > div.flex.gap-2:nth-of-type(3) | 375 | RU | [img](screenshots/before/users__default__ru__375.jpg) |
| P2 | Содержимое вылезает за родителя | inline-edit | `…-100 > div.p-4.space-y-2 > div.flex.items-start.justify-between > span.text-xs.px-2.py-1` | staff — +21px past parent div.card.overflow-hidden:nth-of-type(4) > div.divide-y.divide-gray-100:nth-of-type(1) > div.p-4.space-y-2:nth-of-type(20) > div.flex.items-start.justify-between:nth-of-type(1) | 375 | RU, KZ, EN | [img](screenshots/before/users__inline-edit__kz__375.jpg) |
| P2 | Содержимое вылезает за родителя | inline-edit | `…divide-gray-100 > div.p-4.space-y-2 > div.flex.gap-2 > button.btn-secondary.text-xs.px-3` | Удалить — +3px past parent div.card.overflow-hidden:nth-of-type(4) > div.divide-y.divide-gray-100:nth-of-type(1) > div.p-4.space-y-2:nth-of-type(1) > div.flex.gap-2:nth-of-type(3) | 375 | RU | [img](screenshots/before/users__inline-edit__ru__375.jpg) |
| P2 | Содержимое вылезает за родителя | mobile-menu | `…-100 > div.p-4.space-y-2 > div.flex.items-start.justify-between > span.text-xs.px-2.py-1` | staff — +21px past parent div.card.overflow-hidden:nth-of-type(4) > div.divide-y.divide-gray-100:nth-of-type(1) > div.p-4.space-y-2:nth-of-type(20) > div.flex.items-start.justify-between:nth-of-type(1) | 375 | RU, KZ, EN | [img](screenshots/before/users__mobile-menu__kz__375.jpg) |
| P2 | Содержимое вылезает за родителя | mobile-menu | `…divide-gray-100 > div.p-4.space-y-2 > div.flex.gap-2 > button.btn-secondary.text-xs.px-3` | Удалить — +3px past parent div.card.overflow-hidden:nth-of-type(4) > div.divide-y.divide-gray-100:nth-of-type(1) > div.p-4.space-y-2:nth-of-type(1) > div.flex.gap-2:nth-of-type(3) · under div#root > div.platform-white.soc-shell.min-h-screen > button.fixed.inset-0.z-30 | 375 | RU | [img](screenshots/before/users__mobile-menu__ru__375.jpg) |
| P2 | Содержимое вылезает за родителя | modal-create | `…-100 > div.p-4.space-y-2 > div.flex.items-start.justify-between > span.text-xs.px-2.py-1` | staff — +21px past parent div.card.overflow-hidden:nth-of-type(5) > div.divide-y.divide-gray-100:nth-of-type(1) > div.p-4.space-y-2:nth-of-type(20) > div.flex.items-start.justify-between:nth-of-type(1) | 375 | RU, KZ, EN | [img](screenshots/before/users__modal-create__kz__375.jpg) |
| P2 | Содержимое вылезает за родителя | modal-create | `…divide-gray-100 > div.p-4.space-y-2 > div.flex.gap-2 > button.btn-secondary.text-xs.px-3` | Удалить — +3px past parent div.card.overflow-hidden:nth-of-type(5) > div.divide-y.divide-gray-100:nth-of-type(1) > div.p-4.space-y-2:nth-of-type(1) > div.flex.gap-2:nth-of-type(3) · under div.space-y-5:nth-of-type(2) > div.fixed.inset-0.z-50:nth-of-type(4) > form.w-full.max-w-3xl.overflow-hidden > div.overflow-y-auto.p-5:nth-of-type(2) | 375 | RU | [img](screenshots/before/users__modal-create__ru__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | default | `…center.gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > span.mt-0.5.block.truncate` | Ректорлық бақылау комитеті — scroll 191 / client 179 | 375, 768 | RU, KZ | [img](screenshots/before/users__default__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | default | `….gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > p.mt-0.5.truncate.text-slate-500` | Система мониторинга университета — scroll 188 / client 179 | 375, 768 | RU | [img](screenshots/before/users__default__ru__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | inline-edit | `…center.gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > span.mt-0.5.block.truncate` | Ректорлық бақылау комитеті — scroll 191 / client 179 | 375, 768 | RU, KZ | [img](screenshots/before/users__inline-edit__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | inline-edit | `….gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > p.mt-0.5.truncate.text-slate-500` | Система мониторинга университета — scroll 188 / client 179 | 375, 768 | RU | [img](screenshots/before/users__inline-edit__ru__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | mobile-menu | `…center.gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > span.mt-0.5.block.truncate` | Ректорлық бақылау комитеті — scroll 191 / client 179 | 375, 768 | RU, KZ | [img](screenshots/before/users__mobile-menu__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | mobile-menu | `….gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > p.mt-0.5.truncate.text-slate-500` | Система мониторинга университета — scroll 188 / client 179 | 375, 768 | RU | [img](screenshots/before/users__mobile-menu__ru__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | modal-create | `…center.gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > span.mt-0.5.block.truncate` | Ректорлық бақылау комитеті — scroll 191 / client 179 | 375, 768 | RU, KZ | [img](screenshots/before/users__modal-create__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | modal-create | `….gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > p.mt-0.5.truncate.text-slate-500` | Система мониторинга университета — scroll 188 / client 179 | 375, 768 | RU | [img](screenshots/before/users__modal-create__ru__375.jpg) |

### ldap-users

| Пр. | Тип | Состояние | Селектор | Пример текста / размеры | Ширины | Языки | Скриншот |
|---|---|---|---|---|---|---|---|
| P2 | Обрезка многоточием без title/tooltip | default | `…center.gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > span.mt-0.5.block.truncate` | Ректорлық бақылау комитеті — scroll 191 / client 179 | 375, 768 | RU, KZ | [img](screenshots/before/ldap-users__default__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | default | `….gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > p.mt-0.5.truncate.text-slate-500` | Система мониторинга университета — scroll 188 / client 179 | 375, 768 | RU | [img](screenshots/before/ldap-users__default__ru__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | mobile-menu | `…center.gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > span.mt-0.5.block.truncate` | Ректорлық бақылау комитеті — scroll 191 / client 179 | 375, 768 | RU, KZ | [img](screenshots/before/ldap-users__mobile-menu__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | mobile-menu | `….gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > p.mt-0.5.truncate.text-slate-500` | Система мониторинга университета — scroll 188 / client 179 | 375, 768 | RU | [img](screenshots/before/ldap-users__mobile-menu__ru__375.jpg) |
| P3 | Обрезка многоточием (есть title) | default | `…-sm > tbody.divide-y.divide-gray-100 > tr.transition-colors > td.px-4.py-3.text-gray-500` | [DN]| 375, 768, 1280, 1440, 1920 | RU, KZ, EN | [img](screenshots/before/ldap-users__default__kz__375.jpg) |
| P3 | Обрезка многоточием (есть title) | mobile-menu | `…-sm > tbody.divide-y.divide-gray-100 > tr.transition-colors > td.px-4.py-3.text-gray-500` | [DN]| 375, 768 | RU, KZ, EN | [img](screenshots/before/ldap-users__mobile-menu__kz__375.jpg) |

### rooms-settings

| Пр. | Тип | Состояние | Селектор | Пример текста / размеры | Ширины | Языки | Скриншот |
|---|---|---|---|---|---|---|---|
| P2 | Значение/placeholder не помещается в поле | default | `main#main-content > div.space-y-5 > div.card.p-4 > input.input` | Поиск по кабинету, корпусу или оборудованию... — need 316px / avail 283px | 375 | RU, KZ, EN | [img](screenshots/before/rooms-settings__default__kz__375.jpg) |
| P2 | Значение/placeholder не помещается в поле | mobile-menu | `main#main-content > div.space-y-5 > div.card.p-4 > input.input` | Поиск по кабинету, корпусу или оборудованию... — need 316px / avail 283px | 375 | RU, KZ, EN | [img](screenshots/before/rooms-settings__mobile-menu__kz__375.jpg) |
| P2 | Значение/placeholder не помещается в поле | modal-live | `main#main-content > div.space-y-5 > div.card.p-4 > input.input` | Поиск по кабинету, корпусу или оборудованию... — need 316px / avail 283px | 375 | RU, KZ, EN | [img](screenshots/before/rooms-settings__modal-live__kz__375.jpg) |
| P2 | Значение/placeholder не помещается в поле | modal-room-form | `main#main-content > div.space-y-5 > div.card.p-4 > input.input` | Поиск по кабинету, корпусу или оборудованию... — need 316px / avail 283px | 375 | RU, KZ, EN | [img](screenshots/before/rooms-settings__modal-room-form__kz__375.jpg) |
| P2 | Значение/placeholder не помещается в поле | modal-room-form | `div.border-t.border-gray-200.p-5 > div.grid.gap-4 > label > input.input` | [rtsp-адрес камеры] или https://.../hls.m3u — need 304px / avail 269px | 375 | RU, KZ, EN | [img](screenshots/before/rooms-settings__modal-room-form__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | default | `… > div.space-y-4.p-5.text-sm > div.rounded-xl.bg-indigo-50.p-3 > p.mt-1.truncate.text-xs` | [rtsp-адрес камеры] · ключ — scroll 333 / client 285 | 375, 768, 1280, 1440 | RU, KZ, EN | [img](screenshots/before/rooms-settings__default__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | default | `…center.gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > span.mt-0.5.block.truncate` | Ректорлық бақылау комитеті — scroll 191 / client 179 | 375, 768 | RU, KZ | [img](screenshots/before/rooms-settings__default__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | default | `….gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > p.mt-0.5.truncate.text-slate-500` | Система мониторинга университета — scroll 188 / client 179 | 375, 768 | RU | [img](screenshots/before/rooms-settings__default__ru__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | mobile-menu | `… > div.space-y-4.p-5.text-sm > div.rounded-xl.bg-indigo-50.p-3 > p.mt-1.truncate.text-xs` | [rtsp-адрес камеры] · ключ — scroll 333 / client 285 | 375, 768 | RU, KZ, EN | [img](screenshots/before/rooms-settings__mobile-menu__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | mobile-menu | `…center.gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > span.mt-0.5.block.truncate` | Ректорлық бақылау комитеті — scroll 191 / client 179 | 375, 768 | RU, KZ | [img](screenshots/before/rooms-settings__mobile-menu__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | mobile-menu | `….gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > p.mt-0.5.truncate.text-slate-500` | Система мониторинга университета — scroll 188 / client 179 | 375, 768 | RU | [img](screenshots/before/rooms-settings__mobile-menu__ru__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | modal-live | `… > div.space-y-4.p-5.text-sm > div.rounded-xl.bg-indigo-50.p-3 > p.mt-1.truncate.text-xs` | [rtsp-адрес камеры] · ключ — scroll 333 / client 285 | 375, 768, 1280, 1440 | RU, KZ, EN | [img](screenshots/before/rooms-settings__modal-live__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | modal-live | `…center.gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > span.mt-0.5.block.truncate` | Ректорлық бақылау комитеті — scroll 191 / client 179 | 375, 768 | RU, KZ | [img](screenshots/before/rooms-settings__modal-live__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | modal-live | `….gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > p.mt-0.5.truncate.text-slate-500` | Система мониторинга университета — scroll 188 / client 179 | 375, 768 | RU | [img](screenshots/before/rooms-settings__modal-live__ru__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | modal-room-form | `… > div.space-y-4.p-5.text-sm > div.rounded-xl.bg-indigo-50.p-3 > p.mt-1.truncate.text-xs` | [rtsp-адрес камеры] · ключ — scroll 333 / client 285 | 375, 768, 1280, 1440 | RU, KZ, EN | [img](screenshots/before/rooms-settings__modal-room-form__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | modal-room-form | `…center.gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > span.mt-0.5.block.truncate` | Ректорлық бақылау комитеті — scroll 191 / client 179 | 375, 768 | RU, KZ | [img](screenshots/before/rooms-settings__modal-room-form__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | modal-room-form | `….gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > p.mt-0.5.truncate.text-slate-500` | Система мониторинга университета — scroll 188 / client 179 | 375, 768 | RU | [img](screenshots/before/rooms-settings__modal-room-form__ru__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | modal-room-form | `…iv.border-t.border-gray-200.p-5 > label.mb-4.flex.cursor-pointer > input.h-4.w-4.rounded` |  — 15x16 | 375 | RU, KZ, EN | [img](screenshots/before/rooms-settings__modal-room-form__kz__375.jpg) |

### settings

| Пр. | Тип | Состояние | Селектор | Пример текста / размеры | Ширины | Языки | Скриншот |
|---|---|---|---|---|---|---|---|
| P1 | Текст в textarea срезан (фиксированная высота) | default | `div.card.p-5.space-y-4 > div.grid.grid-cols-1.gap-3 > div > textarea.input` | [PEM-сертификат] | 375, 768, 1280, 1440, 1920 | RU, KZ, EN | [img](screenshots/before/settings__default__kz__375.jpg) |
| P2 | Значение/placeholder не помещается в поле | default | `div.rounded-2xl.border-2.p-4 > div.mt-4.space-y-3 > div > input.input` | Ключ сохранён · введите новый для замены — need 286px / avail 239px | 375 | RU, KZ, EN | [img](screenshots/before/settings__default__kz__375.jpg) |
| P2 | Значение/placeholder не помещается в поле | mobile-menu | `div.rounded-2xl.border-2.p-4 > div.mt-4.space-y-3 > div > input.input` | Ключ сохранён · введите новый для замены — need 286px / avail 239px | 375 | RU, KZ, EN | [img](screenshots/before/settings__mobile-menu__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | default | `…center.gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > span.mt-0.5.block.truncate` | Ректорлық бақылау комитеті — scroll 191 / client 179 | 375, 768 | RU, KZ | [img](screenshots/before/settings__default__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | default | `….gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > p.mt-0.5.truncate.text-slate-500` | Система мониторинга университета — scroll 188 / client 179 | 375, 768 | RU | [img](screenshots/before/settings__default__ru__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | mobile-menu | `…center.gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > span.mt-0.5.block.truncate` | Ректорлық бақылау комитеті — scroll 191 / client 179 | 375, 768 | RU, KZ | [img](screenshots/before/settings__mobile-menu__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | mobile-menu | `….gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > p.mt-0.5.truncate.text-slate-500` | Система мониторинга университета — scroll 188 / client 179 | 375, 768 | RU | [img](screenshots/before/settings__mobile-menu__ru__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | default | `…stify-between > label.flex.cursor-pointer.items-center > input.h-4.w-4.accent-indigo-600` |  — 16x16 | 375 | RU, KZ, EN | [img](screenshots/before/settings__default__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | default | `div.mt-4.space-y-3 > div > div.mt-2.flex.flex-wrap > button.rounded-lg.border.px-2.5` | gpt-5.6-luna — 90x26 | 375 | RU, KZ, EN | [img](screenshots/before/settings__default__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | mobile-menu | `…stify-between > label.flex.cursor-pointer.items-center > input.h-4.w-4.accent-indigo-600` |  — 16x16 | 375 | RU, KZ, EN | [img](screenshots/before/settings__mobile-menu__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | mobile-menu | `div.mt-4.space-y-3 > div > div.mt-2.flex.flex-wrap > button.rounded-lg.border.px-2.5` | gpt-5.6-luna — 90x26 | 375 | RU, KZ, EN | [img](screenshots/before/settings__mobile-menu__kz__375.jpg) |

### audit-logs

| Пр. | Тип | Состояние | Селектор | Пример текста / размеры | Ширины | Языки | Скриншот |
|---|---|---|---|---|---|---|---|
| P2 | Обрезка многоточием без title/tooltip | default | `…center.gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > span.mt-0.5.block.truncate` | Ректорлық бақылау комитеті — scroll 191 / client 179 | 375, 768 | RU, KZ | [img](screenshots/before/audit-logs__default__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | default | `….gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > p.mt-0.5.truncate.text-slate-500` | Система мониторинга университета — scroll 188 / client 179 | 375, 768 | RU | [img](screenshots/before/audit-logs__default__ru__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | mobile-menu | `…center.gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > span.mt-0.5.block.truncate` | Ректорлық бақылау комитеті — scroll 191 / client 179 | 375, 768 | RU, KZ | [img](screenshots/before/audit-logs__mobile-menu__kz__375.jpg) |
| P2 | Обрезка многоточием без title/tooltip | mobile-menu | `….gap-2 > div.min-w-0.items-center.gap-3 > div.min-w-0 > p.mt-0.5.truncate.text-slate-500` | Система мониторинга университета — scroll 188 / client 179 | 375, 768 | RU | [img](screenshots/before/audit-logs__mobile-menu__ru__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | default | `…6 > div.flex.items-center.justify-between > div.flex.gap-2 > button.px-3.py-1.rounded-lg` | Назад — 68x30 | 375 | RU, KZ, EN | [img](screenshots/before/audit-logs__default__kz__375.jpg) |
| P3 | Мелкая зона нажатия (<32px) на мобильном | mobile-menu | `…6 > div.flex.items-center.justify-between > div.flex.gap-2 > button.px-3.py-1.rounded-lg` | Назад — 68x30 | 375 | RU, KZ, EN | [img](screenshots/before/audit-logs__mobile-menu__kz__375.jpg) |

## Методика

Детектор (`checks.js`) выполняется в странице после `networkidle` + 600 мс:

- **text-overlap** (найдено: 0 — наложений текста на текст нет) — прямоугольники текстовых узлов (`Range.getClientRects`, а не боксы элементов), обрезанные клипующими предками; пары не вложенных друг в друга элементов из одного слоя (страница/модалка) с пересечением > 1px по обеим осям, и хотя бы один из них реально отрисован сверху (`elementFromPoint`).
- **text-clipped** — глифы текста выходят за предка с `overflow:hidden|clip` более чем на 2px (скролл-контейнеры `auto|scroll` считаются намеренными и не учитываются).
- **ellipsis-*** — `text-overflow: ellipsis` / `line-clamp`, которые реально обрезают текст; отдельно — есть ли `title`.
- **control-text-clipped** — значение/placeholder/выбранная опция шире полезной области поля (измерение через canvas).
- **out-of-viewport-x** — видимая часть элемента вне `[0, innerWidth]` (элементы целиком за экраном, например закрытый off-canvas, исключены).
- **spills-parent** — элемент с текстом выходит за правую границу родителя без `overflow`.
- **modal-*** — первый крупный потомок `position:fixed`-слоя выходит за viewport.
- **body/main-horizontal-scroll** — `scrollWidth > innerWidth` у документа / у `main`.
- **small-tap-target** — кнопки/ссылки/поля меньше 32px на ширинах < 768.

Для полностраничных состояний viewport перед проверкой растягивается на всю высоту страницы, чтобы `elementFromPoint` работал ниже первого экрана.
- **textarea-content-hidden** — текст `textarea` не помещается в видимую высоту поля.
- **covered-by-neighbour** — вылезшая за родителя часть перекрыта другим элементом того же слоя.

Детектор проверен на синтетической странице с заложенными дефектами всех типов.
Скриншоты: `full_page` для страниц и вкладок, viewport — для модалок и меню. Сохранены только снимки, на которые ссылается отчёт.