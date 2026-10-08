#!/bin/sh
# Стартует от root только чтобы выдать права на том media (файлы, созданные прежними
# root-контейнерами), затем запускает приложение от пользователя app.
set -e
if [ "$(id -u)" = "0" ]; then
    mkdir -p /app/media/acts /app/media/violations
    # Только чужие файлы: полный chown -R на большом томе замедлял бы каждый старт
    find /app/media \( ! -user app -o ! -group app \) -exec chown app:app {} +
    exec setpriv --reuid=app --regid=app --init-groups -- "$@"
fi
exec "$@"
