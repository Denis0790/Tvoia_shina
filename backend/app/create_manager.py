"""Создать менеджера или сменить ему пароль.

Запуск (в терминале, пароль не показывается и не попадает в историю команд):
    docker compose exec backend python -m app.create_manager
"""

import asyncio
import getpass
import sys

from app.database import get_db
from app.manager_tools import upsert_manager


async def main() -> int:
    login = input("Логин менеджера: ").strip()
    password = getpass.getpass("Пароль (не короче 10 символов): ")
    if password != getpass.getpass("Повторите пароль: "):
        print("Пароли не совпадают")
        return 1
    async for db in get_db():
        try:
            await upsert_manager(db, login, password)
            await db.commit()
        except ValueError as e:
            print(f"Ошибка: {e}")
            return 1
        break
    print(f"Готово: менеджер «{login}» создан или пароль обновлён")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
