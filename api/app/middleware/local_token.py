"""Desktop sidecar auth — see docs/desktop-plan.md §3.2.

Active only when `settings.local_api_token` is non-empty (i.e. the process was
launched by the Electron shell with `--token`). No-op for every other
deployment (Docker, bare CLI), where the token is empty and every request is
allowed through unchanged.
"""
import hmac
from urllib.parse import parse_qs

from app.config import settings

HEALTH_PATH = "/api/v1/health"


def _parse_cookies(cookie_header: str) -> dict:
    cookies: dict = {}
    for part in cookie_header.split(";"):
        part = part.strip()
        if not part or "=" not in part:
            continue
        key, _, value = part.partition("=")
        cookies[key.strip()] = value.strip()
    return cookies


class LocalTokenMiddleware:
    """Plain ASGI middleware (not BaseHTTPMiddleware) so it can also guard
    WebSocket upgrades, which BaseHTTPMiddleware does not intercept."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        token = settings.local_api_token
        if not token or scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        if scope["path"] == HEALTH_PATH:
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers") or [])
        cookies = _parse_cookies(headers.get(b"cookie", b"").decode("latin-1"))
        header_token = headers.get(b"x-pilotbase-token", b"").decode("latin-1")

        supplied = cookies.get("pilotbase_token") or header_token
        if not supplied and scope["type"] == "websocket":
            supplied = parse_qs(scope.get("query_string", b"").decode("latin-1")).get("token", [""])[0]
        if supplied and hmac.compare_digest(supplied, token):
            await self.app(scope, receive, send)
            return

        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 4401})
            return

        await send({
            "type": "http.response.start",
            "status": 401,
            "headers": [(b"content-type", b"application/json")],
        })
        await send({
            "type": "http.response.body",
            "body": b'{"detail": "missing local token"}',
        })
