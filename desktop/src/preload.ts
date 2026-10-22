import { contextBridge, ipcRenderer } from 'electron'

function getArg(name: string): string {
  const prefix = `--${name}=`
  const found = process.argv.find((a) => a.startsWith(prefix))
  return found ? found.slice(prefix.length) : ''
}

// Exactly the DesktopBridge shape from ui/src/lib/desktop.ts — nothing else
// is exposed to the renderer (docs/desktop-plan.md §5.6).
contextBridge.exposeInMainWorld('desktop', {
  version: getArg('pilotbase-version'),
  platform: process.platform,
  dataDir: getArg('pilotbase-data-dir'),
  openExternal: (url: string) => ipcRenderer.send('desktop:open-external', url),
  openSettings: () => ipcRenderer.send('desktop:open-settings'),
  chooseFile: (mode: 'open' | 'new', dbType: string): Promise<string | null> =>
    ipcRenderer.invoke('desktop:choose-file', mode, dbType),
  storeBuild: getArg('pilotbase-store') === '1',
  onOpenSettings: (cb: () => void) => {
    const listener = () => cb()
    ipcRenderer.on('desktop:open-settings', listener)
    return () => ipcRenderer.removeListener('desktop:open-settings', listener)
  },
})
