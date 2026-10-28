"""Медиа чата: проверка по содержимому, сжатие, подписанные ссылки, хранилище.

Сейчас файлы лежат на диске сервера (LocalStorage). Для S3 достаточно заменить
класс хранилища: остальной код работает только через storage.put/path/delete."""

import asyncio
import io
import json
import time
from pathlib import Path

import jwt
from PIL import Image, ImageOps

from app.config import settings

MAX_IMAGE_BYTES = 25 * 1024 * 1024
MAX_VIDEO_BYTES = 100 * 1024 * 1024
MAX_VIDEO_SECONDS = 60
MAX_SIDE = 1920
THUMB_SIDE = 480
SIGNED_TTL = 24 * 3600

RUN_BACKGROUND = True  # в тестах выключается: обработку вызывают напрямую

Image.MAX_IMAGE_PIXELS = 60_000_000  # защита от «бомб» распаковки


class MediaError(Exception):
    """Понятная пользователю причина, почему файл не принят."""


class LocalStorage:
    def __init__(self, root: Path):
        self.root = root

    def path(self, key: str) -> Path:
        p = (self.root / key).resolve()
        if self.root.resolve() not in p.parents:
            raise MediaError("Недопустимый путь")
        return p

    def put(self, key: str, data: bytes) -> None:
        p = self.path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)

    def delete(self, key: str | None) -> None:
        if key:
            self.path(key).unlink(missing_ok=True)


storage = LocalStorage(Path(__file__).resolve().parents[1] / "chat_media")


# ---------- подписанные ссылки ----------

def sign_media(att_id) -> str:
    # срок округляется до часа: ссылка не меняется между запросами, браузер кэширует файл
    exp = (int(time.time()) // 3600 + 1) * 3600 + SIGNED_TTL
    return jwt.encode({"typ": "media", "a": str(att_id), "exp": exp}, settings.jwt_secret, algorithm="HS256")


def verify_media(token: str, att_id) -> bool:
    try:
        p = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        return False
    return p.get("typ") == "media" and p.get("a") == str(att_id)


# ---------- фото ----------

def _thumb_bytes(img: Image.Image) -> bytes:
    t = img.copy()
    t.thumbnail((THUMB_SIDE, THUMB_SIDE), Image.LANCZOS)
    buf = io.BytesIO()
    t.save(buf, "WEBP", quality=70, method=4)
    return buf.getvalue()


def process_image(data: bytes) -> dict:
    """JPEG/PNG/WebP -> WebP до 1920 px без EXIF + превью. Тип определяется по содержимому."""
    try:
        img = Image.open(io.BytesIO(data))
        if img.format not in ("JPEG", "PNG", "WEBP"):
            raise MediaError("Допустимы фото JPEG, PNG или WebP")
        img.load()
    except MediaError:
        raise
    except Exception:
        raise MediaError("Не удалось прочитать фото")
    img = ImageOps.exif_transpose(img)
    has_alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)
    img = img.convert("RGBA" if has_alpha else "RGB")
    img.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
    main = io.BytesIO()
    img.save(main, "WEBP", quality=80, method=4)  # EXIF не передаём — геометки и модель камеры не сохраняются
    return {"main": main.getvalue(), "thumb": _thumb_bytes(img), "width": img.width, "height": img.height}


# ---------- видео ----------

async def _run(*cmd: str, timeout: int):
    proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        raise MediaError("Обработка видео заняла слишком много времени")
    return proc.returncode, out, err


async def probe_video(path: Path) -> dict:
    code, out, _ = await _run(
        "ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path), timeout=30
    )
    if code != 0:
        raise MediaError("Не удалось прочитать видео")
    data = json.loads(out or b"{}")
    v = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), None)
    if v is None:
        raise MediaError("В файле нет видео")
    dur = float(data.get("format", {}).get("duration") or v.get("duration") or 0)
    return {"duration": dur, "width": int(v.get("width") or 0), "height": int(v.get("height") or 0)}


# короткая сторона не больше 720, размеры чётные
_VF = "scale='if(gt(iw,ih),-2,trunc(min(720,iw)/2)*2)':'if(gt(iw,ih),trunc(min(720,ih)/2)*2,-2)'"


async def transcode_video(src: Path, dst: Path) -> None:
    code, _, _ = await _run(
        "ffmpeg", "-y", "-v", "error", "-i", str(src), "-t", str(MAX_VIDEO_SECONDS + 1), "-vf", _VF,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "96k", "-ac", "2", "-movflags", "+faststart", "-f", "mp4", str(dst),
        timeout=900,
    )
    if code != 0 or not dst.exists():
        raise MediaError("Не удалось обработать видео")


async def make_poster(video: Path) -> bytes:
    tmp = video.with_suffix(".poster.jpg")
    try:
        for ss in ("0.5", "0"):
            code, _, _ = await _run(
                "ffmpeg", "-y", "-v", "error", "-ss", ss, "-i", str(video), "-frames:v", "1", str(tmp), timeout=60
            )
            if code == 0 and tmp.exists() and tmp.stat().st_size > 0:
                break
        else:
            raise MediaError("Не удалось сделать превью видео")

        def build() -> bytes:
            with Image.open(tmp) as im:
                im.load()
                return _thumb_bytes(im.convert("RGB"))

        return await asyncio.to_thread(build)
    finally:
        tmp.unlink(missing_ok=True)


# ---------- документы ----------

MAX_FILE_BYTES = MAX_IMAGE_BYTES  # 25 МБ

_ZIP = (b"PK\x03\x04", b"PK\x05\x06")
_OLE = (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",)
# расширение -> допустимое начало файла (None — обычный текст)
FILE_TYPES = {
    "pdf": (b"%PDF",),
    "docx": _ZIP, "xlsx": _ZIP, "pptx": _ZIP, "odt": _ZIP, "ods": _ZIP, "odp": _ZIP, "zip": _ZIP,
    "doc": _OLE, "xls": _OLE, "ppt": _OLE,
    "rar": (b"Rar!",),
    "7z": (b"7z\xbc\xaf\x27\x1c",),
    "rtf": (b"{\\rtf",),
    "txt": None, "csv": None,
}


def clean_filename(raw: str) -> str:
    name = raw.replace("\\", "/").split("/")[-1].strip()
    name = "".join(ch for ch in name if ch.isprintable())[:150].strip()
    if not name or "." not in name:
        raise MediaError("Не удалось определить имя или тип файла")
    return name


def check_file(name: str, head: bytes) -> None:
    ext = name.rsplit(".", 1)[-1].lower()
    if ext not in FILE_TYPES:
        raise MediaError("Такой тип файла отправлять нельзя")
    sigs = FILE_TYPES[ext]
    if sigs is None:
        if b"\x00" in head:
            raise MediaError("Файл не похож на текстовый")
    elif not head.startswith(sigs):
        raise MediaError("Содержимое файла не соответствует его типу")
