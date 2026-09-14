"""Resolves the active LLM provider config: DB (app_settings) → env → hard
default, per field. See docs/desktop-plan.md §3.3/§3.5.

Cached in-process; call invalidate() after writing app_settings (done by
routers/settings.py's PUT /llm) so the next read picks up the change.
"""
import os
from dataclasses import dataclass
from typing import Optional

from cryptography.fernet import Fernet
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.app_setting import AppSetting

PROVIDER_DEFAULTS = {
    "ollama": {
        "base_url": "http://localhost:11434/v1",
        "api_key": "ollama",
    },
    "openrouter": {
        "base_url": "https://openrouter.ai/api/v1",
        "api_key": "",
    },
}


@dataclass
class LlmConfig:
    provider: str
    base_url: str
    model: str
    flash_model: str
    api_key: str


def _cipher() -> Fernet:
    return Fernet(settings.encryption_key.encode())


def encrypt_value(value: str) -> str:
    return _cipher().encrypt(value.encode()).decode()


def decrypt_value(value: str) -> str:
    return _cipher().decrypt(value.encode()).decode()


_cache: Optional[LlmConfig] = None


def invalidate() -> None:
    global _cache
    _cache = None


async def _get_settings_map(session: AsyncSession) -> dict:
    rows = (await session.execute(select(AppSetting))).scalars().all()
    result = {}
    for row in rows:
        if row.value is None:
            continue
        result[row.key] = decrypt_value(row.value) if row.is_secret else row.value
    return result


async def get_llm_config(session: AsyncSession) -> LlmConfig:
    global _cache
    if _cache is not None:
        return _cache

    stored = await _get_settings_map(session)

    provider = stored.get("llm.provider") or "ollama"
    defaults = PROVIDER_DEFAULTS.get(provider, PROVIDER_DEFAULTS["ollama"])

    # The OLLAMA_* env vars / Settings fields are the pre-desktop, single-provider
    # config surface — they must only fill in gaps for the ollama provider, never
    # leak in as a fallback for openrouter (e.g. settings.ollama_api_key's literal
    # "ollama" default would otherwise make every provider look "configured").
    if provider == "ollama":
        base_url = stored.get("llm.base_url") or os.environ.get("OLLAMA_BASE_URL") or settings.ollama_base_url or defaults["base_url"]
        model = stored.get("llm.model") or os.environ.get("OLLAMA_MODEL") or settings.ollama_model
        api_key = stored.get("llm.api_key") or os.environ.get("OLLAMA_API_KEY") or settings.ollama_api_key or defaults["api_key"]
    else:
        base_url = stored.get("llm.base_url") or defaults["base_url"]
        model = stored.get("llm.model") or ""
        api_key = stored.get("llm.api_key") or defaults["api_key"]

    # Per §3.3: an empty flash_model always means "use the main model" — no
    # env/settings fallback layer here, unlike the other fields.
    flash_model = stored.get("llm.flash_model") or model

    _cache = LlmConfig(provider=provider, base_url=base_url, model=model, flash_model=flash_model, api_key=api_key)
    return _cache


async def has_stored_api_key(session: AsyncSession) -> bool:
    """Whether an api_key has ever actually been persisted, independent of
    provider — the resolved LlmConfig.api_key isn't a reliable proxy since
    ollama always resolves to a truthy default ("ollama") even unsaved."""
    row = await session.get(AppSetting, "llm.api_key")
    return bool(row and row.value)


async def get_llm_settings_view(session: AsyncSession) -> dict:
    """GET /llm response shape — never includes the raw api_key."""
    config = await get_llm_config(session)
    return {
        "provider": config.provider,
        "base_url": config.base_url,
        "model": config.model,
        "flash_model": config.flash_model if config.flash_model != config.model else "",
        "has_api_key": bool(config.api_key),
    }


async def _set(session: AsyncSession, key: str, value: str, is_secret: bool = False) -> None:
    row = await session.get(AppSetting, key)
    stored_value = encrypt_value(value) if is_secret else value
    if row is None:
        session.add(AppSetting(key=key, value=stored_value, is_secret=is_secret))
    else:
        row.value = stored_value
        row.is_secret = is_secret


async def save_llm_settings(
    session: AsyncSession, *, provider: str, base_url: str, model: str,
    flash_model: str, api_key: Optional[str],
) -> None:
    await _set(session, "llm.provider", provider)
    await _set(session, "llm.base_url", base_url)
    await _set(session, "llm.model", model)
    await _set(session, "llm.flash_model", flash_model or "")
    if api_key:
        await _set(session, "llm.api_key", api_key, is_secret=True)
    await session.commit()
    invalidate()
