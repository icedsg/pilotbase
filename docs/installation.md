# Installation Guide

One page, start to finish: clone → configure → run. Docker Compose is the recommended path and is what this guide covers. For running the backend and frontend natively with hot reload instead, see [Local Development Setup](local-development.md).

**Requirements:** Docker 24+ and Docker Compose v2+.

---

## 1. Clone the repo

```bash
git clone https://github.com/icedsg/pilotbase.git
cd pilotbase
```

## 2. Configure `api/.env`

This is the only file you need to touch to get Pilotbase running in Docker. Copy the template:

```bash
cp api/.env.example api/.env
```

`api/.env` is gitignored and read by `docker-compose.yml` via `env_file:` — everything you set here reaches the `app` container automatically. (Four values — `DATABASE_URL`, `PORT`, `STATIC_DIR`, `BACKUPS_DIR` — are pinned to container-specific paths directly in `docker-compose.yml` and always override whatever is in `api/.env`; see the note at the end of this section.)

Below is every section of `api/.env.example`, what each variable does, and a sample value.

### Database

```env
DATABASE_URL=postgresql+psycopg2://pilotbase:pilotbase_secret@localhost:5432/pilotbase
```

Pilotbase's own internal store (users, saved connections, query history — not your target databases). **Leave this as-is for Docker** — the `app` container ignores this value and always connects to the bundled `db` service instead (see the override note below). It only matters if you're running the backend natively without Docker; see [Local Development Setup](local-development.md).

### Security — required before real use

```env
SECRET_KEY=change-me-generate-with-secrets-token-hex-32
ENCRYPTION_KEY=change-me-generate-with-fernet-generate_key=
```

| Variable | Purpose | Generate with |
|---|---|---|
| `SECRET_KEY` | Signs auth tokens | `python -c "import secrets; print(secrets.token_hex(32))"` |
| `ENCRYPTION_KEY` | Encrypts every saved connection password (Fernet) | `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` |

Pilotbase will start and run with the placeholder values, but don't leave them for anything beyond a quick local trial.

> **`ENCRYPTION_KEY` is a one-way door.** Set it before you create any database connections, and never change it afterward. Every stored connection password is encrypted with this key — change it later and Pilotbase can no longer decrypt existing passwords, forcing you to re-enter credentials everywhere. Generate it once, keep it stable (secrets manager, or a persisted `.env`).

### AI agent (optional — skip if you don't need it yet)

```env
OLLAMA_BASE_URL=https://ollama.com/v1
OLLAMA_API_KEY=your-ollama-apikey-goes-here
OLLAMA_MODEL=gemma4:31b-cloud
OLLAMA_FLASH_MODEL=gemma4:cloud
```

Powers the natural-language AI panel. Everything else in Pilotbase — connecting to databases, browsing schemas, running queries, migrations, backups — works without touching this section. Leave the defaults in place until you're ready to wire up an LLM; see [§4 below](#4-optional-turn-on-the-ai-agent) for what to change and when.

### External database connections

```env
DB_CONNECT_TIMEOUT_SECONDS=10
```

How long Pilotbase waits when connecting to a database *you* add through the UI (Postgres, MongoDB, Qdrant, etc. — any of the 19 supported engines) before giving up. Raise it for engines with a naturally slow handshake (e.g. cloud vector DBs doing auth); lower it to fail faster against unreachable hosts. The default of `10` works for most setups.

### Application

```env
ENVIRONMENT=development
STATIC_DIR=./static
BACKUPS_DIR=./backups
```

| Variable | Sample | Notes |
|---|---|---|
| `ENVIRONMENT` | `production` | Set to `production` for a real deployment — tightens CORS and security defaults. `development` is fine for local trials. |
| `STATIC_DIR` | `./static` | Where the built frontend is served from. **Ignored in Docker** — pinned to `/app/api/static` in `docker-compose.yml`. Only relevant for native/local runs. |
| `BACKUPS_DIR` | `./backups` | Where generated database backups are written. **Ignored in Docker** — pinned to `/app/api/backups`, matching the `pilotbase_backups` volume, so backups survive container rebuilds. Only relevant for native/local runs. |

