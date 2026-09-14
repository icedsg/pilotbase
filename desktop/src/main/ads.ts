import { BrowserWindow, WebContentsView, net, session, shell } from 'electron'
import { join } from 'path'
import { installAdSessionPolicy } from './netpolicy'

// DECISION NEEDED (docs/desktop-plan.md §5.4): the ad network and its exact
// domain list. Empty until decided — only the bundled local placeholder page
// loads, nothing external.
export const AD_HOSTS: string[] = []

// Standard 468x60 banner, centered in the top bar. TopBar.tsx reserves a
// 68px-tall header in desktop mode to fit it — keep the two in sync.
const WIDTH = 468
const HEIGHT = 60
const TOP = 4
const ONLINE_CHECK_INTERVAL_MS = 30_000

export class AdBox {
  private readonly view: WebContentsView
  private attached = false
  private readonly timer: ReturnType<typeof setInterval>

  constructor(private win: BrowserWindow, resourcesPath: string) {
    const adSession = session.fromPartition('persist:ads')
    installAdSessionPolicy(adSession, AD_HOSTS)

    this.view = new WebContentsView({
      webPreferences: {
        session: adSession,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        autoplayPolicy: 'no-user-gesture-required',
      },
    })
    this.view.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url)
      return { action: 'deny' }
    })
    this.view.webContents.on('will-navigate', (event) => event.preventDefault())
    this.view.webContents.loadFile(join(resourcesPath, 'ad', 'index.html'))

    this.reposition()
    win.on('resize', () => this.reposition())

    this.refreshOnlineState()
    this.timer = setInterval(() => this.refreshOnlineState(), ONLINE_CHECK_INTERVAL_MS)
  }

  private reposition(): void {
    const [winWidth] = this.win.getContentSize()
    this.view.setBounds({ x: Math.round((winWidth - WIDTH) / 2), y: TOP, width: WIDTH, height: HEIGHT })
  }

  refreshOnlineState(): void {
    const online = net.isOnline()
    if (online && !this.attached) {
      this.win.contentView.addChildView(this.view)
      this.view.webContents.reload()
      this.attached = true
    } else if (!online && this.attached) {
      this.win.contentView.removeChildView(this.view)
      this.attached = false
    }
  }

  destroy(): void {
    clearInterval(this.timer)
  }
}
