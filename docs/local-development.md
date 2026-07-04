# Local Development Setup

**Requirements:** Python 3.13+, Node.js 20+, PostgreSQL 14+ (for Pilotbase's internal metadata store).

## Backend

```bash
cd api
python3.13 -m venv venv

# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

pip install -r requirements.txt
cp .env.example .env   # edit .env with your settings
alembic upgrade head   # run migrations
python main.py         # starts on http://localhost:8000
```

Before your first run, set `ENCRYPTION_KEY` in `.env` to a real Fernet key (generate with `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`) — the default value in `config.py` is only a placeholder and is not safe to use as-is. Once you've saved connections with a given key, don't change it (see the note in the [Quick Start](../README.md#quick-start-docker--recommended) section of the main README for why).

## Frontend (with hot reload)

In a separate terminal:

```bash
cd ui
npm install
npm run dev   # starts on http://localhost:5173
```

The Vite dev server proxies `/api` to the backend automatically.

---

← [Back to README](../README.md)
