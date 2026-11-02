"""
Демо-данные по ролям для dev-окружения (services/dev_seed.py).

  python seed.py          — создать, если ещё не созданы (быстрый вход тоже создаёт их при первом входе)
  python seed.py --reset  — удалить созданное сидом и создать заново
  python seed.py --clear  — только удалить созданное сидом (настоящие данные не затрагиваются)

Работает только при DEV_QUICK_LOGIN=true и не-Secure cookie (как быстрый вход), на проде — отказ.
"""
import json
import sys

from database import SessionLocal
from routers.dev_login import is_enabled
from services import dev_seed


def main(args: list[str]) -> int:
    if not is_enabled():
        print("Сиды только для dev: нужны DEV_QUICK_LOGIN=true и AUTH_COOKIE_SECURE=false", file=sys.stderr)
        return 1
    db = SessionLocal()
    try:
        if "--clear" in args or "--reset" in args:
            print("Удалено:", json.dumps(dev_seed.clear(db), ensure_ascii=False))
        if "--clear" not in args:
            print(json.dumps(dev_seed.seed_all(db), ensure_ascii=False, indent=2))
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
