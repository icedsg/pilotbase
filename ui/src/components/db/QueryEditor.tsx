import { useRef, useEffect, forwardRef, useImperativeHandle } from 'react'
import Editor, { useMonaco } from '@monaco-editor/react'
import { format as formatSql } from 'sql-formatter'
import type { SqlLanguage } from 'sql-formatter'
import { useStore, type QueryTab } from '../../store'
import { useUserSession } from '../../hooks/useUserSession'
import { apiExecuteQuery, apiListObjects, apiDescribeTable } from '../../api/client'
import { isNoSqlJsonDbType } from '../../utils/dbTypes'

export interface QueryEditorHandle {
  run: () => void
  format: () => void
}

const DIALECTS: Record<string, SqlLanguage> = {
  postgresql: 'postgresql', cockroachdb: 'postgresql', mysql: 'mysql', mariadb: 'mariadb',
  sqlite: 'sqlite', duckdb: 'sql', mssql: 'transactsql', oracle: 'plsql', snowflake: 'snowflake',
  bigquery: 'bigquery', redshift: 'redshift', clickhouse: 'sql', cassandra: 'sql',
}

const QueryEditor = forwardRef<QueryEditorHandle, { tab: QueryTab }>(({ tab }, ref) => {
  const { userId } = useUserSession()
  const { updateQueryTab, theme, connections } = useStore()
  const activeConnectionId = tab.connectionId
  const activeDatabase = tab.database
  const activeQuery = tab.query
  const queryLoading = tab.loading

  const editorRef = useRef<any>(null)
  const completionDisposableRef = useRef<any>(null)
  const monaco = useMonaco()
  const activeConn = connections.find(c => c.id === activeConnectionId)
  const isNoSqlJsonConn = isNoSqlJsonDbType(activeConn?.db_type)

  const runQuery = async () => {
    const selection = editorRef.current?.getSelection()
    const selected = selection && !selection.isEmpty()
      ? editorRef.current?.getModel()?.getValueInRange(selection)
      : ''
    const query = selected?.trim() || editorRef.current?.getValue()?.trim() || activeQuery.trim()
    if (!query || !activeConnectionId || queryLoading) return

    updateQueryTab(tab.id, { columnViewContext: null, loading: true, result: null })
    try {
      const started = performance.now()
      const result = await apiExecuteQuery(userId, activeConnectionId, query, activeDatabase || undefined)
      updateQueryTab(tab.id, { result: { ...result, duration_ms: performance.now() - started } })
    } catch (err: any) {
      updateQueryTab(tab.id, {
        result: {
          rows: [],
          columns: ['Error'],
          row_count: 0,
          error: err?.response?.data?.detail || String(err),
        } as any,
      })
    } finally {
      updateQueryTab(tab.id, { loading: false })
    }
  }

  const formatQuery = () => {
    if (isNoSqlJsonConn || !activeConn) return
    const editor = editorRef.current
    const source = editor?.getValue() || activeQuery
    if (!source.trim()) return
    try {
      const formatted = formatSql(source, { language: DIALECTS[activeConn.db_type] || 'sql' })
      editor?.setValue(formatted)
      updateQueryTab(tab.id, { query: formatted })
    } catch {}
  }

  useImperativeHandle(ref, () => ({ run: runQuery, format: formatQuery }))

  useEffect(() => {
    if (!monaco || !activeConnectionId) return

    const conn = connections.find(c => c.id === activeConnectionId)
    if (!conn) return
    if (isNoSqlJsonDbType(conn.db_type)) {
      completionDisposableRef.current?.dispose()
      completionDisposableRef.current = null
      return
    }

    let cancelled = false

    const registerCompletions = async () => {
      completionDisposableRef.current?.dispose()
      completionDisposableRef.current = null

      try {
        const { objects } = await apiListObjects(userId, activeConnectionId, activeDatabase || undefined)
        if (cancelled) return

        const tableObjects = objects.filter(
          o => o.type === 'table' || o.type === 'view' || o.type === 'collection'
        )

        const tableColumns: Record<string, string[]> = {}
        await Promise.allSettled(
          tableObjects.map(async (obj) => {
            try {
              const info = await apiDescribeTable(userId, activeConnectionId, obj.name, undefined, activeDatabase || undefined)
              if (!cancelled) tableColumns[obj.name] = info.columns.map(c => c.name)
            } catch {}
          })
        )

        if (cancelled) return

        completionDisposableRef.current = monaco.languages.registerCompletionItemProvider('sql', {
          provideCompletionItems: (model: any, position: any) => {
            const word = model.getWordUntilPosition(position)
            const range = {
              startLineNumber: position.lineNumber,
              endLineNumber: position.lineNumber,
              startColumn: word.startColumn,
              endColumn: word.endColumn,
            }

            const suggestions: any[] = []

            tableObjects.forEach(obj => {
              suggestions.push({
                label: obj.name,
                kind: monaco.languages.CompletionItemKind.Class,
                detail: obj.type,
                insertText: obj.name,
                range,
              })
            })

            Object.entries(tableColumns).forEach(([tableName, cols]) => {
              cols.forEach(col => {
                suggestions.push({
                  label: col,
                  kind: monaco.languages.CompletionItemKind.Field,
                  detail: tableName,
                  insertText: col,
                  range,
                })
              })
            })

            return { suggestions }
          },
        })
      } catch {}
    }

    registerCompletions()

    return () => {
      cancelled = true
      completionDisposableRef.current?.dispose()
      completionDisposableRef.current = null
    }
  }, [monaco, activeConnectionId, activeDatabase, userId])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      runQuery()
    } else if (e.shiftKey && e.altKey && e.key.toLowerCase() === 'f' && !isNoSqlJsonConn) {
      e.preventDefault()
      formatQuery()
    }
  }

  return (
    <div className="h-full flex flex-col bg-surface-200">
      <div className="flex-1" onKeyDown={handleKeyDown}>
        <Editor
          height="100%"
          language={isNoSqlJsonConn ? 'json' : 'sql'}
          theme={theme === 'dark' ? 'vs-dark' : 'light'}
          value={activeQuery}
          onChange={(val) => updateQueryTab(tab.id, { query: val || '' })}
          onMount={(editor, editorMonaco) => {
            editorRef.current = editor
            editor.addCommand(editorMonaco.KeyMod.CtrlCmd | editorMonaco.KeyCode.Enter, runQuery)
            if (!isNoSqlJsonConn) {
              editor.addCommand(editorMonaco.KeyMod.Shift | editorMonaco.KeyMod.Alt | editorMonaco.KeyCode.KeyF, formatQuery)
            }
          }}
          options={{
            fontSize: 13,
            fontFamily: '"JetBrains Mono", "Fira Code", monospace',
            fontLigatures: true,
            minimap: { enabled: false },
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            tabSize: 2,
            automaticLayout: true,
            padding: { top: 8, bottom: 8 },
            suggest: { showKeywords: true },
            quickSuggestions: true,
          }}
        />
      </div>
    </div>
  )
})

QueryEditor.displayName = 'QueryEditor'
export default QueryEditor
