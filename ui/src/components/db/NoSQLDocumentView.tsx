import { useState, useEffect, useCallback } from 'react'
import { Search, RefreshCw, Loader2, X, FileText, ChevronRight } from 'lucide-react'
import { useStore } from '../../store'
import { useUserSession } from '../../hooks/useUserSession'
import { apiExecuteQuery } from '../../api/client'

interface Doc {
  id: string
  fields: Record<string, unknown>
}

function extractDocId(row: Record<string, unknown>): string {
  for (const key of ['_id', 'id', '_key', 'key']) {
    if (row[key] != null) return String(row[key])
  }
  const first = Object.values(row)[0]
  return first != null ? String(first) : '?'
}

function extractPreview(row: Record<string, unknown>): string {
  const id = extractDocId(row)
  const rest = Object.entries(row).filter(([k]) => !['_id', 'id', '_key'].includes(k))
  if (rest.length === 0) return id
  const [k, v] = rest[0]
  const valStr = typeof v === 'string' ? v.slice(0, 60) : JSON.stringify(v)?.slice(0, 60) ?? ''
  return `${k}: ${valStr}`
}

function matchesSearch(doc: Doc, term: string): boolean {
  if (!term.trim()) return true
  const lower = term.toLowerCase()
  function searchVal(val: unknown): boolean {
    if (typeof val === 'string') return val.toLowerCase().includes(lower)
    if (typeof val === 'number') return String(val).includes(lower)
    if (Array.isArray(val)) return val.some(searchVal)
    if (val && typeof val === 'object') return Object.values(val as Record<string, unknown>).some(searchVal)
    return false
  }
  if (doc.id.toLowerCase().includes(lower)) return true
  return searchVal(doc.fields)
}

// ── JSON renderer ─────────────────────────────────────────────────────────────

function ExpandableString({ value }: { value: string }) {
  const [exp, setExp] = useState(false)
  return (
    <span>
      <span className="text-amber-300 whitespace-pre-wrap break-words">
        "{exp ? value : value.slice(0, 300)}{!exp && value.length > 300 ? '…' : ''}"
      </span>
      {value.length > 300 && (
        <button onClick={() => setExp(e => !e)} className="ml-1 text-[11px] text-accent hover:underline">
          {exp ? 'less' : 'more'}
        </button>
      )}
    </span>
  )
}

function JsonView({ data, depth = 0 }: { data: unknown; depth?: number }) {
  const [collapsed, setCollapsed] = useState(depth > 1)

  if (data === null || data === undefined) return <span className="text-gray-500 italic">null</span>
  if (typeof data === 'boolean') return <span className="text-blue-400">{String(data)}</span>
  if (typeof data === 'number') return <span className="text-green-400">{data}</span>
  if (typeof data === 'string') {
    return data.length > 300 ? <ExpandableString value={data} /> : <span className="text-amber-300">"{data}"</span>
  }
  if (Array.isArray(data)) {
    if (data.length === 0) return <span className="text-gray-500">[]</span>
    return (
      <div className="ml-3 border-l border-surface-50 pl-2 space-y-0.5">
        {(collapsed ? data.slice(0, 3) : data).map((item, i) => (
          <div key={i} className="text-xs flex gap-1">
            <span className="text-gray-600 flex-shrink-0">{i}:</span>
            <JsonView data={item} depth={depth + 1} />
          </div>
        ))}
        {collapsed && data.length > 3 && (
          <button onClick={() => setCollapsed(false)} className="text-[11px] text-accent hover:underline">
            +{data.length - 3} more…
          </button>
        )}
      </div>
    )
  }
  if (typeof data === 'object') {
    const entries = Object.entries(data as Record<string, unknown>)
    if (entries.length === 0) return <span className="text-gray-500">{'{}'}</span>
    return (
      <div className={depth > 0 ? 'ml-3 border-l border-surface-50 pl-2' : ''}>
        {(collapsed ? entries.slice(0, 5) : entries).map(([key, val]) => (
          <div key={key} className="text-xs py-0.5 flex gap-1 flex-wrap">
            <span className="text-sky-400 font-medium flex-shrink-0">{key}:</span>
            <div className="flex-1 min-w-0"><JsonView data={val} depth={depth + 1} /></div>
          </div>
        ))}
        {collapsed && entries.length > 5 && (
          <button onClick={() => setCollapsed(false)} className="text-[11px] text-accent hover:underline mt-0.5">
            +{entries.length - 5} more fields…
          </button>
        )}
      </div>
    )
  }
  return <span className="text-gray-300">{String(data)}</span>
}

