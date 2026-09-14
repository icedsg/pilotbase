# Pilotbase Desktop — build specification

This document is a specification, not a discussion. Every decision below is final unless a
section is explicitly marked **DECISION NEEDED**. A builder follows it top to bottom.

## 0. Summary of fixed decisions

| Topic | Decision |
|---|---|
| Approach | Wrap the existing FastAPI backend + React UI. No rewrite of product code. |
| Shell | Electron 33.x, TypeScript, packaged with electron-builder 25.x. |
| Backend distribution | PyInstaller 6.x **onedir** build of `api/`, shipped as a sidecar binary, spawned by Electron. |
| Backend bind | `127.0.0.1`, OS-assigned free port, per-launch secret token (cookie). Never `0.0.0.0`. |
| Internal database | SQLite via `sqlite+aiosqlite`, file `<dataDir>/pilotbase.db`. Postgres is no longer required. |
| Data directory | Electron `app.getPath('userData')` → Windows `%APPDATA%\Pilotbase`, macOS `~/Library/Application Support/Pilotbase`, Linux `~/.config/Pilotbase`. |
| Auth | Existing `anon` backend. Single local user, auto-admin. No login screen. |
| LLM | Configurable in a Settings screen: **Ollama** (local, default) or **OpenRouter**. Both use the existing OpenAI-compatible client. |
| Internet egress allowed | (1) user-configured database hosts, (2) the configured LLM base URL, (3) the ad box. Nothing else. |
| Ad banner | One 468×60 banner, centered in the top bar, in an isolated `WebContentsView`. Always visible when online; hidden when offline. No opt-out. |
| Auto-update | **Not included.** No update checks, no update downloads. Users install new releases manually. |
| Telemetry | None. Every client library's telemetry is disabled by env vars (§3.6). |
| Platforms | Windows x64 (NSIS installer), macOS x64 + arm64 (DMG), Linux x64 (AppImage). |

## 1. Repository layout (final)

```
pilotbase/
├── api/                          existing backend (changes in §3)
│   ├── main.py                   gains CLI flags (§3.1)
│   ├── pilotbase-api.spec        NEW  PyInstaller spec (§6.1)
│   └── app/
│       ├── middleware/local_token.py     NEW (§3.2)
│       ├── models/app_setting.py         NEW (§3.3)
│       ├── routers/settings.py           NEW (§3.4)
│       ├── services/llm_settings.py      NEW (§3.5)
│       └── alembic/versions/xxxx_app_settings.py  NEW migration (§3.3)
├── ui/                           existing frontend (changes in §4)
│   └── src/
│       ├── components/settings/SettingsModal.tsx   NEW
│       ├── api/client.ts         gains apiGetLlmSettings / apiPutLlmSettings / apiTestLlm
│       └── lib/desktop.ts        NEW  typed access to window.desktop
├── desktop/                      NEW  Electron shell (§5)
│   ├── package.json
│   ├── tsconfig.json
│   ├── electron-builder.yml
│   ├── src/main/index.ts
│   ├── src/main/sidecar.ts
│   ├── src/main/secrets.ts
│   ├── src/main/netpolicy.ts
│   ├── src/main/ads.ts
│   ├── src/main/menu.ts
│   ├── src/preload.ts
│   └── resources/                icons; sidecar binaries are copied here by CI
└── .github/workflows/desktop.yml NEW (§6.3)
```

## 2. Runtime flow (what happens on launch)

