import uuid
from datetime import datetime, timedelta

import pytest

from app.models import Booking, Post, Service, User
from app.routers.bookings import _today_msk
from tests.conftest_helpers import register_and_login

Q = "?period=custom&date_from=2030-02-01&date_to=2030-02-28"


async def _manager(client, db_session, phone):
    token = await register_and_login(client, phone)
    await db_session.execute(User.__table__.update().where(User.phone == phone).values(role="manager"))
    await db_session.flush()
    return {"Authorization": f"Bearer {token}"}


async def _client_user(client, phone):
    token = await register_and_login(client, phone)
    h = {"Authorization": f"Bearer {token}"}
    me = (await client.get("/users/me", headers=h)).json()
    return uuid.UUID(me["id"]), h


@pytest.mark.asyncio
async def test_stats_numbers(client, db_session):
    mh = await _manager(client, db_session, "+79165559001")
    uid, _ = await _client_user(client, "+79165559002")
    a = Post(name="Тест А", work_start="09:00", work_end="17:00", work_days="1111100")
    b = Post(name="Тест Б", work_start="09:00", work_end="17:00", work_days="1111100")
    s1 = Service(name="Тест-шиномонтаж", duration_minutes=60)
    s2 = Service(name="Тест-балансировка", duration_minutes=120)
    db_session.add_all([a, b, s1, s2])
    await db_session.flush()
    grp = uuid.uuid4()

    def bk(post, day, start, minutes, status="confirmed", services=(), text=None, part=0, group=None):
        row = Booking(
            user_id=uid, post_id=post.id, date=datetime(2030, 2, day), start_time=start, duration_minutes=minutes,
            status=status, services_text=text, part=part, group_id=group,
        )
        row.services = list(services)
        return row

    db_session.add_all([
        bk(a, 4, "10:00", 60, services=[s1]),
        bk(a, 5, "10:00", 60, services=[s1]),
        bk(a, 6, "10:00", 120, services=[s2]),
        bk(a, 7, "10:00", 60, status="cancelled", services=[s1]),
        bk(a, 8, "10:00", 60, status="pending", services=[s1]),
        bk(a, 13, "10:00", 480, group=grp),
        bk(a, 14, "09:00", 120, part=1, group=grp),
        bk(b, 11, "11:00", 90, text="Заварить глушитель"),
        bk(b, 12, "11:00", 30),
    ])
    await db_session.flush()

    d = (await client.get("/stats" + Q, headers=mh)).json()
    o = d["overview"]
    assert (o["confirmed"], o["pending"], o["cancelled"]) == (6, 1, 1)
    assert o["cancel_rate"] == 12.5 and o["hours"] == 16.0 and o["new_clients"] == 0

    posts = {p["id"]: p for p in d["posts"]}
    pa, pb = posts[str(a.id)], posts[str(b.id)]
    assert (pa["bookings"], pa["hours"], pa["cancelled"]) == (4, 14.0, 1)  # длинная запись — одна, часы за оба дня
    assert (pb["bookings"], pb["hours"], pb["cancelled"]) == (2, 2.0, 0)
    assert abs(pa["load"] - 8.75) < 0.06 and abs(pb["load"] - 1.25) < 0.06  # 20 рабочих дней по 8 ч
    assert pa["top_services"][0] == {"name": "Тест-шиномонтаж", "count": 2}

    assert [(x["name"], x["count"], x["hours"], x["share"]) for x in d["services"]] == [
        ("Тест-шиномонтаж", 2, 2.0, 66.7),
        ("Тест-балансировка", 1, 2.0, 33.3),
    ]
    assert d["other"] == {"count": 1, "no_services": 2, "items": [{"text": "Заварить глушитель", "count": 1}]}

    s = d["series"]
    assert s["granularity"] == "day" and len(s["points"]) == 28
    assert sum(p["count"] for p in s["points"]) == 6
    assert [p for p in s["points"] if p["label"] == "2030-02-04"][0]["count"] == 1

    # фильтр по посту: сводка, услуги и «Другое» — только по нему, список постов остаётся полным
    f = (await client.get("/stats" + Q + f"&post_id={a.id}", headers=mh)).json()
    assert f["overview"]["confirmed"] == 4 and f["overview"]["hours"] == 14.0
    assert [x["count"] for x in f["services"]] == [2, 1] and f["other"]["items"] == []
    assert sum(p["count"] for p in f["series"]["points"]) == 4
    assert str(b.id) in {p["id"] for p in f["posts"]}


@pytest.mark.asyncio
async def test_stats_rules(client, db_session):
    mh = await _manager(client, db_session, "+79165559011")
    _, ch = await _client_user(client, "+79165559012")

    assert (await client.get("/stats", headers=ch)).status_code == 403
    assert (await client.get("/stats?period=custom", headers=mh)).status_code == 400
    assert (await client.get("/stats?period=custom&date_from=2030-03-01&date_to=2030-02-01", headers=mh)).status_code == 400
    assert (await client.get(f"/stats?period=month&post_id={uuid.uuid4()}", headers=mh)).status_code == 404
    assert (await client.get("/stats?period=bad", headers=mh)).status_code == 422

    today = _today_msk()
    r = await client.get("/stats?period=month", headers=mh)
    assert r.status_code == 200
    assert r.json()["range"] == {"from": today.replace(day=1).isoformat(), "to": today.isoformat(), "period": "month"}
    first = today.replace(day=1)
    for _ in range(2):
        first = (first - timedelta(days=1)).replace(day=1)
    r3 = await client.get("/stats?period=3months", headers=mh)
    assert r3.status_code == 200 and r3.json()["range"]["from"] == first.isoformat()
    assert (await client.get("/stats?period=all", headers=mh)).status_code == 200
