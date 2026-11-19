from pathlib import Path

import pytest
from sqlalchemy import select

from app import media
from app.media import S3Storage
from app.models.chat import ChatAttachment, Conversation
from app.models.user import User
from tests.conftest_helpers import register_and_login


class FakeS3:
    def __init__(self):
        self.objects = {}
        self.fail_delete = False

    def put_object(self, Bucket, Key, Body, ContentType):
        self.objects[Key] = (Body, ContentType)

    def upload_file(self, Filename, Bucket, Key, ExtraArgs=None):
        self.objects[Key] = (Path(Filename).read_bytes(), (ExtraArgs or {}).get("ContentType"))

    def delete_object(self, Bucket, Key):
        if self.fail_delete:
            raise RuntimeError("s3 недоступен")
        self.objects.pop(Key, None)

    def generate_presigned_url(self, op, Params, ExpiresIn):
        return f"https://s3.test/{Params['Bucket']}/{Params['Key']}"


def make(tmp_path):
    fake = FakeS3()
    return S3Storage(tmp_path, fake, "bkt"), fake


def test_put_goes_to_s3_not_disk(tmp_path):
    st, fake = make(tmp_path)
    st.put("c/a.webp", b"img")
    assert fake.objects["c/a.webp"] == (b"img", "image/webp")
    assert not st.path("c/a.webp").exists()


def test_put_file_uploads_and_removes_local(tmp_path):
    st, fake = make(tmp_path)
    src = st.path("c/x.upload")
    src.parent.mkdir(parents=True)
    src.write_bytes(b"doc")
    st.put_file("c/x.bin", src)
    assert fake.objects["c/x.bin"][0] == b"doc"
    assert not src.exists()
    assert not st.path("c/x.bin").exists()


def test_publish_moves_working_file_to_s3(tmp_path):
    st, fake = make(tmp_path)
    p = st.path("c/v.mp4")
    p.parent.mkdir(parents=True)
    p.write_bytes(b"video")
    st.publish("c/v.mp4")
    assert fake.objects["c/v.mp4"] == (b"video", "video/mp4")
    assert not p.exists()


def test_delete_removes_from_s3_and_survives_s3_error(tmp_path):
    st, fake = make(tmp_path)
    st.put("c/a.webp", b"img")
    st.delete("c/a.webp")
    assert "c/a.webp" not in fake.objects
    fake.fail_delete = True
    st.delete("c/b.webp")  # ошибка S3 не должна ронять удаление сообщения


def test_without_s3_nothing_changes(tmp_path):
    st = S3Storage(tmp_path, None, "")
    st.put("c/a.webp", b"img")
    assert st.path("c/a.webp").read_bytes() == b"img"
    assert st.presigned_url("c/a.webp", "image/webp") is None


async def test_media_redirects_to_s3_when_not_on_disk(client, db_session, tmp_path, monkeypatch):
    st, _ = make(tmp_path)
    monkeypatch.setattr(media, "storage", st)
    phone = "+79990004321"
    await register_and_login(client, phone)
    user = (await db_session.execute(select(User).where(User.phone == phone))).scalar_one()
    conv = Conversation(client_id=user.id)
    db_session.add(conv)
    await db_session.flush()
    att = ChatAttachment(conversation_id=conv.id, kind="image", status="ready", main_key=f"{conv.id}/a.webp")
    db_session.add(att)
    await db_session.flush()
    r = await client.get(f"/chat/media/{att.id}/main", params={"t": media.sign_media(att.id)}, follow_redirects=False)
    assert r.status_code == 302
    assert r.headers["location"].startswith("https://s3.test/bkt/")
