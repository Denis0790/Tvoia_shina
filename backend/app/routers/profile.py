import uuid
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.deps import require_manager
from app.models import User, ServiceProfile, ProfilePhoto, NewsItem

router = APIRouter(prefix="/profile", tags=["profile"])

UPLOAD_DIR = Path(__file__).resolve().parents[2] / "uploads"
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_PHOTOS = 24


def _detect_ext(data: bytes) -> str | None:
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


async def _save_image(request: Request) -> str:
    """Картинка приходит сырым телом запроса; тип определяем по содержимому, не по заголовку."""
    size = 0
    chunks = []
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_IMAGE_BYTES:
            raise HTTPException(status_code=413, detail="Файл больше 5 МБ")
        chunks.append(chunk)
    data = b"".join(chunks)
    ext = _detect_ext(data)
    if ext is None:
        raise HTTPException(status_code=400, detail="Нужна картинка JPG, PNG или WebP")
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}.{ext}"
    (UPLOAD_DIR / name).write_bytes(data)
    return f"/uploads/{name}"


def _remove_file(url: str | None) -> None:
    if url and url.startswith("/uploads/"):
        (UPLOAD_DIR / Path(url).name).unlink(missing_ok=True)


def _profile_dict(p: ServiceProfile) -> dict:
    return {
        k: getattr(p, k)
        for k in (
            "name", "tagline", "description", "phone", "address", "work_hours", "lat", "lng", "logo_url", "cover_url",
            "hero_title", "stats", "advantages", "steps", "reviews",
        )
    }


def _news_dict(n: NewsItem) -> dict:
    return {
        "id": str(n.id), "title": n.title, "body": n.body, "image_url": n.image_url,
        "created_at": n.created_at.isoformat() if n.created_at else None,
    }


async def _get_profile(db: AsyncSession) -> ServiceProfile:
    result = await db.execute(select(ServiceProfile).where(ServiceProfile.id == 1))
    p = result.scalar_one_or_none()
    if p is None:
        p = ServiceProfile(id=1, name="Твоя Шина")
        db.add(p)
        await db.commit()
    return p


@router.get("")
async def get_profile(db: AsyncSession = Depends(get_db)):
    """Публичная карточка сервиса: её увидят и менеджер (редактирует), и клиенты."""
    p = await _get_profile(db)
    photos = (await db.execute(select(ProfilePhoto).order_by(ProfilePhoto.created_at))).scalars().all()
    news = (await db.execute(select(NewsItem).order_by(NewsItem.created_at.desc()).limit(20))).scalars().all()
    return {
        "profile": _profile_dict(p),
        "photos": [{"id": str(x.id), "url": x.url} for x in photos],
        "news": [_news_dict(n) for n in news],
    }


LIST_FIELDS = ("stats", "advantages", "steps", "reviews")


