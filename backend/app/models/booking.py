import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey, Index, Table, Column, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base


booking_services = Table(
    "booking_services",
    Base.metadata,
    Column("booking_id", UUID(as_uuid=True), ForeignKey("bookings.id", ondelete="CASCADE"), primary_key=True),
    Column("service_id", UUID(as_uuid=True), ForeignKey("services.id", ondelete="CASCADE"), primary_key=True),
)


class Booking(Base):
    __tablename__ = "bookings"
    # Слот уникален только среди активных записей: отменённая/отклонённая не должна занимать время
    __table_args__ = (
        Index(
            "uq_post_slot_active",
            "post_id",
            "date",
            "start_time",
            unique=True,
            postgresql_where=text("status IN ('pending', 'confirmed')"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    car_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("cars.id", ondelete="SET NULL"), nullable=True)
    post_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("posts.id", ondelete="SET NULL"), nullable=True, index=True)
    date: Mapped[datetime] = mapped_column(DateTime(timezone=False), index=True)
    start_time: Mapped[str] = mapped_column(String(5))
    duration_minutes: Mapped[int] = mapped_column()
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    comment: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # свободный текст «что делаем» — пока нет справочника услуг с нормативами
    services_text: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # длинная запись разбита на куски по дням: общий group_id и номер куска (0 — первый)
    group_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True, index=True)
    part: Mapped[int] = mapped_column(default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    reminder_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped["User"] = relationship()
    car: Mapped["Car | None"] = relationship()
    post: Mapped["Post | None"] = relationship()
    services: Mapped[list["Service"]] = relationship(secondary=booking_services)