1. Electron `app.requestSingleInstanceLock()`. If the lock is not obtained, focus the existing window and quit.
2. `secrets.ts` loads `<dataDir>/secrets.bin`. If absent, generate `SECRET_KEY` (64 hex chars) and `ENCRYPTION_KEY` (Fernet key, 44 chars base64) and write the file encrypted with `safeStorage.encryptString`. These values never change afterwards.
3. Generate `LOCAL_API_TOKEN` = 32 random bytes hex (new on every launch).
4. `sidecar.ts` spawns the backend (§5.2) with env from §3.6 and args `--host 127.0.0.1 --port 0 --token <LOCAL_API_TOKEN> --data-dir <dataDir>`.
5. Read the sidecar's stdout until a line matching `^PILOTBASE_READY port=(\d+)$`. Timeout 30 s → show an error dialog with the last 50 log lines and quit.
6. Poll `GET http://127.0.0.1:<port>/api/v1/health` every 250 ms until HTTP 200 (max 10 s).
7. Set cookie `pilotbase_token=<LOCAL_API_TOKEN>` on `session.defaultSession` for url `http://127.0.0.1:<port>`, `httpOnly: true`, `sameSite: 'strict'`, no expiry (session cookie).
8. Install the network allowlist (§5.4).
9. Create the main `BrowserWindow` (§5.3) and load `http://127.0.0.1:<port>/`.
10. Create the ad `WebContentsView` (§5.5) and attach it to the window.
11. On `before-quit`: send SIGTERM to the sidecar, wait 5 s, then SIGKILL. Delete the cookie.

## 3. Backend changes

### 3.1 CLI flags in `api/main.py`

Add `argparse` with these flags. Every flag has an env-var fallback so Docker keeps working.

| Flag | Env fallback | Default | Effect |
|---|---|---|---|
| `--host` | `HOST` | `0.0.0.0` | uvicorn host |
| `--port` | `PORT` | `8000` | uvicorn port. `0` = let the OS choose. |
| `--token` | `LOCAL_API_TOKEN` | empty | Enables the token middleware (§3.2) when non-empty. |
| `--data-dir` | `DATA_DIR` | `.` | Base directory; when set and `DATABASE_URL` is unset, `DATABASE_URL` becomes `sqlite+aiosqlite:///<data-dir>/pilotbase.db` and `BACKUPS_DIR` becomes `<data-dir>/backups`. |

Startup sequence in `main.py`: parse flags → run Alembic `upgrade head` programmatically
(`alembic.command.upgrade(Config(alembic_ini_path), "head")`) → bind the uvicorn socket → print
exactly `PILOTBASE_READY port=<actual port>` followed by newline to stdout, flushed → serve.
The port is obtained by binding a socket yourself when `--port 0` and passing the socket to
uvicorn (`uvicorn.Server.serve(sockets=[sock])`), so the printed port is the real one.

### 3.2 Token middleware `app/middleware/local_token.py`

Active only when `settings.local_api_token` is non-empty (new field in `app/config.py`).
Rules, in order:

1. Path `/api/v1/health` → allow.
2. Cookie `pilotbase_token` equals the token → allow.
3. Header `X-Pilotbase-Token` equals the token → allow.
4. WebSocket upgrade with query param `token` equal to the token → allow.
5. Otherwise → HTTP 401 JSON `{"detail": "missing local token"}`. For WebSocket, close with code 4401.

Static files (`/`, `/assets/*`) are subject to the same rule; the shell sets the cookie before
loading, so this is fine. Comparison uses `hmac.compare_digest`.

### 3.3 Settings storage

Model `app/models/app_setting.py`:

```python
class AppSetting(Base):
    __tablename__ = "app_settings"
    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[str | None] = mapped_column(Text)        # Fernet-encrypted when is_secret
    is_secret: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), onupdate=func.now())
```

Alembic migration creates the table. Keys used (exact strings):

| key | is_secret | values |
|---|---|---|
| `llm.provider` | no | `ollama` or `openrouter` |
| `llm.base_url` | no | URL. Defaults: ollama `http://localhost:11434/v1`, openrouter `https://openrouter.ai/api/v1` |
| `llm.model` | no | model id string |
| `llm.flash_model` | no | model id string; if empty, falls back to `llm.model` |
| `llm.api_key` | yes | Ollama: literal `ollama` unless the user sets one; OpenRouter: required |

