import type { Session } from 'electron'

function patternToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`)
}

function matchesAny(url: string, patterns: string[]): boolean {
  return patterns.some((p) => patternToRegex(p).test(url))
}

/** Only the app's own local server (and devtools in dev) may be reached from
 * the main window's session (docs/desktop-plan.md §5.4). */
export function installDefaultSessionPolicy(defaultSession: Session, port: number, devMode: boolean): void {
  const allowed = [`http://127.0.0.1:${port}/*`, `ws://127.0.0.1:${port}/*`]
  if (devMode) allowed.push('devtools://*')

  defaultSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    callback({ cancel: !matchesAny(details.url, allowed) })
  })
  defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
}

/** The ad partition may only load the bundled placeholder page plus whatever
 * `adHosts` names — empty until the ad network is decided (see ads.ts). */
export function installAdSessionPolicy(adSession: Session, adHosts: string[]): void {
  const allowed = ['file://*', ...adHosts.map((h) => `https://${h}/*`)]

  adSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    callback({ cancel: !matchesAny(details.url, allowed) })
  })
  adSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
}
