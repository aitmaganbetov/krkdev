#!/bin/sh
# Запуск e2e-тестов в официальном образе Playwright (Chromium со всеми системными зависимостями).
# Бэкенд не нужен: API подменяется фикстурами. Аргументы передаются в `playwright test`, например:
#   e2e/run-in-docker.sh                       — все тесты
#   e2e/run-in-docker.sh visual.spec.js        — только визуальная регрессия
#   e2e/run-in-docker.sh --update-snapshots    — обновить эталонные скриншоты
set -e
cd "$(dirname "$0")/.."
exec docker run --rm --network host --ipc=host \
  --user "$(id -u):$(id -g)" -e HOME=/tmp -e CI=1 \
  -v "$PWD":/work -w /work \
  mcr.microsoft.com/playwright:v1.47.0-jammy \
  npx playwright test "$@"
