## KRK Monitoring System

Система мониторинга и оценки учебных занятий.

Проект состоит из двух частей:

- `backend` — FastAPI + SQLAlchemy + MySQL
- `frontend` — React + Vite + Tailwind CSS

## Возможности

- аутентификация с ролями `admin`, `inspector`, `staff`
- создание, редактирование и просмотр записей проверки занятия
- workflow записей: `draft`, `submitted`, `rework`, `accepted`
- дашборд со сводными метриками
- справочники для факультетов, ОП, групп и учебных годов
- печатная версия отчета по записи

## Структура проекта

```text
.
├── backend/
├── frontend/
├── docker-compose.yml       # prod
├── docker-compose.dev.yml   # dev
└── readme.md
```

## Основной стек

### Frontend

- React 18
- Vite
- Tailwind CSS
- React Router
- Axios

### Backend

- FastAPI
- SQLAlchemy ORM
- Pydantic
- PyMySQL

### Infrastructure

- MySQL 8
- Docker / Docker Compose
- Nginx для production-сборки frontend

## Prod и dev на сервере

- **Prod** (https://krk.kaztbu.edu.kz) запускается из `/home/admkrk/system krk`, проект `systemkrk`:
  контейнеры `krk_db`, `krk_backend`, `krk_frontend`, том БД `systemkrk_mysql_data`.
  Команда `docker compose down -v` там удалит боевую базу.
- **Dev** — `/home/admkrk/krk dev`, проект `krkdev`. Локальный `.env` (не в git) задаёт
  `COMPOSE_PROJECT_NAME=krkdev` и `COMPOSE_FILE=docker-compose.dev.yml`, поэтому `docker-compose` там работает с dev-файлом:
  контейнеры `krkdev_db`, `krkdev_backend`, `krkdev_frontend`, своя БД (копия прода из бэкапа)
  и своя папка `backend/media_dev`. Прод-контейнеры dev не затрагивает.

## Режим разработки

Bind mount и hot reload для backend и frontend:

```bash
docker-compose up --build -d
docker-compose down          # остановка
docker-compose down -v       # остановка с удалением dev-БД
```

В dev-режиме доступны:

- Frontend: `http://<сервер>:5175`
- Backend API: `http://127.0.0.1:8001`
- MySQL: `127.0.0.1:3307`

Обновить dev-БД из свежего дампа прода:

```bash
docker exec krk_db sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --databases krk_monitoring --single-transaction' \
  | docker exec -i krkdev_db sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD"'
```

## Локальный запуск без Docker

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## Конфигурация

Секреты и доступы не должны храниться в `README` или в git-репозитории.

Для локальной настройки используйте переменные окружения и локальные `.env` файлы.

Быстрый старт для нового окружения:

```bash
cp backend/.env.example backend/.env
```

Генерация безопасных секретов:

```bash
cd backend
bash scripts/generate_secrets.sh
```

Пример backend-конфигурации:

```env
DATABASE_URL=mysql+pymysql://<db_user>:<db_password>@<db_host>:3306/<db_name>
SECRET_KEY=<random_secret>
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=480
ADMIN_USERNAME=<admin_login>
ADMIN_PASSWORD=<admin_password>
```

Если для разработки нужен SSH-туннель к удаленной БД, храните параметры подключения в локальном SSH-конфиге и используйте ключи, а не пароли в текстовых файлах.

Пример команды без раскрытия секретов:

```bash
ssh -N -L 6080:localhost:3306 <ssh-host-alias>
```

После поднятия туннеля backend можно настроить на локальный адрес:

```env
DATABASE_URL=mysql+pymysql://<db_user>:<db_password>@host.docker.internal:6080/<db_name>
```

## Полезные команды

Демо-данные по всем ролям (только dev, `DEV_QUICK_LOGIN=true`; быстрый вход создаёт их сам при первом входе):

```bash
docker compose -f docker-compose.dev.yml exec backend python seed.py           # создать, если ещё нет
docker compose -f docker-compose.dev.yml exec backend python seed.py --reset   # пересоздать
docker compose -f docker-compose.dev.yml exec backend python seed.py --clear   # удалить только демо-данные
```

Преподаватель, пользователь, член комитета КРК и студент входят как настоящие люди из Platonus (без своей учётной записи КРК), остальные роли — служебные `dev.<роль>`. Демо-подписи помечены «DEV · демо-подпись (без ЭЦП)». Подробности — `backend/services/dev_seed.py`.

Проверить состояние API:

```bash
curl http://localhost:8000/health
```

Собрать frontend:

```bash
cd frontend && npm run build
```

## API

Основные endpoints:

- `POST /auth/login`
- `GET /records`
- `POST /records`
- `GET /records/{id}`
- `PUT /records/{id}`
- `DELETE /records/{id}`
- `POST /records/{id}/submit`
- `POST /records/{id}/send-to-rework`
- `POST /records/{id}/accept`
- `GET /catalogs/basic-info`

Подробная схема API доступна в Swagger:

- `http://localhost:8000/docs`

## Модель данных записи

Ключевые поля записи:

- преподаватель, дисциплина, факультет, ОП, группа
- аудитория, тип занятия, формат, тема
- дата и учебный год
- план / факт студентов и посещаемость
- рейтинги `1.1` ... `3.4`
- комментарий
- вычисляемый средний балл
- статус workflow

## Замечания по безопасности

- не храните пароли, токены и строки подключения в `README`
- не коммитьте рабочие `.env` файлы с реальными доступами
- для SSH используйте ключи и локальный `~/.ssh/config`
- для production замените дефолтные секреты и пароли из контейнерной конфигурации на реальные значения через переменные окружения или секреты оркестратора
- бэкапы БД (`backup/*.sql`) содержат пароли и персональные данные: храните их вне репозитория, зашифрованными, с правами 600

### Что проверить при деплое на prod

- **Cookie.** `AUTH_COOKIE_SECURE` по умолчанию `true` (prod работает по HTTPS). `false` нужен только dev по http.
- **LDAP.** Вход через AD проверяет TLS-сертификат сервера. В «Настройках системы» должен быть
  CA-сертификат (поле «Сертификат»), иначе вход через AD не пройдёт и сработает только локальный кэш паролей.
  Пароль bind-учётки хранится зашифрованным (ключ — `SECRET_KEY`) и в API не возвращается;
  старые записи с открытым паролем шифруются при первом сохранении настроек.
- **Смена `SECRET_KEY`** делает нечитаемыми зашифрованные секреты: ключи камер, ключи AI и пароль LDAP.
  После ротации введите их заново в настройках.
- **Мониторинг.** Демо-занятия показываются только при `VITE_MONITORING_DEMO=true` (включено в dev-compose);
  в prod-сборке их нет.
- **Backend-контейнер** работает от пользователя `app` (uid 1000). Entrypoint при старте выдаёт ему права на
  `backend/media`, поэтому файлы, созданные прежним root-контейнером, остаются доступными.
- **Лимит входа:** 5 неверных паролей с одного IP для логина или 50 с одного IP за 5 минут блокируют этот источник
  на 15 минут (`LOGIN_*` в `.env`). Учётная запись при этом не блокируется.
- **docker-compose 1.29** на этом сервере падает при пересоздании контейнера (`KeyError: 'ContainerConfig'`)
  и оставляет контейнер переименованным и остановленным. Пересоздавайте так:
  `docker-compose rm -sf <service> && docker-compose up -d --no-deps <service>`.
- **Отдельный пользователь MySQL.** Приложение сейчас подключается под `root`. Рекомендуется создать пользователя
  только с правами на свою базу и указать его в `DB_USER`/`DB_PASSWORD`:

  ```sql
  CREATE USER 'krk_app'@'%' IDENTIFIED BY '<сгенерированный пароль>';
  GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES, DROP ON krk_monitoring.* TO 'krk_app'@'%';
  ```

  (`CREATE`/`ALTER`/`INDEX`/`DROP` нужны миграциям при старте и импорту справочников.)

## Ротация секретов (PR-03)

Минимальный безопасный цикл ротации:

1. Сгенерируйте новые значения через `backend/scripts/generate_secrets.sh`.
2. Обновите `backend/.env` (и секреты в CI/CD, если используются).
3. Перезапустите сервисы: `docker compose up -d --build`.
4. Проверьте API: `curl http://localhost:8000/health`.
5. Выполните smoke login и проверьте основные endpoints.
6. Считайте старые токены и старые пароли недействительными.

Рекомендуемая частота:

- немедленно после инцидента или подозрения на утечку;
- планово не реже 1 раза в 90 дней для admin и service credentials.