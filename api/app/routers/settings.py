import time
from typing import Optional
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException
from langchain_openai import ChatOpenAI
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.permissions import require_admin
from app.database import get_session
from app.services.llm_settings import (
    PROVIDER_DEFAULTS, get_llm_config, get_llm_settings_view, has_stored_api_key, save_llm_settings,
)

router = APIRouter()


class SaveLlmRequest(BaseModel):
    user_anon_id: str
    provider: str
    base_url: str
    model: str
    flash_model: Optional[str] = ""
    api_key: Optional[str] = None


class TestLlmRequest(BaseModel):
    user_anon_id: str


def _is_http_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


def _ollama_root(base_url: str) -> str:
    """Ollama's model listing lives on its native /api/tags route, not the
    OpenAI-compatible /v1 surface used for chat — strip a trailing /v1."""
    root = base_url.rstrip("/")
    if root.endswith("/v1"):
        root = root[: -len("/v1")]
    return root


@router.get("/llm")
async def get_llm(user_anon_id: str, session: AsyncSession = Depends(get_session)):
    await require_admin(user_anon_id, session)
    return await get_llm_settings_view(session)


@router.get("/llm/status")
async def get_llm_status(user_anon_id: str, session: AsyncSession = Depends(get_session)):
    """Cheap, frequent-poll-friendly reachability check for the TopBar's AI Agent
    indicator. Unlike POST /llm/test, this never invokes the model (no tokens
    spent) — it just confirms the configured endpoint is actually up by hitting
    its OpenAI-compatible GET /models route, which both Ollama and OpenRouter
    support without auth cost."""
    await require_admin(user_anon_id, session)
    config = await get_llm_config(session)

    if not config.model or (config.provider == "openrouter" and not await has_stored_api_key(session)):
        return {"available": False, "reason": "not_configured"}

    headers = {"Authorization": f"Bearer {config.api_key}"} if config.api_key else {}
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            resp = await client.get(f"{config.base_url.rstrip('/')}/models", headers=headers)
        if resp.status_code >= 400:
            return {"available": False, "reason": "unreachable"}
    except Exception:
        return {"available": False, "reason": "unreachable"}

    return {"available": True}


@router.get("/llm/models")
async def list_llm_models(
    user_anon_id: str, provider: str, base_url: str, api_key: Optional[str] = None,
    session: AsyncSession = Depends(get_session),
):
    """Lists models available from the given provider endpoint, for the model
    picker — reads the in-progress form fields (not the saved config), since
    the user may be picking a model before saving a provider/URL switch."""
    await require_admin(user_anon_id, session)
    if provider not in PROVIDER_DEFAULTS:
        raise HTTPException(status_code=422, detail="provider must be 'ollama' or 'openrouter'.")
    if not _is_http_url(base_url):
        raise HTTPException(status_code=422, detail="base_url must be a valid http(s) URL.")

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            if provider == "ollama":
                resp = await client.get(f"{_ollama_root(base_url)}/api/tags")
                resp.raise_for_status()
                models = []
                for m in resp.json().get("models", []):
                    details = m.get("details") or {}
                    parts = [p for p in (details.get("parameter_size"), details.get("quantization_level"), details.get("family")) if p]
                    size = m.get("size")
                    if size:
                        parts.append(f"{size / 1e9:.1f} GB")
                    model_id = m.get("model") or m.get("name")
                    models.append({"id": model_id, "name": m.get("name") or model_id, "description": " · ".join(parts) or None})
            else:
                headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
                resp = await client.get(f"{base_url.rstrip('/')}/models", headers=headers)
                resp.raise_for_status()
                models = [
                    {"id": m.get("id"), "name": m.get("name") or m.get("id"), "description": m.get("description") or None}
                    for m in resp.json().get("data", [])
                ]
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Could not reach {provider} at {base_url}: {e}")

    models.sort(key=lambda m: (m["name"] or m["id"] or "").lower())
    return {"models": models, "has_description": any(m["description"] for m in models)}


@router.put("/llm")
async def put_llm(body: SaveLlmRequest, session: AsyncSession = Depends(get_session)):
    await require_admin(body.user_anon_id, session)

    if body.provider not in PROVIDER_DEFAULTS:
        raise HTTPException(status_code=422, detail="provider must be 'ollama' or 'openrouter'.")
    if not _is_http_url(body.base_url):
        raise HTTPException(status_code=422, detail="base_url must be a valid http(s) URL.")
    if not body.model.strip():
        raise HTTPException(status_code=422, detail="model is required.")

    if body.provider == "openrouter" and not await has_stored_api_key(session) and not body.api_key:
        raise HTTPException(status_code=422, detail="api_key is required for OpenRouter.")

    await save_llm_settings(
        session,
        provider=body.provider,
        base_url=body.base_url,
        model=body.model,
        flash_model=body.flash_model or "",
        api_key=body.api_key or None,
    )
    return {"message": "saved"}


@router.post("/llm/test")
async def test_llm(body: TestLlmRequest, session: AsyncSession = Depends(get_session)):
    await require_admin(body.user_anon_id, session)
    config = await get_llm_config(session)

    kwargs = {"model": config.model, "base_url": config.base_url, "api_key": config.api_key, "timeout": 20}
    if config.provider == "openrouter":
        kwargs["default_headers"] = {"HTTP-Referer": "https://github.com/icedsg/pilotbase", "X-Title": "Pilotbase"}

    start = time.monotonic()
    try:
        llm = ChatOpenAI(**kwargs)
        await llm.ainvoke("Reply with OK")
        latency_ms = int((time.monotonic() - start) * 1000)
        return {"ok": True, "model": config.model, "latency_ms": latency_ms}
    except Exception as e:
        return {"ok": False, "error": str(e)}