SQLite compatibility work (must be done, not optional): set `render_as_batch=True` in
`api/alembic/env.py` `context.configure(...)`; run `alembic upgrade head` against an empty
SQLite file in CI; replace any `postgresql.UUID`/`JSONB`/`ARRAY` column types in existing
migrations with `String`/`Text`(JSON string) equivalents using `sa.String().with_variant(...)`.

### 3.4 Settings API `app/routers/settings.py`

Mounted at `/api/v1/settings`. All routes require `require_admin` (existing helper).

`GET /llm` → `200`
```json
{"provider": "ollama", "base_url": "http://localhost:11434/v1", "model": "gemma4:31b-cloud",
 "flash_model": "", "has_api_key": true}
```
The API key is never returned.

`PUT /llm` body:
```json
{"user_anon_id": "...", "provider": "openrouter", "base_url": "https://openrouter.ai/api/v1",
 "model": "openai/gpt-4o-mini", "flash_model": "", "api_key": "sk-or-..."}
```
Validation: `provider` ∈ {`ollama`,`openrouter`}; `base_url` must parse as http/https URL;
`model` non-empty; `api_key` optional — when omitted or empty the stored key is kept; when
provider is `openrouter` and no key is stored and none is supplied → `422`. On success → `200 {"message":"saved"}`.

`POST /llm/test` body `{"user_anon_id": "..."}` → runs one chat completion with prompt `Reply with OK`
using the stored config, 20 s timeout. `200 {"ok": true, "model": "...", "latency_ms": 812}` or
`200 {"ok": false, "error": "<message>"}`. Never raises 500 for provider errors.

### 3.5 `app/services/llm_settings.py`

```python
async def get_llm_config(session) -> LlmConfig   # dataclass: provider, base_url, model, flash_model, api_key
```
Resolution order per field: `app_settings` row → env (`OLLAMA_BASE_URL`, `OLLAMA_MODEL`,
`OLLAMA_FLASH_MODEL`, `OLLAMA_API_KEY`) → hard default. Result cached in-process and invalidated by
`PUT /llm`.

Replace every direct read of `settings.ollama_*` with `get_llm_config()`:
`app/agents/db_agent.py` (client construction, currently around the `api_key=settings.ollama_api_key` line)
and `app/routers/ai.py` (the three `if not settings.ollama_api_key` guards). When provider is
`openrouter`, pass `default_headers={"HTTP-Referer": "https://github.com/icedsg/pilotbase", "X-Title": "Pilotbase"}`
to `ChatOpenAI`.

### 3.6 Environment passed by the shell to the sidecar

| Variable | Value |
|---|---|
| `HOST` / `PORT` / `LOCAL_API_TOKEN` / `DATA_DIR` | as in §3.1 (also passed as flags) |
| `SECRET_KEY`, `ENCRYPTION_KEY` | from `secrets.ts` |
| `ENVIRONMENT` | `production` |
| `AUTH_BACKEND` | `anon` |
| `STATIC_DIR` | `<sidecarDir>/static` |
| `CORS_ORIGINS` | `http://127.0.0.1:<port>` |
| `ANONYMIZED_TELEMETRY` | `False` (chromadb) |
| `DO_NOT_TRACK` | `1` |
| `SCARF_NO_ANALYTICS` | `true` |
| `HF_HUB_OFFLINE` | `1` |
| `PYTHONUNBUFFERED` | `1` |

The sidecar must not read a `.env` file: `app/config.py` `SettingsConfigDict(env_file=...)` is
set to `None` when `DATA_DIR` is present in the environment.

## 4. Frontend changes

### 4.1 `ui/src/lib/desktop.ts`

```ts
export interface DesktopBridge {
  version: string
  platform: 'win32' | 'darwin' | 'linux'
  openExternal(url: string): void
  openSettings(): void            // focuses the Settings modal (menu item calls the same)
  onOpenSettings(cb: () => void): () => void
}
export const desktop: DesktopBridge | undefined = (window as any).desktop
export const isDesktop = !!desktop
```

