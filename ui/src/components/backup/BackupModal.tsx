import { useEffect, useState } from 'react'
import { X, Download, DatabaseBackup, Loader2, CheckCircle2, AlertCircle, AlertTriangle } from 'lucide-react'
import { apiRunBackup, apiListBackups, apiDownloadBackup, apiListDatabases } from '../../api/client'
import { useUserSession } from '../../hooks/useUserSession'
import { downloadBlob } from '../../utils/download'
import { useStore } from '../../store'

interface BackupEntry {
  filename: string
  size_bytes: number
  created_at: string
}

interface Props {
  connId: string
  /** Pre-selected database (e.g. right-clicked in the tree). If omitted, the
   * user picks from a dropdown, defaulting to the currently active database. */
  database?: string | null
  onClose: () => void
}

type Status = { kind: 'running' | 'success' | 'warning' | 'error'; text: string } | null

const SELECT_CLS = 'bg-surface-300 border border-surface-50 rounded px-2 py-1 text-xs text-gray-800 dark:text-gray-200 focus:outline-none focus:border-accent'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function BackupModal({ connId, database, onClose }: Props) {
  const { userId } = useUserSession()
  const { connections, activeDatabase } = useStore()
  const conn = connections.find((c) => c.id === connId)
  const [backups, setBackups] = useState<BackupEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>(null)
  const [lastCreated, setLastCreated] = useState<string | null>(null)
  const [databases, setDatabases] = useState<string[]>([])
  const [selectedDb, setSelectedDb] = useState<string>(database || activeDatabase || '')

  const refresh = () =>
    apiListBackups(userId, conn?.name)
      .then((r) => setBackups(r.backups))
      .catch(() => {})

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => {
    setLoading(true)
    refresh().finally(() => setLoading(false))
    if (!database) {
      apiListDatabases(userId, connId)
        .then((r) => {
          setDatabases(r.databases)
          setSelectedDb((prev) => prev || r.databases[0] || '')
        })
        .catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connId])

  const download = async (filename: string) => {
    setDownloading(filename)
    try {
      const blob = await apiDownloadBackup(userId, filename)
      downloadBlob(blob, filename)
    } catch (e: any) {
      setStatus({ kind: 'error', text: e?.response?.data?.detail || `Failed to download ${filename}.` })
    } finally {
      setDownloading(null)
    }
  }

  const runBackup = async () => {
    const targetDb = database || selectedDb || undefined
    setRunning(true)
    setStatus({ kind: 'running', text: `Running backup${targetDb ? ` of "${targetDb}"` : ''}… this can take a while for large databases.` })
    try {
      const res = await apiRunBackup(userId, connId, targetDb)
      setLastCreated(res.filename)
      await refresh()
      if (res.warning) {
        setStatus({ kind: 'warning', text: `${res.warning} (file: ${res.filename}, via ${res.method})` })
      } else {
        const countText = res.object_count != null ? ` (${res.object_count} objects)` : ''
        setStatus({ kind: 'success', text: `Backup created via ${res.method}${countText}: ${res.filename}. Starting download…` })
        await download(res.filename)
      }
    } catch (e: any) {
      setStatus({ kind: 'error', text: e?.response?.data?.detail || 'Backup failed. See server logs for details.' })
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-100 border border-surface-50 rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-50 flex-shrink-0">
          <div className="flex items-center gap-2">
            <DatabaseBackup size={18} className="text-gray-500" />
            <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Backups</h2>
            {conn && <span className="text-xs text-gray-500">— {conn.name}</span>}
          </div>
          <button onClick={onClose} className="btn-ghost p-1"><X size={20} /></button>
        </div>

        <div className="px-5 py-3 border-b border-surface-50 flex-shrink-0 space-y-2">
          <div className="flex items-center gap-2">
            <button
              onClick={runBackup}
              disabled={running || (!database && !selectedDb)}
              className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-white px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50"
            >
              {running ? <Loader2 size={14} className="animate-spin" /> : <DatabaseBackup size={14} />}
              Run backup now
            </button>

            {database ? (
              <span className="text-xs text-gray-500">database: <span className="font-mono text-gray-700 dark:text-gray-300">{database}</span></span>
            ) : databases.length > 0 ? (
              <select className={SELECT_CLS} value={selectedDb} onChange={(e) => setSelectedDb(e.target.value)}>
                {databases.map((db) => <option key={db} value={db}>{db}</option>)}
              </select>
            ) : null}
          </div>

          {status && (
            <p className={`flex items-center gap-1.5 text-xs ${
              status.kind === 'error' ? 'text-red-400'
                : status.kind === 'warning' ? 'text-yellow-400'
                : status.kind === 'success' ? 'text-green-400' : 'text-gray-500'
            }`}>
              {status.kind === 'running' && <Loader2 size={13} className="animate-spin flex-shrink-0" />}
              {status.kind === 'success' && <CheckCircle2 size={13} className="flex-shrink-0" />}
              {status.kind === 'warning' && <AlertTriangle size={13} className="flex-shrink-0" />}
              {status.kind === 'error' && <AlertCircle size={13} className="flex-shrink-0" />}
              <span>{status.text}</span>
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center gap-2 text-xs text-gray-500 py-10">
              <Loader2 size={16} className="animate-spin" /> Loading…
            </div>
          )}
          {!loading && backups.length === 0 && (
            <div className="text-center text-gray-600 text-xs py-10">No backups yet.</div>
          )}
          {backups.map((b) => (
            <div
              key={b.filename}
              className={`flex items-center justify-between gap-3 px-5 py-2.5 border-b border-surface-50/60 hover:bg-surface-200/40 ${
                b.filename === lastCreated ? 'bg-accent/5 border-l-2 border-l-accent' : ''
              }`}
            >
              <div className="min-w-0">
                <div className="text-xs font-mono text-gray-700 dark:text-gray-300 truncate" title={b.filename}>{b.filename}</div>
                <div className="text-[13px] text-gray-600">{formatSize(b.size_bytes)} · {new Date(b.created_at).toLocaleString()}</div>
              </div>
              <button
                onClick={() => download(b.filename)}
                disabled={downloading === b.filename}
                className="btn-ghost flex items-center gap-1 text-xs flex-shrink-0"
              >
                {downloading === b.filename ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                Download
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