// ── Main component ────────────────────────────────────────────────────────────

export default function NoSQLDocumentView() {
  const { nosqlViewContext } = useStore()
  const { userId } = useUserSession()

  const [docs, setDocs] = useState<Doc[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!nosqlViewContext || !userId) return
    setLoading(true)
    setError(null)
    setSelectedId(null)
    setDocs([])
    try {
      const { collection, connId, db } = nosqlViewContext
      const query = JSON.stringify({ collection, scroll: true, limit: 200 })
      const result = await apiExecuteQuery(userId, connId, query, db || undefined)
      const loaded: Doc[] = (result.rows || []).map(row => ({
        id: extractDocId(row),
        fields: row,
      }))
      setDocs(loaded)
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Failed to load documents')
    } finally {
      setLoading(false)
    }
  }, [nosqlViewContext, userId])

  useEffect(() => { fetch() }, [fetch])
  useEffect(() => { setSearchTerm('') }, [nosqlViewContext?.collection])

  const filtered = docs.filter(d => matchesSearch(d, searchTerm))
  const selected = selectedId != null ? docs.find(d => d.id === selectedId) ?? null : null

  if (!nosqlViewContext) return null

  return (
    <div className="h-full flex flex-col bg-surface-200">
      {/* Search + toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-surface-300 border-b border-surface-50 flex-shrink-0">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
          <input
            className="w-full bg-surface-200 text-gray-300 pl-8 pr-8 py-1 rounded text-xs outline-none border border-surface-50 focus:border-accent transition-colors"
            placeholder={`Search ${nosqlViewContext.collection} documents…`}
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
            >
              <X size={12} />
            </button>
          )}
        </div>
        <span className="text-[11px] text-gray-600 flex-shrink-0 tabular-nums">
          {loading ? '…' : `${filtered.length} / ${docs.length}`}
        </span>
        <button
          onClick={fetch}
          disabled={loading}
          className="btn-ghost p-1 flex-shrink-0"
          title="Refresh documents"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
        </button>
      </div>

      {/* Body: list + detail */}
      <div className="flex-1 flex min-h-0 overflow-hidden">

        {/* Left: document list */}
        <div className="w-72 flex-shrink-0 border-r border-surface-50 flex flex-col">
          <div className="px-3 py-1 bg-surface-300 border-b border-surface-50 flex-shrink-0">
            <span className="text-[11px] text-gray-600 uppercase tracking-wider font-medium">
              {nosqlViewContext.collection}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {error ? (
              <div className="p-3 text-xs text-red-400">{error}</div>
            ) : loading ? (
              <div className="flex items-center justify-center gap-2 h-20 text-xs text-gray-600">
                <Loader2 size={13} className="animate-spin" /> Loading…
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex items-center justify-center h-20 text-xs text-gray-600">
                {docs.length === 0 ? 'No documents found' : 'No matches'}
              </div>
            ) : (
              filtered.map(doc => {
                const preview = extractPreview(doc.fields)
                const isSelected = selectedId === doc.id
                return (
                  <button
                    key={doc.id}
                    onClick={() => setSelectedId(doc.id)}
                    className={`w-full text-left flex items-start gap-2 px-3 py-2 border-b border-surface-50 transition-colors ${
                      isSelected
                        ? 'bg-accent/10 border-l-2 border-l-accent'
                        : 'hover:bg-surface-50 border-l-2 border-l-transparent'
                    }`}
                  >
                    <FileText size={13} className={`flex-shrink-0 mt-0.5 ${isSelected ? 'text-accent' : 'text-emerald-400'}`} />
                    <div className="min-w-0 flex-1">
                      <div className={`text-xs truncate ${isSelected ? 'text-gray-100' : 'text-gray-300'}`}>
                        {preview}
                      </div>
                      <div className="text-[10px] text-gray-600 font-mono truncate">{doc.id}</div>
                    </div>
                    {isSelected && <ChevronRight size={11} className="flex-shrink-0 mt-0.5 text-accent" />}
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* Right: document detail */}
        <div className="flex-1 overflow-y-auto">
          {!selected ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-600">
              <FileText size={28} className="text-gray-700" />
              <span className="text-xs">Select a document to view its fields</span>
            </div>
          ) : (
            <div className="p-4 space-y-4">
              <div className="flex items-center gap-2 pb-3 border-b border-surface-50">
                <FileText size={15} className="text-emerald-400 flex-shrink-0" />
                <span className="text-xs font-mono text-gray-400 break-all">{selected.id}</span>
              </div>
              <div className="font-mono text-xs space-y-1">
                <JsonView data={selected.fields} depth={0} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
