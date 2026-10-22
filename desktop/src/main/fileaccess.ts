import { app, BrowserWindow, dialog } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

// SQLite/DuckDB files picked in the native dialog. In the Mac App Store build
// the app is sandboxed: a path typed by hand is unreadable, so the dialog's
// security-scoped bookmark is kept per path and opened again on every launch
// (before the sidecar starts, which inherits the app's sandbox).

type Bookmarks = Record<string, string>

function bookmarksFile(dataDir: string): string {
  return join(dataDir, 'file-access.json')
}

function load(dataDir: string): Bookmarks {
  try {
    return JSON.parse(readFileSync(bookmarksFile(dataDir), 'utf8'))
  } catch {
    return {}
  }
}

function remember(dataDir: string, path: string, bookmark: string | undefined): void {
  if (!process.mas || !bookmark) return
  const all = load(dataDir)
  all[path] = bookmark
  try {
    writeFileSync(bookmarksFile(dataDir), JSON.stringify(all), { mode: 0o600 })
  } catch {
    // best-effort: the file stays usable until the app quits
  }
  app.startAccessingSecurityScopedResource(bookmark)
}

/** Re-opens access to every remembered file (store build only). */
export function restoreFileAccess(dataDir: string): void {
  if (!process.mas) return
  for (const bookmark of Object.values(load(dataDir))) {
    try {
      app.startAccessingSecurityScopedResource(bookmark)
    } catch {
      // a moved or deleted file: the connection test will say so
    }
  }
}

const FILTERS: Record<string, Electron.FileFilter[]> = {
  sqlite: [{ name: 'SQLite database', extensions: ['db', 'sqlite', 'sqlite3', 'db3'] }, { name: 'All files', extensions: ['*'] }],
  duckdb: [{ name: 'DuckDB database', extensions: ['duckdb', 'db'] }, { name: 'All files', extensions: ['*'] }],
}

/** Native open ("open") or new-file ("new") dialog; resolves to the path or null. */
export async function chooseDatabaseFile(
  win: BrowserWindow,
  dataDir: string,
  mode: 'open' | 'new',
  dbType: string,
): Promise<string | null> {
  const filters = FILTERS[dbType] ?? FILTERS.sqlite
  if (mode === 'new') {
    const res = await dialog.showSaveDialog(win, {
      title: 'New database file',
      defaultPath: dbType === 'duckdb' ? 'database.duckdb' : 'database.db',
      filters,
      securityScopedBookmarks: !!process.mas,
    })
    if (res.canceled || !res.filePath) return null
    remember(dataDir, res.filePath, res.bookmark)
    return res.filePath
  }
  const res = await dialog.showOpenDialog(win, {
    title: 'Choose database file',
    properties: ['openFile'],
    filters,
    securityScopedBookmarks: !!process.mas,
  })
  if (res.canceled || res.filePaths.length === 0) return null
  remember(dataDir, res.filePaths[0], res.bookmarks?.[0])
  return res.filePaths[0]
}
