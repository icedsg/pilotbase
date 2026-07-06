import { useEffect, useState } from 'react'
import { Loader2, AlertCircle, Check, ArrowRight, Database, FileStack } from 'lucide-react'
import { apiMigrationObjects, apiMigrationPlan } from '../../api/client'
import { useUserSession } from '../../hooks/useUserSession'
import { useStore, type MigrationTab } from '../../store'
import type { MigrationObjectPick } from '../../types'

function formatSize(bytes: number | null): string {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function MigrationObjectPicker({ tab }: { tab: MigrationTab }) {
  const { userId } = useUserSession()
  const { connections, updateMigrationTab } = useStore()
  const [objects, setObjects] = useState<MigrationObjectPick[] | null>(null)
  const [kind, setKind] = useState<'sql' | 'mongo'>('sql')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [scope, setScope] = useState<'schema' | 'schema_data'>('schema')
  const [loading, setLoading] = useState(true)
  const [planLoading, setPlanLoading] = useState(false)
  const [error, setError] = useState('')

  const sourceConn = connections.find((c) => c.id === tab.sourceConnId)
  const targetConn = connections.find((c) => c.id === tab.targetConnId)

  useEffect(() => {
    setLoading(true)
    setError('')
    updateMigrationTab(tab.id, { checking: true })
    apiMigrationObjects(userId, tab.sourceConnId, tab.targetConnId)
      .then((r) => {
        setObjects(r.objects)
        setKind(r.kind)
        setSelected(new Set(r.objects.filter((o) => o.on_source).map((o) => o.name)))
      })
      .catch((e) => setError(e?.response?.data?.detail || 'Failed to list tables/collections.'))
      .finally(() => { setLoading(false); updateMigrationTab(tab.id, { checking: false }) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.sourceConnId, tab.targetConnId, userId])

  const toggle = (name: string) => {
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(name)) n.delete(name)
      else n.add(name)
      return n
    })
  }

  const toggleAll = () => {
    if (!objects) return
    const selectable = objects.filter((o) => o.on_source)
    if (selectable.every((o) => selected.has(o.name))) {
      setSelected(new Set())
    } else {
      setSelected(new Set(selectable.map((o) => o.name)))
    }
  }

  const continueToReview = async () => {
    if (selected.size === 0) return
    setPlanLoading(true)
    setError('')
    updateMigrationTab(tab.id, { checking: true })
    try {
      const r = await apiMigrationPlan(
        userId, tab.sourceConnId, tab.targetConnId,
        Array.from(selected), scope,
      )
      updateMigrationTab(tab.id, { step: 'review', migrationKind: r.kind, scope, plan: r.objects, checking: false })
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to build migration plan.')
      updateMigrationTab(tab.id, { checking: false })
    } finally {
      setPlanLoading(false)
    }
  }

  const noun = kind === 'mongo' ? 'collection' : 'table'

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-5 py-3 border-b border-surface-50 flex-shrink-0">
        <div className="text-sm text-gray-700 dark:text-gray-300">
          <span className="font-medium">{sourceConn?.name}</span>
          <ArrowRight size={13} className="inline mx-2 text-gray-500" />
          <span className="font-medium">{targetConn?.name}</span>
        </div>

        <div className="flex items-center gap-1 bg-surface-300 rounded-lg p-0.5">
          <button
            onClick={() => setScope('schema')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-colors ${scope === 'schema' ? 'bg-accent text-white' : 'text-gray-500 hover:text-gray-300'}`}
          >
            <FileStack size={13} /> Schema only
          </button>
          <button
            onClick={() => setScope('schema_data')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-colors ${scope === 'schema_data' ? 'bg-accent text-white' : 'text-gray-500 hover:text-gray-300'}`}
          >
            <Database size={13} /> Schema + data
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-gray-500 py-10 justify-center">
          <Loader2 size={16} className="animate-spin" /> Listing {noun}s…
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-xs text-red-400 px-5 py-3">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {objects && !loading && (
        <>
          <div className="flex-1 min-h-0 overflow-y-auto">
            <table className="min-w-full text-xs font-mono">
              <thead className="sticky top-0 bg-surface-300 z-10">
                <tr>
                  <th className="px-3 py-1.5 text-left border-b border-surface-50 w-8">
                    <button onClick={toggleAll} className="btn-ghost p-0.5" title="Select/deselect all">
                      <Check size={13} />
                    </button>
                  </th>
                  <th className="px-3 py-1.5 text-left border-b border-surface-50">{noun[0].toUpperCase() + noun.slice(1)}</th>
                  <th className="px-3 py-1.5 text-left border-b border-surface-50">On source</th>
                  <th className="px-3 py-1.5 text-left border-b border-surface-50">On destination</th>
                  <th className="px-3 py-1.5 text-left border-b border-surface-50">Source rows</th>
                  <th className="px-3 py-1.5 text-left border-b border-surface-50">Dest rows</th>
                  <th className="px-3 py-1.5 text-left border-b border-surface-50">Source size</th>
                </tr>
              </thead>
              <tbody>
                {objects.map((o) => (
                  <tr key={o.name} className="hover:bg-surface-200/40">
                    <td className="px-3 py-1 border-b border-surface-50/60">
                      <input
                        type="checkbox"
                        checked={selected.has(o.name)}
                        disabled={!o.on_source}
                        onChange={() => toggle(o.name)}
                        className="accent-accent"
                      />
                    </td>
                    <td className="px-3 py-1 border-b border-surface-50/60">{o.name}</td>
                    <td className="px-3 py-1 border-b border-surface-50/60">
                      {o.on_source ? <Check size={13} className="text-green-400" /> : <span className="text-gray-600">—</span>}
                    </td>
                    <td className="px-3 py-1 border-b border-surface-50/60">
                      {o.on_target ? <Check size={13} className="text-green-400" /> : <span className="text-gray-600">—</span>}
                    </td>
                    <td className="px-3 py-1 border-b border-surface-50/60">{o.src_rows ?? '—'}</td>
                    <td className="px-3 py-1 border-b border-surface-50/60">{o.tgt_rows ?? '—'}</td>
                    <td className="px-3 py-1 border-b border-surface-50/60">{formatSize(o.src_size)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between px-5 py-3 border-t border-surface-50 flex-shrink-0">
            <span className="text-xs text-gray-500">{selected.size} selected</span>
            <button
              onClick={continueToReview}
              disabled={selected.size === 0 || planLoading}
              className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-white px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50"
            >
              {planLoading ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
              Review plan
            </button>
          </div>
        </>
      )}
    </div>
  )
}
