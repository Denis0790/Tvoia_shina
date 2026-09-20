"""Общая инфраструктура тестов.

Каждый тест pytest-asyncio запускается в своём собственном event loop —
поэтому глобальные синглтоны приложения (engine к Postgres, redis_client)
нельзя переиспользовать между тестами напрямую, они "привязываются" к loop'у
первого использования. Решение: для БД — свежий engine с NullPool на каждый
тест (гарантирует новое подключение в текущем loop'е), для Redis — сброс пула
соединений перед каждым тестом, чтобы клиент переподключился уже в актуальном loop'е.
"""

import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.pool import NullPool

from app.main import app
from app.database import get_db
from app.config import settings
from app.redis_client import redis_client


@pytest_asyncio.fixture
async def db_session():
    test_engine = create_async_engine(settings.database_url, poolclass=NullPool)
    test_session_maker = async_sessionmaker(test_engine, expire_on_commit=False)

    connection = await test_engine.connect()
    transaction = await connection.begin()
    session = test_session_maker(bind=connection)

    async def override_get_db():
        yield session

    app.dependency_overrides[get_db] = override_get_db

    yield session

    await session.close()
    await transaction.rollback()
    await connection.close()
    await test_engine.dispose()
    app.dependency_overrides.clear()


@pytest_asyncio.fixture(autouse=True)
async def reset_redis_connection():
    await redis_client.aclose()
    yield
    await redis_client.aclose()


@pytest_asyncio.fixture
async def client(db_session):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
