import { useState, useEffect, useRef } from 'react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Download, AlertCircle, CheckCircle, CheckCircle2,
  Pencil, X, Check, Play, Copy, Loader2, Trash2, Plus,
} from 'lucide-react'
import { useStore } from '../../store'
import { useUserSession } from '../../hooks/useUserSession'
import { apiExecuteQuery } from '../../api/client'
import TypeSelector from './TypeSelector'

// ── CSV export ────────────────────────────────────────────────────────────────

function downloadCsv(columns: string[], rows: Record<string, unknown>[]) {
  const header = columns.join(',')
  const body = rows.map((r) =>
    columns.map((c) => {
      const val = r[c]
      const s = val === null ? '' : String(val)
      return s.includes(',') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
    }).join(',')
  ).join('\n')
  const blob = new Blob([header + '\n' + body], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'pilotbase_result.csv'
  a.click()
  URL.revokeObjectURL(url)
}

function rewriteQueryColumns(query: string, newColumns: string[], dbType: string): string {
  if (!/SELECT\s+\*/i.test(query)) return query
  const quote = (col: string) =>
    dbType === 'mysql' || dbType === 'mariadb' ? `\`${col}\`` : `"${col}"`
  return query.replace(/SELECT\s+\*/i, `SELECT ${newColumns.map(quote).join(', ')}`)
}

// ── ALTER TABLE script generation ─────────────────────────────────────────────

function quoteId(name: string, dbType: string): string {
  if (dbType === 'mysql' || dbType === 'mariadb') return `\`${name}\``
  if (dbType === 'mssql') return `[${name}]`
  return `"${name}"`
}

function tableRef(table: string, db: string | null, dbType: string): string {
  const q = (s: string) => quoteId(s, dbType)
  return db ? `${q(db)}.${q(table)}` : q(table)
}

interface ColDraft {
  name: string
  type: string
  nullable: string
  default: string
}

function generateAlterScripts(
  dbType: string,
  table: string,
  db: string | null,
  original: ColDraft,
  edited: ColDraft,
): string[] {
  if (
    original.name === edited.name &&
    original.type === edited.type &&
    original.nullable === edited.nullable &&
    original.default === edited.default
  ) return []

  const scripts: string[] = []
  const q = (s: string) => quoteId(s, dbType)
  const tbl = tableRef(table, db, dbType)

  if (dbType === 'mysql' || dbType === 'mariadb') {
    if (original.name !== edited.name) {
      scripts.push(`ALTER TABLE ${tbl} RENAME COLUMN ${q(original.name)} TO ${q(edited.name)};`)
    }
    const colName = q(edited.name)
    if (original.type !== edited.type || original.nullable !== edited.nullable) {
      const nullStr = edited.nullable === 'YES' ? 'NULL' : 'NOT NULL'
      const defStr = edited.default ? ` DEFAULT '${edited.default}'` : ''
      scripts.push(`ALTER TABLE ${tbl} MODIFY COLUMN ${colName} ${edited.type} ${nullStr}${defStr};`)
    } else if (original.default !== edited.default) {
      scripts.push(
        edited.default
          ? `ALTER TABLE ${tbl} ALTER COLUMN ${colName} SET DEFAULT '${edited.default}';`
          : `ALTER TABLE ${tbl} ALTER COLUMN ${colName} DROP DEFAULT;`
      )
    }

  } else if (dbType === 'postgresql') {
    const oldCol = q(original.name)
    const newCol = q(edited.name)
    if (original.name !== edited.name) {
      scripts.push(`ALTER TABLE ${tbl} RENAME COLUMN ${oldCol} TO ${newCol};`)
    }
    if (original.type !== edited.type) {
      scripts.push(`ALTER TABLE ${tbl} ALTER COLUMN ${newCol} TYPE ${edited.type};`)
    }
    if (original.nullable !== edited.nullable) {
      scripts.push(
        edited.nullable === 'YES'
          ? `ALTER TABLE ${tbl} ALTER COLUMN ${newCol} DROP NOT NULL;`
          : `ALTER TABLE ${tbl} ALTER COLUMN ${newCol} SET NOT NULL;`
      )
    }
    if (original.default !== edited.default) {
      scripts.push(
        edited.default
          ? `ALTER TABLE ${tbl} ALTER COLUMN ${newCol} SET DEFAULT '${edited.default}';`
          : `ALTER TABLE ${tbl} ALTER COLUMN ${newCol} DROP DEFAULT;`
      )
    }

  } else if (dbType === 'sqlite') {
    if (original.name !== edited.name) {
      scripts.push(`ALTER TABLE ${tbl} RENAME COLUMN ${q(original.name)} TO ${q(edited.name)};`)
    }
    if (original.type !== edited.type || original.nullable !== edited.nullable || original.default !== edited.default) {
      scripts.push(`-- SQLite does not support ALTER COLUMN. Recreate the table to change type, nullable, or default for "${edited.name}".`)
    }

  } else if (dbType === 'mssql') {
    if (original.name !== edited.name) {
      scripts.push(`EXEC sp_rename '${table}.${original.name}', '${edited.name}', 'COLUMN';`)
    }
    if (original.type !== edited.type || original.nullable !== edited.nullable) {
      const nullStr = edited.nullable === 'YES' ? 'NULL' : 'NOT NULL'
      scripts.push(`ALTER TABLE ${tbl} ALTER COLUMN ${q(edited.name)} ${edited.type} ${nullStr};`)
    }
    if (original.default !== edited.default && edited.default) {
      scripts.push(`ALTER TABLE ${tbl} ADD DEFAULT '${edited.default}' FOR ${q(edited.name)};`)
    }

  } else {
    if (original.name !== edited.name) {
      scripts.push(`ALTER TABLE ${q(table)} RENAME COLUMN ${q(original.name)} TO ${q(edited.name)};`)
    }
    if (original.type !== edited.type) {
      scripts.push(`ALTER TABLE ${q(table)} ALTER COLUMN ${q(edited.name)} TYPE ${edited.type};`)
    }
  }

  return scripts
}

function generateDropColumnScript(dbType: string, table: string, db: string | null, colName: string): string {
  const q = (s: string) => quoteId(s, dbType)
  const tbl = tableRef(table, db, dbType)
  if (dbType === 'sqlite') {
    return `-- SQLite 3.35+\nALTER TABLE ${tbl} DROP COLUMN ${q(colName)};`
  }
  return `ALTER TABLE ${tbl} DROP COLUMN ${q(colName)};`
}

function generateAddColumnScript(
  dbType: string,
  table: string,
  db: string | null,
  col: ColDraft,
  afterColumn: string,
): string {
  const q = (s: string) => quoteId(s, dbType)
  const tbl = tableRef(table, db, dbType)
  const nullStr = col.nullable === 'YES' ? 'NULL' : 'NOT NULL'
  const defStr = col.default ? ` DEFAULT '${col.default}'` : ''

  const supportsAfter = dbType === 'mysql' || dbType === 'mariadb'
  const afterStr = supportsAfter && afterColumn ? ` AFTER ${q(afterColumn)}` : ''

  if (!supportsAfter && afterColumn) {
    const comment = `-- Note: ${dbType} does not support column positioning. Column will be added at the end.\n`
    return `${comment}ALTER TABLE ${tbl} ADD COLUMN ${q(col.name)} ${col.type} ${nullStr}${defStr};`
  }

  return `ALTER TABLE ${tbl} ADD COLUMN ${q(col.name)} ${col.type} ${nullStr}${defStr}${afterStr};`
}

// ── Drag-sortable header (normal query results) ───────────────────────────────

function SortableHeader({ col }: { col: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: col })
  return (
    <th
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        cursor: isDragging ? 'grabbing' : 'grab',
        userSelect: 'none',
      }}
      {...attributes}
      {...listeners}
      className="px-3 py-1.5 text-left text-[14px] text-gray-600 dark:text-gray-400 font-medium border-b border-r border-surface-50 whitespace-nowrap"
    >
      {col}
    </th>
  )
}

