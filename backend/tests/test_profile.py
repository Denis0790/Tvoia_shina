import pytest

from app.models import User
from tests.conftest_helpers import register_and_login

PNG = b"\x89PNG\r\n\x1a\n" + b"x" * 32


async def _mgr(client, db_session, phone):
    token = await register_and_login(client, phone)
    await db_session.execute(User.__table__.update().where(User.phone == phone).values(role="manager"))
    await db_session.flush()
    return {"Authorization": f"Bearer {token}"}


def _img(headers):
    return {**headers, "Content-Type": "image/png"}


@pytest.fixture
def uploads(tmp_path, monkeypatch):
    monkeypatch.setattr("app.routers.profile.UPLOAD_DIR", tmp_path)
    return tmp_path


@pytest.mark.asyncio
async def test_profile_is_public_and_editing_requires_manager(client, db_session):
    r = await client.get("/profile")
    assert r.status_code == 200
    assert {"profile", "photos", "news"} <= set(r.json())

    token = await register_and_login(client, "+79165559990")
    r_forbidden = await client.put("/profile", json={"name": "Хак"}, headers={"Authorization": f"Bearer {token}"})
    assert r_forbidden.status_code == 403


@pytest.mark.asyncio
async def test_manager_updates_profile(client, db_session):
    headers = await _mgr(client, db_session, "+79165559991")
    r = await client.put(
        "/profile",
        json={"name": "  Шина Плюс  ", "tagline": "Быстро и честно", "phone": "+7 900 000-00-00", "lat": 55.75, "lng": 37.61, "address": ""},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    got = (await client.get("/profile")).json()["profile"]
    assert got["name"] == "Шина Плюс" and got["tagline"] == "Быстро и честно"
    assert got["lat"] == 55.75 and got["address"] is None

    assert (await client.put("/profile", json={"name": "  "}, headers=headers)).status_code == 400
    assert (await client.put("/profile", json={"lat": 123}, headers=headers)).status_code == 422


@pytest.mark.asyncio
async def test_logo_upload_replaces_old_file(client, db_session, uploads):
    headers = await _mgr(client, db_session, "+79165559992")
    r1 = await client.post("/profile/image/logo", content=PNG, headers=_img(headers))
    assert r1.status_code == 200, r1.text
    url1 = r1.json()["logo_url"]
    assert url1.startswith("/uploads/") and (uploads / url1.split("/")[-1]).exists()

    r2 = await client.post("/profile/image/logo", content=PNG, headers=_img(headers))
    url2 = r2.json()["logo_url"]
    assert url2 != url1
    assert not (uploads / url1.split("/")[-1]).exists() and (uploads / url2.split("/")[-1]).exists()

    r3 = await client.delete("/profile/image/logo", headers=headers)
    assert r3.json()["logo_url"] is None and not (uploads / url2.split("/")[-1]).exists()


@pytest.mark.asyncio
async def test_upload_rejects_non_images_and_big_files(client, db_session, uploads):
    headers = await _mgr(client, db_session, "+79165559993")
    r_txt = await client.post("/profile/image/cover", content=b"hello world", headers=_img(headers))
    assert r_txt.status_code == 400
    r_svg = await client.post("/profile/image/cover", content=b"<svg onload=alert(1)></svg>", headers=_img(headers))
    assert r_svg.status_code == 400
    r_big = await client.post("/profile/image/cover", content=PNG + b"0" * (5 * 1024 * 1024), headers=_img(headers))
    assert r_big.status_code == 413
    assert list(uploads.iterdir()) == []


@pytest.mark.asyncio
async def test_gallery_add_and_delete(client, db_session, uploads):
    headers = await _mgr(client, db_session, "+79165559994")
    r = await client.post("/profile/photos", content=PNG, headers=_img(headers))
    assert r.status_code == 200, r.text
    photo = r.json()
    assert photo["id"] in [p["id"] for p in (await client.get("/profile")).json()["photos"]]

    assert (await client.delete(f"/profile/photos/{photo['id']}", headers=headers)).status_code == 200
    assert photo["id"] not in [p["id"] for p in (await client.get("/profile")).json()["photos"]]
    assert list(uploads.iterdir()) == []
    assert (await client.delete(f"/profile/photos/{photo['id']}", headers=headers)).status_code == 404


@pytest.mark.asyncio
async def test_news_crud(client, db_session, uploads):
    headers = await _mgr(client, db_session, "+79165559995")
    r = await client.post("/profile/news", json={"title": "Скидка на хранение", "body": "до конца месяца"}, headers=headers)
    assert r.status_code == 200, r.text
    nid = r.json()["id"]

    r_up = await client.put(f"/profile/news/{nid}", json={"title": "Скидка 20%", "body": None}, headers=headers)
    assert r_up.json()["title"] == "Скидка 20%" and r_up.json()["body"] is None

    r_img = await client.post(f"/profile/news/{nid}/image", content=PNG, headers=_img(headers))
    assert r_img.json()["image_url"].startswith("/uploads/")

    listed = (await client.get("/profile")).json()["news"]
    assert nid in [n["id"] for n in listed]

    assert (await client.delete(f"/profile/news/{nid}", headers=headers)).status_code == 200
    assert nid not in [n["id"] for n in (await client.get("/profile")).json()["news"]]
    assert list(uploads.iterdir()) == []
    assert (await client.post("/profile/news", json={"title": "   "}, headers=headers)).status_code == 400


@pytest.mark.asyncio
async def test_storefront_blocks_roundtrip_and_validation(client, db_session):
    headers = await _mgr(client, db_session, "+79165559989")
    body = {
        "hero_title": "  Шины и сервис без сюрпризов  ",
        "stats": [{"value": "12 лет", "label": "на рынке"}, {"value": "5 000+", "label": "машин в год"}],
        "advantages": [{"title": "Гарантия на работы", "text": "12 месяцев"}],
        "steps": [{"title": "Записываетесь онлайн", "text": None}],
        "reviews": [{"name": "Алексей", "text": "Быстро поменяли резину", "rating": 5, "car": "Kia Rio"}],
    }
    r = await client.put("/profile", json=body, headers=headers)
    assert r.status_code == 200, r.text

    got = (await client.get("/profile")).json()["profile"]
    assert got["hero_title"] == "Шины и сервис без сюрпризов"
    assert [s["value"] for s in got["stats"]] == ["12 лет", "5 000+"]
    assert got["advantages"][0]["title"] == "Гарантия на работы"
    assert got["reviews"][0]["rating"] == 5 and got["reviews"][0]["car"] == "Kia Rio"

    too_many = {"stats": [{"value": str(i), "label": "x"} for i in range(5)]}
    assert (await client.put("/profile", json=too_many, headers=headers)).status_code == 422
    bad_rating = {"reviews": [{"name": "А", "text": "Т", "rating": 6}]}
    assert (await client.put("/profile", json=bad_rating, headers=headers)).status_code == 422
    assert (await client.put("/profile", json={"stats": [{"value": "  ", "label": "x"}]}, headers=headers)).status_code == 422

    # другие поля не затираются, блоки очищаются пустым списком
    await client.put("/profile", json={"stats": [], "reviews": None}, headers=headers)
    got = (await client.get("/profile")).json()["profile"]
    assert got["stats"] == [] and got["reviews"] == [] and got["advantages"]
