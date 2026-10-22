"""Пользователи. /me — для любого залогиненного (включая необязательное
обновление своего имени), /clients — только для менеджеров: список клиентов
с количеством записей и основной машиной (без N+1) и приватные заметки о клиенте."""

import re
import secrets
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func, update, or_
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user, require_manager
from app.models import User, Booking, Car, RefreshToken
from app.security import hash_password

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me")
async def read_me(user: User = Depends(get_current_user)):
    return {
        "id": str(user.id),
        "phone": user.phone,
        "full_name": user.full_name,
        "role": user.role,
    }


class NameIn(BaseModel):
    full_name: str


@router.put("/me/name")
async def update_my_name(
    payload: NameIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """Необязательное имя — клиент может заполнить его в любой момент в профиле,
    чтобы менеджерам было проще его узнавать (не запрашивается при регистрации)."""
    user.full_name = payload.full_name.strip() or None
    await db.commit()
    return {"ok": True, "full_name": user.full_name}


@router.get("/clients")
async def list_clients(manager: User = Depends(require_manager), db: AsyncSession = Depends(get_db)):
    """Список клиентов для менеджера — с количеством записей каждого
    (LEFT JOIN + GROUP BY) и основной машиной (make/model/vin), вторым
    отдельным запросом по всем id клиентов разом — чтобы не делать N+1."""
    result = await db.execute(
        select(User, func.count(Booking.id).label("bookings_count"))
        .outerjoin(Booking, (Booking.user_id == User.id) & (Booking.part == 0))
        # гости без телефона (запись «с улицы» без номера) в клиентах не показываем
        .where(User.role == "client", or_(User.phone.is_not(None), User.kind == "org"))
        .group_by(User.id)
        .order_by(User.created_at.desc())
    )
    rows = result.all()
    user_ids = [user.id for user, _ in rows]

    cars_result = await db.execute(
        select(Car).where(Car.user_id.in_(user_ids)).order_by(Car.created_at)
    )
    primary_car_by_user: dict = {}
    for car in cars_result.scalars().all():
        primary_car_by_user.setdefault(car.user_id, car)

    def car_summary(user_id):
        car = primary_car_by_user.get(user_id)
        if car is None:
            return None
        return {"make": car.make, "model": car.model, "vin": car.vin}

    return [
        {
            "id": str(user.id),
            "phone": user.phone,
            "full_name": user.full_name,
            "manager_note": user.manager_note,
            "kind": user.kind,
            "inn": user.inn,
            "login": user.login,
            "created_at": user.created_at.isoformat(),
            "bookings_count": count,
            "car": car_summary(user.id),
        }
        for user, count in rows
    ]


class NoteIn(BaseModel):
    note: str


@router.put("/clients/{user_id}/note")
async def update_client_note(
    user_id: str, payload: NoteIn, manager: User = Depends(require_manager), db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(User).where(User.id == user_id, User.role == "client"))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="Клиент не найден")

    user.manager_note = payload.note
    await db.commit()
    return {"ok": True}


# Без похожих символов (0/o, 1/l/i), чтобы пароль легко диктовать и вводить
_PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"


def _generate_password(length: int = 8) -> str:
    return "".join(secrets.choice(_PASSWORD_ALPHABET) for _ in range(length))


_TRANSLIT = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "zh", "з": "z", "и": "i",
    "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t",
    "у": "u", "ф": "f", "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sch", "ъ": "", "ы": "y",
    "ь": "", "э": "e", "ю": "yu", "я": "ya",
}
_LEGAL_FORMS = {"ооо", "ип", "ао", "зао", "пао", "оао", "нко", "гуп", "муп"}


def _login_base(name: str) -> str:
    """Логин из названия: латиница, без «ООО/ИП/АО…», слова через подчёркивание."""
    tokens = re.findall(r"[a-zа-яё0-9]+", name.lower())
    tokens = [t for t in tokens if t not in _LEGAL_FORMS] or tokens
    words = ["".join(_TRANSLIT.get(ch, ch) for ch in t) for t in tokens]
    base = "_".join(w for w in words if w)[:30].strip("_")
    return base or "org"


async def _unique_login(db: AsyncSession, name: str) -> str:
    base = _login_base(name)
    result = await db.execute(select(func.lower(User.login)).where(User.login.like(f"{base}%")))
    taken = set(result.scalars().all())
    if base not in taken:
        return base
    n = 2
    while f"{base}{n}" in taken:
        n += 1
    return f"{base}{n}"


class OrgIn(BaseModel):
    name: str
    inn: str
    note: str | None = None


@router.post("/clients/org")
async def create_org(
    payload: OrgIn, manager: User = Depends(require_manager), db: AsyncSession = Depends(get_db)
):
    """Менеджер заводит организацию: логин строится из названия, пароль генерируется и возвращается
    один раз в ответе (в базе хранится только хеш)."""
    name = payload.name.strip()
    inn = payload.inn.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Укажите название организации")
    if not inn.isdigit() or len(inn) not in (10, 12):
        raise HTTPException(status_code=400, detail="ИНН — 10 или 12 цифр")

    exists = await db.execute(select(User.id).where(User.inn == inn))
    if exists.first() is not None:
        raise HTTPException(status_code=409, detail="Организация с таким ИНН уже есть")

    login = await _unique_login(db, name)
    password = _generate_password()
    user = User(
        kind="org",
        full_name=name,
        inn=inn,
        login=login,
        password_hash=hash_password(password),
        manager_note=(payload.note or "").strip() or None,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return {"id": str(user.id), "login": login, "password": password}


@router.post("/clients/{user_id}/reset-password")
async def reset_org_password(
    user_id: str, manager: User = Depends(require_manager), db: AsyncSession = Depends(get_db)
):
    """Новый пароль организации: старый перестаёт работать, активные сессии завершаются."""
    result = await db.execute(select(User).where(User.id == user_id, User.kind == "org"))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="Организация не найдена")

    password = _generate_password()
    user.password_hash = hash_password(password)
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=func.now())
    )
    await db.commit()
    return {"login": user.login, "password": password}


@router.get("/clients/{user_id}/bookings")
async def client_bookings(
    user_id: uuid.UUID, manager: User = Depends(require_manager), db: AsyncSession = Depends(get_db)
):
    """Все записи клиента (новые сверху) с машиной, постом и услугами —
    из них карточка клиента собирает историю обслуживания по каждой машине."""
    owner = await db.get(User, user_id)
    if owner is None or owner.role != "client":
        raise HTTPException(status_code=404, detail="Клиент не найден")

    result = await db.execute(
        select(Booking)
        .where(Booking.user_id == user_id, Booking.part == 0)
        .options(selectinload(Booking.car), selectinload(Booking.post), selectinload(Booking.services))
        .order_by(Booking.date.desc(), Booking.start_time.desc())
    )
    return [
        {
            "id": str(b.id),
            "date": b.date.date().isoformat(),
            "start_time": b.start_time,
            "duration_minutes": b.duration_minutes,
            "status": b.status,
            "comment": b.comment,
            "services_text": b.services_text,
            "post_name": b.post.name if b.post else None,
            "car": (
                {"id": str(b.car.id), "make": b.car.make, "model": b.car.model, "plate": b.car.plate, "vin": b.car.vin}
                if b.car
                else None
            ),
            "services": [{"id": str(s.id), "name": s.name} for s in b.services],
        }
        for b in result.scalars().all()
    ]