// ── Inline input used in edit/add rows ────────────────────────────────────────

function CellInput({ value, onChange, placeholder, autoFocus }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoFocus?: boolean
}) {
  return (
    <input
      className="w-full bg-surface-200 text-gray-200 px-1.5 py-0.5 rounded text-xs font-mono outline-none border border-accent focus:ring-1 focus:ring-accent"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      autoFocus={autoFocus}
    />
  )
}

// ── Main component ────────────────────────────────────────────────────────────

const EMPTY_COL: ColDraft = { name: '', type: 'VARCHAR(255)', nullable: 'YES', default: '' }
const VIEW_COLS = ['column', 'type', 'nullable', 'default', 'pk'] as const

export default function ResultsTable() {
  const {
    queryResult, setQueryResult,
    queryLoading,
    activeQuery, setActiveQuery,
    activeConnectionId, connections,
    columnViewContext,
    alterScriptLog, appendAlterScript, clearAlterScripts,
  } = useStore()
  const { userId } = useUserSession()

  const [columnOrder, setColumnOrder]       = useState<string[]>([])
  const [editingRowIdx, setEditingRowIdx]   = useState<number | null>(null)
  const [editDraft, setEditDraft]           = useState<ColDraft | null>(null)
  const [deletingRowIdx, setDeletingRowIdx] = useState<number | null>(null)
  const [addingColumn, setAddingColumn]     = useState(false)
  const [newColDraft, setNewColDraft]       = useState<ColDraft>(EMPTY_COL)
  const [afterColumn, setAfterColumn]       = useState('')
  const [scriptRunning, setScriptRunning]   = useState(false)
  const scriptEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (queryResult?.columns) setColumnOrder([...queryResult.columns])
    setEditingRowIdx(null)
    setEditDraft(null)
    setAddingColumn(false)
    setNewColDraft(EMPTY_COL)
  }, [queryResult])

  useEffect(() => {
    scriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [alterScriptLog])

  const sensors = useSensors(useSensor(PointerSensor))

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setColumnOrder((cols) => {
      const oldIdx = cols.indexOf(String(active.id))
      const newIdx = cols.indexOf(String(over.id))
      const newCols = arrayMove(cols, oldIdx, newIdx)
      const conn = connections.find(c => c.id === activeConnectionId)
      if (conn) {
        const rewritten = rewriteQueryColumns(activeQuery, newCols, conn.db_type)
        if (rewritten !== activeQuery) setActiveQuery(rewritten)
      }
      return newCols
    })
  }

  const isColumnView = !!columnViewContext &&
    queryResult?.columns?.join(',') === 'column,type,nullable,default,pk'

  // ── Edit handlers ────────────────────────────────────────────────────────────

  const handleEditRow = (idx: number) => {
    if (!queryResult) return
    const row = queryResult.rows[idx]
    setAddingColumn(false)
    setDeletingRowIdx(null)
    setEditingRowIdx(idx)
    setEditDraft({
      name:     String(row.column  ?? ''),
      type:     String(row.type    ?? ''),
      nullable: String(row.nullable ?? 'YES'),
      default:  String(row.default  ?? ''),
    })
  }

  const handleCancelEdit = () => {
    setEditingRowIdx(null)
    setEditDraft(null)
  }

  const handleSaveEdit = (idx: number) => {
    if (!queryResult || !editDraft || !columnViewContext) return
    const row = queryResult.rows[idx]
    const original: ColDraft = {
      name:     String(row.column  ?? ''),
      type:     String(row.type    ?? ''),
      nullable: String(row.nullable ?? 'YES'),
      default:  String(row.default  ?? ''),
    }
    const scripts = generateAlterScripts(columnViewContext.dbType, columnViewContext.table, columnViewContext.db, original, editDraft)
    scripts.forEach(sql => appendAlterScript(sql))

    const updatedRows = queryResult.rows.map((r, i) =>
      i === idx
        ? { ...r, column: editDraft.name, type: editDraft.type, nullable: editDraft.nullable, default: editDraft.default }
        : r
    )
    setQueryResult({ ...queryResult, rows: updatedRows })
    setEditingRowIdx(null)
    setEditDraft(null)
  }

  // ── Add column handlers ──────────────────────────────────────────────────────

  const handleOpenAddColumn = () => {
    setEditingRowIdx(null)
    setEditDraft(null)
    setAddingColumn(true)
    setNewColDraft(EMPTY_COL)
    setAfterColumn('')
  }

  const handleCancelAdd = () => {
    setAddingColumn(false)
    setNewColDraft(EMPTY_COL)
  }

  const handleConfirmDelete = (idx: number) => {
    if (!queryResult || !columnViewContext) return
    const colName = String(queryResult.rows[idx].column ?? '')
    const sql = generateDropColumnScript(columnViewContext.dbType, columnViewContext.table, columnViewContext.db, colName)
    appendAlterScript(sql)
    setQueryResult({
      ...queryResult,
      rows: queryResult.rows.filter((_, ri) => ri !== idx),
      row_count: queryResult.row_count - 1,
    })
    setDeletingRowIdx(null)
  }

  const handleSaveAdd = () => {
    if (!newColDraft.name.trim() || !newColDraft.type.trim() || !columnViewContext) return
    const sql = generateAddColumnScript(columnViewContext.dbType, columnViewContext.table, columnViewContext.db, newColDraft, afterColumn)
    appendAlterScript(sql)

    // Append new row to the column list in the UI
    if (queryResult) {
      setQueryResult({
        ...queryResult,
        rows: [
          ...queryResult.rows,
          { column: newColDraft.name, type: newColDraft.type, nullable: newColDraft.nullable, default: newColDraft.default, pk: '' },
        ],
        row_count: queryResult.row_count + 1,
      })
    }
    setAddingColumn(false)
    setNewColDraft(EMPTY_COL)
  }

  // ── Script execution ─────────────────────────────────────────────────────────

  const handleRunAllScripts = async () => {
    const pending = alterScriptLog.filter(e => !e.executed)
    if (!pending.length || !columnViewContext || !userId) return
    setScriptRunning(true)
    try {
      for (const entry of pending) {
        const firstLine = entry.sql.trimStart()
        if (firstLine.startsWith('--') && !firstLine.includes('\n')) continue
        const execSql = firstLine.startsWith('--')
          ? entry.sql.split('\n').filter(l => !l.trimStart().startsWith('--')).join('\n').trim()
          : entry.sql
        if (execSql) {
          await apiExecuteQuery(userId, columnViewContext.connId, execSql, columnViewContext.db || undefined)
        }
      }
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Script execution failed.')
    } finally {
      setScriptRunning(false)
    }
  }

  const handleCopyAllScripts = () => {
    const text = alterScriptLog.map(e => `-- ${e.ts}\n${e.sql}`).join('\n\n')
    navigator.clipboard.writeText(text)
  }

  // ── Loading / error / empty states ───────────────────────────────────────────

  if (queryLoading) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-gray-500">
        <span className="animate-pulse">Running query…</span>
      </div>
    )
  }

  if (!queryResult) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-gray-600">
        Results will appear here
      </div>
    )
  }

  const hasError = (queryResult as any).error
  if (hasError) {
    return (
      <div className="h-full p-4">
        <div className="flex items-start gap-2 text-red-400 text-xs">
          <AlertCircle size={18} className="flex-shrink-0 mt-0.5" />
          <pre className="whitespace-pre-wrap font-mono">{(queryResult as any).error}</pre>
        </div>
      </div>
    )
  }

  if (queryResult.columns.length === 0) {
    return (
      <div className="h-full flex items-center gap-2 justify-center text-xs text-green-400">
        <CheckCircle size={18} />
        <span>
          Query executed.{queryResult.affected !== undefined ? ` ${queryResult.affected} row(s) affected.` : ''}
        </span>
      </div>
    )
  }

  // ── Shared SQL log panel ──────────────────────────────────────────────────────

  const pendingScripts = alterScriptLog.filter(e => !e.executed)

  const sqlLogPanel = (
    <div className="h-44 flex-shrink-0 border-t-2 border-surface-50 flex flex-col bg-surface-300">
      <div className="flex items-center justify-between px-3 py-1 border-b border-surface-50 flex-shrink-0">
        <span className="text-xs font-medium text-gray-400">
          Executed SQL Scripts
          {alterScriptLog.length > 0 && (
            <span className="ml-1.5 text-accent font-mono">({alterScriptLog.length})</span>
          )}
        </span>
        <div className="flex items-center gap-1">
          {alterScriptLog.length > 0 && (
            <>
              <button
                onClick={handleCopyAllScripts}
                className="btn-ghost flex items-center gap-1 text-xs"
                title="Copy all scripts to clipboard"
              >
                <Copy size={12} /> Copy All
              </button>
              {pendingScripts.length > 0 && (
                <button
                  onClick={handleRunAllScripts}
                  disabled={scriptRunning}
                  className="btn-ghost flex items-center gap-1 text-xs text-green-400 hover:text-green-300 disabled:opacity-50"
                  title="Execute pending scripts on the database"
                >
                  {scriptRunning
                    ? <Loader2 size={12} className="animate-spin" />
                    : <Play size={12} fill="currentColor" />
                  }
                  Run Pending
                </button>
              )}
              <button
                onClick={clearAlterScripts}
                className="btn-ghost p-0.5 text-gray-500 hover:text-red-400 transition-colors"
                title="Clear script log"
              >
                <Trash2 size={13} />
              </button>
            </>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3 font-mono text-xs">
        {alterScriptLog.length === 0 ? (
          <p className="text-gray-600 text-center pt-3">
            SQL executed by actions (drop, truncate, alter) will appear here
          </p>
        ) : (
          <div className="space-y-3">
            {alterScriptLog.map((entry, i) => {
              const isCommentOnly = entry.sql.split('\n').every(l => l.trimStart().startsWith('--') || l.trim() === '')
              return (
                <div key={i}>
                  <div className="flex items-center gap-1.5 text-[11px] text-gray-600">
                    {entry.executed
                      ? <CheckCircle2 size={11} className="text-green-600 flex-shrink-0" />
                      : <span className="w-[11px] h-[11px] inline-block rounded-full border border-yellow-600 flex-shrink-0" />
                    }
                    <span>{entry.ts}</span>
                    {entry.executed && <span className="text-green-700">executed</span>}
                  </div>
                  <pre className={`mt-0.5 whitespace-pre-wrap pl-[15px] ${
                    entry.executed ? 'text-green-500' : isCommentOnly ? 'text-yellow-600' : 'text-accent'
                  }`}>
                    {entry.sql}
                  </pre>
                </div>
              )
            })}
            <div ref={scriptEndRef} />
          </div>
        )}
      </div>
    </div>
  )

  // ── Column view (editable) ────────────────────────────────────────────────────

  if (isColumnView) {
    const supportsAfter = columnViewContext!.dbType === 'mysql' || columnViewContext!.dbType === 'mariadb'
    const columnNames = queryResult.rows.map(r => String(r.column ?? ''))

    return (
      <div className="h-full flex flex-col bg-surface-200">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-3 py-1 bg-surface-300 border-b border-surface-50 flex-shrink-0">
          <span className="text-xs text-gray-500">
            {queryResult.row_count} column{queryResult.row_count !== 1 ? 's' : ''}
            <span className="text-gray-600 ml-2">· {columnViewContext!.table}</span>
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleOpenAddColumn}
              className="btn-ghost flex items-center gap-1 text-xs text-accent hover:text-accent-hover"
              title="Add a new column"
            >
              <Plus size={14} /> Add Column
            </button>
            <button
              onClick={() => downloadCsv([...VIEW_COLS], queryResult.rows)}
              className="btn-ghost flex items-center gap-1 text-xs"
            >
              <Download size={16} /> CSV
            </button>
          </div>
        </div>

        {/* Editable column table */}
        <div className="flex-1 overflow-auto min-h-0">
          <table className="min-w-full text-xs font-mono">
            <thead className="sticky top-0 bg-surface-300 z-10">
              <tr>
                {[...VIEW_COLS, ''].map(col => (
                  <th
                    key={col}
                    className="px-3 py-1.5 text-left text-[14px] text-gray-600 dark:text-gray-400 font-medium border-b border-r border-surface-50 whitespace-nowrap"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {queryResult.rows.map((row, i) => {
                const isEditing = editingRowIdx === i
                if (isEditing && editDraft) {
                  return (
                    <tr key={i} className="bg-surface-50">
                      <td className="px-2 py-1 border-b border-r border-surface-50">
                        <CellInput value={editDraft.name} onChange={v => setEditDraft({ ...editDraft, name: v })} autoFocus />
                      </td>
                      <td className="px-2 py-1 border-b border-r border-surface-50">
                        <TypeSelector value={editDraft.type} onChange={v => setEditDraft({ ...editDraft, type: v })} dbType={columnViewContext!.dbType} />
                      </td>
                      <td className="px-2 py-1 border-b border-r border-surface-50">
                        <select
                          className="w-full bg-surface-200 text-gray-200 px-1.5 py-0.5 rounded text-xs outline-none border border-accent"
                          value={editDraft.nullable}
                          onChange={e => setEditDraft({ ...editDraft, nullable: e.target.value })}
                        >
                          <option value="YES">YES</option>
                          <option value="NO">NO</option>
                        </select>
                      </td>
                      <td className="px-2 py-1 border-b border-r border-surface-50">
                        <CellInput value={editDraft.default} onChange={v => setEditDraft({ ...editDraft, default: v })} placeholder="NULL" />
                      </td>
                      <td className="px-3 py-1 border-b border-r border-surface-50 text-gray-500">
                        {String(row.pk ?? '')}
                      </td>
                      <td className="px-2 py-1 border-b border-surface-50">
                        <div className="flex items-center gap-1">
                          <button onClick={() => handleSaveEdit(i)} className="text-green-400 hover:text-green-300 p-0.5 rounded transition-colors" title="Generate ALTER TABLE script">
                            <Check size={14} />
                          </button>
                          <button onClick={handleCancelEdit} className="text-gray-500 hover:text-gray-300 p-0.5 rounded transition-colors" title="Cancel">
                            <X size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                }
                const isDeleting = deletingRowIdx === i
                return (
                  <tr key={i} className={`hover:bg-surface-50 transition-colors group ${isDeleting ? 'bg-red-950/30' : ''}`}>
                    {VIEW_COLS.map(col => (
                      <td
                        key={col}
                        className={`px-3 py-1 border-b border-r border-surface-50 ${
                          isDeleting ? 'text-red-400' : !row[col] ? 'text-gray-500 italic' : 'text-gray-700 dark:text-gray-300'
                        }`}
                      >
                        {String(row[col] ?? '')}
                      </td>
                    ))}
                    <td className="px-2 py-1 border-b border-surface-50 w-16">
                      {isDeleting ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleConfirmDelete(i)}
                            className="p-0.5 rounded text-red-400 hover:text-red-300 transition-colors"
                            title="Confirm drop column"
                          >
                            <Check size={13} />
                          </button>
                          <button
                            onClick={() => setDeletingRowIdx(null)}
                            className="p-0.5 rounded text-gray-500 hover:text-gray-300 transition-colors"
                            title="Cancel"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      ) : (
                        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-all">
                          <button
                            onClick={() => handleEditRow(i)}
                            className="btn-ghost p-0.5 text-gray-400 hover:text-accent"
                            title="Edit column"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            onClick={() => { setDeletingRowIdx(i); setEditingRowIdx(null); setEditDraft(null) }}
                            className="btn-ghost p-0.5 text-gray-400 hover:text-red-400"
                            title="Drop column"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}

              {/* Add column row */}
              {addingColumn && (
                <tr className="bg-surface-50 border-t-2 border-accent">
                  <td className="px-2 py-1 border-b border-r border-surface-50">
                    <CellInput value={newColDraft.name} onChange={v => setNewColDraft({ ...newColDraft, name: v })} placeholder="column_name" autoFocus />
                  </td>
                  <td className="px-2 py-1 border-b border-r border-surface-50">
                    <TypeSelector value={newColDraft.type} onChange={v => setNewColDraft({ ...newColDraft, type: v })} dbType={columnViewContext!.dbType} />
                  </td>
                  <td className="px-2 py-1 border-b border-r border-surface-50">
                    <select
                      className="w-full bg-surface-200 text-gray-200 px-1.5 py-0.5 rounded text-xs outline-none border border-accent"
                      value={newColDraft.nullable}
                      onChange={e => setNewColDraft({ ...newColDraft, nullable: e.target.value })}
                    >
                      <option value="YES">YES</option>
                      <option value="NO">NO</option>
                    </select>
                  </td>
                  <td className="px-2 py-1 border-b border-r border-surface-50">
                    <CellInput value={newColDraft.default} onChange={v => setNewColDraft({ ...newColDraft, default: v })} placeholder="NULL" />
                  </td>
                  <td className="px-2 py-1 border-b border-r border-surface-50">
                    {supportsAfter ? (
                      <select
                        className="w-full bg-surface-200 text-gray-400 px-1.5 py-0.5 rounded text-xs outline-none border border-surface-50"
                        value={afterColumn}
                        onChange={e => setAfterColumn(e.target.value)}
                        title="Insert after this column"
                      >
                        <option value="">— end —</option>
                        {columnNames.map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    ) : (
                      <span className="text-gray-600 text-[11px] px-1">added at end</span>
                    )}
                  </td>
                  <td className="px-2 py-1 border-b border-surface-50">
                    <div className="flex items-center gap-1">
                      <button onClick={handleSaveAdd} className="text-green-400 hover:text-green-300 p-0.5 rounded transition-colors" title="Generate ADD COLUMN script">
                        <Check size={14} />
                      </button>
                      <button onClick={handleCancelAdd} className="text-gray-500 hover:text-gray-300 p-0.5 rounded transition-colors" title="Cancel">
                        <X size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {sqlLogPanel}
      </div>
    )
  }

  // ── Normal query results ──────────────────────────────────────────────────────

  const displayColumns = columnOrder.length === queryResult.columns.length ? columnOrder : queryResult.columns

  return (
    <div className="h-full flex flex-col bg-surface-200">
      <div className="flex items-center justify-between px-3 py-1 bg-surface-300 border-b border-surface-50 flex-shrink-0">
        <span className="text-xs text-gray-500">
          {queryResult.row_count} row{queryResult.row_count !== 1 ? 's' : ''}
          {queryResult.truncated && <span className="text-yellow-500 ml-2">(truncated to 1000)</span>}
        </span>
        <button
          onClick={() => downloadCsv(displayColumns, queryResult.rows)}
          className="btn-ghost flex items-center gap-1 text-xs"
        >
          <Download size={16} />
          CSV
        </button>
      </div>

      <div className="flex-1 overflow-auto min-h-0">
        <table className="min-w-full text-xs font-mono">
          <thead className="sticky top-0 bg-surface-300 z-10">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={displayColumns} strategy={horizontalListSortingStrategy}>
                <tr>
                  {displayColumns.map((col) => (
                    <SortableHeader key={col} col={col} />
                  ))}
                </tr>
              </SortableContext>
            </DndContext>
          </thead>
          <tbody>
            {queryResult.rows.map((row, i) => (
              <tr key={i} className="hover:bg-surface-50 transition-colors">
                {displayColumns.map((col) => {
                  const val = row[col]
                  const isNull = val === null
                  return (
                    <td
                      key={col}
                      className={`px-3 py-1 border-b border-r border-surface-50 max-w-xs truncate ${
                        isNull ? 'text-gray-500 italic' : 'text-gray-700 dark:text-gray-300'
                      }`}
                      title={isNull ? 'NULL' : String(val)}
                    >
                      {isNull ? 'NULL' : String(val)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sqlLogPanel}
    </div>
  )
}
