import { useEffect, useState } from 'react'
import Editor from '@monaco-editor/react'
import { X, FileCode, Loader2, Copy, Check, Download, Table2, Eye } from 'lucide-react'
import { apiListObjects, apiExportSql } from '../../api/client'
import { useUserSession } from '../../hooks/useUserSession'
import { useStore } from '../../store'
import { downloadBlob } from '../../utils/download'
import type { DbObject } from '../../types'

interface Props {
  connId: string
  database: string
  /** Pre-selected table/view (right-clicked in the tree). If omitted, this is a
   * database-level export — the user picks which tables/views to include. */
  table?: string | null
  onClose: () => void
}

export default function ExportSqlModal({ connId, database, table, onClose }: Props) {
  const { userId } = useUserSession()
  const { connections, theme } = useStore()
  const conn = connections.find((c) => c.id === connId)

  const [objects, setObjects] = useState<DbObject[]>([])
  const [loadingObjects, setLoadingObjects] = useState(!table)
  const [selected, setSelected] = useState<Set<string>>(new Set(table ? [table] : []))

  const [createTable, setCreateTable] = useState(true)
  const [dropIfExists, setDropIfExists] = useState(false)
  const [includeInserts, setIncludeInserts] = useState(false)

  const [sql, setSql] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => {
    if (table) return
    apiListObjects(userId, connId, database)
      .then((r) => {
        const tablesAndViews = r.objects.filter((o) => o.type === 'table' || o.type === 'view')
        setObjects(tablesAndViews)
        setSelected(new Set(tablesAndViews.map((o) => o.name)))
      })
      .catch(() => setObjects([]))
      .finally(() => setLoadingObjects(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connId, database, table])

  const toggle = (name: string) => {
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(name)) n.delete(name); else n.add(name)
      return n
    })
  }

  const toggleAll = () => {
    setSelected((s) => (s.size === objects.length ? new Set() : new Set(objects.map((o) => o.name))))
  }

  const generate = async () => {
    if (selected.size === 0) return
    setGenerating(true)
    setError('')
    setSql(null)
    try {
      const res = await apiExportSql(userId, connId, database, Array.from(selected), {
        create_table: createTable,
        drop_if_exists: dropIfExists,
        include_inserts: includeInserts,
      })
      setSql(res.sql)
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to generate SQL.')
    } finally {
      setGenerating(false)
    }
  }

  const copy = () => {
    if (!sql) return
    navigator.clipboard.writeText(sql)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const save = () => {
    if (!sql) return
    const filename = table ? `${table}.sql` : `${database}_export.sql`
    downloadBlob(new Blob([sql], { type: 'application/sql' }), filename)
  }

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-100 border border-surface-50 rounded-xl shadow-2xl w-full max-w-6xl h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-50 flex-shrink-0">
          <div className="flex items-center gap-2">
            <FileCode size={18} className="text-gray-500" />
            <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Export as SQL</h2>
            {conn && (
              <span className="text-xs text-gray-500">
                — {conn.name} / {database}{table ? ` / ${table}` : ''}
              </span>
            )}
          </div>
          <button onClick={onClose} className="btn-ghost p-1"><X size={20} /></button>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* Left: options */}
          <div className="w-72 flex-shrink-0 border-r border-surface-50 flex flex-col min-h-0">
            {!table && (
              <div className="flex-1 min-h-0 flex flex-col border-b border-surface-50">
                <div className="flex items-center justify-between px-3 py-2 flex-shrink-0">
                  <span className="text-[13px] text-gray-500 uppercase tracking-wider">Tables & Views</span>
                  <button onClick={toggleAll} className="text-[11px] text-accent hover:underline">
                    {selected.size === objects.length ? 'Select none' : 'Select all'}
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto px-2 pb-2">
                  {loadingObjects ? (
                    <div className="flex items-center gap-2 text-xs text-gray-500 py-4 px-2">
                      <Loader2 size={14} className="animate-spin" /> Loading…
                    </div>
                  ) : objects.length === 0 ? (
                    <div className="text-xs text-gray-600 px-2 py-4">No tables or views found.</div>
                  ) : (
                    objects.map((o) => (
                      <label
                        key={o.name}
                        className="flex items-center gap-2 px-2 py-1 rounded hover:bg-surface-200/40 cursor-pointer text-xs"
                      >
                        <input type="checkbox" checked={selected.has(o.name)} onChange={() => toggle(o.name)} />
                        {o.type === 'view' ? <Eye size={13} className="text-gray-500 flex-shrink-0" /> : <Table2 size={13} className="text-gray-500 flex-shrink-0" />}
                        <span className="font-mono truncate text-gray-700 dark:text-gray-300">{o.name}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>
            )}

            <div className="p-3 space-y-2 flex-shrink-0">
              <span className="text-[13px] text-gray-500 uppercase tracking-wider">Options</span>
              <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300 cursor-pointer">
                <input type="checkbox" checked={createTable} onChange={(e) => setCreateTable(e.target.checked)} />
                CREATE TABLE statements
              </label>
              <label className={`flex items-center gap-2 text-xs cursor-pointer ${createTable ? 'text-gray-700 dark:text-gray-300' : 'text-gray-600 opacity-50'}`}>
                <input type="checkbox" checked={dropIfExists} disabled={!createTable} onChange={(e) => setDropIfExists(e.target.checked)} />
                DROP TABLE IF EXISTS first
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300 cursor-pointer">
                <input type="checkbox" checked={includeInserts} onChange={(e) => setIncludeInserts(e.target.checked)} />
                INSERT statements (data)
              </label>
            </div>

            <div className="p-3 border-t border-surface-50 flex-shrink-0">
              <button
                onClick={generate}
                disabled={generating || selected.size === 0}
                className="w-full flex items-center justify-center gap-2 bg-accent hover:bg-accent-hover text-white px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50"
              >
                {generating ? <Loader2 size={14} className="animate-spin" /> : <FileCode size={14} />}
                Generate SQL
              </button>
              {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
            </div>
          </div>

          {/* Right: SQL viewer */}
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex items-center justify-end gap-2 px-3 py-2 border-b border-surface-50 flex-shrink-0">
              <button
                onClick={copy}
                disabled={!sql}
                className="btn-ghost flex items-center gap-1 text-xs disabled:opacity-40"
              >
                {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                {copied ? 'Copied' : 'Copy to clipboard'}
              </button>
              <button
                onClick={save}
                disabled={!sql}
                className="btn-ghost flex items-center gap-1 text-xs disabled:opacity-40"
              >
                <Download size={14} />
                Save as file
              </button>
            </div>
            <div className="flex-1 min-h-0">
              {sql ? (
                <Editor
                  height="100%"
                  defaultLanguage="sql"
                  theme={theme === 'dark' ? 'vs-dark' : 'light'}
                  value={sql}
                  options={{
                    readOnly: true,
                    fontSize: 13,
                    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
                    minimap: { enabled: false },
                    lineNumbers: 'on',
                    wordWrap: 'on',
                    automaticLayout: true,
                    padding: { top: 8, bottom: 8 },
                  }}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-xs text-gray-500">
                  {generating ? 'Generating SQL…' : 'Pick options and click "Generate SQL" to preview the script.'}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
