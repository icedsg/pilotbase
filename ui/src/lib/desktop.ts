// Typed access to the bridge the Electron preload script exposes on
// `window.desktop` (see docs/desktop-plan.md §4.1/§5.6). Undefined when
// running as a plain web app — every call site must check `isDesktop` first.
export interface DesktopBridge {
  version: string
  platform: 'win32' | 'darwin' | 'linux'
  dataDir: string
  openExternal(url: string): void
  openSettings(): void
  onOpenSettings(cb: () => void): () => void
  /** Native file dialog for SQLite/DuckDB files; null when cancelled. Missing in builds before CR-0297. */
  chooseFile?(mode: 'open' | 'new', dbType: string): Promise<string | null>
  /** Mac App Store build: sandboxed, so local files must come from chooseFile. */
  storeBuild?: boolean
}

export const desktop: DesktopBridge | undefined = (window as any).desktop
export const isDesktop = !!desktop

/** Opens `url` in the OS browser when running under Electron, otherwise lets
 * the normal `<a target="_blank">` behavior happen (see §4.3). */
export function openExternalLink(url: string, e?: { preventDefault: () => void }): void {
  if (isDesktop) {
    e?.preventDefault()
    desktop!.openExternal(url)
  }
}