### 4.2 Settings modal `ui/src/components/settings/SettingsModal.tsx`

Opened from a gear icon in the top bar (always present, web and desktop) and from the Electron
menu (`Pilotbase → Settings…`, shortcut `Ctrl/Cmd+,`). Contents, top to bottom:

1. Section **AI provider**: radio `Ollama (local)` / `OpenRouter`.
2. `Base URL` text input. Switching provider resets it to that provider's default (§3.3).
3. `Model` text input, required. `Flash model` text input, optional.
4. `API key` password input. Placeholder `leave blank to keep current` when `has_api_key` is true.
   Required (red error, save disabled) when provider is OpenRouter and `has_api_key` is false.
5. Buttons: `Test` (calls `POST /llm/test`, shows green `OK · <model> · <latency> ms` or the red error
   text), `Cancel`, `Save` (calls `PUT /llm`; on success closes the modal and shows toast `Settings saved`).
6. Section **About** (desktop only): app version, data directory path (read-only, with `Open folder`
   button via `desktop.openExternal('file://…')`).

When `isDesktop`, the layout's right panel (`RightPanel`) gets `style={{ paddingBottom: 274 }}` so the
ad box (250 px + 12 px margin ×2) never covers the AI chat input.

### 4.3 External links

Every `<a target="_blank">` in the UI (comparison links, GitHub) is rendered through a helper that
calls `desktop.openExternal(url)` when `isDesktop`; the shell also enforces this (§5.4).

## 5. Electron shell (`desktop/`)

### 5.1 `package.json` (essentials)

```json
{ "name": "pilotbase-desktop", "productName": "Pilotbase", "version": "<same as api>",
  "main": "dist/main/index.js",
  "scripts": { "dev": "tsc -p . && electron .", "build": "tsc -p . && electron-builder" },
  "devDependencies": { "electron": "^33", "electron-builder": "^25", "typescript": "^5" } }
```
No runtime npm dependencies. Node integration off, context isolation on, sandbox on for every
web contents.

### 5.2 `sidecar.ts`

- Binary path: `process.resourcesPath + '/sidecar/pilotbase-api' + (win32 ? '.exe' : '')`; in dev
  (`!app.isPackaged`) use `python api/main.py` from the repo with the same flags.
- `child_process.spawn(bin, args, { env, cwd: sidecarDir, stdio: ['ignore','pipe','pipe'] })`.
- stdout and stderr appended to `<dataDir>/logs/backend.log` (rotate at 5 MB, keep 3 files).
- Parse the `PILOTBASE_READY` line (§2 step 5).
- If the process exits before the app quits: restart immediately, max 3 restarts per 60 s; after that,
  show dialog `Pilotbase backend stopped unexpectedly. See logs at <path>.` and quit.
- Export `getPort(): number` and `stop(): Promise<void>`.

### 5.3 Main window

`new BrowserWindow({ width: 1400, height: 900, minWidth: 1024, minHeight: 700, show: false,
webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true } })`.
Show on `ready-to-show`. Persist bounds in `<dataDir>/window.json` and restore on launch (clamp to
the current display). `webContents.setWindowOpenHandler(() => { shell.openExternal(url); return { action: 'deny' } })`.
`will-navigate` to any origin other than `http://127.0.0.1:<port>` → `event.preventDefault()`.

### 5.4 Network policy `netpolicy.ts`

Applied to `session.defaultSession` (main window) and `session.fromPartition('persist:ads')`.

```
session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, cb) => cb({ cancel: !allowed(details.url) }))
```

