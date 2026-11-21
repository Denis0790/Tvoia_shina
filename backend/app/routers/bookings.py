import uuid
from datetime import date as date_type, datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import get_current_user, require_manager
from app.auth_utils import normalize_phone
from app.models import User, Booking, Service, Post, Car, ScheduleException, booking_services

router = APIRouter(prefix="/bookings", tags=["bookings"])

MAX_BOOKING_MINUTES = 8 * 60  # для клиента: резерв не больше одного рабочего дня
MANUAL_MAX_MINUTES = 80 * 60  # для менеджера: длинная работа переносится по дням

MSK = timezone(timedelta(hours=3))  # Москва, без перехода на летнее время


def _now_msk() -> datetime:
    """Текущее московское время (наивное) — сервер может жить в другом часовом поясе."""
    return datetime.now(MSK).replace(tzinfo=None)


def _today_msk() -> date_type:
    return _now_msk().date()


class BookingCreate(BaseModel):
    car_id: uuid.UUID | None = None
    post_id: uuid.UUID | None = None  # мастер, выбранный клиентом; None = "любой свободный"
    date: date_type
    start_time: str
    service_ids: list[uuid.UUID]
    comment: str | None = Field(default=None, max_length=200)  # коротко: не «поэма»


@router.post("")
async def create_booking(
    payload: BookingCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.blocked:
        raise HTTPException(status_code=403, detail="Онлайн-запись для вас недоступна. Пожалуйста, позвоните нам")
    if payload.date < _today_msk():
        raise HTTPException(status_code=400, detail="Нельзя записаться на прошедшую дату")

    if payload.date == _today_msk():
        now = _now_msk()
        now_minutes = now.hour * 60 + now.minute
        if _time_to_minutes(payload.start_time) <= now_minutes:
            raise HTTPException(status_code=400, detail="Это время уже прошло")

    # Несколько активных записей разрешены, в том числе на одну машину (масло
    # завтра, подвеска в другой день). Ограничения только от спама и дубля времени.
    MAX_ACTIVE_BOOKINGS = 5
    result = await db.execute(
        select(Booking).where(
            Booking.user_id == user.id,
            Booking.status.in_(["pending", "confirmed"]),
            Booking.date >= _today_msk(),
            Booking.part == 0,
        )
    )
    active = [b for b in result.scalars().all() if _is_booking_still_active(b)]
    if len(active) >= MAX_ACTIVE_BOOKINGS:
        raise HTTPException(
            status_code=409,
            detail=f"Не больше {MAX_ACTIVE_BOOKINGS} активных записей: дождитесь выполнения или отмените лишние",
        )
    if any(str(b.date)[:10] == str(payload.date)[:10] and str(b.start_time)[:5] == str(payload.start_time)[:5] for b in active):
        raise HTTPException(status_code=409, detail="У вас уже есть запись на это время")

    # Длительность — только по нормативам услуг, не вручную
    services_result = await db.execute(select(Service).where(Service.id.in_(payload.service_ids)))
    services = services_result.scalars().all()
    if not services or len(services) != len(payload.service_ids):
        raise HTTPException(status_code=400, detail="Некорректный список услуг")

    total_minutes = sum(s.duration_minutes for s in services)
    # клиентский резерв — не больше 8 часов; остаток работы менеджер решит сам
    total_minutes = min(total_minutes, MAX_BOOKING_MINUTES)

    start_minutes = _time_to_minutes(payload.start_time)
    post_id, segments = await _pick_post_with_segments(db, payload.date, start_minutes, total_minutes, payload.post_id)

    rows = _build_rows(
        segments, post_id=post_id, user_id=user.id, car_id=payload.car_id, status="pending",
        comment=payload.comment, services_text=None, services=services,
    )
    db.add_all(rows)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Этот слот уже занят")

    await _notify_booking(db, "new", booking_id=rows[0].id, actor="client")
    return {"id": str(rows[0].id), "status": "pending", "duration_minutes": total_minutes}


@router.get("/manual/clients")
async def search_clients_for_manual_booking(
    q: str, manager: User = Depends(require_manager), db: AsyncSession = Depends(get_db)
):
    """Подсказки для поля телефона в форме «Новая запись»: q — цифры номера после +7 (от 3 штук).
    Ищет клиентов, чей номер начинается с этих цифр, и сразу отдаёт их машины."""
    digits = "".join(ch for ch in q if ch.isdigit())
    text_query = q.strip()
    # есть буквы — ищем по имени / названию организации / машине / гос. номеру, иначе — по началу телефона
    text_mode = any(ch.isalpha() for ch in text_query)
    if text_mode:
        if len(text_query) < 2:
            return []
    elif len(digits) < 3:
        return []
    # Релевантность: сначала клиенты с самой свежей/ближайшей записью, затем с большим числом записей,
    # затем самые новые. Показываем не больше 3 — дальше менеджер сужает поиск, дописывая цифры.
    stats = (
        select(
            Booking.user_id.label("uid"),
            func.count(Booking.id).label("n"),
            func.max(Booking.date).label("last"),
        )
        .group_by(Booking.user_id)
        .subquery()
    )
    if text_mode:
        from sqlalchemy import and_, or_

        ql = text_query.lower()
        # латинские буквы, похожие на кириллические, в гос. номере считаем русскими
        plate_q = text_query.upper().replace(" ", "").translate(str.maketrans("ABEKMHOPCTYX", "АВЕКМНОРСТУХ"))
        car_match = (
            select(Car.id)
            .where(
                Car.user_id == User.id,
                or_(
                    func.lower(Car.make).contains(ql, autoescape=True),
                    func.lower(Car.model).contains(ql, autoescape=True),
                    func.lower(func.concat(Car.make, " ", Car.model)).contains(ql, autoescape=True),
                    Car.plate.contains(plate_q, autoescape=True),
                ),
            )
            .exists()
        )
        match_cond = and_(
            User.role == "client",
            or_(User.phone.is_not(None), User.email.is_not(None), User.kind == "org"),  # гости без телефона и почты не ищутся
            or_(func.lower(User.full_name).contains(ql, autoescape=True), car_match),
        )
    else:
        match_cond = User.phone.like(f"+7{digits}%")

    users_result = await db.execute(
        select(User)
        .outerjoin(stats, stats.c.uid == User.id)
        .where(match_cond)
        .order_by(stats.c.last.desc().nulls_last(), stats.c.n.desc().nulls_last(), User.created_at.desc())
        .limit(3)
    )
    users = users_result.scalars().all()
    if not users:
        return []
    # Машины: сначала та, на которой клиент был записан последним
    car_stats = (
        select(Booking.car_id.label("cid"), func.max(Booking.date).label("last"))
        .group_by(Booking.car_id)
        .subquery()
    )
    cars_result = await db.execute(
        select(Car)
        .outerjoin(car_stats, car_stats.c.cid == Car.id)
        .where(Car.user_id.in_([u.id for u in users]))
        .order_by(car_stats.c.last.desc().nulls_last(), Car.created_at.desc())
    )
    cars_by_user: dict = {}
    for car in cars_result.scalars().all():
        cars_by_user.setdefault(car.user_id, []).append(
            {"id": str(car.id), "make": car.make, "model": car.model, "vin": car.vin, "plate": car.plate}
        )
    # Ближайшие активные записи клиентов — чтобы менеджер видел, что человек уже записан
    upcoming_result = await db.execute(
        select(Booking, Post.name)
        .outerjoin(Post, Post.id == Booking.post_id)
        .where(
            Booking.user_id.in_([u.id for u in users]),
            Booking.status.in_(["pending", "confirmed"]),
            Booking.part == 0,
            Booking.date >= datetime.combine(_today_msk(), datetime.min.time()),
        )
        .order_by(Booking.date, Booking.start_time)
    )
    upcoming_by_user: dict = {}
    for b, post_name in upcoming_result.all():
        if not _is_booking_still_active(b):
            continue
        upcoming_by_user.setdefault(b.user_id, []).append(
            {
                "date": b.date.date().isoformat(),
                "start_time": b.start_time,
                "post_name": post_name,
                "status": b.status,
            }
        )

    return [
        {
            "user_id": str(u.id),
            "phone": u.phone,
            "kind": u.kind,
            "inn": u.inn,
            "full_name": u.full_name,
            "cars": cars_by_user.get(u.id, []),
            "upcoming": upcoming_by_user.get(u.id, [])[:3],
            "upcoming_total": len(upcoming_by_user.get(u.id, [])),
        }
        for u in users
    ]


@router.get("/manual/client")
async def lookup_client_for_manual_booking(
    phone: str, manager: User = Depends(require_manager), db: AsyncSession = Depends(get_db)
):
    """Для формы «Новая запись»: по номеру находит клиента и его машины, чтобы подставить их в форму."""
    normalized = normalize_phone(phone)
    user_result = await db.execute(select(User).where(User.phone == normalized))
    user = user_result.scalar_one_or_none()
    if user is None:
        return {"found": False}
    cars_result = await db.execute(select(Car).where(Car.user_id == user.id).order_by(Car.created_at.desc()))
    return {
        "found": True,
        "user_id": str(user.id),
        "full_name": user.full_name,
        "cars": [
            {"id": str(car.id), "make": car.make, "model": car.model, "vin": car.vin}
            for car in cars_result.scalars().all()
        ],
    }


class ManualBookingCreate(BaseModel):
    post_id: uuid.UUID
    date: date_type
    start_time: str
    duration_minutes: int = 60
    phone: str | None = None
    car_id: uuid.UUID | None = None  # машина существующего клиента
    service_ids: list[uuid.UUID] = []  # услуги из справочника (когда он появится)
    services_text: str | None = None  # свободный текст: что делаем
    user_id: uuid.UUID | None = None  # клиент, выбранный в подсказке (в том числе организация)
    car_plate: str | None = None
    client_name: str | None = None
    car_make: str | None = None
    car_model: str | None = None
    vin: str | None = None
    comment: str | None = None


@router.post("/manual")
async def create_manual_booking(
    payload: ManualBookingCreate, manager: User = Depends(require_manager), db: AsyncSession = Depends(get_db)
):
    """Запись, которую менеджер вносит сам: клиент пришёл в сервис без регистрации.
    Клиент ищется по телефону; если его нет — создаётся «заготовка» (без пароля).
    Когда человек позже зарегистрируется по этому номеру (set-password), он войдёт
    в тот же профиль, и запись окажется у него. Запись сразу подтверждена."""
    if not 15 <= payload.duration_minutes <= MANUAL_MAX_MINUTES:
        raise HTTPException(status_code=400, detail="Длительность должна быть от 15 минут до 80 часов")

    _assert_not_past(payload.date, _time_to_minutes(payload.start_time))

    vin = payload.vin.strip().upper() if payload.vin else None
    if vin and len(vin) > 17:
        raise HTTPException(status_code=400, detail="VIN не может быть длиннее 17 символов")

    comment = payload.comment.strip() if payload.comment else None
    if comment and len(comment) > 500:
        raise HTTPException(status_code=400, detail="Комментарий слишком длинный (до 500 символов)")

    services_text = payload.services_text.strip() if payload.services_text else None
    if services_text and len(services_text) > 500:
        raise HTTPException(status_code=400, detail="Описание услуг слишком длинное (до 500 символов)")

    post_result = await db.execute(select(Post.id).where(Post.id == payload.post_id))
    if post_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Пост не найден")

    services: list[Service] = []
    if payload.service_ids:
        wanted = set(payload.service_ids)
        services_result = await db.execute(select(Service).where(Service.id.in_(wanted)))
        services = list(services_result.scalars().all())
        if len(services) != len(wanted):
            raise HTTPException(status_code=400, detail="Некорректный список услуг")

    phone_raw = payload.phone.strip() if payload.phone else ""
    phone = normalize_phone(phone_raw) if phone_raw else None

    start = _time_to_minutes(payload.start_time)
    segments = await _plan_segments(
        db, payload.post_id, payload.date, start, payload.duration_minutes,
        statuses=("pending", "confirmed"),
    )

    user = None
    if payload.user_id is not None:
        user_result = await db.execute(select(User).where(User.id == payload.user_id, User.role == "client"))
        user = user_result.scalar_one_or_none()
        if user is None:
            raise HTTPException(status_code=404, detail="Клиент не найден")
    elif phone is not None:
        user_result = await db.execute(select(User).where(User.phone == phone))
        user = user_result.scalar_one_or_none()
    name = payload.client_name.strip() if payload.client_name else None
    created_user = False
    if user is None:
        # без номера объединить визиты и подтянуть запись при регистрации нельзя — это отдельная заготовка
        user = User(phone=phone, full_name=name or (None if phone else "Гость"), role="client")
        db.add(user)
        await db.flush()
        created_user = True
    elif name and not user.full_name:
        user.full_name = name

    car_id = None
    if payload.car_id is not None:
        car_check = await db.execute(select(Car.id).where(Car.id == payload.car_id, Car.user_id == user.id))
        if car_check.scalar_one_or_none() is None:
            raise HTTPException(status_code=400, detail="Эта машина не принадлежит клиенту")
        car_id = payload.car_id
    make = payload.car_make.strip() if payload.car_make else ""
    model = payload.car_model.strip() if payload.car_model else ""
    plate = payload.car_plate.strip().upper().replace(" ", "") if payload.car_plate else None
    if plate and len(plate) > 20:
        raise HTTPException(status_code=400, detail="Слишком длинный гос. номер")
    if car_id is None and (make or model or vin or plate):
        car = None
        if vin:
            car_result = await db.execute(select(Car).where(Car.user_id == user.id, Car.vin == vin))
            car = car_result.scalars().first()
        elif plate:
            # гос. номер однозначно определяет машину (у организации может быть много одинаковых моделей)
            car_result = await db.execute(select(Car).where(Car.user_id == user.id, Car.plate == plate))
            car = car_result.scalars().first()
        elif make and model:
            # без VIN считаем той же машиной ту, у которой совпали марка и модель
            car_result = await db.execute(
                select(Car).where(
                    Car.user_id == user.id,
                    func.lower(Car.make) == make.lower(),
                    func.lower(Car.model) == model.lower(),
                )
            )
            car = car_result.scalars().first()
        if car is None:
            car = Car(user_id=user.id, make=make or "Авто", model=model, vin=vin, plate=plate)
            db.add(car)
            await db.flush()
        car_id = car.id

    rows = _build_rows(
        segments,
        post_id=payload.post_id, user_id=user.id, car_id=car_id, status="confirmed",
        comment=comment, services_text=services_text, services=services,
    )
    db.add_all(rows)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Этот пост уже занят на это время")

    return {"id": str(rows[0].id), "user_id": str(user.id), "created_user": created_user, "segments": len(rows)}


_RU_MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"]
_RU_WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"]


def _fmt_when(b: Booking) -> str:
    d = b.date
    return f"{d.day} {_RU_MONTHS[d.month - 1]} ({_RU_WEEKDAYS[d.weekday()]}), {str(b.start_time)[:5]}"


class BookingNote(BaseModel):
    comment: str | None = None


async def _notify_booking(db: AsyncSession, kind: str, *, booking_id, actor: str, actor_user=None, note: str | None = None, extra: str | None = None):
    """Дублирует событие по записи карточкой в чат клиента. Сбой чата не ломает саму запись."""
    try:
        from app.models import booking_services
        from app.routers.chat import post_booking_message

        found = (
            await db.execute(select(Booking).where(Booking.id == booking_id).execution_options(populate_existing=True))
        ).scalar_one_or_none()
        if found is None:
            return
        head = found
        if found.group_id is not None:
            first = (
                await db.execute(
                    select(Booking).where(Booking.group_id == found.group_id, Booking.part == 0).execution_options(populate_existing=True)
                )
            ).scalars().first()
            head = first or found
        client = (await db.execute(select(User).where(User.id == head.user_id))).scalar_one_or_none()
        if client is None:
            return
        names = (
            await db.execute(
                select(Service.name)
                .join(booking_services, booking_services.c.service_id == Service.id)
                .where(booking_services.c.booking_id == head.id)
            )
        ).scalars().all()
        work = ", ".join(x for x in (", ".join(names), head.services_text) if x)
        car_text = None
        if head.car_id is not None:
            car = (await db.execute(select(Car).where(Car.id == head.car_id))).scalar_one_or_none()
            if car is not None:
                car_text = " · ".join(x for x in (" ".join(y for y in (car.make, car.model) if y), car.plate) if x)
        titles = {
            "new": "Новая запись — ждёт подтверждения",
            "confirmed": "Запись подтверждена",
            "declined": "Заявка отклонена",
            "cancelled": "Запись отменена",
            "moved": "Запись перенесена",
            "duration": "Время записи изменено",
            "cancelled_by_client": "Запись отменена клиентом",
            "moved_by_client": "Запись перенесена клиентом — ждёт подтверждения",
        }
        lines = [f"Когда: {_fmt_when(head)}"]
        if work:
            lines.append(f"Работы: {work}")
        if car_text:
            lines.append(f"Авто: {car_text}")
        if kind == "new" and head.comment:
            lines.append(f"Комментарий: {head.comment}")
        if note:
            lines.append(f"Комментарий сервиса: {note}")
        if extra:
            lines.append(extra)
        await post_booking_message(db, client, actor, actor_user, titles[kind], lines)
    except Exception:
        import logging

        logging.getLogger(__name__).exception("не удалось отправить карточку записи в чат")


class BookingConfirm(BaseModel):
    post_id: uuid.UUID
    duration_minutes: int | None = None
    start_time: str | None = None
    comment: str | None = None


@router.post("/{booking_id}/confirm")
async def confirm_booking(booking_id: uuid.UUID, payload: BookingConfirm, manager: User = Depends(require_manager), db: AsyncSession = Depends(get_db)):
    """Подтверждение заявки. Менеджер может поменять мастера, время и длительность;
    если работа не влезает в день, остаток переносится на следующие рабочие дни,
    а вся группа заявки подтверждается разом."""
    booking_result = await db.execute(select(Booking).where(Booking.id == booking_id).with_for_update())
    booking = booking_result.scalar_one_or_none()
    if booking is None or booking.status != "pending":
        raise HTTPException(status_code=409, detail="Запись уже обработана другим менеджером")
    if payload.duration_minutes is not None and not 15 <= payload.duration_minutes <= MANUAL_MAX_MINUTES:
        raise HTTPException(status_code=400, detail="Длительность должна быть от 15 минут до 80 часов")

    start_time = payload.start_time if payload.start_time is not None else booking.start_time
    await _move_group(
        db, booking, payload.post_id, booking.date, start_time, statuses=("confirmed",),
        total=payload.duration_minutes, new_status="confirmed",
    )
    await _notify_booking(
        db, "confirmed", booking_id=booking_id, actor="manager", actor_user=manager,
        note=(payload.comment or "").strip()[:500] or None,
    )
    return {"ok": True}


class BookingReschedule(BaseModel):
    post_id: uuid.UUID
    start_time: str
    date: date_type | None = None


@router.post("/{booking_id}/reschedule")
async def reschedule_booking(booking_id: uuid.UUID, payload: BookingReschedule, manager: User = Depends(require_manager), db: AsyncSession = Depends(get_db)):
    """Перенос уже подтверждённой записи на другой пост и/или время (и, при
    необходимости, другую дату) — для перетаскивания записи в календаре.
    Длинная запись двигается целиком: продолжение раскладывается заново."""
    booking_result = await db.execute(select(Booking).where(Booking.id == booking_id))
    booking = booking_result.scalar_one_or_none()
    if booking is None or booking.status != "confirmed":
        raise HTTPException(status_code=409, detail="Запись не найдена или не подтверждена")

    target_date = payload.date if payload.date is not None else booking.date
    await _move_group(db, booking, payload.post_id, target_date, payload.start_time, statuses=("confirmed",))
    await _notify_booking(db, "moved", booking_id=booking_id, actor="manager", actor_user=manager)
    return {"ok": True}


class BookingMove(BaseModel):
    date: date_type | None = None
    post_id: uuid.UUID
    start_time: str


@router.post("/{booking_id}/move")
async def move_pending_booking(
    booking_id: uuid.UUID, payload: BookingMove, manager: User = Depends(require_manager), db: AsyncSession = Depends(get_db)
):
    """Переносит ещё не подтверждённую заявку на другого мастера и/или время,
    не меняя статус (остаётся pending) — для переноса заявки в календаре до
    подтверждения."""
    booking_result = await db.execute(select(Booking).where(Booking.id == booking_id))
    booking = booking_result.scalar_one_or_none()
    if booking is None or booking.status != "pending":
        raise HTTPException(status_code=409, detail="Запись уже обработана другим менеджером")

    target_date = payload.date if payload.date is not None else booking.date
    await _move_group(db, booking, payload.post_id, target_date, payload.start_time, statuses=("pending", "confirmed"))
    return {"ok": True}


async def _group_clause(db: AsyncSession, booking_id: uuid.UUID):
    result = await db.execute(select(Booking).where(Booking.id == booking_id))
    found = result.scalar_one_or_none()
    if found is None:
        return None
    return Booking.group_id == found.group_id if found.group_id is not None else Booking.id == found.id


@router.post("/{booking_id}/cancel")
async def cancel_confirmed_booking(
    booking_id: uuid.UUID,
    payload: BookingNote | None = None,
    manager: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Отмена уже подтверждённой записи менеджером (в отличие от /decline,
    которая отклоняет ещё не подтверждённую заявку). Отменяется вся группа."""
    clause = await _group_clause(db, booking_id)
    if clause is None:
        raise HTTPException(status_code=409, detail="Запись не найдена или уже не подтверждена")
    result = await db.execute(
        update(Booking).where(clause, Booking.status == "confirmed").values(status="cancelled")
    )
    await db.commit()

    if result.rowcount == 0:
        raise HTTPException(status_code=409, detail="Запись не найдена или уже не подтверждена")

    await _notify_booking(
        db, "cancelled", booking_id=booking_id, actor="manager", actor_user=manager,
        note=((payload.comment if payload else "") or "").strip()[:500] or None,
    )
    return {"ok": True}


@router.post("/{booking_id}/decline")
async def decline_booking(
    booking_id: uuid.UUID,
    payload: BookingNote | None = None,
    manager: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    clause = await _group_clause(db, booking_id)
    if clause is None:
        raise HTTPException(status_code=409, detail="Запись уже обработана другим менеджером")
    result = await db.execute(
        update(Booking).where(clause, Booking.status == "pending").values(status="cancelled")
    )
    await db.commit()

    if result.rowcount == 0:
        raise HTTPException(status_code=409, detail="Запись уже обработана другим менеджером")

    await _notify_booking(
        db, "declined", booking_id=booking_id, actor="manager", actor_user=manager,
        note=((payload.comment if payload else "") or "").strip()[:500] or None,
    )
    return {"ok": True}


@router.get("/me")
async def get_my_booking(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Возвращает активную (pending/confirmed, ещё не прошедшую по дате)
    запись клиента, если есть — именно ту единственную, что разрешена
    правилом "одна активная запись на клиента"."""
    result = await db.execute(
        select(Booking)
        .where(
            Booking.user_id == user.id,
            Booking.status.in_(["pending", "confirmed"]),
            Booking.date >= _today_msk(),
            Booking.part == 0,
        )
        .order_by(Booking.created_at.desc())
    )
    booking = next((b for b in result.scalars().all() if _is_booking_still_active(b)), None)
    if booking is None:
        return None

    return {
        "id": str(booking.id),
        "date": str(booking.date),
        "start_time": booking.start_time,
        "duration_minutes": booking.duration_minutes,
        "status": booking.status,
        "post_id": str(booking.post_id) if booking.post_id else None,
        "comment": booking.comment,
    }


@router.get("/mine")
async def list_my_bookings(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Все активные записи клиента (ближайшие первыми) — для главной страницы."""
    from sqlalchemy.orm import selectinload

    result = await db.execute(
        select(Booking)
        .options(selectinload(Booking.car))
        .where(
            Booking.user_id == user.id,
            Booking.status.in_(["pending", "confirmed"]),
            Booking.date >= _today_msk(),
            Booking.part == 0,
        )
        .order_by(Booking.date, Booking.start_time)
    )
    bookings = [b for b in result.scalars().all() if _is_booking_still_active(b)]
    if not bookings:
        return []

    rows = await db.execute(
        select(booking_services.c.booking_id, Service.name)
        .join(Service, Service.id == booking_services.c.service_id)
        .where(booking_services.c.booking_id.in_([b.id for b in bookings]))
        .order_by(Service.name)
    )
    names: dict = {}
    for booking_id, name in rows.all():
        names.setdefault(booking_id, []).append(name)

    from sqlalchemy import func

    gids = [b.group_id for b in bookings if b.group_id is not None]
    totals: dict = {}
    if gids:
        res = await db.execute(
            select(Booking.group_id, func.sum(Booking.duration_minutes))
            .where(Booking.group_id.in_(gids))
            .group_by(Booking.group_id)
        )
        totals = {g: int(t) for g, t in res.all()}

    out = []
    for b in bookings:
        car_label = None
        if b.car is not None:
            plate = getattr(b.car, "plate", None)
            car_label = f"{b.car.make} {b.car.model}" + (f" · {plate}" if plate else "")
        out.append(
            {
                "id": str(b.id),
                "date": str(b.date),
                "start_time": b.start_time,
                "duration_minutes": b.duration_minutes,
                "status": b.status,
                "comment": b.comment,
                "services": names.get(b.id, []),
                "car": car_label,
                "carry_over": b.group_id is not None,
                "total_minutes": totals.get(b.group_id, b.duration_minutes),
            }
        )
    return out


import datetime as _dt


class ClientReschedule(BaseModel):
    date: _dt.date
    start_time: str


async def _own_active_booking(db: AsyncSession, booking_id: uuid.UUID, user: User) -> Booking:
    result = await db.execute(select(Booking).where(Booking.id == booking_id))
    booking = result.scalar_one_or_none()
    if booking is None or booking.user_id != user.id:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    if booking.part:
        raise HTTPException(status_code=409, detail="Продолжение записи меняется вместе с первой частью")
    if booking.status not in ("pending", "confirmed") or not _is_booking_still_active(booking):
        raise HTTPException(status_code=409, detail="Запись уже неактивна")
    return booking


@router.post("/{booking_id}/cancel-mine")
async def cancel_my_booking(booking_id: uuid.UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Клиент отменяет свою запись целиком (вместе с продолжением на следующие дни)."""
    booking = await _own_active_booking(db, booking_id, user)
    clause = Booking.group_id == booking.group_id if booking.group_id is not None else Booking.id == booking.id
    await db.execute(update(Booking).where(clause, Booking.status.in_(["pending", "confirmed"])).values(status="cancelled"))
    await db.commit()
    await _notify_booking(db, "cancelled_by_client", booking_id=booking_id, actor="client")
    return {"ok": True}


@router.post("/{booking_id}/reschedule-mine")
async def reschedule_my_booking(
    booking_id: uuid.UUID, payload: ClientReschedule, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """Клиент переносит свою запись на другое время. Пост подбирается сам (сначала прежний);
    запись снова становится «ждёт подтверждения»."""
    from app.models import Post

    booking = await _own_active_booking(db, booking_id, user)
    _assert_not_past(payload.date, _time_to_minutes(payload.start_time))

    posts = (await db.execute(select(Post).order_by(Post.name))).scalars().all()
    candidates = [p.id for p in posts]
    if booking.post_id is not None:
        if booking.post_id in candidates:
            candidates.remove(booking.post_id)
        candidates.insert(0, booking.post_id)

    last_error = None
    for pid in candidates:
        try:
            await _move_group(
                db, booking, pid, payload.date, payload.start_time,
                statuses=("pending", "confirmed"), new_status="pending",
            )
            await _notify_booking(db, "moved_by_client", booking_id=booking_id, actor="client")
            return {"ok": True}
        except HTTPException as e:
            last_error = e
    raise last_error or HTTPException(status_code=409, detail="На это время нет свободных мест")


@router.get("/history")
async def my_service_history(
    car_id: uuid.UUID | None = None, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """История обслуживания клиента (по машине): прошедшие подтверждённые записи."""
    query = select(Booking).where(
        Booking.user_id == user.id,
        Booking.status == "confirmed",
        Booking.part == 0,
        Booking.date <= _today_msk(),
    )
    if car_id is not None:
        query = query.where(Booking.car_id == car_id)
    result = await db.execute(query.order_by(Booking.date.desc(), Booking.start_time.desc()))
    items = [b for b in result.scalars().all() if not _is_booking_still_active(b)]
    if not items:
        return []

    rows = await db.execute(
        select(booking_services.c.booking_id, Service.name)
        .join(Service, Service.id == booking_services.c.service_id)
        .where(booking_services.c.booking_id.in_([b.id for b in items]))
        .order_by(Service.name)
    )
    names: dict = {}
    for booking_id, name in rows.all():
        names.setdefault(booking_id, []).append(name)

    return [
        {
            "id": str(b.id),
            "date": str(b.date),
            "start_time": b.start_time,
            "duration_minutes": b.duration_minutes,
            "services": names.get(b.id, []),
            "comment": b.comment,
        }
        for b in items
    ]


@router.get("/pending")
async def list_pending_bookings(manager: User = Depends(require_manager), db: AsyncSession = Depends(get_db)):
    """Очередь заявок, ожидающих подтверждения. Только для менеджеров."""
    result = await db.execute(select(Booking).where(Booking.status == "pending", Booking.part == 0).order_by(Booking.created_at))
    bookings = result.scalars().all()

    services_result = await db.execute(
        select(booking_services.c.booking_id, Service).join(Service, Service.id == booking_services.c.service_id)
    )
    services_by_booking: dict = {}
    for booking_id, service in services_result.all():
        services_by_booking.setdefault(booking_id, []).append(service)

    return [
        {
            "id": str(b.id),
            "user_id": str(b.user_id),
            "car_id": str(b.car_id) if b.car_id else None,
            "date": str(b.date),
            "start_time": b.start_time,
            "duration_minutes": b.duration_minutes,
            "comment": b.comment,
            "services": [
                {"id": str(s.id), "name": s.name, "duration_minutes": s.duration_minutes}
                for s in services_by_booking.get(b.id, [])
            ],
        }
        for b in bookings
    ]


@router.get("/by-user/{user_id}")
async def list_bookings_for_manager(
    user_id: uuid.UUID, manager: User = Depends(require_manager), db: AsyncSession = Depends(get_db)
):
    """История всех записей конкретного клиента (любых статусов) — для
    развёрнутой карточки клиента в /nord/clients."""
    result = await db.execute(
        select(Booking).where(Booking.user_id == user_id).order_by(Booking.date.desc(), Booking.start_time.desc())
    )
    bookings = result.scalars().all()
    return [
        {
            "id": str(b.id),
            "date": str(b.date),
            "start_time": b.start_time,
            "duration_minutes": b.duration_minutes,
            "status": b.status,
            "comment": b.comment,
        }
        for b in bookings
    ]


def _time_to_minutes(t: str) -> int:
    h, m = t.split(":")
    return int(h) * 60 + int(m)


def _assert_not_past(target, start_minutes: int | None = None) -> None:
    """Записывать и переносить можно только на текущий получасовой слот и позже —
    прошлое можно лишь смотреть. Время — московское."""
    day = target.date() if isinstance(target, datetime) else target
    today = _today_msk()
    if day < today:
        raise HTTPException(status_code=400, detail="Нельзя записать на прошедшую дату")
    if day == today and start_minutes is not None:
        now = _now_msk()
        now_minutes = now.hour * 60 + now.minute
        if start_minutes < now_minutes - now_minutes % 30:
            raise HTTPException(status_code=400, detail="Это время уже прошло")


def _minutes_to_time(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


def _is_booking_still_active(b: Booking) -> bool:
    """Запись больше не активна, если её дата в прошлом, либо дата сегодня,
    но время окончания (start_time + duration_minutes) уже прошло."""
    today = _today_msk()
    booking_date = b.date.date() if isinstance(b.date, datetime) else b.date
    if booking_date > today:
        return True
    if booking_date < today:
        return False
    end_minutes = _time_to_minutes(b.start_time) + b.duration_minutes
    now = _now_msk()
    now_minutes = now.hour * 60 + now.minute
    return now_minutes < end_minutes


async def _assert_no_overlap(
    db: AsyncSession,
    post_id: uuid.UUID,
    target_date,
    start: int,
    end: int,
    exclude_booking_id: uuid.UUID | None = None,
    statuses: tuple[str, ...] = ("confirmed",),
):
    """Бросает 409, если на этом посту в эту дату уже есть запись в одном из
    statuses (по умолчанию — только подтверждённая), пересекающаяся по
    времени с [start, end)."""
    query = select(Booking).where(
        Booking.post_id == post_id,
        Booking.date == target_date,
        Booking.status.in_(statuses),
    )
    if exclude_booking_id is not None:
        query = query.where(Booking.id != exclude_booking_id)
    result = await db.execute(query)
    for other in result.scalars().all():
        other_start = _time_to_minutes(other.start_time)
        other_end = other_start + other.duration_minutes
        if start < other_end and other_start < end:
            raise HTTPException(status_code=409, detail="Этот пост уже занят на это время")


async def _resolve_post_for_booking(
    db: AsyncSession,
    target_date: date_type,
    start_minutes: int,
    end_minutes: int,
    requested_post_id: uuid.UUID | None,
) -> uuid.UUID:
    """Подбирает мастера для новой заявки клиента: если мастер указан явно —
    проверяет, что у него весь интервал свободен (с учётом исключений по
    расписанию); если нет ("любой свободный") — берёт первого подходящего по
    алфавиту. Бросает 404/409/400, если подходящего мастера нет."""
    posts_result = await db.execute(select(Post).order_by(Post.name))
    posts = posts_result.scalars().all()
    if requested_post_id is not None:
        posts = [p for p in posts if p.id == requested_post_id]
        if not posts:
            raise HTTPException(status_code=404, detail="Мастер не найден")

    weekday_index = target_date.weekday()
    exceptions_result = await db.execute(select(ScheduleException).where(ScheduleException.date == target_date))
    exceptions_by_post = {e.post_id: e for e in exceptions_result.scalars().all()}

    for post in posts:
        exception = exceptions_by_post.get(post.id)
        if exception is not None:
            if not exception.is_working:
                continue
            work_start = exception.work_start or post.work_start
            work_end = exception.work_end or post.work_end
        else:
            if post.work_days[weekday_index] != "1":
                continue
            work_start, work_end = post.work_start, post.work_end

        if start_minutes < _time_to_minutes(work_start) or end_minutes > _time_to_minutes(work_end):
            continue

        try:
            await _assert_no_overlap(
                db, post.id, target_date, start_minutes, end_minutes, statuses=("pending", "confirmed")
            )
        except HTTPException:
            continue
        return post.id

    if requested_post_id is not None:
        raise HTTPException(status_code=409, detail="У этого мастера занято это время")
    raise HTTPException(status_code=400, detail="Нет свободных мастеров на это время")


async def _plan_segments(
    db: AsyncSession,
    post_id: uuid.UUID,
    day: date_type,
    start: int,
    total: int,
    exclude_ids=(),
    statuses: tuple[str, ...] = ("pending", "confirmed"),
):
    """Раскладывает работу длиной total минут по рабочим дням мастера.
    Первый кусок идёт с start до конца рабочего дня и должен быть свободен;
    остаток переносится на утро следующих рабочих дней (выходные и отпуск
    пропускаются), занятое время обходится. Возвращает [(дата, начало, минут)]."""
    post_result = await db.execute(select(Post).where(Post.id == post_id))
    post = post_result.scalar_one_or_none()
    if post is None:
        raise HTTPException(status_code=404, detail="Пост не найден")

    exc_result = await db.execute(
        select(ScheduleException).where(ScheduleException.post_id == post_id, ScheduleException.date >= day)
    )
    exc = {}
    for e in exc_result.scalars().all():
        exc[e.date.date() if isinstance(e.date, datetime) else e.date] = e

    def window(d):
        e = exc.get(d)
        if e is not None:
            if not e.is_working:
                return None
            return _time_to_minutes(e.work_start or post.work_start), _time_to_minutes(e.work_end or post.work_end)
        if post.work_days[d.weekday()] != "1":
            return None
        return _time_to_minutes(post.work_start), _time_to_minutes(post.work_end)

    async def busy(d, st):
        query = select(Booking).where(Booking.post_id == post_id, Booking.date == d, Booking.status.in_(st))
        if exclude_ids:
            query = query.where(Booking.id.not_in(list(exclude_ids)))
        result = await db.execute(query)
        spans = []
        for other in result.scalars().all():
            s = _time_to_minutes(other.start_time)
            spans.append((s, s + other.duration_minutes))
        return sorted(spans)

    win = window(day)
    if win is None or not (win[0] <= start < win[1]):
        # вне графика мастера — как раньше: одним куском, без переноса
        seg_end = start + total
        first_len = total
    else:
        seg_end = min(start + total, win[1])
        first_len = seg_end - start

    for bs, be in await busy(day, statuses):
        if start < be and bs < seg_end:
            raise HTTPException(status_code=409, detail="Этот пост уже занят на это время")

    segments = [(day, start, first_len)]
    remaining = total - first_len
    d = day
    for _ in range(60):
        if remaining <= 0:
            break
        d = d + timedelta(days=1)
        w = window(d)
        if w is None:
            continue
        cursor = w[0]
        spans = await busy(d, ("pending", "confirmed"))
        for bs, be in spans + [(w[1], w[1])]:
            gap_end = min(bs, w[1])
            if remaining > 0 and gap_end - cursor >= 15:
                take = min(remaining, gap_end - cursor)
                segments.append((d, cursor, take))
                remaining -= take
            cursor = max(cursor, be)
            if remaining <= 0:
                break
    if remaining > 0:
        raise HTTPException(status_code=409, detail="Не хватает свободного времени в ближайшие дни")
    return segments


def _build_rows(segments, *, post_id, user_id, car_id, status, comment, services_text, services):
    gid = uuid.uuid4() if len(segments) > 1 else None
    rows = []
    for i, (d, s, dur) in enumerate(segments):
        row = Booking(
            id=uuid.uuid4(), user_id=user_id, car_id=car_id, post_id=post_id, date=d,
            start_time=_minutes_to_time(s), duration_minutes=dur, status=status,
            comment=comment, services_text=services_text, group_id=gid, part=i,
        )
        row.services = list(services)
        rows.append(row)
    return rows


async def _booking_services(db: AsyncSession, booking_id: uuid.UUID):
    result = await db.execute(
        select(Service)
        .join(booking_services, booking_services.c.service_id == Service.id)
        .where(booking_services.c.booking_id == booking_id)
    )
    return list(result.scalars().all())


async def _move_group(
    db: AsyncSession, booking: Booking, post_id, target_date, start_time: str, statuses,
    total: int | None = None, new_status: str | None = None, check_past: bool = True,
):
    """Переносит запись (и всю её группу): продолжение пересчитывается заново."""
    if booking.part:
        raise HTTPException(status_code=409, detail="Перенесите первую часть записи — продолжение двигается вместе с ней")
    day = target_date.date() if isinstance(target_date, datetime) else target_date
    if check_past:
        _assert_not_past(day, _time_to_minutes(start_time))

    if booking.group_id is not None:
        rows_result = await db.execute(select(Booking).where(Booking.group_id == booking.group_id).order_by(Booking.part))
        rows = list(rows_result.scalars().all())
    else:
        rows = [booking]
    if total is None:
        total = sum(r.duration_minutes for r in rows)

    segments = await _plan_segments(
        db, post_id, day, _time_to_minutes(start_time), total,
        exclude_ids=[r.id for r in rows], statuses=statuses,
    )

    extra_ids = [r.id for r in rows if r.id != booking.id]
    if extra_ids:
        await db.execute(delete(Booking).where(Booking.id.in_(extra_ids)))
    services = await _booking_services(db, booking.id)

    gid = (booking.group_id or uuid.uuid4()) if len(segments) > 1 else None
    d0, s0, dur0 = segments[0]
    booking.post_id = post_id
    booking.date = d0
    booking.start_time = _minutes_to_time(s0)
    booking.duration_minutes = dur0
    booking.group_id = gid
    booking.part = 0
    if new_status:
        booking.status = new_status
    for idx, (d, s, dur) in enumerate(segments[1:], 1):
        row = Booking(
            id=uuid.uuid4(), user_id=booking.user_id, car_id=booking.car_id, post_id=post_id, date=d,
            start_time=_minutes_to_time(s), duration_minutes=dur, status=booking.status,
            comment=booking.comment, services_text=booking.services_text, group_id=gid, part=idx,
        )
        row.services = list(services)
        db.add(row)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Этот пост уже занят на это время")


async def _pick_post_with_segments(db: AsyncSession, day: date_type, start: int, total: int, requested_post_id):
    """Подбирает мастера для клиентской заявки: старт должен попасть в рабочее
    время мастера и быть свободным; если работа не влезает в день, остаток
    переносится на утро следующих рабочих дней. Возвращает (post_id, куски)."""
    posts_result = await db.execute(select(Post).order_by(Post.name))
    posts = posts_result.scalars().all()
    if requested_post_id is not None:
        posts = [p for p in posts if p.id == requested_post_id]
        if not posts:
            raise HTTPException(status_code=404, detail="Мастер не найден")

    exceptions_result = await db.execute(select(ScheduleException).where(ScheduleException.date == day))
    exceptions_by_post = {e.post_id: e for e in exceptions_result.scalars().all()}

    for post in posts:
        exception = exceptions_by_post.get(post.id)
        if exception is not None:
            if not exception.is_working:
                continue
            work_start = exception.work_start or post.work_start
            work_end = exception.work_end or post.work_end
        else:
            if post.work_days[day.weekday()] != "1":
                continue
            work_start, work_end = post.work_start, post.work_end

        if not (_time_to_minutes(work_start) <= start < _time_to_minutes(work_end)):
            continue
        try:
            segments = await _plan_segments(db, post.id, day, start, total)
        except HTTPException:
            continue
        return post.id, segments

    if requested_post_id is not None:
        raise HTTPException(status_code=409, detail="У этого мастера занято это время")
    raise HTTPException(status_code=400, detail="Нет свободных мастеров на это время")


def _car_dict(car: Car | None):
    if car is None:
        return None
    return {"make": car.make, "model": car.model, "vin": car.vin, "plate": car.plate}


@router.get("/pending-days")
async def pending_days(
    start: date_type, days: int = 14, manager: User = Depends(require_manager), db: AsyncSession = Depends(get_db)
):
    """Сколько заявок ждут подтверждения по дням — для пометок в календаре менеджера."""
    import datetime as _dtm

    days = max(1, min(days, 62))
    begin = _dtm.datetime.combine(start, _dtm.time.min)
    end = begin + _dtm.timedelta(days=days)
    rows = await db.execute(
        select(Booking.date).where(
            Booking.status == "pending", Booking.part == 0, Booking.date >= begin, Booking.date < end
        )
    )
    out: dict[str, int] = {}
    for (d,) in rows.all():
        key = str(d)[:10]
        out[key] = out.get(key, 0) + 1
    return out


@router.get("/calendar")
async def get_calendar(
    target_date: date_type, manager: User = Depends(require_manager), db: AsyncSession = Depends(get_db)
):
    """Общий календарь по всем постам на один день — сетка пост × получасовые
    слоты. Заявки, ожидающие подтверждения, показываются прямо в слотах
    того мастера, которого выбрал клиент (или которого подобрала система),
    а не отдельным списком — они сразу занимают своё время и место."""
    posts_result = await db.execute(select(Post).order_by(Post.name))
    posts = posts_result.scalars().all()

    exceptions_result = await db.execute(select(ScheduleException).where(ScheduleException.date == target_date))
    exceptions_by_post = {e.post_id: e for e in exceptions_result.scalars().all()}

    bookings_result = await db.execute(
        select(Booking, User, Car)
        .join(User, User.id == Booking.user_id)
        .outerjoin(Car, Car.id == Booking.car_id)
        .where(
            Booking.date == target_date,
            Booking.status.in_(["pending", "confirmed"]),
            Booking.post_id.isnot(None),
        )
    )
    rows = bookings_result.all()

    services_result = await db.execute(
        select(booking_services.c.booking_id, Service).join(Service, Service.id == booking_services.c.service_id)
    )
    services_by_booking: dict = {}
    for booking_id, service in services_result.all():
        services_by_booking.setdefault(booking_id, []).append(service)

    bookings_by_post: dict = {}
    for booking, user, car in rows:
        bookings_by_post.setdefault(booking.post_id, []).append((booking, user, car))

    weekday_index = target_date.weekday()  # 0 = понедельник

    result_posts = []
    for post in posts:
        exception = exceptions_by_post.get(post.id)
        if exception is not None:
            working = exception.is_working
            work_start = exception.work_start or post.work_start
            work_end = exception.work_end or post.work_end
        else:
            working = post.work_days[weekday_index] == "1"
            work_start, work_end = post.work_start, post.work_end

        slots = []
        post_bookings = bookings_by_post.get(post.id, [])
        # у мастера выходной/отпуск, но записи остались: показываем их, чтобы можно было перенести
        day_off = not working and bool(post_bookings)
        if working or day_off:
            if working:
                start = _time_to_minutes(work_start)
                end = _time_to_minutes(work_end)
            else:
                starts = [_time_to_minutes(b.start_time) for b, _u, _c in post_bookings]
                ends = [_time_to_minutes(b.start_time) + b.duration_minutes for b, _u, _c in post_bookings]
                start = min(starts) - min(starts) % 30
                end = -(-max(ends) // 30) * 30
            t = start
            while t < end:
                slot_time = _minutes_to_time(t)
                occupying = None
                for booking, user, car in post_bookings:
                    b_start = _time_to_minutes(booking.start_time)
                    b_end = b_start + booking.duration_minutes
                    if b_start <= t < b_end:
                        occupying = (booking, user, car, t == b_start)
                        break
                if occupying:
                    booking, user, car, is_start = occupying
                    slots.append(
                        {
                            "time": slot_time,
                            "status": booking.status,
                            "is_start": is_start,
                            "booking": {
                                "id": str(booking.id),
                                "user_id": str(user.id),
                                "post_id": str(booking.post_id),
                                "client_name": user.full_name or user.phone,
                                "phone": user.phone,
                                "is_guest": user.phone is None and user.email is None and user.kind != "org",
                                "is_org": user.kind == "org",
                                "start_time": booking.start_time,
                                "duration_minutes": booking.duration_minutes,
                                "comment": booking.comment,
                                "services_text": booking.services_text,
                                "group_id": str(booking.group_id) if booking.group_id else None,
                                "part": booking.part,
                                "car": _car_dict(car),
                                "services": [
                                    {"id": str(s.id), "name": s.name, "duration_minutes": s.duration_minutes}
                                    for s in services_by_booking.get(booking.id, [])
                                ],
                            },
                        }
                    )
                else:
                    slots.append({"time": slot_time, "status": "free" if working else "off", "is_start": False, "booking": None})
                t += 30
        result_posts.append(
            {
                "post_id": str(post.id),
                "name": post.name,
                "working": working,
                "day_off": day_off,
                "slots": slots,
            }
        )

    return {"date": str(target_date), "posts": result_posts}


class BookingDuration(BaseModel):
    delta_minutes: int


def _fmt_minutes(total: int) -> str:
    h, m = divmod(total, 60)
    if h and m:
        return f"{h} ч {m} мин"
    return f"{h} ч" if h else f"{m} мин"


@router.post("/{booking_id}/duration")
async def change_booking_duration(
    booking_id: uuid.UUID,
    payload: BookingDuration,
    manager: User = Depends(require_manager),
    db: AsyncSession = Depends(get_db),
):
    """Добавить или убавить время у подтверждённой записи шагом по 30 минут.
    Продолжение раскладывается заново, пересечения с соседними записями проверяются."""
    delta = payload.delta_minutes
    if delta == 0 or delta % 30 != 0 or abs(delta) > 240:
        raise HTTPException(status_code=400, detail="Время меняется шагом по 30 минут")

    result = await db.execute(select(Booking).where(Booking.id == booking_id).with_for_update())
    booking = result.scalar_one_or_none()
    if booking is None or booking.status != "confirmed":
        raise HTTPException(status_code=409, detail="Запись не найдена или не подтверждена")
    if booking.part:
        head_result = await db.execute(
            select(Booking).where(Booking.group_id == booking.group_id, Booking.part == 0).with_for_update()
        )
        booking = head_result.scalar_one_or_none()
        if booking is None:
            raise HTTPException(status_code=409, detail="Запись не найдена")

    if booking.group_id is not None:
        rows_result = await db.execute(select(Booking).where(Booking.group_id == booking.group_id))
        total = sum(r.duration_minutes for r in rows_result.scalars().all())
    else:
        total = booking.duration_minutes

    new_total = total + delta
    if not 15 <= new_total <= MANUAL_MAX_MINUTES:
        raise HTTPException(status_code=400, detail="Длительность должна быть от 15 минут до 80 часов")

    await _move_group(
        db, booking, booking.post_id, booking.date, booking.start_time,
        statuses=("confirmed",), total=new_total, check_past=False,
    )
    await _notify_booking(
        db, "duration", booking_id=booking.id, actor="manager", actor_user=manager,
        extra=f"Длительность: {_fmt_minutes(new_total)}",
    )
    return {"ok": True, "duration_minutes": new_total}
