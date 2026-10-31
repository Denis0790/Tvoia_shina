"""Модели, связанные с аккаунтом: сам пользователь, привязанные OAuth-провайдеры
(задел под вход через Яндекс — пока не подключен) и refresh-токены сессий.

password_hash используется только для входа персонала (role=manager) по общему
логину/паролю — у клиентов это поле всегда пустое, они входят по SMS-коду."""

import uuid
from datetime import datetime
from sqlalchemy import Boolean, String, DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    phone: Mapped[str | None] = mapped_column(String(20), unique=True, index=True, nullable=True)
    login: Mapped[str | None] = mapped_column(String(50), unique=True, index=True, nullable=True)
    # почта клиента: по ней регистрация (код приходит письмом) и вход; всегда в нижнем регистре
    email: Mapped[str | None] = mapped_column(String(254), unique=True, index=True, nullable=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    role: Mapped[str] = mapped_column(String(20), default="client", server_default="client")
    manager_note: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    # person — обычный клиент (вход по SMS/телефону), org — организация (логин = ИНН, пароль выдаёт менеджер)
    kind: Mapped[str] = mapped_column(String(10), default="person", server_default="person")
    inn: Mapped[str | None] = mapped_column(String(12), unique=True, index=True, nullable=True)
    # заблокирован менеджером: не пишет в чат и не записывается онлайн
    blocked: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # доказательство согласия на обработку ПДн: когда, на какую редакцию текста, с какого IP
    consent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    consent_version: Mapped[str | None] = mapped_column(String(20), nullable=True)
    consent_ip: Mapped[str | None] = mapped_column(String(45), nullable=True)

    oauth_accounts: Mapped[list["OAuthAccount"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class OAuthAccount(Base):
    __tablename__ = "oauth_accounts"
    __table_args__ = (UniqueConstraint("provider", "provider_user_id", name="uq_provider_account"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(20))
    provider_user_id: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship(back_populates="oauth_accounts")


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped["User"] = relationship()