| Session | Allowed URL patterns | Everything else |
|---|---|---|
| default (UI) | `http://127.0.0.1:<port>/*`, `ws://127.0.0.1:<port>/*`, `devtools://*` (dev only) | cancelled |
| `persist:ads` | `https://*.<AD_NETWORK_DOMAIN>/*` list in `ads.ts` `AD_HOSTS` + `https://imasdk.googleapis.com/*`, `https://*.doubleclick.net/*`, `https://*.googlesyndication.com/*`, `https://*.googlevideo.com/*` when the ad network is Google Ad Manager | cancelled |

Also: `session.setPermissionRequestHandler(() => false)` on both sessions (no camera, mic,
notifications, geolocation). `app.commandLine.appendSwitch('disable-features', 'MediaRouter')`
(no Cast discovery). Chromium's own network calls are disabled by
`app.commandLine.appendSwitch('disable-background-networking')` and, in `electron-builder.yml`,
`electronDownload` is irrelevant at runtime; spellcheck is disabled (`spellcheck: false`) so no
dictionary downloads occur.

**DECISION NEEDED:** the ad network and its exact domain list (`AD_HOSTS`). Until decided, `ads.ts`
loads a bundled local placeholder page and `AD_HOSTS` is empty.

### 5.5 Ad box `ads.ts`

- `new WebContentsView({ webPreferences: { partition: 'persist:ads', sandbox: true, contextIsolation: true, nodeIntegration: false, preload: undefined, autoplayPolicy: 'no-user-gesture-required' } })`.
- Loaded page: `resources/ad/index.html` (bundled). It contains the ad tag for the chosen network with
  slot size 468×60 banner, centered in the top bar. This is the only place ad code exists.
- Bounds: `{ x: winWidth - 300 - 12, y: winHeight - 250 - 12, width: 300, height: 250 }`, updated on
  every window `resize`. View is added with `win.contentView.addChildView(adView)` after the main view
  so it renders on top.
- `setWindowOpenHandler` → `shell.openExternal(url)`, deny. `will-navigate` → deny.
- Online state: main process polls `net.isOnline()` every 30 s and on `powerMonitor` resume; when offline
  the view is removed from the window, when back online it is re-added and reloaded.
- No close button, no mute button, no interaction other than clicks passed to the ad.

### 5.6 `preload.ts`

Exposes exactly the `DesktopBridge` of §4.1 via `contextBridge.exposeInMainWorld('desktop', …)`.
IPC channels: `desktop:open-external` (validated: only `http:`, `https:`, `file://<dataDir>/*`),
`desktop:open-settings` (main → renderer). Nothing else is exposed.

### 5.7 `menu.ts`

Application menu: **Pilotbase** (About, Settings… `CmdOrCtrl+,`, Quit), **Edit** (standard roles),
**View** (Reload, Zoom in/out/reset, Toggle Full Screen, Toggle DevTools in dev builds only),
**Help** (Open logs folder, Open data folder, Pilotbase on GitHub → `openExternal`).

## 6. Packaging and CI

### 6.1 PyInstaller `api/pilotbase-api.spec`

- Entry `main.py`, mode onedir, name `pilotbase-api`, `console=True` (stdout is needed).
- `datas`: `alembic/` → `alembic/`, `alembic.ini` → `.`, `static/` → `static/` (React build copied in
  before packaging), `../docs/` → `docs/`, `../README.md` → `.`.
- `hiddenimports`: `uvicorn.logging, uvicorn.loops.auto, uvicorn.protocols.http.auto,
  uvicorn.protocols.websockets.auto, uvicorn.lifespan.on, aiosqlite, sqlalchemy.dialects.sqlite,
  sqlalchemy.dialects.postgresql, sqlalchemy.dialects.mysql, sqlalchemy.dialects.mssql,
  sqlalchemy.dialects.oracle, duckdb_engine, sqlalchemy_cockroachdb, snowflake.sqlalchemy,
  pymysql, psycopg2, pymssql, oracledb, pymongo, redis, cassandra, boto3, qdrant_client, chromadb,
  weaviate, pinecone, pymilvus, langchain_openai, langgraph, alembic, passlib.handlers.bcrypt`.
  Use `collect_submodules` for `chromadb`, `pymilvus`, `snowflake`, `langchain_core`, `langgraph`.
