# Sapa — система ректорского контроля

Sapa — веб-система ректорского контроля качества учебных занятий КазУТБ им. К. Кулажанова.
Она собирает в одном месте расписание из Platonus, камеры аудиторий, проверки занятий, наблюдения
с подписью ЭЦП, взаимопосещения, работу комитета КРК и посещаемость студентов по QR-коду.

Интерфейс на русском, казахском и английском, со светлой и тёмной темой, работает на телефоне и компьютере.

## Возможности

| Модуль | Что делает |
|---|---|
| Ситуационный мониторинг | Занятия дня из расписания Platonus (идёт / впереди / завершено), прямые трансляции камер, архив и аналитика проверок |
| Записи КРК | Проверка занятия по шаблону вопросов: черновик → отправлено → на доработку / принято, печатная форма, дашборд |
| Наблюдения (форма 16-02) | Чек-лист наблюдения, подпись акта ЭЦП, уведомление и пояснение преподавателя, акт в PDF |
| Взаимопосещение | График посещений на семестр с утверждением, отзывы по единой форме, проверка инспектором |
| Комитет КРК | Состав по приказу, назначенные проверки, «назначено / проверено» по каждому члену, сводка с ЭЦП |
| QR-аудитория | Студент отмечается по QR-коду у двери; сотрудник видит занятия, камеру и оснащение кабинета |
| Проверка документов | Подлинность подписанных документов проверяется по QR-коду на странице `/verify/<token>` |
| Администрирование | Пользователи и роли, вход через AD (LDAP) или ЭЦП, справочники, кабинеты и камеры, журнал аудита |

## Роли

| Роль | Доступ |
|---|---|
| `superadmin` | Всё, включая настройки системы и стоимость оснащения |
| `admin` | Пользователи, кабинеты, камеры, справочники |
| `inspector` | Записи КРК, наблюдения, посещаемость |
| `peer_inspector` | График взаимопосещений и проверка отзывов |
| `staff` | Записи КРК |
| `dean` | Наблюдения и камеры своего факультета |
| `committee` | Проверки, назначенные по приказу (роль выдаётся автоматически по составу комитета) |
| `teacher` | Свои наблюдения и пояснения, взаимопосещения |
| `user` | Взаимопосещения |
| `student` | Расписание и отметка посещаемости по QR |

## Стек

- **Backend:** Python, FastAPI, SQLAlchemy, Pydantic, MySQL 8, ReportLab (PDF), KalkanCrypt (ЭЦП НУЦ РК)
- **Frontend:** React 18, Vite, Tailwind CSS, React Router, i18next, NCALayer для подписи в браузере
- **Инфраструктура:** Docker Compose, Nginx (сборка frontend), Playwright (e2e)
- **Интеграции:** Platonus (расписание, преподаватели, студенты, аудитории — через read-only БД), Active Directory (LDAP)

## Структура репозитория

```text
backend/
  main.py            точка входа FastAPI, миграции при старте
  routers/           HTTP API по разделам
  services/          бизнес-логика, PDF, ЭЦП, синхронизация с Platonus
  models/, schemas/  модели SQLAlchemy и схемы Pydantic
  scripts/           импорт данных и генерация секретов
  seed.py            демо-данные по ролям (только dev)
frontend/
  src/pages/         страницы
  src/components/ui/ дизайн-система (компоненты интерфейса)
  src/locales/       переводы ru / kz / en
  e2e/               Playwright: вёрстка, стресс-тесты, визуальная регрессия
docs/redesign/       описание дизайн-системы
docker-compose.yml       prod
docker-compose.dev.yml   dev
```

## Быстрый старт (dev в Docker)

```bash
cp backend/.env.example backend/.env      # заполнить значения __REQUIRED_…__
bash backend/scripts/generate_secrets.sh  # сгенерировать SECRET_KEY и пароли
docker compose -f docker-compose.dev.yml up --build -d
```

Dev поднимает backend и frontend с hot reload:

- Frontend: `http://<сервер>:5175`
- Backend API: `http://127.0.0.1:8001` (Swagger — `/docs`, если `ENABLE_API_DOCS=true`)
- MySQL: `127.0.0.1:3307`

Остановка: `docker compose -f docker-compose.dev.yml down` (с флагом `-v` удаляется и dev-БД).

Dev и prod могут работать на одном сервере: у dev своё имя проекта Compose (`COMPOSE_PROJECT_NAME`
в локальном `.env`), свои контейнеры, БД и папка `backend/media_dev`. Перенести копию prod-БД в dev:

```bash
docker exec krk_db sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --databases krk_monitoring --single-transaction' \
  | docker exec -i krkdev_db sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD"'
```

### Без Docker

```bash
cd backend && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt && uvicorn main:app --reload

cd frontend && npm install && npm run dev
```

## Конфигурация

Все настройки — переменные окружения в `backend/.env` (шаблон — `backend/.env.example`).
Реальные значения в git не попадают.

