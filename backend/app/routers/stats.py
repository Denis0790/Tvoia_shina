"""Статистика для менеджера: по постам и услугам за период.

Учитываются подтверждённые записи; ожидающие и отменённые показываются отдельно.
Длинная запись, разбитая по дням, — одна запись (part=0), а часы суммируются по всем её дням."""

import uuid
from datetime import date as date_type, datetime, time as time_type, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import require_manager
from app.models import Booking, Post, ScheduleException, Service, User, booking_services
from app.routers.bookings import MSK, _today_msk

router = APIRouter(prefix="/stats", tags=["stats"])

MAX_DAYS = 366 * 5


def _minutes(t: str) -> int:
    h, m = t.split(":")
    return int(h) * 60 + int(m)


def _kind(status: str) -> str:
    return status if status in ("confirmed", "pending") else "cancelled"


def _hours(minutes: int) -> float:
    return round(minutes / 60, 1)


async def _resolve_range(db: AsyncSession, period: str, date_from: date_type | None, date_to: date_type | None):
    today = _today_msk()
    if period == "month":  # текущий календарный месяц
        return today.replace(day=1), today
    if period == "3months":  # текущий и два предыдущих календарных месяца
        first = today.replace(day=1)
        for _ in range(2):
            first = (first - timedelta(days=1)).replace(day=1)
        return first, today
    if period == "custom":
        if date_from is None or date_to is None or date_from > date_to:
            raise HTTPException(status_code=400, detail="Укажите период: дата «с» не позже даты «по»")
        if (date_to - date_from).days > MAX_DAYS:
            raise HTTPException(status_code=400, detail="Период слишком длинный")
        return date_from, date_to
    first = (await db.execute(select(func.min(Booking.date)))).scalar_one_or_none()
    start = first.date() if first else today
    return min(start, today), today


def _capacity(posts, exceptions, d1: date_type, d2: date_type) -> dict:
    """Рабочие минуты каждого поста за период: расписание минус выходные/отпуска/ремонты из исключений."""
    exc = {(e.post_id, e.date.date()): e for e in exceptions}
    caps: dict = {}
    for p in posts:
        start = d1
        if p.created_at is not None:
            start = max(d1, p.created_at.astimezone(MSK).date())
        total = 0
        d = start
        while d <= d2:
            e = exc.get((p.id, d))
            if e is not None:
                if e.is_working:
                    total += max(0, _minutes(e.work_end or p.work_end) - _minutes(e.work_start or p.work_start))
            elif p.work_days[d.weekday()] == "1":
                total += max(0, _minutes(p.work_end) - _minutes(p.work_start))
            d += timedelta(days=1)
        caps[p.id] = total
    return caps


def _load(busy: int, cap: int) -> float | None:
    return min(100.0, round(busy / cap * 100, 1)) if cap > 0 else None


def _key(d: date_type, gran: str) -> date_type:
    if gran == "day":
        return d
    if gran == "week":
        return d - timedelta(days=d.weekday())
    return d.replace(day=1)


def _next(k: date_type, gran: str) -> date_type:
    if gran == "day":
        return k + timedelta(days=1)
    if gran == "week":
        return k + timedelta(days=7)
    return (k.replace(day=28) + timedelta(days=4)).replace(day=1)


