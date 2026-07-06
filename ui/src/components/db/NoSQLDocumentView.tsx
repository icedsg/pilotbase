import { useState, useEffect, useCallback, useMemo } from 'react'
import { Search, RefreshCw, Loader2, X, FileText, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react'
import type { NoSQLTab } from '../../store'
import { useUserSession } from '../../hooks/useUserSession'
import { apiExecuteQuery } from '../../api/client'
import { sortByDirection, type SortDirection } from '../../utils/sort'
import SortContextMenu, { type SortMenuTarget } from './SortContextMenu'
import { JsonView, extractDocId, extractPreview, matchesSearch, type Doc } from './JsonView'

// ── Main component ────────────────────────────────────────────────────────────

export default function NoSQLDocumentView({ tab }: { tab: NoSQLTab }) {
  const nosqlViewContext = tab.context
  const { userId } = useUserSession()

  const [docs, setDocs] = useState<Doc[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sortField, setSortField]         = useState<string | null>(null)
  const [sortDirection, setSortDirection] = useState<SortDirection>(null)
  const [sortMenuTarget, setSortMenuTarget] = useState<(SortMenuTarget & { field: string }) | null>(null)

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
  useEffect(() => {
    setSearchTerm('')
    setSortField(null)
    setSortDirection(null)
  }, [nosqlViewContext?.collection])

  const availableFields = useMemo(() => {
    const keys = new Set<string>()
    for (const d of docs) {
      for (const k of Object.keys(d.fields)) {
        if (!['_id', 'id', '_key'].includes(k)) keys.add(k)
      }
    }
    return [...keys].sort((a, b) => a.localeCompare(b))
  }, [docs])

  const filtered = docs.filter(d => matchesSearch(d, searchTerm))
  const sorted = sortField ? sortByDirection(filtered, d => d.fields[sortField], sortDirection) : filtered
  const selected = selectedId != null ? docs.find(d => d.id === selectedId) ?? null : null

  const applyFieldSort = (field: string, dir: SortDirection) => {
    setSortField(dir ? field : null)
    setSortDirection(dir)
  }

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
        <select
          className="bg-surface-200 text-gray-400 px-1.5 py-1 rounded text-xs outline-none border border-surface-50 focus:border-accent flex-shrink-0 max-w-[110px]"
          value={sortField ?? ''}
          onChange={e => applyFieldSort(e.target.value, e.target.value ? (sortDirection ?? 'asc') : null)}
          title="Sort documents by field"
        >
          <option value="">Sort by…</option>
          {availableFields.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <button
          onClick={() => sortField && setSortDirection(d => d === 'asc' ? 'desc' : 'asc')}
          disabled={!sortField}
          className="btn-ghost p-1 flex-shrink-0 disabled:opacity-30 text-accent"
          title={sortDirection === 'desc' ? 'Sort descending' : 'Sort ascending'}
        >
          {sortDirection === 'desc' ? <ArrowDown size={13} /> : sortDirection === 'asc' ? <ArrowUp size={13} /> : <ArrowUpDown size={13} />}
        </button>
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
            ) : sorted.length === 0 ? (
              <div className="flex items-center justify-center h-20 text-xs text-gray-600">
                {docs.length === 0 ? 'No documents found' : 'No matches'}
              </div>
            ) : (
              sorted.map(doc => {
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
                <JsonView
                  data={selected.fields}
                  depth={0}
                  onKeyContextMenu={(key, e) => setSortMenuTarget({ field: key, label: key, x: e.clientX, y: e.clientY })}
                />
              </div>
            </div>
          )}
        </div>
      </div>
      {sortMenuTarget && (
        <SortContextMenu
          target={sortMenuTarget}
          hasSort={sortField === sortMenuTarget.field}
          onSortAsc={() => applyFieldSort(sortMenuTarget.field, 'asc')}
          onSortDesc={() => applyFieldSort(sortMenuTarget.field, 'desc')}
          onClearSort={() => applyFieldSort(sortMenuTarget.field, null)}
          onClose={() => setSortMenuTarget(null)}
        />
      )}
    </div>
  )
}
