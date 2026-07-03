import { useEffect, useState, type ReactNode } from 'react'
import { Loader2, FileCode2, AlertCircle } from 'lucide-react'
import { apiSchemaDiff, apiMigrationScript } from '../../api/client'
import { useUserSession } from '../../hooks/useUserSession'
import { useStore } from '../../store'
import type { MigrationDiff } from '../../types'

function formatSize(bytes: number | null): string {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-6">
      <h3 className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-2">{title}</h3>
      {children}
    </div>
  )
}

function NameList({ names, tone }: { names: string[]; tone: 'add' | 'drop' }) {
  if (names.length === 0) return <div className="text-xs text-gray-600 italic">None</div>
  return (
    <ul className="text-xs font-mono space-y-0.5">
      {names.map((n) => (
        <li key={n} className={tone === 'add' ? 'text-green-400' : 'text-red-400'}>
          {tone === 'add' ? '+ ' : '− '}{n}
        </li>
      ))}
    </ul>
  )
}

export default function MigrationCompareView() {
  const { userId } = useUserSession()
  const { migrationViewContext, connections } = useStore()
  const [diff, setDiff] = useState<MigrationDiff | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [script, setScript] = useState<string | null>(null)
  const [scriptLoading, setScriptLoading] = useState(false)

  const sourceConn = connections.find((c) => c.id === migrationViewContext?.sourceConnId)
  const targetConn = connections.find((c) => c.id === migrationViewContext?.targetConnId)

  useEffect(() => {
    if (!migrationViewContext) return
    setLoading(true)
    setError('')
    apiSchemaDiff(userId, migrationViewContext.sourceConnId, migrationViewContext.targetConnId)
      .then(setDiff)
      .catch((e) => setError(e?.response?.data?.detail || 'Failed to compare schemas.'))
      .finally(() => setLoading(false))
  }, [migrationViewContext, userId])

  const generateScript = async () => {
    if (!migrationViewContext) return
    setScriptLoading(true)
    try {
      const r = await apiMigrationScript(userId, migrationViewContext.sourceConnId, migrationViewContext.targetConnId)
      setScript(r.sql)
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to generate migration script.')
    } finally {
      setScriptLoading(false)
    }
  }

  if (!migrationViewContext) return null

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="flex items-center justify-between mb-5">
        <div className="text-sm text-gray-700 dark:text-gray-300">
          <span className="font-medium">{sourceConn?.name ?? migrationViewContext.sourceConnId}</span>
          <span className="text-gray-500 mx-2">→</span>
          <span className="font-medium">{targetConn?.name ?? migrationViewContext.targetConnId}</span>
        </div>
        <button
          onClick={generateScript}
          disabled={scriptLoading || loading}
          className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-white px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50"
        >
          {scriptLoading ? <Loader2 size={14} className="animate-spin" /> : <FileCode2 size={14} />}
          Generate migration script
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-gray-500 py-10 justify-center">
          <Loader2 size={16} className="animate-spin" /> Comparing schemas…
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-xs text-red-400 mb-4">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {diff && !loading && (
        <>
          <Section title="Tables">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <div className="text-[13px] text-gray-500 mb-1">Only in source</div>
                <NameList names={diff.added_tables} tone="add" />
              </div>
              <div>
                <div className="text-[13px] text-gray-500 mb-1">Only in target</div>
                <NameList names={diff.dropped_tables} tone="drop" />
              </div>
            </div>
          </Section>

          <Section title="Row counts &amp; data size">
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs font-mono">
                <thead className="bg-surface-300">
                  <tr>
                    <th className="px-3 py-1.5 text-left border-b border-r border-surface-50">Table</th>
                    <th className="px-3 py-1.5 text-left border-b border-r border-surface-50">Source rows</th>
                    <th className="px-3 py-1.5 text-left border-b border-r border-surface-50">Target rows</th>
                    <th className="px-3 py-1.5 text-left border-b border-r border-surface-50">Source size</th>
                    <th className="px-3 py-1.5 text-left border-b border-surface-50">Target size</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(diff.table_stats).map(([name, s]) => (
                    <tr key={name} className="hover:bg-surface-200/40">
                      <td className="px-3 py-1 border-b border-r border-surface-50/60">{name}</td>
                      <td className="px-3 py-1 border-b border-r border-surface-50/60">{s.src_rows ?? '—'}</td>
                      <td className="px-3 py-1 border-b border-r border-surface-50/60">{s.tgt_rows ?? '—'}</td>
                      <td className="px-3 py-1 border-b border-r border-surface-50/60">{formatSize(s.src_size)}</td>
                      <td className="px-3 py-1 border-b border-surface-50/60">{formatSize(s.tgt_size)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Column changes">
            {Object.keys(diff.column_changes).length === 0 && <div className="text-xs text-gray-600 italic">No column differences</div>}
            {Object.entries(diff.column_changes).map(([table, c]) => (
              <div key={table} className="mb-2">
                <div className="text-xs font-medium text-gray-700 dark:text-gray-300">{table}</div>
                <NameList names={c.added} tone="add" />
                <NameList names={c.dropped} tone="drop" />
                {c.modified.length > 0 && (
                  <div className="text-xs font-mono text-yellow-400">~ {c.modified.join(', ')}</div>
                )}
              </div>
            ))}
          </Section>

          <Section title="Views">
            <div className="grid grid-cols-2 gap-6">
              <NameList names={diff.added_views} tone="add" />
              <NameList names={diff.dropped_views} tone="drop" />
            </div>
          </Section>

          <Section title="Stored procedures / functions">
            <div className="grid grid-cols-2 gap-6">
              <NameList names={diff.added_routines} tone="add" />
              <NameList names={diff.dropped_routines} tone="drop" />
            </div>
          </Section>

          <Section title="Indexes">
            {Object.keys(diff.index_changes).length === 0 && <div className="text-xs text-gray-600 italic">No index differences</div>}
            {Object.entries(diff.index_changes).map(([table, c]) => (
              <div key={table} className="mb-2">
                <div className="text-xs font-medium text-gray-700 dark:text-gray-300">{table}</div>
                <NameList names={c.added} tone="add" />
                <NameList names={c.dropped} tone="drop" />
              </div>
            ))}
          </Section>

          <Section title="Foreign keys">
            {Object.keys(diff.fk_changes).length === 0 && <div className="text-xs text-gray-600 italic">No foreign-key differences</div>}
            {Object.entries(diff.fk_changes).map(([table, c]) => (
              <div key={table} className="mb-2">
                <div className="text-xs font-medium text-gray-700 dark:text-gray-300">{table}</div>
                <NameList names={c.added} tone="add" />
                <NameList names={c.dropped} tone="drop" />
              </div>
            ))}
          </Section>

          {script && (
            <Section title="Generated migration script">
              <pre className="text-xs font-mono bg-surface-300 border border-surface-50 rounded p-3 overflow-x-auto whitespace-pre-wrap">{script}</pre>
            </Section>
          )}
        </>
      )}
    </div>
  )
}
