import { Menu, MenuItemConstructorOptions, shell } from 'electron'

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
        { label: 'Pilotbase on GitHub', click: () => shell.openExternal('https://github.com/icedsg/pilotbase') },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
