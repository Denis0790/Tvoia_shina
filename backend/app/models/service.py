import uuid
from datetime import datetime
from sqlalchemy import String, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base


class Service(Base):
    """Справочник услуг. duration_minutes — норматив. Услугу не удаляем, а скрываем
    (is_active=False): иначе она пропала бы из истории записей."""

    __tablename__ = "services"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(150))
    duration_minutes: Mapped[int] = mapped_column()
    category: Mapped[str | None] = mapped_column(String(60), nullable=True)
    is_active: Mapped[bool] = mapped_column(default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
