import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends
from fastapi.staticfiles import StaticFiles
from app.config import api_docs_kwargs
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db, engine, Base
from app import models  # noqa: F401 — регистрирует все модели в Base.metadata
from app.routers.auth import router as auth_router
from app.routers.users import router as users_router
from app.routers.cars import router as cars_router
from app.routers.availability import router as availability_router
from app.routers.bookings import router as bookings_router
from app.routers.services import router as services_router
from app.routers.posts import router as posts_router
from app.routers.profile import router as profile_router, UPLOAD_DIR
from app.routers.chat import router as chat_router
from app.routers.stats import router as stats_router


async def _media_cleanup_loop():
    """Раз в час: удаляем неприкреплённые файлы чата и переписку старше срока хранения."""
    from sqlalchemy.ext.asyncio import async_sessionmaker

    from app.routers.chat import cleanup_media

    await asyncio.sleep(60)
    while True:
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as db:
                await cleanup_media(db)
        except Exception:
            logging.getLogger(__name__).exception("очистка медиа чата не удалась")
        await asyncio.sleep(3600)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Простое автосоздание отсутствующих таблиц при старте (без Alembic).
    # Существующие таблицы не трогает — безопасно гонять на каждом старте.
    from sqlalchemy import text

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # create_all не добавляет колонки в уже существующие таблицы — догоняем вручную
        await conn.execute(
            text("ALTER TABLE schedule_exceptions ADD COLUMN IF NOT EXISTS kind VARCHAR(20) NOT NULL DEFAULT 'dayoff'")
        )
        await conn.execute(text("ALTER TABLE schedule_exceptions ADD COLUMN IF NOT EXISTS note VARCHAR(200)"))
        # организации: тип клиента и ИНН
        await conn.execute(
            text("ALTER TABLE users ADD COLUMN IF NOT EXISTS kind VARCHAR(10) NOT NULL DEFAULT 'person'")
        )
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS inn VARCHAR(12)"))
        await conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_inn ON users (inn)"))
        # записи: свободный текст услуг
        await conn.execute(text("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS services_text VARCHAR(500)"))
        await conn.execute(text("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS group_id UUID"))
        await conn.execute(text("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS part INTEGER NOT NULL DEFAULT 0"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_bookings_group_id ON bookings (group_id)"))
        await conn.execute(text("ALTER TABLE services ADD COLUMN IF NOT EXISTS category VARCHAR(60)"))
        await conn.execute(text("ALTER TABLE services ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE"))
        await conn.execute(text("ALTER TABLE service_profile ADD COLUMN IF NOT EXISTS hero_title VARCHAR(160)"))
        await conn.execute(text("ALTER TABLE service_profile ADD COLUMN IF NOT EXISTS stats JSONB NOT NULL DEFAULT '[]'::jsonb"))
        await conn.execute(text("ALTER TABLE service_profile ADD COLUMN IF NOT EXISTS advantages JSONB NOT NULL DEFAULT '[]'::jsonb"))
        await conn.execute(text("ALTER TABLE service_profile ADD COLUMN IF NOT EXISTS steps JSONB NOT NULL DEFAULT '[]'::jsonb"))
        await conn.execute(text("ALTER TABLE service_profile ADD COLUMN IF NOT EXISTS reviews JSONB NOT NULL DEFAULT '[]'::jsonb"))
        await conn.execute(text("ALTER TABLE service_profile ADD COLUMN IF NOT EXISTS max_link VARCHAR(300)"))
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(254)"))
        await conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email ON users (email)"))
        # слот уникален только среди активных записей (раньше отменённая запись блокировала то же время)
        await conn.execute(text("ALTER TABLE bookings DROP CONSTRAINT IF EXISTS uq_post_slot"))
        await conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_post_slot_active "
                "ON bookings (post_id, date, start_time) WHERE status IN ('pending', 'confirmed')"
            )
        )
        await conn.execute(text("ALTER TABLE chat_attachments ADD COLUMN IF NOT EXISTS original_name VARCHAR(200)"))
        await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked BOOLEAN NOT NULL DEFAULT FALSE"))
        await conn.execute(text("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE"))
        await conn.execute(text("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS muted BOOLEAN NOT NULL DEFAULT FALSE"))
    cleanup_task = asyncio.create_task(_media_cleanup_loop())
    yield
    cleanup_task.cancel()


app = FastAPI(title="Tvoya Shina API", lifespan=lifespan, **api_docs_kwargs(settings.app_env))

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(users_router)
app.include_router(cars_router)
app.include_router(availability_router)
app.include_router(bookings_router)
app.include_router(services_router)
app.include_router(posts_router)
app.include_router(profile_router)
app.include_router(chat_router)
app.include_router(stats_router)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/health/db")
async def health_db(db: AsyncSession = Depends(get_db)):
    result = await db.execute(text("SELECT 1"))
    return {"db": result.scalar() == 1}
