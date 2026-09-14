import { app } from 'electron'
import { spawn, ChildProcessByStdio } from 'child_process'
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'fs'
import { join } from 'path'
import type { Readable } from 'stream'

const READY_RE = /^PILOTBASE_READY port=(\d+)$/m
const MAX_LOG_BYTES = 5 * 1024 * 1024
const MAX_LOG_BACKUPS = 3
const MAX_RESTARTS = 3
const RESTART_WINDOW_MS = 60_000

export interface SidecarOptions {
  dataDir: string
  token: string
  env: NodeJS.ProcessEnv
}

/** Spawns and supervises the FastAPI backend (docs/desktop-plan.md §5.2). */
export class Sidecar {
  private proc: ChildProcessByStdio<null, Readable, Readable> | null = null
  private port = 0
  private restarts: number[] = []
  private stopping = false
  private stdoutBuffer = ''
  private readonly logPath: string

  constructor(private opts: SidecarOptions) {
    const logsDir = join(opts.dataDir, 'logs')
    mkdirSync(logsDir, { recursive: true })
    this.logPath = join(logsDir, 'backend.log')
  }

  getPort(): number {
    return this.port
  }

  getLogPath(): string {
    return this.logPath
  }

  private appendLog(chunk: Buffer | string): void {
    try {
      if (existsSync(this.logPath) && statSync(this.logPath).size > MAX_LOG_BYTES) {
        this.rotateLog()
      }
      appendFileSync(this.logPath, chunk)
    } catch {
      // Logging is best-effort — never let a log write failure crash the app.
    }
  }

  private rotateLog(): void {
    for (let i = MAX_LOG_BACKUPS - 1; i >= 0; i--) {
      const from = i === 0 ? this.logPath : `${this.logPath}.${i}`
      const to = `${this.logPath}.${i + 1}`
      if (existsSync(from)) {
        try { renameSync(from, to) } catch { /* best-effort */ }
      }
    }
  }

  private resolveCommand(): { cmd: string; args: string[]; cwd: string } {
    const args = [
      '--host', '127.0.0.1',
      '--port', '0',
      '--token', this.opts.token,
      '--data-dir', this.opts.dataDir,
    ]
    if (!app.isPackaged) {
      const apiDir = join(__dirname, '..', '..', '..', 'api')
      return { cmd: 'python', args: [join(apiDir, 'main.py'), ...args], cwd: apiDir }
    }
    const sidecarDir = join(process.resourcesPath, 'sidecar')
    const bin = join(sidecarDir, 'pilotbase-api' + (process.platform === 'win32' ? '.exe' : ''))
    return { cmd: bin, args, cwd: sidecarDir }
  }

  start(onReady: (port: number) => void, onFatal: (message: string) => void): void {
    this.stopping = false
    this.port = 0
    this.stdoutBuffer = ''

    const { cmd, args, cwd } = this.resolveCommand()
    const proc = spawn(cmd, args, { env: this.opts.env, cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    this.proc = proc

    proc.stdout.on('data', (chunk: Buffer) => {
      this.appendLog(chunk)
      if (this.port === 0) {
        this.stdoutBuffer += chunk.toString('utf8')
        const match = this.stdoutBuffer.match(READY_RE)
        if (match) {
          this.port = parseInt(match[1], 10)
          onReady(this.port)
        }
      }
    })
    proc.stderr.on('data', (chunk: Buffer) => this.appendLog(chunk))

    proc.on('exit', (code) => {
      this.appendLog(`\n[sidecar] exited with code ${code}\n`)
      this.proc = null
      this.port = 0
      if (this.stopping) return

      const now = Date.now()
      this.restarts = this.restarts.filter((t) => now - t < RESTART_WINDOW_MS)
      this.restarts.push(now)
      if (this.restarts.length > MAX_RESTARTS) {
        onFatal(`Pilotbase backend stopped unexpectedly. See logs at ${this.logPath}.`)
        return
      }
      this.start(onReady, onFatal)
    })
  }

  async stop(): Promise<void> {
    if (!this.proc) return
    this.stopping = true
    const proc = this.proc
    this.proc = null

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => proc.kill('SIGKILL'), 5000)
      proc.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      proc.kill('SIGTERM')
    })
  }
}
