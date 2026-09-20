from datetime import datetime, date as date_type
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Post, Booking, ScheduleException

router = APIRouter(prefix="/availability", tags=["availability"])

SLOT_STEP_MINUTES = 30


def time_to_minutes(t: str) -> int:
    h, m = t.split(":")
    return int(h) * 60 + int(m)


def minutes_to_time(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


@router.get("/slots")
async def get_slots(target_date: date_type = Query(...), db: AsyncSession = Depends(get_db)):
    # 1. Все посты — один запрос
    posts_result = await db.execute(select(Post))
    posts = posts_result.scalars().all()

    # 2. Исключения на эту дату для всех постов сразу — один запрос, не по одному на пост
    exceptions_result = await db.execute(
        select(ScheduleException).where(ScheduleException.date == target_date)
    )
    exceptions_by_post = {e.post_id: e for e in exceptions_result.scalars().all()}

    # 3. Все брони на эту дату сразу для всех постов — тоже один запрос
    bookings_result = await db.execute(
        select(Booking).where(
            Booking.date == target_date,
            Booking.status.in_(["pending", "confirmed"]),
        )
    )
    bookings_by_post: dict = {}
    for b in bookings_result.scalars().all():
        bookings_by_post.setdefault(b.post_id, []).append(b)

    weekday_index = target_date.weekday()  # 0 = Пн

    posts_availability = []
    for post in posts:
        exception = exceptions_by_post.get(post.id)

        if exception is not None:
            if not exception.is_working:
                posts_availability.append({"post_id": str(post.id), "name": post.name, "working": False, "slots": []})
                continue
            work_start, work_end = exception.work_start, exception.work_end
        else:
            if post.work_days[weekday_index] != "1":
                posts_availability.append({"post_id": str(post.id), "name": post.name, "working": False, "slots": []})
                continue
            work_start, work_end = post.work_start, post.work_end

        start_min = time_to_minutes(work_start)
        end_min = time_to_minutes(work_end)

        occupied = set()
        for b in bookings_by_post.get(post.id, []):
            b_start = time_to_minutes(b.start_time)
            for m in range(b_start, b_start + b.duration_minutes, SLOT_STEP_MINUTES):
                occupied.add(m)

        slots = []
        m = start_min
        while m < end_min:
            slots.append({"time": minutes_to_time(m), "free": m not in occupied})
            m += SLOT_STEP_MINUTES

        posts_availability.append(
            {"post_id": str(post.id), "name": post.name, "working": True, "slots": slots}
        )

    return {"date": str(target_date), "posts": posts_availability}
