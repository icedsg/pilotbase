import { useState, useMemo } from 'react'
import { Search, X, FileText, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown, AlertCircle, Copy } from 'lucide-react'
import type { QueryTab } from '../../store'
import { sortByDirection, type SortDirection } from '../../utils/sort'
import SortContextMenu, { type SortMenuTarget } from './SortContextMenu'
import { JsonView, extractDocId, extractPreview, matchesSearch, type Doc } from './JsonView'

// Renders ad-hoc query results for JSON-command NoSQL/vector connections
// (Mongo, Qdrant, CouchDB, ...) as a searchable document list + JsonView
// detail pane, mirroring NoSQLDocumentView's layout — a flat SQL-style grid
// can't represent nested/aggregated documents (it shows "[object Object]").

export default function NoSQLQueryResultsView({ tab }: { tab: QueryTab }) {
  const queryResult = tab.result
  const queryLoading = tab.loading

  const [searchTerm, setSearchTerm] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sortField, setSortField] = useState<string | null>(null)
  const [sortDirection, setSortDirection] = useState<SortDirection>(null)
  const [sortMenuTarget, setSortMenuTarget] = useState<(SortMenuTarget & { field: string }) | null>(null)
  const [copied, setCopied] = useState(false)

  const docs: Doc[] = useMemo(
    () => (queryResult?.rows || []).map(row => ({ id: extractDocId(row), fields: row })),
    [queryResult]
  )

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

  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(queryResult?.rows ?? [], null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  if (queryLoading) {
    return (
      <div className="h-full flex flex-col bg-surface-200">
        <div className="flex-1 flex items-center justify-center text-xs text-gray-500">
          <span className="animate-pulse">Running query…</span>
        </div>
      </div>
    )
  }

  if (!queryResult) {
    return (
      <div className="h-full flex flex-col bg-surface-200">
        <div className="flex-1 flex items-center justify-center text-xs text-gray-600">
          Results will appear here
        </div>
      </div>
    )
  }

  if (queryResult.error) {
    return (
      <div className="h-full flex flex-col bg-surface-200">
        <div className="p-4">
          <div className="flex items-start gap-2 text-red-400 text-xs">
            <AlertCircle size={18} className="flex-shrink-0 mt-0.5" />
            <pre className="whitespace-pre-wrap font-mono">{queryResult.error}</pre>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-surface-200">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-surface-300 border-b border-surface-50 flex-shrink-0">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
          <input
            className="w-full bg-surface-200 text-gray-300 pl-8 pr-8 py-1 rounded text-xs outline-none border border-surface-50 focus:border-accent transition-colors"
            placeholder="Search results…"
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
          {filtered.length} / {docs.length}
          {queryResult.truncated && <span className="text-yellow-500 ml-1">(truncated)</span>}
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
          onClick={handleCopyJson}
          className="btn-ghost flex items-center gap-1 text-xs flex-shrink-0"
          title="Copy all results as JSON"
        >
          <Copy size={13} />
          {copied ? 'Copied' : 'Copy JSON'}
        </button>
      </div>

      {/* Body: list + detail */}
      <div className="flex-1 flex min-h-0 overflow-hidden">

        {/* Left: document list */}
        <div className="w-72 flex-shrink-0 border-r border-surface-50 flex flex-col">
          <div className="flex-1 overflow-y-auto">
            {sorted.length === 0 ? (
              <div className="flex items-center justify-center h-20 text-xs text-gray-600">
                {docs.length === 0 ? 'Query executed. No rows returned.' : 'No matches'}
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
              <span className="text-xs">Select a result to view its fields</span>
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