@router.get("")
async def stats(
    period: str = Query("month", pattern="^(all|month|3months|custom)$"),
    date_from: date_type | None = None,
    date_to: date_type | None = None,
    post_id: uuid.UUID | None = None,
    manager: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    d1, d2 = await _resolve_range(db, period, date_from, date_to)
    lo, hi = datetime.combine(d1, time_type.min), datetime.combine(d2, time_type.max)
    win = (Booking.date >= lo, Booking.date <= hi)

    posts = (await db.execute(select(Post).order_by(Post.created_at, Post.name))).scalars().all()
    if post_id is not None and all(p.id != post_id for p in posts):
        raise HTTPException(status_code=404, detail="Пост не найден")
    exceptions = (
        await db.execute(select(ScheduleException).where(ScheduleException.date >= lo, ScheduleException.date <= hi))
    ).scalars().all()
    caps = _capacity(posts, exceptions, d1, d2)

    rows = (
        await db.execute(select(Booking.post_id, Booking.date, Booking.duration_minutes, Booking.status, Booking.part).where(*win))
    ).all()

    def scope(pid):
        return [r for r in rows if pid is None or r.post_id == pid]

    def summarize(rs):
        c = p = x = mins = 0
        for r in rs:
            k = _kind(r.status)
            if r.part == 0:
                if k == "confirmed":
                    c += 1
                elif k == "pending":
                    p += 1
                else:
                    x += 1
            if k == "confirmed":
                mins += r.duration_minutes
        return c, p, x, mins

    def busy_minutes(rs):
        return sum(r.duration_minutes for r in rs if r.status == "confirmed" and r.post_id is not None)

    # услуги: подтверждённые записи (по первой части), сгруппировано по посту
    svc_rows = (
        await db.execute(
            select(Booking.post_id, Service.id, Service.name, Service.category, Service.duration_minutes, func.count())
            .select_from(Booking)
            .join(booking_services, booking_services.c.booking_id == Booking.id)
            .join(Service, Service.id == booking_services.c.service_id)
            .where(*win, Booking.status == "confirmed", Booking.part == 0)
            .group_by(Booking.post_id, Service.id, Service.name, Service.category, Service.duration_minutes)
        )
    ).all()
    other_rows = (
        await db.execute(
            select(Booking.post_id, Booking.services_text).where(
                *win, Booking.status == "confirmed", Booking.part == 0, Booking.services_text.isnot(None)
            )
        )
    ).all()
    no_services = (
        await db.execute(
            select(Booking.post_id, func.count())
            .where(*win, Booking.status == "confirmed", Booking.part == 0, Booking.services_text.is_(None), ~Booking.services.any())
            .group_by(Booking.post_id)
        )
    ).all()

    lo_tz = datetime.combine(d1, time_type.min, tzinfo=MSK)
    hi_tz = datetime.combine(d2 + timedelta(days=1), time_type.min, tzinfo=MSK)
    new_clients = (
        await db.execute(
            select(func.count()).select_from(User).where(User.role != "manager", User.created_at >= lo_tz, User.created_at < hi_tz)
        )
    ).scalar_one()

    # --- сводка (с учётом выбранного поста) ---
    sc = scope(post_id)
    c, p, x, mins = summarize(sc)
    total = c + p + x
    cap = caps.get(post_id, 0) if post_id else sum(caps.values())
    overview = {
        "confirmed": c,
        "pending": p,
        "cancelled": x,
        "cancel_rate": round(x / total * 100, 1) if total else None,
        "hours": _hours(mins),
        "load": _load(busy_minutes(sc), cap),
        "new_clients": new_clients,
    }

    # --- посты: всегда все, для сравнения ---
    posts_out = []
    for post in posts:
        pc, _pp, px, pmins = summarize(scope(post.id))
        top = sorted((r for r in svc_rows if r[0] == post.id), key=lambda r: (-r[5], r[2]))[:3]
        posts_out.append(
            {
                "id": str(post.id),
                "name": post.name,
                "bookings": pc,
                "hours": _hours(pmins),
                "load": _load(busy_minutes(scope(post.id)), caps.get(post.id, 0)),
                "cancelled": px,
                "top_services": [{"name": r[2], "count": r[5]} for r in top],
            }
        )

    # --- услуги (с учётом выбранного поста) ---
    agg: dict = {}
    for pid_, sid, name, category, norm, cnt in svc_rows:
        if post_id is not None and pid_ != post_id:
            continue
        e = agg.setdefault(sid, {"id": str(sid), "name": name, "category": category, "count": 0, "minutes": 0})
        e["count"] += cnt
        e["minutes"] += cnt * norm
    total_cnt = sum(e["count"] for e in agg.values())
    services_out = [
        {
            "id": e["id"],
            "name": e["name"],
            "category": e["category"],
            "count": e["count"],
            "hours": _hours(e["minutes"]),
            "share": round(e["count"] / total_cnt * 100, 1) if total_cnt else 0,
        }
        for e in sorted(agg.values(), key=lambda e: (-e["count"], e["name"]))
    ]

    # --- «Другое»: текст вне справочника ---
    texts: dict = {}
    other_count = 0
    for pid_, text in other_rows:
        if post_id is not None and pid_ != post_id:
            continue
        other_count += 1
        for piece in (t.strip() for t in text.split(",")):
            if piece:
                e = texts.setdefault(piece.lower(), [piece, 0])
                e[1] += 1
    items = [{"text": t, "count": n} for t, n in sorted(texts.values(), key=lambda v: (-v[1], v[0]))[:50]]
    empty = sum(n for pid_, n in no_services if post_id is None or pid_ == post_id)

    # --- график ---
    span = (d2 - d1).days + 1
    gran = "day" if span <= 62 else "week" if span <= 400 else "month"
    buckets: dict = {}
    k = _key(d1, gran)
    while k <= d2:
        buckets[k] = [0, 0]
        k = _next(k, gran)
    for r in sc:
        if r.status != "confirmed":
            continue
        b = buckets.get(_key(r.date.date(), gran))
        if b is None:
            continue
        b[1] += r.duration_minutes
        if r.part == 0:
            b[0] += 1
    points = [{"label": k.isoformat(), "count": v[0], "hours": _hours(v[1])} for k, v in buckets.items()]

    return {
        "range": {"from": d1.isoformat(), "to": d2.isoformat(), "period": period},
        "overview": overview,
        "posts": posts_out,
        "services": services_out,
        "other": {"count": other_count, "no_services": empty, "items": items},
        "series": {"granularity": gran, "points": points},
    }
