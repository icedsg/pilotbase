# Configuration Reference

Flat variable reference. For a guided, section-by-section walkthrough with sample values (recommended for first-time setup), see the **[Installation Guide](installation.md)**.

All settings are read from environment variables or `api/.env`. In Docker, `docker-compose.yml` loads `api/.env` via `env_file:` for the app container.

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql+psycopg2://pilotbase:pilotbase_secret@localhost:5432/pilotbase` | Pilotbase's own internal store |
| `SECRET_KEY` | `change-me` | JWT signing secret — **always override in production** |
| `ENCRYPTION_KEY` | `change-me-must-be-valid-fernet-key=` | Fernet key for stored DB credentials — **always override in production** |
| `OLLAMA_BASE_URL` | `https://ollama.com/v1` | OpenAI-compatible LLM base URL (use `http://localhost:11434/v1` for local Ollama) |
| `OLLAMA_MODEL` | `gemma4:31b-cloud` | Primary reasoning model for the AI agent |
| `OLLAMA_FLASH_MODEL` | `gemma4:cloud` | Faster model for lightweight agent steps |
| `OLLAMA_API_KEY` | `ollama` | API key (`ollama` for local, real key for hosted providers) |
| `AUTH_BACKEND` | `anon` | `anon` for single-user/anonymous, or dotted path to a custom `AuthBackend` class |
| `ENVIRONMENT` | `development` | Set to `production` for tighter CORS and security defaults |
| `CORS_ORIGINS` | `http://localhost:5173,...` | Comma-separated allowed origins |
| `DB_CONNECT_TIMEOUT_SECONDS` | `10` | Seconds to wait when connecting to a user-added database (any engine) before giving up. Lower it to fail faster against unreachable hosts; raise it for engines with a naturally slow handshake. |
| `BACKUPS_DIR` | `./backups` | Directory where generated database backups are written, relative to the `api/` working directory. See note below for changing this in a Docker deployment. |

See `api/.env.example` for a complete, copy-pasteable template covering every variable above.

**Four variables are pinned in Docker regardless of `api/.env`:** `DATABASE_URL`, `PORT`, `STATIC_DIR`, and `BACKUPS_DIR` are set directly under the `app` service's `environment:` block in `docker-compose.yml`, which takes precedence over the `env_file:` values from `api/.env`. This is intentional — they're tied to the container's internal topology (the `db` service hostname, the exposed port, and paths that match the persisted volume). Every other variable flows from `api/.env` as normal.

**Changing `BACKUPS_DIR` in a Docker deployment:**

1. Edit `BACKUPS_DIR` under `environment:` in `docker-compose.yml`
2. Update the matching volume mount (`pilotbase_backups:/app/api/backups`) so the new path is persisted outside the container
3. Restart with `docker compose up -d --build`

If you don't change the volume mount to match, backups will still be written but won't survive a container rebuild.

**Using a local Ollama instance instead of the cloud:** see [Setting Up Ollama](../README.md#setting-up-ollama-for-the-ai-agent) in the main README.

**Using a different hosted LLM:**

Set `OLLAMA_BASE_URL` to any OpenAI-compatible endpoint and provide the appropriate `OLLAMA_API_KEY`. Works with OpenAI, Groq, Together AI, Anthropic (via proxy), and others.

---

← [Back to README](../README.md)
