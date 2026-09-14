import { app, BrowserWindow, dialog, ipcMain, session, screen, shell } from 'electron'
import { randomBytes } from 'crypto'
import http from 'http'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

import { buildMenu } from './menu'
import { installDefaultSessionPolicy } from './netpolicy'
import { loadOrCreateSecrets } from './secrets'
import { Sidecar } from './sidecar'

const isDev = !app.isPackaged

// ── Single instance ──────────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

let mainWindow: BrowserWindow | null = null
let splashWindow: BrowserWindow | null = null
let sidecar: Sidecar | null = null
let currentPort = 0

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

// ── Window bounds persistence ────────────────────────────────────────────────
interface Bounds { x: number; y: number; width: number; height: number }

function boundsFile(dataDir: string): string {
  return join(dataDir, 'window.json')
}

function loadBounds(dataDir: string): Bounds | null {
  try {
    return JSON.parse(readFileSync(boundsFile(dataDir), 'utf8'))
  } catch {
    return null
  }
}

function saveBounds(dataDir: string, win: BrowserWindow): void {
  try {
    writeFileSync(boundsFile(dataDir), JSON.stringify(win.getBounds()))
  } catch {
    // best-effort
  }
}

function clampToDisplay(bounds: Bounds): Bounds {
  const area = screen.getDisplayMatching(bounds).workArea
  const width = Math.min(bounds.width, area.width)
  const height = Math.min(bounds.height, area.height)
  const x = Math.min(Math.max(bounds.x, area.x), area.x + area.width - width)
  const y = Math.min(Math.max(bounds.y, area.y), area.y + area.height - height)
  return { x, y, width, height }
}

// ── Backend health poll ──────────────────────────────────────────────────────
function waitForHealth(port: number, token: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(
        { host: '127.0.0.1', port, path: '/api/v1/health', headers: { 'X-Pilotbase-Token': token }, timeout: 1000 },
        (res) => {
          res.resume()
          if (res.statusCode === 200) resolve()
          else retry()
        },
      )
      req.on('error', retry)
      req.on('timeout', () => { req.destroy(); retry() })
    }
    const retry = () => {
      if (Date.now() > deadline) reject(new Error('Backend health check timed out.'))
      else setTimeout(attempt, 250)
    }
    attempt()
  })
}

// Packaged: leave STATIC_DIR unset so the sidecar resolves its own bundled
// static dir relative to its PyInstaller extraction root (main.py's
// sys._MEIPASS fallback) — the exact layout under resources/sidecar is a
// PyInstaller implementation detail (e.g. an `_internal/` subfolder) that
// shouldn't be hardcoded here.
function sidecarStaticDirForDev(): string {
  return join(__dirname, '..', '..', '..', 'ui', 'dist')
}

function splashFile(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'splash', 'index.html')
    : join(__dirname, '..', '..', 'resources', 'splash', 'index.html')
}

function iconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '..', '..', 'resources', 'icon.png')
}

function createSplashWindow(): void {
  splashWindow = new BrowserWindow({
    width: 440,
    height: 300,
    frame: false,
    resizable: false,
    movable: false,
    center: true,
    show: false,
    icon: iconPath(),
    backgroundColor: '#0d1b33',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  splashWindow.once('ready-to-show', () => splashWindow?.show())
  splashWindow.loadFile(splashFile(), { query: { v: app.getVersion() } })
}

function setSplashStatus(text: string): void {
  splashWindow?.webContents
    .executeJavaScript(`document.getElementById('status').textContent = ${JSON.stringify(text)}`)
    .catch(() => { /* splash may already be closing — best-effort */ })
}

function closeSplash(): void {
  splashWindow?.close()
  splashWindow = null
}

async function createWindow(dataDir: string, port: number): Promise<void> {
  const saved = loadBounds(dataDir)
  const bounds = saved ? clampToDisplay(saved) : null

  mainWindow = new BrowserWindow({
    width: bounds?.width ?? 1400,
    height: bounds?.height ?? 900,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    icon: iconPath(),
    webPreferences: {
      preload: join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [
        `--pilotbase-version=${app.getVersion()}`,
        `--pilotbase-data-dir=${dataDir}`,
      ],
    },
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow!.show()
    closeSplash()
  })
  mainWindow.on('resize', () => saveBounds(dataDir, mainWindow!))
  mainWindow.on('move', () => saveBounds(dataDir, mainWindow!))

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // Reads currentPort (not the `port` this window was created with) so a
    // post-crash restart on a new port doesn't make this block same-origin
    // navigation against a now-stale port number.
    if (!url.startsWith(`http://127.0.0.1:${currentPort}`)) event.preventDefault()
  })

  ipcMain.on('desktop:open-external', (_event, url: string) => {
    if (/^https?:\/\//.test(url) || url.startsWith(`file://${dataDir}`)) {
      shell.openExternal(url)
    }
  })
  ipcMain.on('desktop:open-settings', () => {
    mainWindow?.webContents.send('desktop:open-settings')
  })

  buildMenu(dataDir, join(dataDir, 'logs'), isDev, () => {
    mainWindow?.webContents.send('desktop:open-settings')
  })

  await mainWindow.loadURL(`http://127.0.0.1:${port}/`)

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function buildSidecarEnv(dataDir: string, secretKey: string, encryptionKey: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ENVIRONMENT: 'production',
    AUTH_BACKEND: 'anon',
    SECRET_KEY: secretKey,
    ENCRYPTION_KEY: encryptionKey,
    ANONYMIZED_TELEMETRY: 'False',
    DO_NOT_TRACK: '1',
    SCARF_NO_ANALYTICS: 'true',
    HF_HUB_OFFLINE: '1',
    PYTHONUNBUFFERED: '1',
  }
  if (!app.isPackaged) env.STATIC_DIR = sidecarStaticDirForDev()
  return env
}

async function main(): Promise<void> {
  createSplashWindow()
  setSplashStatus('Starting backend…')

  const dataDir = app.getPath('userData')
  const secrets = loadOrCreateSecrets(dataDir)
  const token = randomBytes(32).toString('hex')

  sidecar = new Sidecar({
    dataDir,
    token,
    env: buildSidecarEnv(dataDir, secrets.secretKey, secrets.encryptionKey),
  })

  sidecar.start(
    // Called once on first launch, and again if the sidecar crashes and
    // auto-restarts (a new `--port 0` each time) — reload the existing
    // window rather than leaving it pointed at a dead port.
    async (port) => {
      try {
        setSplashStatus('Waiting for backend…')
        await waitForHealth(port, token, 10_000)
        currentPort = port
        await session.defaultSession.cookies.set({
          url: `http://127.0.0.1:${port}`,
          name: 'pilotbase_token',
          value: token,
          httpOnly: true,
          sameSite: 'strict',
        })
        installDefaultSessionPolicy(session.defaultSession, port, isDev)
        if (mainWindow) {
          await mainWindow.loadURL(`http://127.0.0.1:${port}/`)
        } else {
          setSplashStatus('Loading interface…')
          await createWindow(dataDir, port)
        }
      } catch (err) {
        closeSplash()
        dialog.showErrorBox('Pilotbase', `Backend did not become ready: ${(err as Error).message}`)
        app.quit()
      }
    },
    (message) => {
      closeSplash()
      dialog.showErrorBox('Pilotbase', message)
      app.quit()
    },
  )
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', async (event) => {
  if (sidecar) {
    event.preventDefault()
    const s = sidecar
    sidecar = null
    await s.stop()
    app.quit()
  }
})

if (gotLock) {
  app.whenReady().then(main)
}
