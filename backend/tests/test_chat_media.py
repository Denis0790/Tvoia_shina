import io
import os
import shutil
import subprocess
import uuid
from datetime import timedelta

import pytest
from PIL import Image
from sqlalchemy import select

from app import media
from app.models import User
from app.models.chat import ChatAttachment, Message
from app.routers import chat as chat_router
from tests.conftest_helpers import register_and_login


@pytest.fixture(autouse=True)
def _tmp_media(tmp_path, monkeypatch):
    monkeypatch.setattr(media.storage, "root", tmp_path / "media")
    monkeypatch.setattr(media, "RUN_BACKGROUND", False)


async def _client(client, phone):
    token = await register_and_login(client, phone)
    headers = {"Authorization": f"Bearer {token}"}
    me = (await client.get("/users/me", headers=headers)).json()
    return headers, uuid.UUID(me["id"])


async def _manager(client, db_session, phone):
    token = await register_and_login(client, phone)
    await db_session.execute(User.__table__.update().where(User.phone == phone).values(role="manager"))
    await db_session.flush()
    return {"Authorization": f"Bearer {token}"}


async def _conv(client, headers):
    return (await client.get("/chat/conversations/mine", headers=headers)).json()["id"]


async def _upload(client, headers, conv_id, data, ctype):
    return await client.post(
        f"/chat/conversations/{conv_id}/attachments", content=data, headers={**headers, "Content-Type": ctype}
    )


def _jpeg(w=3000, h=2000, exif=False):
    buf = io.BytesIO()
    kwargs = {}
    if exif:
        e = Image.Exif()
        e[0x010F] = "SecretCamera"
        kwargs["exif"] = e
    Image.new("RGB", (w, h), (200, 30, 30)).save(buf, "JPEG", **kwargs)
    return buf.getvalue()


@pytest.mark.asyncio
async def test_photo_is_converted_and_served(client, db_session):
    ch, _ = await _client(client, "+79165557001")
    mh = await _manager(client, db_session, "+79165557002")
    conv_id = await _conv(client, ch)

    r = await _upload(client, ch, conv_id, _jpeg(exif=True), "image/jpeg")
    assert r.status_code == 200
    att = r.json()
    assert (att["kind"], att["status"], att["width"], att["height"]) == ("image", "ready", 1920, 1280)

    sent = await client.post(f"/chat/conversations/{conv_id}/messages", json={"attachment_ids": [att["id"]]}, headers=ch)
    assert sent.status_code == 200
    assert sent.json()["text"] == ""
    assert sent.json()["attachments"][0]["id"] == att["id"]
    listing = (await client.get("/chat/conversations", headers=mh)).json()
    assert [c for c in listing if c["id"] == conv_id][0]["last_message"] == "📷 Фото"

    url = sent.json()["attachments"][0]["url"]
    main = await client.get(url)
    assert main.status_code == 200 and main.headers["content-type"] == "image/webp"
    img = Image.open(io.BytesIO(main.content))
    assert img.size == (1920, 1280)
    assert len(img.getexif()) == 0  # метаданные камеры не сохранены

    thumb = await client.get(sent.json()["attachments"][0]["thumb_url"])
    assert max(Image.open(io.BytesIO(thumb.content)).size) <= 480

    part = await client.get(url, headers={"Range": "bytes=0-9"})
    assert part.status_code == 206 and len(part.content) == 10
    assert part.headers["content-range"].startswith("bytes 0-9/")

    assert (await client.get(url.split("?t=")[0] + "?t=nope")).status_code == 403
    assert (await client.get(url.split("?t=")[0].replace(att["id"], str(uuid.uuid4())) + "?t=" + url.split("?t=")[1])).status_code == 403


@pytest.mark.asyncio
async def test_upload_rules(client, db_session, monkeypatch):
    ch, _ = await _client(client, "+79165557011")
    other, _ = await _client(client, "+79165557012")
    conv_id = await _conv(client, ch)
    other_conv = await _conv(client, other)

    assert (await _upload(client, ch, conv_id, b"hello", "text/plain")).status_code == 400  # документ без имени
    assert (await _upload(client, ch, conv_id, os.urandom(500), "image/jpeg")).status_code == 400
    assert (await _upload(client, ch, conv_id, b"\x00" * 64, "video/mp4")).status_code == 400
    assert (await _upload(client, other, conv_id, _jpeg(200, 100), "image/jpeg")).status_code == 404  # чужой диалог

    att = (await _upload(client, ch, conv_id, _jpeg(200, 100), "image/jpeg")).json()
    # чужое вложение нельзя прикрепить к своему сообщению
    stolen = await client.post(f"/chat/conversations/{other_conv}/messages", json={"attachment_ids": [att["id"]]}, headers=other)
    assert stolen.status_code == 400

    monkeypatch.setattr(chat_router, "DAILY_ATTACH_LIMIT", 1)
    assert (await _upload(client, ch, conv_id, _jpeg(200, 100), "image/jpeg")).status_code == 429


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="нет ffmpeg")
@pytest.mark.asyncio
async def test_video_pipeline(client, db_session, tmp_path):
    ch, _ = await _client(client, "+79165557021")
    mh = await _manager(client, db_session, "+79165557022")
    conv_id = await _conv(client, ch)

    src = tmp_path / "in.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=15:duration=2",
         "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-shortest", str(src)],
        check=True, capture_output=True,
    )
    r = await _upload(client, ch, conv_id, src.read_bytes(), "video/mp4")
    assert r.status_code == 200 and r.json()["status"] == "processing" and "url" not in r.json()
    await chat_router.process_video_attachment(db_session, uuid.UUID(r.json()["id"]))

    # битое видео с правильной «шапкой» отбраковывается при обработке
    bad = await _upload(client, ch, conv_id, b"\x00\x00\x00\x18ftypmp42" + os.urandom(500), "video/mp4")
    assert bad.status_code == 200
    await chat_router.process_video_attachment(db_session, uuid.UUID(bad.json()["id"]))

    sent = await client.post(
        f"/chat/conversations/{conv_id}/messages", json={"attachment_ids": [r.json()["id"], bad.json()["id"]]}, headers=ch
    )
    assert sent.status_code == 200
    good, broken = (await client.get(f"/chat/conversations/{conv_id}/messages", headers=mh)).json()["messages"][0]["attachments"]
    assert (good["kind"], good["status"], good["width"], good["height"]) == ("video", "ready", 1280, 720)
    assert 1500 <= good["duration_ms"] <= 2600
    assert broken["status"] == "failed" and "url" not in broken

    part = await client.get(good["url"], headers={"Range": "bytes=0-99"})
    assert part.status_code == 206 and part.headers["content-type"] == "video/mp4" and len(part.content) == 100
    poster = await client.get(good["thumb_url"])
    assert poster.headers["content-type"] == "image/webp"
    listing = (await client.get("/chat/conversations", headers=mh)).json()
    assert [c for c in listing if c["id"] == conv_id][0]["last_message"] == "🎥 Видео"


