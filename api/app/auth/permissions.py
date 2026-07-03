"""
Shared authorization helpers, reused by any router that needs to gate an
action behind the current user's global role (see app.models.user.UserRole).
Kept separate from anon_auth.py so it stays stable if AUTH_BACKEND is swapped
for a different AuthBackend implementation.
"""
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.anon_auth import get_auth_backend
from app.models.user import User, UserRole


async def require_admin(user_anon_id: str, session: AsyncSession) -> User:
    """Resolve the calling user and raise 403 unless they are a global ADMIN."""
    backend = get_auth_backend()
    user = await backend.get_or_create_user(session, user_anon_id)
    if user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Admin access required.")
    return user