### Auth

```env
AUTH_BACKEND=anon
```

`anon` (the default) is single-user/anonymous mode — a `user_anon_id` cookie, no login screen. Fine for self-hosted single-user or trusted-network use. To add real authentication later, implement `AuthBackend` in `api/app/auth/base.py` and point this at its dotted Python path (e.g. `app.auth.my_jwt_auth.JWTAuthBackend`). Not required to get started.

### CORS

```env
CORS_ORIGINS=http://localhost:5173,http://localhost:8000
```

Comma-separated list of origins allowed to call the API. The default covers the Docker deployment (`:8000`) and the Vite dev server (`:5173`). Add your own domain if you're exposing Pilotbase somewhere else, e.g.:

```env
CORS_ORIGINS=https://pilotbase.mycompany.com
```

---

## 3. Start Pilotbase

```bash
docker compose up --build
```

Pilotbase will be live at **[http://localhost:8000](http://localhost:8000)**. First run builds the frontend and installs dependencies inside the image (2-3 minutes); subsequent starts are near-instant.

**That's the whole core setup.** Open the UI, add a connection to any of your databases (PostgreSQL, MySQL, MongoDB, Redis, Qdrant, ...), and start browsing and querying. Everything below is optional and can be configured later, whenever you actually need it.

---

## 4. (Optional) Turn on the AI agent

Skip this if you just want to browse and query databases — it works without any AI configuration.

The AI panel talks to any OpenAI-compatible LLM endpoint. Two ways to set it up:

**A. Ollama's hosted cloud (no GPU needed)** — leave `OLLAMA_BASE_URL` at its default and just set a real key:

```env
OLLAMA_API_KEY=<your real Ollama API key>
```

**B. A local Ollama install:**

1. Install from [ollama.com/download](https://ollama.com/download) and pull a model: `ollama pull gemma4:31b-cloud`
2. In `api/.env`:
   ```env
   OLLAMA_BASE_URL=http://localhost:11434/v1
   OLLAMA_MODEL=<your model name>
   OLLAMA_API_KEY=ollama
   ```
3. `docker compose up -d --build` to pick up the change

Any other OpenAI-compatible provider (OpenAI, Groq, Together AI, Anthropic via proxy, etc.) works the same way — set `OLLAMA_BASE_URL` to its endpoint and `OLLAMA_API_KEY` to the matching key.

## 5. (Optional) Relocate backups

Skip this if the default location is fine — automated backups already work out of the box, written inside the `pilotbase_backups` volume so they survive rebuilds.

To change where they're stored inside the container:

1. Edit `BACKUPS_DIR` under the `app` service's `environment:` block in `docker-compose.yml` (not `api/.env` — see the override note in §2)
2. Update the matching volume mount (`pilotbase_backups:/app/api/backups`) so the new path is still persisted
3. `docker compose up -d --build`

If you skip step 2, backups still get written but won't survive a container rebuild.

## 6. (Optional) Schema migration

No configuration needed — migration (diffing and applying schema changes across two connections) works directly from the UI once you've added the connections you want to migrate between.

## 7. (Optional) Public API access per connection

No environment configuration needed either. Each saved connection can independently expose a token-based public API (create/read/update/delete rows over HTTP) — enable it and generate a token from that connection's settings in the UI when you need it.

---

## Local development (no Docker)

Running the backend and frontend separately with hot reload uses a different file, `ui/.env.local`, in addition to `api/.env` — see [Local Development Setup](local-development.md) for the full walkthrough. `ui/.env.local` is **not used by Docker at all** (it's excluded from the build context) — the Docker image serves the built frontend and API from the same origin, so no separate frontend URL config is needed there.

---

← [Back to README](../README.md) · See also: [Configuration Reference](configuration.md) (flat variable table) · [Supported Databases](supported-databases.md)
