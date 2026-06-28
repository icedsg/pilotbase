import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Search, RefreshCw, Loader2, X, Package, ChevronRight,
  Trash2, Pencil, Check, Upload, AlertCircle, Plus,
} from 'lucide-react'
import { useStore } from '../../store'
import { useUserSession } from '../../hooks/useUserSession'
import {
  apiExecuteQuery, apiGetVectorSchema, apiDeleteVectorChunk,
  apiUpdateVectorChunk, apiUploadVectorChunks,
} from '../../api/client'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Chunk {
  id: string
  payload: Record<string, unknown>
}

interface SchemaProperty {
  name: string
  dataType: string[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parsePayload(row: Record<string, unknown>): Record<string, unknown> {
  const p = row.payload
  if (p == null) {
    const { id, score, _additional, ...rest } = row as any
    return Object.keys(rest).length > 0 ? rest : {}
  }
  if (typeof p === 'string') { try { return JSON.parse(p) } catch { return { _raw: p } } }
  if (typeof p === 'object') return p as Record<string, unknown>
  return { _value: p }
}

function extractTitle(payload: Record<string, unknown>, id: string): string {
  for (const k of ['title', 'name', 'heading', 'subject']) {
    if (payload[k] && typeof payload[k] === 'string') return payload[k] as string
  }
  for (const k of ['text', 'content', 'body', 'document', 'page_content']) {
    if (payload[k] && typeof payload[k] === 'string') return (payload[k] as string).slice(0, 100)
  }
  for (const v of Object.values(payload)) {
    if (typeof v === 'string' && v.length > 0) return v.slice(0, 100)
  }
  return id
}

function matchesSearch(chunk: Chunk, term: string): boolean {
  if (!term.trim()) return true
  const lower = term.toLowerCase()
  if (chunk.id.toLowerCase().includes(lower)) return true
  function scan(val: unknown): boolean {
    if (typeof val === 'string') return val.toLowerCase().includes(lower)
    if (typeof val === 'number') return String(val).includes(lower)
    if (Array.isArray(val)) return val.some(scan)
    if (val && typeof val === 'object') return Object.values(val as object).some(scan)
    return false
  }
  return scan(chunk.payload)
}

function findTextField(schema: SchemaProperty[]): string {
  for (const p of schema) {
    if (['text', 'content', 'body', 'page_content', 'document'].includes(p.name)) return p.name
    if (p.dataType.some(t => t === 'text' || t === 'string')) return p.name
  }
  return 'text'
}

// ── JSON viewer ───────────────────────────────────────────────────────────────

function JsonView({ data, depth = 0 }: { data: unknown; depth?: number }) {
  const [collapsed, setCollapsed] = useState(depth > 1)
  if (data === null || data === undefined) return <span className="text-gray-500 italic">null</span>
  if (typeof data === 'boolean') return <span className="text-blue-400">{String(data)}</span>
  if (typeof data === 'number') return <span className="text-green-400">{data}</span>
  if (typeof data === 'string') {
    if (data.length > 300) return (
      <ExpandStr value={data} />
    )
    return <span className="text-amber-300 whitespace-pre-wrap break-words">"{data}"</span>
  }
  if (Array.isArray(data)) {
    if (data.length === 0) return <span className="text-gray-500">[]</span>
    if (data.length > 8 && typeof data[0] === 'number')
      return <span className="text-gray-500 italic text-[11px]">[float vector · {data.length} dims]</span>
    return (
      <div className="ml-3 border-l border-surface-50 pl-2 space-y-0.5">
        {(collapsed ? data.slice(0, 3) : data).map((v, i) => (
          <div key={i} className="text-xs flex gap-1">
            <span className="text-gray-600 flex-shrink-0">{i}:</span>
            <JsonView data={v} depth={depth + 1} />
          </div>
        ))}
        {collapsed && data.length > 3 && (
          <button onClick={() => setCollapsed(false)} className="text-[11px] text-accent hover:underline">+{data.length - 3} more…</button>
        )}
      </div>
    )
  }
  if (typeof data === 'object') {
    const entries = Object.entries(data as object)
    if (!entries.length) return <span className="text-gray-500">{'{}'}</span>
    return (
      <div className={depth > 0 ? 'ml-3 border-l border-surface-50 pl-2' : ''}>
        {(collapsed ? entries.slice(0, 4) : entries).map(([k, v]) => (
          <div key={k} className="text-xs py-0.5 flex gap-1 flex-wrap">
            <span className="text-sky-400 font-medium flex-shrink-0">{k}:</span>
            <div className="flex-1 min-w-0"><JsonView data={v} depth={depth + 1} /></div>
          </div>
        ))}
        {collapsed && entries.length > 4 && (
          <button onClick={() => setCollapsed(false)} className="text-[11px] text-accent hover:underline mt-0.5">+{entries.length - 4} more…</button>
        )}
      </div>
    )
  }
  return <span className="text-gray-300">{String(data)}</span>
}

function ExpandStr({ value }: { value: string }) {
  const [exp, setExp] = useState(false)
  return (
    <span>
      <span className="text-amber-300 whitespace-pre-wrap break-words">
        "{exp ? value : value.slice(0, 300)}{!exp && value.length > 300 ? '…' : ''}"
      </span>
      <button onClick={() => setExp(e => !e)} className="ml-1 text-[11px] text-accent hover:underline">
        {exp ? 'less' : 'more'}
      </button>
    </span>
  )
}

// ── Upload dialog ─────────────────────────────────────────────────────────────

function UploadDialog({
  textField, onUpload, onClose,
}: {
  textField: string
  onUpload: (files: File[]) => Promise<void>
  onClose: () => void
}) {
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<{ created: number; errors: { file: string; error: string }[] } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleUpload = async () => {
    if (!files.length) return
    setUploading(true)
    try {
      await onUpload(files)
      setResult({ created: files.length, errors: [] })
    } catch (e: any) {
      setResult({ created: 0, errors: [{ file: 'upload', error: e?.response?.data?.detail || String(e) }] })
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-surface-100 border border-surface-50 rounded-xl shadow-2xl w-[440px] p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Upload size={16} className="text-accent" />
            <span className="text-sm font-medium text-gray-200">Upload chunks</span>
          </div>
          <button onClick={onClose} className="btn-ghost p-1"><X size={14} /></button>
        </div>

        <p className="text-xs text-gray-500">
          Supported: <span className="text-gray-400">.txt, .json, .csv</span> — each file is split into chunks and inserted.
          Text will be embedded using the collection's vectorizer.
        </p>

        <div
          className="border-2 border-dashed border-surface-50 rounded-lg p-6 text-center cursor-pointer hover:border-accent transition-colors"
          onClick={() => inputRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); setFiles(Array.from(e.dataTransfer.files)) }}
        >
          <Upload size={24} className="mx-auto text-gray-600 mb-2" />
          <p className="text-xs text-gray-500">
            {files.length ? files.map(f => f.name).join(', ') : 'Click or drag files here'}
          </p>
          <input ref={inputRef} type="file" multiple accept=".txt,.json,.csv" className="hidden"
            onChange={e => setFiles(Array.from(e.target.files || []))} />
        </div>

        {result && (
          <div className={`text-xs rounded p-2 ${result.errors.length ? 'text-red-400 bg-red-900/20' : 'text-green-400 bg-green-900/20'}`}>
            {result.errors.length
              ? result.errors.map((e, i) => <div key={i}>{e.file}: {e.error}</div>)
              : `Upload complete — chunks created successfully`
            }
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="btn-ghost text-xs px-3 py-1">Cancel</button>
          <button
            onClick={handleUpload}
            disabled={!files.length || uploading}
            className="flex items-center gap-1.5 bg-accent hover:bg-accent-hover text-white text-xs px-3 py-1 rounded disabled:opacity-50 transition-colors"
          >
            {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            Upload {files.length > 0 ? `(${files.length})` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function VectorChunksView() {
  const { vectorViewContext } = useStore()
  const { userId } = useUserSession()

  const [chunks, setChunks]           = useState<Chunk[]>([])
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [searchTerm, setSearchTerm]   = useState('')
  const [selectedId, setSelectedId]   = useState<string | null>(null)
  const [schema, setSchema]           = useState<SchemaProperty[]>([])

  // Edit state
  const [editing, setEditing]           = useState(false)
  const [editPayload, setEditPayload]   = useState<Record<string, unknown>>({})
  const [saving, setSaving]             = useState(false)

  // Delete state
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting]           = useState(false)

  // Upload state
  const [showUpload, setShowUpload]     = useState(false)

  const textField = findTextField(schema)

  // ── Data fetch ─────────────────────────────────────────────────────────────

  const fetchChunks = useCallback(async () => {
    if (!vectorViewContext || !userId) return
    setLoading(true)
    setError(null)
    setSelectedId(null)
    setEditing(false)
    setChunks([])
    try {
      const { collection, connId, db, dbType } = vectorViewContext
      const query = JSON.stringify({ collection, scroll: true, limit: 200 })
      const result = await apiExecuteQuery(userId, connId, query, db || undefined)
      if ((result as any).error) {
        setError((result as any).error)
        return
      }
      const loaded: Chunk[] = (result.rows || []).map(row => ({
        id: String(row.id ?? (row._additional as any)?.id ?? Object.values(row)[0] ?? '?'),
        payload: parsePayload(row),
      }))
      setChunks(loaded)
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to load chunks')
    } finally {
      setLoading(false)
    }
  }, [vectorViewContext, userId])

  const fetchSchema = useCallback(async () => {
    if (!vectorViewContext || !userId) return
    try {
      const { data } = await apiGetVectorSchema(userId, vectorViewContext.connId, vectorViewContext.collection) as any
      setSchema((data as any)?.properties ?? [])
    } catch {
      setSchema([])
    }
  }, [vectorViewContext, userId])

  useEffect(() => {
    fetchChunks()
    apiGetVectorSchema(userId!, vectorViewContext?.connId!, vectorViewContext?.collection!)
      .then(res => setSchema(res.properties ?? []))
      .catch(() => setSchema([]))
  }, [vectorViewContext?.collection, vectorViewContext?.connId])  // eslint-disable-line

  useEffect(() => { setSearchTerm('') }, [vectorViewContext?.collection])

  // ── Edit handlers ──────────────────────────────────────────────────────────

  const startEdit = () => {
    const chunk = chunks.find(c => c.id === selectedId)
    if (!chunk) return
    setEditPayload({ ...chunk.payload })
    setEditing(true)
    setConfirmDelete(false)
  }

  const cancelEdit = () => { setEditing(false); setEditPayload({}) }

  const saveEdit = async () => {
    if (!vectorViewContext || !userId || !selectedId) return
    setSaving(true)
    try {
      await apiUpdateVectorChunk(userId, vectorViewContext.connId, vectorViewContext.collection, selectedId, { ...editPayload })
      setChunks(cs => cs.map(c => c.id === selectedId ? { ...c, payload: { ...editPayload } } : c))
      setEditing(false)
    } catch (e: any) {
      alert(e?.response?.data?.detail || 'Update failed')
    } finally {
      setSaving(false)
    }
  }

  // ── Delete handler ─────────────────────────────────────────────────────────

  const confirmAndDelete = async () => {
    if (!vectorViewContext || !userId || !selectedId) return
    setDeleting(true)
    try {
      await apiDeleteVectorChunk(userId, vectorViewContext.connId, vectorViewContext.collection, selectedId)
      setChunks(cs => cs.filter(c => c.id !== selectedId))
      setSelectedId(null)
      setConfirmDelete(false)
    } catch (e: any) {
      alert(e?.response?.data?.detail || 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  // ── Upload handler ─────────────────────────────────────────────────────────

  const handleUpload = async (files: File[]) => {
    if (!vectorViewContext || !userId) return
    const result = await apiUploadVectorChunks(
      userId, vectorViewContext.connId, vectorViewContext.collection, textField, files,
    )
    if (result.errors.length) throw new Error(result.errors.map(e => e.error).join('; '))
    await fetchChunks()
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!vectorViewContext) return null

  const filtered = chunks.filter(c => matchesSearch(c, searchTerm))
  const selected = selectedId ? chunks.find(c => c.id === selectedId) ?? null : null

  return (
    <div className="h-full flex flex-col bg-surface-200">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-surface-300 border-b border-surface-50 flex-shrink-0">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
          <input
            className="w-full bg-surface-200 text-gray-300 pl-8 pr-8 py-1 rounded text-xs outline-none border border-surface-50 focus:border-accent transition-colors"
            placeholder={`Search ${vectorViewContext.collection} chunks…`}
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button onClick={() => setSearchTerm('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
              <X size={12} />
            </button>
          )}
        </div>
        <span className="text-[11px] text-gray-600 flex-shrink-0 tabular-nums">
          {loading ? '…' : `${filtered.length} / ${chunks.length}`}
        </span>
        <button
          onClick={() => setShowUpload(true)}
          className="btn-ghost p-1 flex-shrink-0 text-accent hover:text-accent-hover"
          title="Upload files as chunks"
        >
          <Upload size={13} />
        </button>
        <button onClick={fetchChunks} disabled={loading} className="btn-ghost p-1 flex-shrink-0" title="Refresh">
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 flex min-h-0 overflow-hidden">

        {/* Left: chunk list */}
        <div className="w-72 flex-shrink-0 border-r border-surface-50 flex flex-col">
          <div className="px-3 py-1 bg-surface-300 border-b border-surface-50 flex-shrink-0">
            <span className="text-[11px] text-gray-600 uppercase tracking-wider font-medium">
              {vectorViewContext.collection}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {error ? (
              <div className="flex items-start gap-2 p-3 text-xs text-red-400">
                <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            ) : loading ? (
              <div className="flex items-center justify-center gap-2 h-20 text-xs text-gray-600">
                <Loader2 size={13} className="animate-spin" /> Loading…
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 h-24 text-xs text-gray-600">
                <Package size={20} className="text-gray-700" />
                {chunks.length === 0 ? 'No chunks found' : 'No matches'}
              </div>
            ) : (
              filtered.map(chunk => {
                const title = extractTitle(chunk.payload, chunk.id)
                const isSelected = selectedId === chunk.id
                return (
                  <button
                    key={chunk.id}
                    onClick={() => { setSelectedId(chunk.id); setEditing(false); setConfirmDelete(false) }}
                    className={`w-full text-left flex items-start gap-2 px-3 py-2 border-b border-surface-50 transition-colors ${
                      isSelected
                        ? 'bg-accent/10 border-l-2 border-l-accent'
                        : 'hover:bg-surface-50 border-l-2 border-l-transparent'
                    }`}
                  >
                    <Package size={13} className={`flex-shrink-0 mt-0.5 ${isSelected ? 'text-accent' : 'text-violet-400'}`} />
                    <div className="min-w-0 flex-1">
                      <div className={`text-xs truncate leading-snug ${isSelected ? 'text-gray-100' : 'text-gray-300'}`}>{title}</div>
                      <div className="text-[10px] text-gray-600 font-mono truncate">{chunk.id}</div>
                    </div>
                    {isSelected && <ChevronRight size={11} className="flex-shrink-0 mt-0.5 text-accent" />}
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* Right: chunk detail / editor */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {!selected ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-600">
              <Package size={28} className="text-gray-700" />
              <span className="text-xs">Select a chunk to view or edit</span>
            </div>
          ) : (
            <>
              {/* Detail toolbar */}
              <div className="flex items-center gap-2 px-4 py-2 bg-surface-300 border-b border-surface-50 flex-shrink-0">
                <Package size={13} className="text-violet-400 flex-shrink-0" />
                <span className="text-[11px] font-mono text-gray-500 truncate flex-1">{selected.id}</span>

                {!editing && !confirmDelete && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={startEdit}
                      className="btn-ghost flex items-center gap-1 text-xs text-gray-400 hover:text-accent"
                      title="Edit chunk"
                    >
                      <Pencil size={12} /> Edit
                    </button>
                    <button
                      onClick={() => setConfirmDelete(true)}
                      className="btn-ghost flex items-center gap-1 text-xs text-gray-400 hover:text-red-400"
                      title="Delete chunk"
                    >
                      <Trash2 size={12} /> Delete
                    </button>
                  </div>
                )}

                {editing && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={saveEdit}
                      disabled={saving}
                      className="btn-ghost flex items-center gap-1 text-xs text-green-400 hover:text-green-300 disabled:opacity-50"
                    >
                      {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Save
                    </button>
                    <button onClick={cancelEdit} className="btn-ghost flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300">
                      <X size={12} /> Cancel
                    </button>
                  </div>
                )}

                {confirmDelete && (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[11px] text-red-400">Delete this chunk?</span>
                    <button
                      onClick={confirmAndDelete}
                      disabled={deleting}
                      className="flex items-center gap-1 bg-red-700 hover:bg-red-600 text-white text-xs px-2 py-0.5 rounded disabled:opacity-50 transition-colors"
                    >
                      {deleting ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />} Yes, delete
                    </button>
                    <button onClick={() => setConfirmDelete(false)} className="btn-ghost text-xs text-gray-500">
                      Cancel
                    </button>
                  </div>
                )}
              </div>

              {/* Detail body */}
              <div className="flex-1 overflow-y-auto p-4">
                {editing ? (
                  <EditForm
                    payload={editPayload}
                    schema={schema}
                    textField={textField}
                    onChange={setEditPayload}
                  />
                ) : (
                  <div className="font-mono text-xs space-y-1">
                    <JsonView data={selected.payload} depth={0} />
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {showUpload && (
        <UploadDialog
          textField={textField}
          onUpload={handleUpload}
          onClose={() => setShowUpload(false)}
        />
      )}
    </div>
  )
}

// ── Edit form ─────────────────────────────────────────────────────────────────

function EditForm({
  payload, schema, textField, onChange,
}: {
  payload: Record<string, unknown>
  schema: SchemaProperty[]
  textField: string
  onChange: (p: Record<string, unknown>) => void
}) {
  const keys = Object.keys(payload).filter(k => k !== 'id')

  const updateKey = (k: string, v: unknown) => onChange({ ...payload, [k]: v })

  // Determine if a field should be a textarea
  const isTextArea = (k: string, v: unknown) =>
    k === textField || (typeof v === 'string' && (v as string).length > 80)

  return (
    <div className="space-y-3">
      {keys.map(k => {
        const v = payload[k]
        if (typeof v === 'object' && v !== null)
          return (
            <div key={k}>
              <label className="text-[11px] text-sky-400 font-medium block mb-1">{k}</label>
              <textarea
                className="w-full bg-surface-300 text-gray-300 text-xs font-mono p-2 rounded border border-surface-50 focus:border-accent outline-none resize-y min-h-[60px]"
                value={JSON.stringify(v, null, 2)}
                onChange={e => { try { updateKey(k, JSON.parse(e.target.value)) } catch { updateKey(k, e.target.value) } }}
              />
            </div>
          )
        if (isTextArea(k, v))
          return (
            <div key={k}>
              <label className="text-[11px] text-sky-400 font-medium block mb-1">{k}</label>
              <textarea
                className="w-full bg-surface-300 text-gray-300 text-xs font-mono p-2 rounded border border-surface-50 focus:border-accent outline-none resize-y min-h-[120px]"
                value={String(v ?? '')}
                onChange={e => updateKey(k, e.target.value)}
              />
            </div>
          )
        return (
          <div key={k}>
            <label className="text-[11px] text-sky-400 font-medium block mb-1">{k}</label>
            <input
              className="w-full bg-surface-300 text-gray-300 text-xs font-mono px-2 py-1 rounded border border-surface-50 focus:border-accent outline-none"
              value={String(v ?? '')}
              onChange={e => updateKey(k, e.target.value)}
            />
          </div>
        )
      })}
      {keys.length === 0 && (
        <p className="text-xs text-gray-600 italic">No editable fields in payload</p>
      )}
    </div>
  )
}
