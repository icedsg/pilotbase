import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.base import AuthBackend
from app.models.connection import ConnectionAccess, InviteToken
from app.models.user import User, UserRole


class AnonAuthBackend(AuthBackend):
    """
    Default auth backend. Every browser gets a UUID cookie (user_anon_id) on first
    visit. The first user to register automatically becomes an ADMIN.
    """

    async def get_or_create_user(
        self,
        session: AsyncSession,
        user_anon_id: str,
        user_email: Optional[str] = None,
    ) -> User:
        result = await session.execute(select(User).where(User.id == user_anon_id))
        user = result.scalar_one_or_none()

        if user is None:
            # First user ever → ADMIN
            count_result = await session.execute(select(User))
            is_first = count_result.first() is None

            user = User(
                id=user_anon_id,
                email=user_email,
                role=UserRole.ADMIN if is_first else UserRole.USER,
            )
            session.add(user)
            await session.commit()
            await session.refresh(user)
        elif user_email and not user.email:
            user.email = user_email
            await session.commit()

        return user

    async def create_invite_token(
        self,
        session: AsyncSession,
        creator: User,
        connection_id: Optional[str] = None,
        role_grant: str = "user",
        expire_hours: int = 48,
    ) -> str:
        token = secrets.token_urlsafe(32)
        invite = InviteToken(
            token=token,
            created_by=creator.id,
            connection_id=connection_id,
            role_grant=role_grant,
            expires_at=datetime.now(timezone.utc) + timedelta(hours=expire_hours),
        )
        session.add(invite)
        await session.commit()
        return token

    async def redeem_invite_token(
        self,
        session: AsyncSession,
        token: str,
        new_user: User,
    ) -> bool:
        result = await session.execute(
            select(InviteToken).where(InviteToken.token == token, InviteToken.is_used == False)  # noqa: E712
        )
        invite = result.scalar_one_or_none()

        if invite is None or invite.expires_at < datetime.now(timezone.utc):
            return False

        invite.is_used = True

        if invite.role_grant == "admin":
            new_user.role = UserRole.ADMIN

        if invite.connection_id:
            access = ConnectionAccess(
                id=secrets.token_hex(16),
                connection_id=invite.connection_id,
                user_id=new_user.id,
                can_read=True,
                can_write=False,
                can_admin=False,
            )
            session.add(access)

        await session.commit()
        return True


_backend = AnonAuthBackend()


def get_auth_backend() -> AuthBackend:
    return _backend
