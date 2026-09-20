import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base


class Booking(Base):
    __tablename__ = "bookings"
    __table_args__ = (UniqueConstraint("post_id", "date", "start_time", name="uq_post_slot"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    car_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("cars.id", ondelete="SET NULL"), nullable=True)
    post_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("posts.id", ondelete="SET NULL"), nullable=True, index=True)
    date: Mapped[datetime] = mapped_column(DateTime(timezone=False), index=True)
    start_time: Mapped[str] = mapped_column(String(5))
    duration_minutes: Mapped[int] = mapped_column()
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    comment: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship()
    car: Mapped["Car | None"] = relationship()
    post: Mapped["Post | None"] = relationship()