| Переменная | Назначение |
|---|---|
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Основная БД MySQL |
| `READONLY_DB_*` | Read-only БД Platonus (расписание, люди, аудитории) |
| `SECRET_KEY` | Подпись токенов и шифрование секретов в БД (пароль LDAP, ключи камер) |
| `ACCESS_TOKEN_EXPIRE_MINUTES`, `AUTH_COOKIE_*` | Сессия; `AUTH_COOKIE_SECURE=false` только для dev по http |
| `LOGIN_*` | Лимит неудачных входов и время блокировки |
| `CORS_ALLOW_*` | Разрешённые источники запросов |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | Первый администратор |
| `PUBLIC_BASE_URL` | Адрес сайта для QR-кодов проверки документов |
| `CAMERA_LIVE_MAX_STREAMS` | Сколько трансляций камер открыто одновременно (по умолчанию 3; меняется и в настройках системы) |
| `KALKAN_LIB`, `KALKAN_NCA`, `KALKAN_TSA_URL` | ЭЦП: путь к библиотеке KalkanCrypt, принимаемые НУЦ (`test`, `prod`), сервер меток времени |
| `ENABLE_API_DOCS` | Swagger на `/docs` |
| `DEV_QUICK_LOGIN` | Быстрый вход под ролями — **только dev** |

Frontend: `VITE_API_PROXY_TARGET` (адрес backend для dev-сервера), `VITE_MONITORING_DEMO` (демо-занятия в мониторинге, только dev).

Настройки LDAP, камер, интеграции с Platonus и AI задаются в интерфейсе: «Настройка системы».

### ЭЦП

Подпись проверяется библиотекой KalkanCrypt из SDK НУЦ РК. SDK распространяется по лицензии и
**в репозиторий не входит**: его кладут рядом с проектом и монтируют в контейнер
(см. `docker-compose.dev.yml`). Корневые сертификаты НУЦ — в `backend/assets/nca/`.
В браузере подпись идёт через NCALayer.

## Демо-данные (dev)

Работают только при `DEV_QUICK_LOGIN=true`. Быстрый вход создаёт их сам при первом входе; вручную:

```bash
docker compose -f docker-compose.dev.yml exec backend python seed.py           # создать, если ещё нет
docker compose -f docker-compose.dev.yml exec backend python seed.py --reset   # пересоздать
docker compose -f docker-compose.dev.yml exec backend python seed.py --clear   # удалить только демо-данные
```

Преподаватель, пользователь, член комитета и студент входят как люди из Platonus без своей учётной записи
в системе; остальные роли — служебные `dev.<роль>`. Каждая созданная строка учитывается в таблице
`dev_seed_items`, поэтому `--clear` не трогает настоящие данные. Демо-подписи помечены
«DEV · демо-подпись (без ЭЦП)».

## Тесты и проверки

```bash
cd frontend
npm run lint                     # ESLint
npm run build                    # production-сборка
e2e/run-in-docker.sh             # все e2e-тесты в образе Playwright (backend не нужен — API из фикстур)
e2e/run-in-docker.sh --update-snapshots   # обновить эталонные скриншоты

curl http://127.0.0.1:8001/health        # состояние API
```

## Деплой на prod

1. Бэкап БД (файл с правами 600, вне репозитория) и теги текущих образов для отката.
2. Обновить код: `git pull --ff-only`.
3. Собрать: `docker-compose build`.
4. Пересоздать сервисы по одному: `docker-compose rm -sf <service> && docker-compose up -d --no-deps <service>`.
   docker-compose 1.29 падает при обычном пересоздании (`KeyError: 'ContainerConfig'`).
5. Проверить `/health`, вход и основные страницы.

Что проверить:

- **Cookie.** `AUTH_COOKIE_SECURE=true` (prod работает по HTTPS).
- **LDAP.** Вход через AD проверяет TLS-сертификат: в настройках системы должен быть CA-сертификат.
  Пароль bind-учётки хранится зашифрованным и в API не возвращается.
- **Смена `SECRET_KEY`** делает нечитаемыми зашифрованные секреты (ключи камер, AI, пароль LDAP) —
  после ротации введите их заново.
- **`DEV_QUICK_LOGIN` и `VITE_MONITORING_DEMO`** на prod не задаются.
- **Backend-контейнер** работает от пользователя `app` (uid 1000); entrypoint выдаёт ему права на `backend/media`.
- **Отдельный пользователь MySQL** вместо `root` (рекомендуется):

  ```sql
  CREATE USER 'krk_app'@'%' IDENTIFIED BY '<сгенерированный пароль>';
  GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES, DROP ON krk_monitoring.* TO 'krk_app'@'%';
  ```

  `CREATE`, `ALTER`, `INDEX`, `DROP` нужны миграциям при старте и импорту справочников.

## Безопасность

- Пароли, токены, строки подключения, `.env` и бэкапы БД в git не хранятся.
- Документы университета (приказы, графики, сверки) и данные из них с ФИО — только локально (`.gitignore`).
- ИИН через API не отдаётся, в журнал аудита попадает только маска.
- Все действия пользователей пишутся в журнал аудита.
- Доступ к данным ограничен ролью и факультетом.

### Ротация секретов

1. Сгенерировать новые значения: `backend/scripts/generate_secrets.sh`.
2. Обновить `backend/.env` и перезапустить сервисы.
3. Проверить `/health` и вход.
4. Считать старые токены и пароли недействительными.

Немедленно — после инцидента или подозрения на утечку; планово — не реже раза в 90 дней для учётных записей администраторов и сервисов.
