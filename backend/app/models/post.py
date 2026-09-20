import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(100))
    work_start: Mapped[str] = mapped_column(String(5), default="09:00")
    work_end: Mapped[str] = mapped_column(String(5), default="17:00")
    work_days: Mapped[str] = mapped_column(String(7), default="1111100")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ScheduleException(Base):
    __tablename__ = "schedule_exceptions"
    __table_args__ = (UniqueConstraint("post_id", "date", name="uq_post_date_exception"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    post_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("posts.id", ondelete="CASCADE"), index=True)
    date: Mapped[datetime] = mapped_column(DateTime(timezone=False))
    is_working: Mapped[bool] = mapped_column()
    work_start: Mapped[str | None] = mapped_column(String(5), nullable=True)
    work_end: Mapped[str | None] = mapped_column(String(5), nullable=True)
