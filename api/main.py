import argparse
import os
import sys


def _parse_cli_and_set_env() -> argparse.Namespace:
    """Desktop sidecar CLI flags (docs/desktop-plan.md §3.1). Every flag has an
    env-var fallback so Docker/bare-CLI usage is unaffected. Must run before
    any `app.*` import, since `app.config.Settings` is a module-level
    singleton instantiated at import time from these same env vars."""
    parser = argparse.ArgumentParser(description="Pilotbase API server")
    parser.add_argument("--host", default=None)
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--token", default=None)
    parser.add_argument("--data-dir", default=None)
    args, _unknown = parser.parse_known_args()

    if args.host:
        os.environ["HOST"] = args.host
    if args.port is not None:
        os.environ["PORT"] = str(args.port)
    if args.token:
        os.environ["LOCAL_API_TOKEN"] = args.token
    if args.data_dir:
        os.environ["DATA_DIR"] = args.data_dir

    data_dir = os.environ.get("DATA_DIR")
    if data_dir:
        os.makedirs(data_dir, exist_ok=True)
        if not os.environ.get("DATABASE_URL"):
            db_path = os.path.join(data_dir, "pilotbase.db").replace("\\", "/")
            os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{db_path}"
        if not os.environ.get("BACKUPS_DIR"):
            os.environ["BACKUPS_DIR"] = os.path.join(data_dir, "backups")

    return args


_cli_args = _parse_cli_and_set_env()

import asyncio
import logging
import socket
from contextlib import asynccontextmanager

import uvicorn
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import init_db
from app.middleware.local_token import LocalTokenMiddleware
from app.routers import auth, connections, query, query_history, backup, migration, ai, chat_sessions, vector, papi, export, settings as settings_router
from app.websocket.manager import ws_router, manager

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s")
log = logging.getLogger("pilotbase")


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Starting Pilotbase …")
    manager.loop = asyncio.get_running_loop()
    await init_db()
    log.info("Database ready.")
    yield
    log.info("Pilotbase stopped.")


app = FastAPI(
    title="Pilotbase",
    description="Open source DB manager with AI",
    version="0.1.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

# CORS — in production restrict to your domain
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Desktop sidecar auth — no-op unless settings.local_api_token is set (§3.2)
app.add_middleware(LocalTokenMiddleware)

# API routers
app.include_router(auth.router,        prefix="/api/v1/auth",        tags=["auth"])
app.include_router(connections.router, prefix="/api/v1/connections",  tags=["connections"])
app.include_router(query.router,       prefix="/api/v1/query",        tags=["query"])
app.include_router(query_history.router, prefix="/api/v1/query/history", tags=["query"])
app.include_router(backup.router,      prefix="/api/v1/backup",       tags=["backup"])
app.include_router(migration.router,   prefix="/api/v1/migration",    tags=["migration"])
app.include_router(ai.router,          prefix="/api/v1/ai",           tags=["ai"])
app.include_router(chat_sessions.router, prefix="/api/v1/ai/sessions", tags=["ai"])
app.include_router(vector.router,      prefix="/api/v1/vector",        tags=["vector"])
app.include_router(papi.router,        prefix="/api/v1/papi",          tags=["public-api"])
app.include_router(export.router,      prefix="/api/v1/export",        tags=["export"])
app.include_router(settings_router.router, prefix="/api/v1/settings",   tags=["settings"])

# WebSocket
app.include_router(ws_router, prefix="/ws", tags=["websocket"])


@app.get("/api/v1/health", tags=["health"])
async def health():
    return {"status": "ok", "version": "0.1.0"}


# ── Serve React SPA ───────────────────────────────────────────────────────────
_static = settings.static_dir
if not os.path.isdir(_static) and hasattr(sys, "_MEIPASS"):
    # PyInstaller onefile/onedir: bundled datas live under the extracted
    # bundle root, not the exe's cwd.
    _static = os.path.join(sys._MEIPASS, settings.static_dir)

if os.path.isdir(_static):
    # Serve /assets/* directly
    _assets = os.path.join(_static, "assets")
    if os.path.isdir(_assets):
        app.mount("/assets", StaticFiles(directory=_assets), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        file_path = os.path.join(_static, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(_static, "index.html"))
else:
    @app.get("/", include_in_schema=False)
    async def no_frontend():
        return {
            "message": "Pilotbase API is running. Frontend not found.",
            "hint": "Run `npm run build` in ui/ and copy dist/ to api/static/, or use Docker.",
        }


def _run_alembic_upgrade() -> None:
    alembic_ini = os.path.join(os.path.dirname(os.path.abspath(__file__)), "alembic.ini")
    cfg = Config(alembic_ini)
    cfg.set_main_option("script_location", os.path.join(os.path.dirname(alembic_ini), "alembic"))
    command.upgrade(cfg, "head")


if __name__ == "__main__":
    _run_alembic_upgrade()

    host = settings.host
    reload = settings.environment == "development" and not settings.local_api_token

    if reload:
        log.info(f"Pilotbase listening on http://{host}:{settings.port}")
        uvicorn.run("main:app", host=host, port=settings.port, reload=True)
    else:
        # Bind the socket ourselves so `--port 0` (let the OS choose) still
        # lets us know — and print — the real port before serving (§3.1).
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind((host, settings.port))
        sock.listen(100)
        actual_port = sock.getsockname()[1]

        log.info(f"Pilotbase listening on http://{host}:{actual_port}")
        print(f"PILOTBASE_READY port={actual_port}", flush=True)

        uvicorn_config = uvicorn.Config(app, host=host, port=actual_port, log_level="info")
        uvicorn.Server(uvicorn_config).run(sockets=[sock])