class StatItem(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    value: str = Field(min_length=1, max_length=20)
    label: str = Field(min_length=1, max_length=60)


class TextItem(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    title: str = Field(min_length=1, max_length=80)
    text: str | None = Field(None, max_length=300)


class ReviewItem(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=60)
    text: str = Field(min_length=1, max_length=600)
    rating: int = Field(5, ge=1, le=5)
    car: str | None = Field(None, max_length=60)


class ProfileUpdate(BaseModel):
    name: str | None = Field(None, max_length=120)
    tagline: str | None = Field(None, max_length=200)
    description: str | None = Field(None, max_length=3000)
    phone: str | None = Field(None, max_length=40)
    address: str | None = Field(None, max_length=200)
    work_hours: str | None = Field(None, max_length=200)
    lat: float | None = Field(None, ge=-90, le=90)
    lng: float | None = Field(None, ge=-180, le=180)
    hero_title: str | None = Field(None, max_length=160)
    stats: list[StatItem] | None = Field(None, max_length=4)
    advantages: list[TextItem] | None = Field(None, max_length=4)
    steps: list[TextItem] | None = Field(None, max_length=5)
    reviews: list[ReviewItem] | None = Field(None, max_length=12)


@router.put("")
async def update_profile(payload: ProfileUpdate, manager: User = Depends(require_manager), db: AsyncSession = Depends(get_db)):
    p = await _get_profile(db)
    for key, value in payload.model_dump(exclude_unset=True).items():
        if isinstance(value, str):
            value = value.strip() or None
        if key in LIST_FIELDS:
            value = value or []
        if key == "name" and not value:
            raise HTTPException(status_code=400, detail="Название не может быть пустым")
        setattr(p, key, value)
    await db.commit()
    return _profile_dict(p)


@router.post("/image/{slot}")
async def upload_profile_image(
    slot: Literal["logo", "cover"], request: Request, manager: User = Depends(require_manager), db: AsyncSession = Depends(get_db)
):
    url = await _save_image(request)
    p = await _get_profile(db)
    old = getattr(p, f"{slot}_url")
    setattr(p, f"{slot}_url", url)
    await db.commit()
    _remove_file(old)
    return _profile_dict(p)


@router.delete("/image/{slot}")
async def delete_profile_image(slot: Literal["logo", "cover"], manager: User = Depends(require_manager), db: AsyncSession = Depends(get_db)):
    p = await _get_profile(db)
    old = getattr(p, f"{slot}_url")
    setattr(p, f"{slot}_url", None)
    await db.commit()
    _remove_file(old)
    return _profile_dict(p)


@router.post("/photos")
async def add_photo(request: Request, manager: User = Depends(require_manager), db: AsyncSession = Depends(get_db)):
    count = len((await db.execute(select(ProfilePhoto.id))).scalars().all())
    if count >= MAX_PHOTOS:
        raise HTTPException(status_code=400, detail=f"Не больше {MAX_PHOTOS} фото в галерее")
    url = await _save_image(request)
    photo = ProfilePhoto(id=uuid.uuid4(), url=url)
    db.add(photo)
    await db.commit()
    return {"id": str(photo.id), "url": photo.url}


@router.delete("/photos/{photo_id}")
async def delete_photo(photo_id: uuid.UUID, manager: User = Depends(require_manager), db: AsyncSession = Depends(get_db)):
    photo = (await db.execute(select(ProfilePhoto).where(ProfilePhoto.id == photo_id))).scalar_one_or_none()
    if photo is None:
        raise HTTPException(status_code=404, detail="Фото не найдено")
    url = photo.url
    await db.delete(photo)
    await db.commit()
    _remove_file(url)
    return {"ok": True}


class NewsPayload(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    body: str | None = Field(None, max_length=5000)


@router.post("/news")
async def create_news(payload: NewsPayload, manager: User = Depends(require_manager), db: AsyncSession = Depends(get_db)):
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Заголовок не может быть пустым")
    item = NewsItem(id=uuid.uuid4(), title=title, body=(payload.body or "").strip() or None)
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return _news_dict(item)


async def _get_news(db: AsyncSession, news_id: uuid.UUID) -> NewsItem:
    item = (await db.execute(select(NewsItem).where(NewsItem.id == news_id))).scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="Новость не найдена")
    return item


@router.put("/news/{news_id}")
async def update_news(news_id: uuid.UUID, payload: NewsPayload, manager: User = Depends(require_manager), db: AsyncSession = Depends(get_db)):
    item = await _get_news(db, news_id)
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Заголовок не может быть пустым")
    item.title = title
    item.body = (payload.body or "").strip() or None
    await db.commit()
    return _news_dict(item)


@router.post("/news/{news_id}/image")
async def upload_news_image(news_id: uuid.UUID, request: Request, manager: User = Depends(require_manager), db: AsyncSession = Depends(get_db)):
    item = await _get_news(db, news_id)
    url = await _save_image(request)
    old = item.image_url
    item.image_url = url
    await db.commit()
    _remove_file(old)
    return _news_dict(item)


@router.delete("/news/{news_id}")
async def delete_news(news_id: uuid.UUID, manager: User = Depends(require_manager), db: AsyncSession = Depends(get_db)):
    item = await _get_news(db, news_id)
    url = item.image_url
    await db.delete(item)
    await db.commit()
    _remove_file(url)
    return {"ok": True}
