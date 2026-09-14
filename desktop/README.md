# Pilotbase Desktop

A native Windows/macOS/Linux app for Pilotbase — the same FastAPI backend and React UI,
wrapped in Electron with no Docker or Postgres required. Data is stored locally in SQLite.
See [`docs/desktop-plan.md`](../docs/desktop-plan.md) for the full technical spec.

## Prerequisites

- Node.js 20+
- Python 3.13 with a virtual environment set up in `api/venv` (see the main [README](../README.md))
- On Windows, build tools for any native Python deps you use (usually not needed)

## Run in development

Electron loads the app from the FastAPI backend directly (not the Vite dev server), so the
frontend needs to be built first:

```bash
# 1. Build the frontend and copy it where the backend serves it from
cd ui
npm install
npm run build
rm -rf ../api/static && cp -r dist ../api/static
# Windows PowerShell: Remove-Item -Recurse -Force ..\api\static -ErrorAction SilentlyContinue; Copy-Item -Recurse dist ..\api\static

# 2. Make sure the backend's Python deps are installed
cd ../api
./venv/Scripts/pip install -r requirements.txt   # macOS/Linux: venv/bin/pip

# 3. Install and launch the desktop shell
cd ../desktop
npm install
npm run dev
```

`npm run dev` compiles the Electron TypeScript and launches the app. In dev mode it spawns
`python api/main.py` directly (not a packaged sidecar binary), on `127.0.0.1` with a random
port and a per-launch token — the same as a packaged build.

Re-run step 1 whenever you change frontend code; the Electron main process (`desktop/src`)
picks up changes on the next `npm run dev`. Clearing `api/static` first (rather than copying
over it) avoids stale files nesting inside it on repeat builds.

## Build a distributable

**You can only build for the OS you're currently on.** Both PyInstaller (the backend sidecar
binary) and electron-builder's code signing are platform-locked — there is no cross-compiling.
Running the steps below on Windows produces only the `.exe`; you need an actual Mac to produce
the `.dmg` and an actual Linux machine (or container) to produce the `.AppImage`. `win`/`mac`/
`linux` all being listed in `electron-builder.yml` does not change this — it only controls which
target electron-builder picks *on the machine it's running on*.

If you need all three at once, skip the manual steps entirely and use CI (see below).

### Manual build, per OS

```bash
# 1. Build the frontend (as above) into api/static

# 2. Build the backend sidecar binary — must run on the target OS
cd api
pip install -r requirements.txt   # pyinstaller is already in requirements.txt
pyinstaller pilotbase-api.spec
# produces api/dist/pilotbase-api/ (this is the platform-specific binary — do not copy it
# between machines/OSes, rebuild it on each one)

# 3. Build the Electron app
cd ../desktop
npm install
npm run build
```

Output lands in `desktop/release/`:

| OS | File |
|---|---|
| Windows | `Pilotbase-Setup-<version>-win-x64.exe` (one-click installer, per-user — installs to `%LOCALAPPDATA%\Programs\Pilotbase`, never prompts for admin) |
| macOS | `Pilotbase-<version>-mac-x64.dmg` / `Pilotbase-<version>-mac-arm64.dmg` |
| Linux | `Pilotbase-<version>-linux-x64.AppImage` |

Unsigned builds work fine for local testing, but expect OS gatekeeping on a fresh machine:
- **macOS**: an unsigned/unnotarized `.dmg` is blocked by Gatekeeper — right-click the app →
  **Open** (once) to bypass it, or `xattr -cr /Applications/Pilotbase.app` after install.
- **Windows**: an unsigned `.exe` triggers a SmartScreen "unknown publisher" warning — click
  **More info → Run anyway**.
- **Linux**: the `.AppImage` needs `chmod +x` before it will run.

Real signing (macOS notarization, Windows Authenticode) only happens in CI, and only when the
relevant secrets are configured — see `docs/desktop-plan.md` §6.3.

### Recommended: build all platforms via CI

`.github/workflows/desktop.yml` runs the exact steps above across four runners (`windows-latest`,
`macos-14` for arm64, `macos-13` for x64, `ubuntu-22.04`) in parallel and uploads all four
artifacts, so this is the easiest way to get every platform's build without owning every
platform's hardware. It triggers on any pushed tag matching `v*.*.*`:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Each job's output is attached to the GitHub Release for that tag and also uploaded as a
workflow artifact (Actions tab → the run → Artifacts) if you just want to grab a build without
cutting a release. If the signing secrets (`WIN_CSC_LINK`/`WIN_CSC_KEY_PASSWORD`,
`CSC_LINK`/`CSC_KEY_PASSWORD`, `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID`) aren't
configured in the repo, the build still succeeds but produces unsigned artifacts — see the
gatekeeping notes above for what that means for anyone installing them.

## Using the app

- **First launch**: the app opens straight to the connection list — no login, no setup wizard.
- **Settings** (gear icon in the icon bar, or `Cmd/Ctrl+,`): choose the AI provider —
  **Ollama** (local, default) or **OpenRouter** — set the base URL/model, and hit **Test**
  before saving.
- **Data location**: everything (the SQLite database, backups, logs, encryption secrets) lives
  under the OS-standard app data folder:
  - Windows: `%APPDATA%\Pilotbase`
  - macOS: `~/Library/Application Support/Pilotbase`
  - Linux: `~/.config/Pilotbase`

  Open it from the **Help → Open data folder** menu item.
- **Logs**: `Help → Open logs folder`, or `<data folder>/logs/backend.log`.
- **Network**: the backend only ever binds to `127.0.0.1` on a random port with a per-launch
  secret token — it is never reachable from the network, and the app window can't navigate
  anywhere else.
- **Uninstalling / resetting**: uninstall the app normally, then delete the data folder above
  if you want to remove your databases connections and settings too (this is not done for you).

## Troubleshooting

- **App shows an error dialog on launch**: check `<data folder>/logs/backend.log` for the
  Python traceback — this is the same backend that runs under Docker, so most errors are
  regular backend issues (bad `requirements.txt` install, a locked SQLite file, etc.).
- **Blank window**: usually means `api/static` wasn't built/copied before running `npm run dev`
  — repeat step 1 above.
- **Port already in use**: shouldn't happen (the OS assigns the port), but if you see it, another
  process is likely holding `127.0.0.1` briefly — just relaunch.
