"""Чат клиента с сервисом: один диалог на клиента (общий ящик для менеджеров)
и сообщения в нём. Удаление мягкое: текст остаётся в базе (срок хранения),
но наружу не отдаётся."""

import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Text, Integer, DateTime, ForeignKey, Index, text as sql_text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    client_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    last_message_preview: Mapped[str | None] = mapped_column(String(120), nullable=True)
    # непрочитанные: клиентом (сообщения сервиса) и менеджерами (сообщения клиента)
    client_unread: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    manager_unread: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class Message(Base):
    __tablename__ = "chat_messages"
    __table_args__ = (
        Index("ix_chat_messages_conv_created", "conversation_id", "created_at"),
        # повторная отправка того же сообщения (обрыв связи) не создаёт дубль
        Index(
            "uq_chat_client_msg",
            "conversation_id",
            "client_msg_id",
            unique=True,
            postgresql_where=sql_text("client_msg_id IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE")
    )
    sender_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    # client / manager / system
    sender_role: Mapped[str] = mapped_column(String(10))
    kind: Mapped[str] = mapped_column(String(10), default="text", server_default="text")
    text: Mapped[str | None] = mapped_column(Text, nullable=True)
    reply_to_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("chat_messages.id", ondelete="SET NULL"), nullable=True
    )
    client_msg_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # прочитано второй стороной (для сообщения клиента — любым менеджером)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
