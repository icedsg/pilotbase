import os
import logging
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import init_db
from app.routers import auth, connections, query, backup, migration, ai, vector
from app.websocket.manager import ws_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s — %(message)s")
log = logging.getLogger("pilotbase")


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Starting Pilotbase …")
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

# API routers
app.include_router(auth.router,        prefix="/api/v1/auth",        tags=["auth"])
app.include_router(connections.router, prefix="/api/v1/connections",  tags=["connections"])
app.include_router(query.router,       prefix="/api/v1/query",        tags=["query"])
app.include_router(backup.router,      prefix="/api/v1/backup",       tags=["backup"])
app.include_router(migration.router,   prefix="/api/v1/migration",    tags=["migration"])
app.include_router(ai.router,          prefix="/api/v1/ai",           tags=["ai"])
app.include_router(vector.router,      prefix="/api/v1/vector",        tags=["vector"])

# WebSocket
app.include_router(ws_router, prefix="/ws", tags=["websocket"])


@app.get("/api/v1/health", tags=["health"])
async def health():
    return {"status": "ok", "version": "0.1.0"}


# ── Serve React SPA ───────────────────────────────────────────────────────────
_static = settings.static_dir

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


if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    reload = settings.environment == "development"
    log.info(f"Pilotbase listening on http://0.0.0.0:{port}")
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=reload)
