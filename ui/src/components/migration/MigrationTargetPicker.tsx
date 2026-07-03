import { useEffect, useState } from 'react'
import { X, GitMerge, Loader2 } from 'lucide-react'
import { apiListDatabases, apiSchemaDiff } from '../../api/client'
import { useUserSession } from '../../hooks/useUserSession'
import { useStore } from '../../store'

const SELECT_CLS = 'w-full bg-surface-300 border border-surface-50 rounded px-3 py-1.5 text-gray-800 dark:text-gray-200 focus:outline-none focus:border-accent text-sm'

interface Props {
  sourceConnId: string
  sourceDb: string
  onClose: () => void
}

export default function MigrationTargetPicker({ sourceConnId, sourceDb, onClose }: Props) {
  const { userId } = useUserSession()
  const { connections, setMigrationViewContext } = useStore()
  const candidates = connections.filter((c) => c.id !== sourceConnId)

  const [targetConnId, setTargetConnId] = useState(candidates[0]?.id ?? '')
  const [targetDbs, setTargetDbs] = useState<string[]>([])
  const [targetDb, setTargetDb] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => {
    if (!targetConnId) return
    apiListDatabases(userId, targetConnId)
      .then((r) => { setTargetDbs(r.databases); setTargetDb(r.databases[0] ?? '') })
      .catch(() => setTargetDbs([]))
  }, [targetConnId, userId])

  const runDiff = async () => {
    if (!targetConnId) return
    setLoading(true)
    setError('')
    try {
      await apiSchemaDiff(userId, sourceConnId, targetConnId)
      setMigrationViewContext({ sourceConnId, sourceDb, targetConnId, targetDb: targetDb || null })
      onClose()
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to compare schemas.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-100 border border-surface-50 rounded-xl shadow-2xl w-full max-w-md flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-50">
          <div className="flex items-center gap-2">
            <GitMerge size={18} className="text-gray-500" />
            <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Plan Migration</h2>
          </div>
          <button onClick={onClose} className="btn-ghost p-1"><X size={20} /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="text-xs text-gray-500">
            Compare <span className="font-mono text-gray-700 dark:text-gray-300">{sourceDb}</span> against another connection.
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Target connection</label>
            <select className={SELECT_CLS} value={targetConnId} onChange={(e) => setTargetConnId(e.target.value)}>
              {candidates.length === 0 && <option value="">No other connections available</option>}
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>{c.name} ({c.db_type})</option>
              ))}
            </select>
          </div>

          {targetDbs.length > 0 && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Target database</label>
              <select className={SELECT_CLS} value={targetDb} onChange={(e) => setTargetDb(e.target.value)}>
                {targetDbs.map((db) => <option key={db} value={db}>{db}</option>)}
              </select>
            </div>
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button
            onClick={runDiff}
            disabled={!targetConnId || loading}
            className="w-full flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover text-white px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <GitMerge size={14} />}
            Compare schemas
          </button>
        </div>
      </div>
    </div>
  )
}