@pytest.mark.asyncio
async def test_cleanup_media(client, db_session):
    ch, user_id = await _client(client, "+79165557031")
    conv_id = await _conv(client, ch)
    conv = uuid.UUID(conv_id)
    now = chat_router._utcnow()

    def put(att_id):
        key = f"{conv_id}/{att_id}.webp"
        media.storage.put(key, b"x")
        return key

    def att(created, message_id=None, status="ready", key=True):
        aid = uuid.uuid4()
        return ChatAttachment(
            id=aid, conversation_id=conv, uploader_id=user_id, kind="image", status=status, message_id=message_id,
            main_key=put(aid) if key else None, created_at=created,
        )

    old_orphan = att(now - timedelta(hours=48))
    fresh_orphan = att(now - timedelta(hours=1))
    stuck = att(now - timedelta(hours=2), status="processing", key=False)
    old_msg = Message(id=uuid.uuid4(), conversation_id=conv, sender_id=user_id, sender_role="client", text="давно",
                      created_at=now - timedelta(days=365 * 3 + 5))
    new_msg = Message(id=uuid.uuid4(), conversation_id=conv, sender_id=user_id, sender_role="client", text="недавно", created_at=now)
    db_session.add_all([old_orphan, fresh_orphan, stuck, old_msg, new_msg])
    await db_session.flush()
    old_att = att(now - timedelta(days=365 * 3 + 5), message_id=old_msg.id)
    db_session.add(old_att)
    await db_session.flush()

    result = await chat_router.cleanup_media(db_session)
    assert result["orphans"] == 1 and result["stuck"] == 1 and result["old_messages"] == 1

    assert not media.storage.path(old_orphan.main_key).exists()
    assert media.storage.path(fresh_orphan.main_key).exists()
    assert not media.storage.path(old_att.main_key).exists()
    texts = [m.text for m in (await db_session.execute(select(Message).where(Message.conversation_id == conv))).scalars().all()]
    assert texts == ["недавно"]
    assert (await db_session.execute(select(ChatAttachment.status).where(ChatAttachment.id == stuck.id))).scalar_one() == "failed"


@pytest.mark.asyncio
async def test_file_attachments(client, db_session):
    from urllib.parse import quote

    ch, _ = await _client(client, "+79165557041")
    mh = await _manager(client, db_session, "+79165557042")
    conv_id = await _conv(client, ch)
    name = "Счёт №5.pdf"
    pdf = b"%PDF-1.4\n" + b"x" * 100

    async def up(data, fname, ctype="application/octet-stream"):
        return await client.post(
            f"/chat/conversations/{conv_id}/attachments",
            content=data,
            headers={**ch, "Content-Type": ctype, "X-File-Name": quote(fname)},
        )

    r = await up(pdf, name, "application/pdf")
    assert r.status_code == 200
    att = r.json()
    assert (att["kind"], att["status"], att["name"]) == ("file", "ready", name)
    assert "thumb_url" not in att

    assert (await up(b"MZ" + b"\x00" * 50, "run.exe")).status_code == 400  # исполняемые нельзя
    assert (await up(os.urandom(200), "fake.pdf")).status_code == 400  # содержимое не PDF
    assert (await up(pdf, "noext")).status_code == 400

    sent = await client.post(f"/chat/conversations/{conv_id}/messages", json={"attachment_ids": [att["id"]]}, headers=ch)
    assert sent.status_code == 200
    listing = (await client.get("/chat/conversations", headers=mh)).json()
    assert [c for c in listing if c["id"] == conv_id][0]["last_message"] == "📎 " + name

    got = await client.get(sent.json()["attachments"][0]["url"])
    assert got.status_code == 200 and got.content == pdf
    assert got.headers["content-disposition"].startswith("attachment;") and "%D0%A1" in got.headers["content-disposition"]


@pytest.mark.asyncio
async def test_file_name_from_query(client):
    from urllib.parse import quote

    ch, _ = await _client(client, "+79165557051")
    conv_id = await _conv(client, ch)
    r = await client.post(
        f"/chat/conversations/{conv_id}/attachments?name={quote('Акт.txt')}",
        content=b"hello",
        headers={**ch, "Content-Type": "text/plain"},
    )
    assert r.status_code == 200 and r.json()["name"] == "Акт.txt"
