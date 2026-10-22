import uuid
from datetime import date, datetime, time, timedelta

import pytest
from sqlalchemy import select

from app.models import Booking, Post, Service, User
from tests.conftest_helpers import register_and_login


async def _manager_headers(client, db_session, phone="+79165559921"):
    token = await register_and_login(client, phone)
    await db_session.execute(User.__table__.update().where(User.phone == phone).values(role="manager"))
    await db_session.flush()
    return {"Authorization": f"Bearer {token}"}


async def _person(client, db_session, phone):
    token = await register_and_login(client, phone)
    user = (await db_session.execute(select(User).where(User.phone == phone))).scalar_one()
    return user, {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_manager_adds_car_to_client_with_clean_plate(client, db_session):
    mh = await _manager_headers(client, db_session)
    person, ph = await _person(client, db_session, "+79165559922")

    r = await client.post(
        f"/users/me/cars/by-user/{person.id}",
        json={"make": " Лада ", "model": "Ларгус", "plate": " а123вс ", "vin": "", "color": None},
        headers=mh,
    )
    assert r.status_code == 200, r.text
    car = r.json()
    assert car["make"] == "Лада"
    assert car["plate"] == "А123ВС"
    assert car["vin"] is None

    # у клиента машина появилась в его кабинете
    mine = await client.get("/users/me/cars", headers=ph)
    assert [c["id"] for c in mine.json()] == [car["id"]]

    listed = await client.get(f"/users/me/cars/by-user/{person.id}", headers=mh)
    assert listed.json()[0]["plate"] == "А123ВС"


@pytest.mark.asyncio
async def test_add_car_requires_manager_and_existing_client(client, db_session):
    mh = await _manager_headers(client, db_session)
    person, ph = await _person(client, db_session, "+79165559923")

    r = await client.post(f"/users/me/cars/by-user/{person.id}", json={"make": "A", "model": "B"}, headers=ph)
    assert r.status_code in (401, 403)

    r = await client.post(f"/users/me/cars/by-user/{uuid.uuid4()}", json={"make": "A", "model": "B"}, headers=mh)
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_car_validation(client, db_session):
    mh = await _manager_headers(client, db_session)
    person, _ = await _person(client, db_session, "+79165559924")
    url = f"/users/me/cars/by-user/{person.id}"

    r = await client.post(url, json={"make": "  ", "model": "B"}, headers=mh)
    assert r.status_code == 400
    r = await client.post(url, json={"make": "A", "model": "B", "vin": "1" * 18}, headers=mh)
    assert r.status_code == 400
    r = await client.post(url, json={"make": "A", "model": "B", "plate": "X" * 21}, headers=mh)
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_update_car_by_manager_and_by_owner(client, db_session):
    mh = await _manager_headers(client, db_session)
    person, ph = await _person(client, db_session, "+79165559925")
    other, oh = await _person(client, db_session, "+79165559926")

    r = await client.post(f"/users/me/cars/by-user/{person.id}", json={"make": "Лада", "model": "Ларгус"}, headers=mh)
    car_id = r.json()["id"]

    # менеджер дописывает гос. номер
    r = await client.put(
        f"/users/me/cars/by-user/{person.id}/{car_id}",
        json={"make": "Лада", "model": "Ларгус", "plate": "к777кк"},
        headers=mh,
    )
    assert r.status_code == 200
    assert r.json()["plate"] == "К777КК"

    # владелец правит свою
    r = await client.put(
        f"/users/me/cars/{car_id}", json={"make": "Лада", "model": "Ларгус", "color": "белый", "plate": "К777КК"}, headers=ph
    )
    assert r.status_code == 200
    assert r.json()["color"] == "белый"

    # чужой клиент не может
    r = await client.put(f"/users/me/cars/{car_id}", json={"make": "X", "model": "Y"}, headers=oh)
    assert r.status_code == 404
    # менеджер с чужим user_id тоже не находит
    r = await client.put(f"/users/me/cars/by-user/{other.id}/{car_id}", json={"make": "X", "model": "Y"}, headers=mh)
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_client_booking_history(client, db_session):
    mh = await _manager_headers(client, db_session)
    person, _ = await _person(client, db_session, "+79165559927")

    r = await client.post(
        f"/users/me/cars/by-user/{person.id}", json={"make": "Лада", "model": "Ларгус", "plate": "А111АА"}, headers=mh
    )
    car_a = r.json()["id"]
    r = await client.post(
        f"/users/me/cars/by-user/{person.id}", json={"make": "Лада", "model": "Ларгус", "plate": "В222ВВ"}, headers=mh
    )
    car_b = r.json()["id"]

    post = Post(name="Пост история", work_start="09:00", work_end="18:00", work_days="1111111")
    service = Service(name="Замена масла история", duration_minutes=60)
    db_session.add_all([post, service])
    await db_session.flush()

    old_day = date.today() - timedelta(days=30)
    new_day = date.today() + timedelta(days=5)
    db_session.add_all(
        [
            Booking(
                user_id=person.id,
                car_id=uuid.UUID(car_a),
                post_id=post.id,
                date=datetime.combine(old_day, time()),
                start_time="10:00",
                duration_minutes=60,
                status="confirmed",
                comment="ТО-1",
                services=[service],
            ),
            Booking(
                user_id=person.id,
                car_id=uuid.UUID(car_b),
                post_id=post.id,
                date=datetime.combine(new_day, time()),
                start_time="12:00",
                duration_minutes=30,
                status="pending",
            ),
        ]
    )
    await db_session.flush()

    r = await client.get(f"/users/clients/{person.id}/bookings", headers=mh)
    assert r.status_code == 200, r.text
    rows = r.json()
    assert [x["date"] for x in rows] == [str(new_day), str(old_day)]  # новые сверху

    new_row, old_row = rows
    assert new_row["car"]["plate"] == "В222ВВ"
    assert new_row["services"] == []
    assert old_row["car"]["plate"] == "А111АА"
    assert old_row["post_name"] == "Пост история"
    assert old_row["comment"] == "ТО-1"
    assert [s["name"] for s in old_row["services"]] == ["Замена масла история"]
    assert old_row["status"] == "confirmed"


@pytest.mark.asyncio
async def test_client_history_access(client, db_session):
    mh = await _manager_headers(client, db_session)
    person, ph = await _person(client, db_session, "+79165559928")

    r = await client.get(f"/users/clients/{person.id}/bookings", headers=ph)
    assert r.status_code in (401, 403)

    r = await client.get(f"/users/clients/{uuid.uuid4()}/bookings", headers=mh)
    assert r.status_code == 404

    r = await client.get(f"/users/clients/{person.id}/bookings", headers=mh)
    assert r.status_code == 200
    assert r.json() == []
