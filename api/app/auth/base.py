"""
Abstract authentication interface for Pilotbase.

The default implementation (AnonAuthBackend) uses browser-generated UUIDs
stored as cookies, with an optional email association.

To add a real auth system (OAuth, LDAP, SAML, JWT from an external IdP), subclass
AuthBackend and set AUTH_BACKEND in your .env to the dotted path of your class,
e.g.  AUTH_BACKEND=myorg.auth.OAuthBackend
"""
from abc import ABC, abstractmethod
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User


class AuthBackend(ABC):

    @abstractmethod
    async def get_or_create_user(
        self,
        session: AsyncSession,
        user_anon_id: str,
        user_email: Optional[str] = None,
    ) -> User:
        """
        Validate the identity from the request, fetch the User from the DB,
        and create one on first visit. The `user_anon_id` is always sent by the
        client cookie and serves as the primary key until a real auth token
        replaces it.
        """

    @abstractmethod
    async def create_invite_token(
        self,
        session: AsyncSession,
        creator: User,
        connection_id: Optional[str] = None,
        role_grant: str = "user",
        expire_hours: int = 48,
    ) -> str:
        """Generate and persist an invite token. Returns the raw token string."""

    @abstractmethod
    async def redeem_invite_token(
        self,
        session: AsyncSession,
        token: str,
        new_user: User,
    ) -> bool:
        """
        Validate and consume an invite token.
        Grants the new_user access as specified by the token. Returns True on success.
        """
