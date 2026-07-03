import { useEffect, useState } from 'react'
import { X, History, CheckCircle2, XCircle, Bot, User, Loader2 } from 'lucide-react'
import { apiGetQueryHistory } from '../../api/client'
import { useStore } from '../../store'
import type { QueryHistoryEntry } from '../../types'

interface Props {
  onClose: () => void
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

function mergeById(a: QueryHistoryEntry[], b: QueryHistoryEntry[]): QueryHistoryEntry[] {
  const byId = new Map(a.map((e) => [e.id, e]))
  for (const e of b) byId.set(e.id, e)
  return [...byId.values()].sort((x, y) => y.executed_at.localeCompare(x.executed_at))
}

export default function QueryHistoryPanel({ onClose }: Props) {
  const { queryHistory, setQueryHistory, connections } = useStore()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => {
    apiGetQueryHistory(300)
      .then((r) => setQueryHistory(mergeById(queryHistory, r.entries)))
      .catch(() => {})
      .finally(() => setLoading(false))
    // Fetch once on open; live executions arrive via WebSocket afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const connectionName = (id: string) => connections.find((c) => c.id === id)?.name ?? id

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-100 border border-surface-50 rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-50 flex-shrink-0">
          <div className="flex items-center gap-2">
            <History size={18} className="text-gray-500" />
            <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Query History</h2>
            <span className="text-xs text-gray-500">({queryHistory.length})</span>
          </div>
          <button onClick={onClose} className="btn-ghost p-1"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && queryHistory.length === 0 && (
            <div className="flex items-center justify-center gap-2 text-xs text-gray-500 py-10">
              <Loader2 size={16} className="animate-spin" /> Loading…
            </div>
          )}

          {!loading && queryHistory.length === 0 && (
            <div className="text-center text-gray-600 text-xs py-10">
              No queries have been executed yet.
            </div>
          )}

          {queryHistory.map((entry) => (
            <div
              key={entry.id}
              className="flex items-start gap-3 px-5 py-2.5 border-b border-surface-50/60 hover:bg-surface-200/40"
            >
              <div className="flex-shrink-0 mt-0.5" title={entry.success ? 'Succeeded' : 'Failed'}>
                {entry.success
                  ? <CheckCircle2 size={15} className="text-green-400" />
                  : <XCircle size={15} className="text-red-400" />}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs font-medium text-accent truncate max-w-[40%]" title={connectionName(entry.connection_id)}>
                    {connectionName(entry.connection_id)}
                  </span>
                  <span
                    className="flex items-center gap-1 text-[13px] px-1.5 py-0.5 rounded bg-surface-300 text-gray-500 flex-shrink-0"
                    title={entry.source === 'agent' ? 'Run by AI agent' : 'Run by user'}
                  >
                    {entry.source === 'agent' ? <Bot size={11} /> : <User size={11} />}
                    {entry.source === 'agent' ? 'AI' : 'User'}
                  </span>
                  <span className="text-[13px] text-gray-600 flex-shrink-0">
                    {new Date(entry.executed_at).toLocaleTimeString()}
                  </span>
                </div>
                <code
                  className="block text-xs text-gray-700 dark:text-gray-300 truncate font-mono"
                  title={entry.query_text}
                >
                  {entry.query_text}
                </code>
                {!entry.success && entry.error && (
                  <p className="text-[13px] text-red-400 truncate mt-0.5" title={entry.error}>{entry.error}</p>
                )}
              </div>

              <div className="flex-shrink-0 text-right">
                <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                  {formatDuration(entry.duration_ms)}
                </div>
                {entry.row_count != null && (
                  <div className="text-[13px] text-gray-600">{entry.row_count} row{entry.row_count === 1 ? '' : 's'}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
