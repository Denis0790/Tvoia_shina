"""Напоминание клиенту о записи за сутки (push)."""

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import push
from app.models import Booking

MSK = timezone(timedelta(hours=3))


async def send_due_reminders(db: AsyncSession, now: datetime | None = None) -> int:
    """Шлёт напоминание по подтверждённым записям, до начала которых осталось от 23 до 24,5 часов.
    now — московское время без часового пояса (для тестов). Возвращает число отправленных."""
    if not push.enabled():
        return 0
    now = now or datetime.now(MSK).replace(tzinfo=None)
    horizon = now + timedelta(hours=24, minutes=30)
    rows = (
        await db.execute(
            select(Booking).where(
                Booking.status == "confirmed",
                Booking.part == 0,
                Booking.reminder_sent_at.is_(None),
                Booking.date >= now.replace(hour=0, minute=0, second=0, microsecond=0),
                Booking.date <= horizon,
            )
        )
    ).scalars().all()

    sent = 0
    for b in rows:
        hours, minutes = b.start_time.split(":")
        start = b.date.replace(hour=int(hours), minute=int(minutes), second=0, microsecond=0)
        if not (now + timedelta(hours=23) < start <= horizon):
            continue
        day_word = "завтра" if start.date() > now.date() else "сегодня"
        push.notify_users(
            [b.user_id],
            "Напоминание о записи",
            f"Ждём вас {day_word} в {b.start_time}. Ул. Промышленная, 2к",
            "/",
            f"reminder-{b.id}",
        )
        b.reminder_sent_at = datetime.now(timezone.utc)
        sent += 1
    if sent:
        await db.commit()
    return sent
