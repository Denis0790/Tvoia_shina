from fastapi import APIRouter, Depends
from app.deps import get_current_user
from app.models import User

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me")
async def read_me(user: User = Depends(get_current_user)):
    return {
        "id": str(user.id),
        "phone": user.phone,
        "full_name": user.full_name,
    }
