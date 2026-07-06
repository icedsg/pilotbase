import { useState, type MouseEvent } from 'react'

export interface Doc {
  id: string
  fields: Record<string, unknown>
}

export function extractDocId(row: Record<string, unknown>): string {
  for (const key of ['_id', 'id', '_key', 'key']) {
    if (row[key] != null) return String(row[key])
  }
  const first = Object.values(row)[0]
  return first != null ? String(first) : '?'
}

export function extractPreview(row: Record<string, unknown>): string {
  const id = extractDocId(row)
  const rest = Object.entries(row).filter(([k]) => !['_id', 'id', '_key'].includes(k))
  if (rest.length === 0) return id
  const [k, v] = rest[0]
  const valStr = typeof v === 'string' ? v.slice(0, 60) : JSON.stringify(v)?.slice(0, 60) ?? ''
  return `${k}: ${valStr}`
}

export function matchesSearch(doc: Doc, term: string): boolean {
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

export function ExpandableString({ value }: { value: string }) {
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

export function JsonView({ data, depth = 0, onKeyContextMenu }: {
  data: unknown
  depth?: number
  onKeyContextMenu?: (key: string, e: MouseEvent) => void
}) {
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
            <span
              className={`text-sky-400 font-medium flex-shrink-0 ${depth === 0 && onKeyContextMenu ? 'cursor-context-menu' : ''}`}
              title={depth === 0 && onKeyContextMenu ? 'Right-click to sort documents by this field' : undefined}
              onContextMenu={depth === 0 && onKeyContextMenu ? (e) => { e.preventDefault(); onKeyContextMenu(key, e) } : undefined}
            >
              {key}:
            </span>
            <div className="flex-1 min-w-0"><JsonView data={val} depth={depth + 1} onKeyContextMenu={onKeyContextMenu} /></div>
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
