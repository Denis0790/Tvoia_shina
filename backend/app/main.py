from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.routers.auth import router as auth_router
from app.routers.users import router as users_router
from app.routers.cars import router as cars_router
from app.routers.availability import router as availability_router
from app.routers.bookings import router as bookings_router
from app.routers.services import router as services_router

app = FastAPI(title="Tvoya Shina API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
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


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/health/db")
async def health_db(db: AsyncSession = Depends(get_db)):
    result = await db.execute(text("SELECT 1"))
    return {"db": result.scalar() == 1}
