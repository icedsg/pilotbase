"""
Process-local rate limiter for the public generated-CRUD-API auth endpoints
(create_token / validate_token — the only two papi endpoints callable without
an existing token). Keyed by a hash of (client IP, User-Agent) rather than IP
alone, since many mobile clients behind carrier NAT share an IP.

This is in-memory and per-process — fine for a single-instance deployment.
A multi-instance deployment would need this backed by a shared store (e.g.
Redis) instead, since each process would otherwise track its own bucket.
"""
import hashlib
import time
from collections import defaultdict, deque
from typing import Deque, Dict

from fastapi import HTTPException, Request

_CREATE_TOKEN_LIMIT = 1
_CREATE_TOKEN_WINDOW = 1.0  # seconds
_VALIDATE_LIMIT = 20
_VALIDATE_WINDOW = 1.0

_buckets: Dict[str, Deque[float]] = defaultdict(deque)


def _key(request: Request) -> str:
    ip = request.client.host if request.client else "unknown"
    ua = request.headers.get("user-agent", "")
    return hashlib.sha256(f"{ip}:{ua}".encode()).hexdigest()


def _check(request: Request, limit: int, window: float) -> None:
    key = _key(request)
    now = time.monotonic()
    bucket = _buckets[key]
    while bucket and now - bucket[0] > window:
        bucket.popleft()
    if len(bucket) >= limit:
        raise HTTPException(status_code=429, detail="Rate limit exceeded. Try again shortly.")
    bucket.append(now)


async def rate_limit_create_token(request: Request) -> None:
    _check(request, _CREATE_TOKEN_LIMIT, _CREATE_TOKEN_WINDOW)


async def rate_limit_validate(request: Request) -> None:
    _check(request, _VALIDATE_LIMIT, _VALIDATE_WINDOW)
