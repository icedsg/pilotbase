import secrets
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.anon_auth import get_auth_backend
from app.database import get_session
from app.models.user import UserRole

router = APIRouter()


class SessionRequest(BaseModel):
    user_anon_id: str
    user_email: Optional[str] = None


class InviteRequest(BaseModel):
    user_anon_id: str
    user_email: Optional[str] = None
    connection_id: Optional[str] = None
    role_grant: str = "user"
    expire_hours: int = 48


class RedeemRequest(BaseModel):
    token: str
    user_anon_id: str
    user_email: Optional[str] = None


@router.post("/session")
async def get_or_create_session(
    body: SessionRequest,
    session: AsyncSession = Depends(get_session),
):
    """Called by the UI on every load. Creates the user if it's their first visit."""
    backend = get_auth_backend()
    user = await backend.get_or_create_user(session, body.user_anon_id, body.user_email)
    return {
        "user_id": user.id,
        "email": user.email,
        "role": user.role,
        "is_active": user.is_active,
    }


@router.post("/invite")
async def create_invite(
    body: InviteRequest,
    session: AsyncSession = Depends(get_session),
):
    """Admin creates an invite link. Returns the invite token."""
    backend = get_auth_backend()
    user = await backend.get_or_create_user(session, body.user_anon_id, body.user_email)
    if user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Only admins can create invites.")

    token = await backend.create_invite_token(
        session,
        creator=user,
        connection_id=body.connection_id,
        role_grant=body.role_grant,
        expire_hours=body.expire_hours,
    )
    return {"token": token, "expires_in_hours": body.expire_hours}


@router.post("/redeem")
async def redeem_invite(
    body: RedeemRequest,
    session: AsyncSession = Depends(get_session),
):
    """New user redeems an invite token to gain access."""
    backend = get_auth_backend()
    user = await backend.get_or_create_user(session, body.user_anon_id, body.user_email)
    ok = await backend.redeem_invite_token(session, body.token, user)
    if not ok:
        raise HTTPException(status_code=400, detail="Invalid or expired invite token.")
    return {"message": "Invite accepted.", "user_id": user.id, "role": user.role}
