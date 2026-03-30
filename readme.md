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
├── docker-compose.yml
├── docker-compose.dev.yml
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

## Быстрый запуск в Docker

Production-профиль поднимает три сервиса: `db`, `backend`, `frontend`.

```bash
docker compose up --build -d
```

Остановка:

```bash
docker compose down
```

С удалением тома БД:

```bash
docker compose down -v
```

## Адреса сервисов

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:8000`
- Swagger UI: `http://localhost:8000/docs`

## Режим разработки

Для разработки используется дополнительный compose-файл с bind mount и hot reload.

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

В dev-режиме доступны:

- Frontend: `http://localhost:5174`
- Backend API: `http://localhost:8000`
- MySQL: `localhost:3307`

Остановка dev-режима:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml down
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

Заполнить тестовыми данными:

```bash
docker compose exec backend python seed.py
```

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