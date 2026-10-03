"""Пользователи. /me — для любого залогиненного, /clients — только для менеджеров:
список клиентов с количеством записей (без N+1) и приватные заметки о клиенте."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user, require_manager
from app.models import User, Booking

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me")
async def read_me(user: User = Depends(get_current_user)):
    return {
        "id": str(user.id),
        "phone": user.phone,
        "full_name": user.full_name,
        "role": user.role,
    }


@router.get("/clients")
async def list_clients(manager: User = Depends(require_manager), db: AsyncSession = Depends(get_db)):
    """Список клиентов для менеджера — с количеством записей каждого,
    одним запросом через LEFT JOIN + GROUP BY, а не N+1 по каждому клиенту."""
    result = await db.execute(
        select(User, func.count(Booking.id).label("bookings_count"))
        .outerjoin(Booking, Booking.user_id == User.id)
        .where(User.role == "client")
        .group_by(User.id)
        .order_by(User.created_at.desc())
    )
    rows = result.all()
    return [
        {
            "id": str(user.id),
            "phone": user.phone,
            "full_name": user.full_name,
            "manager_note": user.manager_note,
            "created_at": user.created_at.isoformat(),
            "bookings_count": count,
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
