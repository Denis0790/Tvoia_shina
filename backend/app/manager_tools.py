"""Создание менеджера и смена его пароля (используется командой app.create_manager)."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User
from app.security import hash_password

MIN_PASSWORD = 10


async def upsert_manager(db: AsyncSession, login: str, password: str, full_name: str = "Менеджер") -> User:
    login = login.strip()
    if len(login) < 3:
        raise ValueError("Логин — не короче 3 символов")
    if len(password) < MIN_PASSWORD:
        raise ValueError(f"Пароль менеджера — не короче {MIN_PASSWORD} символов")

    user = (await db.execute(select(User).where(User.login == login))).scalar_one_or_none()
    if user is None:
        user = User(login=login, role="manager", kind="person", full_name=full_name, password_hash=hash_password(password))
        db.add(user)
    else:
        if user.role != "manager":
            raise ValueError("Этот логин занят не менеджером")
        user.password_hash = hash_password(password)
    await db.flush()
    return user