- `ibm_db_sa` excluded on macOS arm64 (already conditional in `requirements.txt`).
- Smoke test after build (CI step): run the binary with `--port 0 --token t --data-dir <tmp>`, wait for
  `PILOTBASE_READY`, `curl` `/api/v1/health` with the cookie, expect 200, then kill.

### 6.2 `electron-builder.yml`

```yaml
appId: com.pilotbase.desktop
productName: Pilotbase
directories: { output: release, buildResources: resources }
files: ["dist/**", "resources/ad/**", "package.json"]
extraResources:
  - { from: "../api/dist/pilotbase-api", to: "sidecar", filter: ["**/*"] }
asar: true
win:   { target: [{ target: nsis, arch: [x64] }], artifactName: "Pilotbase-${version}-win-x64.exe" }
nsis:  { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true }
mac:   { target: [{ target: dmg, arch: [x64, arm64] }], category: public.app-category.developer-tools,
         hardenedRuntime: true, entitlements: resources/entitlements.plist, artifactName: "Pilotbase-${version}-mac-${arch}.dmg" }
linux: { target: [{ target: AppImage, arch: [x64] }], category: Development, artifactName: "Pilotbase-${version}-linux-x64.AppImage" }
publish: null
```
`publish: null` guarantees electron-builder never embeds update metadata.

### 6.3 `.github/workflows/desktop.yml`

Trigger: tag `v*`. Matrix: `windows-latest`, `macos-14` (arm64), `macos-13` (x64), `ubuntu-22.04`.
Steps per job: checkout → Node 20 → `npm ci && npm run build` in `ui/` → copy `ui/dist` to `api/static`
→ Python 3.13 → `pip install -r api/requirements.txt pyinstaller` → `pyinstaller api/pilotbase-api.spec`
→ sidecar smoke test (§6.1) → `npm ci && npm run build` in `desktop/` → upload `desktop/release/*`
as workflow artifacts and attach to the GitHub Release. macOS jobs sign and notarise using secrets
`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `CSC_LINK`, `CSC_KEY_PASSWORD`; Windows
signs with `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`. Unsigned builds are still produced when the secrets
are absent (for testing), with a warning in the job summary.

## 7. Acceptance checklist (all must pass before release)

1. Fresh machine, no Python, no Docker: installer runs, app opens to the connection list within 15 s.
2. `<dataDir>/pilotbase.db`, `secrets.bin`, `logs/backend.log`, `backups/` exist after first launch.
3. `netstat` shows the backend listening on `127.0.0.1` only. A request without the cookie returns 401.
4. Add a DuckDB `:memory:` connection, run `select 1`, see results. Add a remote Postgres, browse tables.
5. Settings → Ollama with local model → Test shows OK; AI panel answers a question.
6. Settings → OpenRouter with key → Test shows OK; restart the app; key survives (`has_api_key: true`).
7. With a packet capture (or `Little Snitch`/`Wireshark`) over 10 minutes of normal use: outbound
   connections only to the DB hosts in use, the LLM base URL, and the ad domains. Zero others.
8. Disconnect the network: the ad box disappears within 30 s, the app keeps working against a local
   DuckDB/SQLite; reconnect: the ad box returns.
9. Clicking any link in the UI opens the OS browser; the app window never navigates away.
10. Quit the app: no `pilotbase-api` process remains after 6 s.
11. Second launch while running: focuses the existing window, no second backend.
12. Backup, migration diff, export-as-SQL, public API (papi) each work once against SQLite internal storage.

## 8. Explicitly out of scope for v1

Auto-update, crash reporting, multi-user/invites in desktop mode, tray icon, deep links,
bundled `pg_dump`/`mysqldump` (the generic INSERT dump is used unless those binaries are on `PATH`),
Tauri port.
