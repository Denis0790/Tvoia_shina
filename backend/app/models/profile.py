import uuid
from datetime import datetime
from sqlalchemy import String, Text, Float, Integer, DateTime, func, text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID, JSONB
from app.database import Base


class ServiceProfile(Base):
    """Карточка сервиса — одна строка (id=1): то, что клиенты увидят у себя."""

    __tablename__ = "service_profile"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    name: Mapped[str] = mapped_column(String(120), default="Твоя Шина")
    tagline: Mapped[str | None] = mapped_column(String(200), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    address: Mapped[str | None] = mapped_column(String(200), nullable=True)
    work_hours: Mapped[str | None] = mapped_column(String(200), nullable=True)
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    logo_url: Mapped[str | None] = mapped_column(String(300), nullable=True)
    cover_url: Mapped[str | None] = mapped_column(String(300), nullable=True)
    # витрина: заголовок первого экрана и блоки (списки небольших объектов)
    hero_title: Mapped[str | None] = mapped_column(String(160), nullable=True)
    stats: Mapped[list] = mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))
    advantages: Mapped[list] = mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))
    steps: Mapped[list] = mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))
    reviews: Mapped[list] = mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))


class ProfilePhoto(Base):
    __tablename__ = "profile_photos"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    url: Mapped[str] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class NewsItem(Base):
    __tablename__ = "news"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_url: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
