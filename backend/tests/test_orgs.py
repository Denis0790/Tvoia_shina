import uuid
from datetime import date, timedelta

import pytest
from sqlalchemy import select

from app.models import Post, RefreshToken, User
from tests.conftest_helpers import register_and_login


async def _manager_headers(client, db_session, phone="+79165559911"):
    token = await register_and_login(client, phone)
    await db_session.execute(User.__table__.update().where(User.phone == phone).values(role="manager"))
    await db_session.flush()
    return {"Authorization": f"Bearer {token}"}


async def _create_org(client, headers, name="ООО Ромашка", inn="7700000001"):
    r = await client.post("/users/clients/org", json={"name": name, "inn": inn}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.mark.asyncio
async def test_create_org_and_login(client, db_session):
    headers = await _manager_headers(client, db_session)
    org = await _create_org(client, headers)

    assert org["login"].startswith("romashka")
    assert org["login"].isascii()
    assert len(org["password"]) == 8

    r = await client.post("/auth/org-login", params={"login": org["login"], "password": org["password"]})
    assert r.status_code == 200, r.text

    r = await client.post("/auth/org-login", params={"login": org["login"], "password": "wrong"})
    assert r.status_code == 401

    # в базе только хеш, не сам пароль
    user = (await db_session.execute(select(User).where(User.id == uuid.UUID(org["id"])))).scalar_one()
    assert user.kind == "org"
    assert user.phone is None
    assert user.password_hash and org["password"] not in user.password_hash


@pytest.mark.asyncio
async def test_org_in_clients_list(client, db_session):
    headers = await _manager_headers(client, db_session)
    org = await _create_org(client, headers, name="ИП Петров", inn="770000000102")

    r = await client.get("/users/clients", headers=headers)
    assert r.status_code == 200
    row = next(x for x in r.json() if x["id"] == org["id"])
    assert row["kind"] == "org"
    assert row["inn"] == "770000000102"
    assert row["login"] == org["login"]
    assert row["login"].startswith("petrov")
    assert row["full_name"] == "ИП Петров"
    assert row["phone"] is None


@pytest.mark.asyncio
async def test_create_org_duplicate_inn(client, db_session):
    headers = await _manager_headers(client, db_session)
    await _create_org(client, headers)
    r = await client.post("/users/clients/org", json={"name": "Другая", "inn": "7700000001"}, headers=headers)
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_create_org_validation(client, db_session):
    headers = await _manager_headers(client, db_session)
    for inn in ["abc", "12345", "12345678901", "77000000a1"]:
        r = await client.post("/users/clients/org", json={"name": "Орг", "inn": inn}, headers=headers)
        assert r.status_code == 400, inn
    r = await client.post("/users/clients/org", json={"name": "  ", "inn": "7700000003"}, headers=headers)
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_create_org_requires_manager(client, db_session):
    token = await register_and_login(client, "+79165559912")
    r = await client.post(
        "/users/clients/org",
        json={"name": "Орг", "inn": "7700000004"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code in (401, 403)


@pytest.mark.asyncio
async def test_reset_password_invalidates_old_password_and_sessions(client, db_session):
    headers = await _manager_headers(client, db_session)
    org = await _create_org(client, headers)

    r = await client.post("/auth/org-login", params={"login": org["login"], "password": org["password"]})
    assert r.status_code == 200
    org_id = uuid.UUID(org["id"])
    before = (await db_session.execute(select(RefreshToken).where(RefreshToken.user_id == org_id))).scalars().all()
    assert before and all(t.revoked_at is None for t in before)

    r = await client.post(f"/users/clients/{org['id']}/reset-password", headers=headers)
    assert r.status_code == 200
    new = r.json()
    assert new["login"] == org["login"]
    assert new["password"] != org["password"]

    old_try = await client.post("/auth/org-login", params={"login": org["login"], "password": org["password"]})
    assert old_try.status_code == 401
    new_try = await client.post("/auth/org-login", params={"login": new["login"], "password": new["password"]})
    assert new_try.status_code == 200

    db_session.expire_all()
    tokens = (await db_session.execute(select(RefreshToken).where(RefreshToken.user_id == org_id))).scalars().all()
    old_tokens = [t for t in tokens if t.id in {b.id for b in before}]
    assert all(t.revoked_at is not None for t in old_tokens)


@pytest.mark.asyncio
async def test_reset_password_only_for_org(client, db_session):
    headers = await _manager_headers(client, db_session)
    person_phone = "+79165559913"
    await register_and_login(client, person_phone)
    person = (await db_session.execute(select(User).where(User.phone == person_phone))).scalar_one()

    r = await client.post(f"/users/clients/{person.id}/reset-password", headers=headers)
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_org_login_rejects_person_and_unknown(client, db_session):
    r = await client.post("/auth/org-login", params={"login": "nobody", "password": "x"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_clients_list_hides_guests_without_phone(client, db_session):
    headers = await _manager_headers(client, db_session)
    guest = User(full_name="Гость без телефона")
    db_session.add(guest)
    await db_session.flush()

    await register_and_login(client, "+79165559931")
    person = (await db_session.execute(select(User).where(User.phone == "+79165559931"))).scalar_one()
    org = await _create_org(client, headers, name="ООО Список", inn="7700000005")

    r = await client.get("/users/clients", headers=headers)
    assert r.status_code == 200
    ids = {x["id"] for x in r.json()}
    assert str(guest.id) not in ids
    assert str(person.id) in ids
    assert org["id"] in ids


@pytest.mark.asyncio
async def test_search_by_text_finds_org_and_hides_guests(client, db_session):
    headers = await _manager_headers(client, db_session)
    org = await _create_org(client, headers, name="ООО Ромашка Тест Поиск", inn="7700000006")
    guest = User(full_name="Ромашка Тест Поиск Гость")
    db_session.add(guest)
    await db_session.flush()

    r = await client.get("/bookings/manual/clients", params={"q": "ромашка тест поиск"}, headers=headers)
    assert r.status_code == 200
    rows = r.json()
    ids = [x["user_id"] for x in rows]
    assert org["id"] in ids
    assert str(guest.id) not in ids
    row = next(x for x in rows if x["user_id"] == org["id"])
    assert row["kind"] == "org"
    assert row["inn"] == "7700000006"
    assert row["phone"] is None


@pytest.mark.asyncio
async def test_search_by_plate_and_car(client, db_session):
    headers = await _manager_headers(client, db_session)
    await register_and_login(client, "+79165559951")
    person = (await db_session.execute(select(User).where(User.phone == "+79165559951"))).scalar_one()
    r = await client.post(
        f"/users/me/cars/by-user/{person.id}",
        json={"make": "Тестомарка", "model": "Крузак", "plate": "а777мр"},
        headers=headers,
    )
    assert r.status_code == 200

    # латиница в номере, кириллица, марка, марка+модель
    for q in ["a777mp", "а777", "тестомарка", "ТЕСТОМАРКА круз"]:
        r = await client.get("/bookings/manual/clients", params={"q": q}, headers=headers)
        assert r.status_code == 200
        row = next((x for x in r.json() if x["user_id"] == str(person.id)), None)
        assert row is not None, q
        assert row["phone"] == "+79165559951"
        assert row["cars"][0]["plate"] == "А777МР"


@pytest.mark.asyncio
async def test_manual_booking_for_org_with_plates(client, db_session):
    headers = await _manager_headers(client, db_session)
    org = await _create_org(client, headers, name="ООО Парк", inn="7700000007")
    post = Post(name="Пост орг", work_start="09:00", work_end="18:00", work_days="1111111")
    db_session.add(post)
    await db_session.flush()
    day = date.today() + timedelta(days=30)

    async def book(time, plate):
        r = await client.post(
            "/bookings/manual",
            json={
                "post_id": str(post.id),
                "date": str(day),
                "start_time": time,
                "duration_minutes": 30,
                "user_id": org["id"],
                "car_make": "Лада",
                "car_model": "Ларгус",
                "car_plate": plate,
            },
            headers=headers,
        )
        assert r.status_code == 200, r.text

    await book("10:00", "а111аа")
    await book("11:00", "в222вв")
    await book("12:00", "А111АА")  # та же машина, не дубль

    cars = await client.get(f"/users/me/cars/by-user/{org['id']}", headers=headers)
    assert sorted(c["plate"] for c in cars.json()) == ["А111АА", "В222ВВ"]

    history = await client.get(f"/users/clients/{org['id']}/bookings", headers=headers)
    assert sorted(b["car"]["plate"] for b in history.json()) == ["А111АА", "А111АА", "В222ВВ"]


@pytest.mark.asyncio
async def test_manual_booking_unknown_user_id(client, db_session):
    headers = await _manager_headers(client, db_session)
    post = Post(name="Пост орг 2", work_start="09:00", work_end="18:00", work_days="1111111")
    db_session.add(post)
    await db_session.flush()

    r = await client.post(
        "/bookings/manual",
        json={
            "post_id": str(post.id),
            "date": str(date.today() + timedelta(days=31)),
            "start_time": "10:00",
            "duration_minutes": 30,
            "user_id": str(uuid.uuid4()),
        },
        headers=headers,
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_org_login_from_name_is_unique(client, db_session):
    headers = await _manager_headers(client, db_session)
    a = await _create_org(client, headers, name="ООО «Тестовая Фирма Один»", inn="7700000008")
    b = await _create_org(client, headers, name="ИП Тестовая Фирма Один", inn="770000000009")
    assert a["login"] == "testovaya_firma_odin"
    assert b["login"] == "testovaya_firma_odin2"

    # вход не зависит от регистра
    r = await client.post("/auth/org-login", params={"login": a["login"].upper(), "password": a["password"]})
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_calendar_marks_guests(client, db_session):
    headers = await _manager_headers(client, db_session)
    org = await _create_org(client, headers, name="ООО Флаг Гость", inn="7700000010")
    post = Post(name="Пост гость", work_start="09:00", work_end="18:00", work_days="1111111")
    db_session.add(post)
    await db_session.flush()
    day = date.today() + timedelta(days=32)

    async def book(time, **extra):
        r = await client.post(
            "/bookings/manual",
            json={"post_id": str(post.id), "date": str(day), "start_time": time, "duration_minutes": 30, **extra},
            headers=headers,
        )
        assert r.status_code == 200, r.text
        return r.json()["id"]

    guest_id = await book("10:00", client_name="Иван")
    phone_id = await book("11:00", phone="+79165559973")
    org_booking_id = await book("12:00", user_id=org["id"])

    cal = await client.get("/bookings/calendar", params={"target_date": str(day)}, headers=headers)
    by_id = {
        s["booking"]["id"]: s["booking"]
        for p in cal.json()["posts"]
        for s in p["slots"]
        if s.get("booking")
    }
    assert by_id[guest_id]["is_guest"] is True
    assert by_id[phone_id]["is_guest"] is False
    assert by_id[org_booking_id]["is_guest"] is False

