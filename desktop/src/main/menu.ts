import { app, clipboard, Menu, MenuItemConstructorOptions, shell } from 'electron'
import { join } from 'path'

/** claude_desktop_config.json entry that launches the stdio MCP bridge
 * (api/app/mcp/bridge.py) against this install's data dir. */
function mcpConfigSnippet(dataDir: string): string {
  const server = app.isPackaged
    ? {
        command: join(process.resourcesPath, 'sidecar', 'pilotbase-api' + (process.platform === 'win32' ? '.exe' : '')),
        args: ['--mcp-bridge', '--data-dir', dataDir],
      }
    : {
        command: 'python',
        args: [join(__dirname, '..', '..', '..', 'api', 'main.py'), '--mcp-bridge', '--data-dir', dataDir],
      }
  return JSON.stringify({ mcpServers: { pilotbase: server } }, null, 2)
}

export function buildMenu(
  dataDir: string,
  logsDir: string,
  isDev: boolean,
  onOpenSettings: () => void,
): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Pilotbase',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: onOpenSettings },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' },
        { role: 'togglefullscreen' },
        ...(isDev ? [{ role: 'toggleDevTools' } as MenuItemConstructorOptions] : []),
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Open logs folder', click: () => shell.openPath(logsDir) },
        { label: 'Open data folder', click: () => shell.openPath(dataDir) },
        { label: 'Copy Claude MCP config', click: () => clipboard.writeText(mcpConfigSnippet(dataDir)) },
        { label: 'Pilotbase on GitHub', click: () => shell.openExternal('https://github.com/icedsg/pilotbase') },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
