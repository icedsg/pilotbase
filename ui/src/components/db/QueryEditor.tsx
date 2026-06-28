import { useRef, useEffect, forwardRef, useImperativeHandle } from 'react'
import Editor, { useMonaco } from '@monaco-editor/react'
import { useStore } from '../../store'
import { useUserSession } from '../../hooks/useUserSession'
import { apiExecuteQuery, apiListObjects, apiDescribeTable } from '../../api/client'

export interface QueryEditorHandle {
  run: () => void
}

const QueryEditor = forwardRef<QueryEditorHandle, {}>((_, ref) => {
  const { userId } = useUserSession()
  const {
    activeConnectionId,
    activeDatabase,
    activeQuery,
    setActiveQuery,
    setQueryResult,
    queryLoading,
    setQueryLoading,
    setColumnViewContext,
    theme,
    connections,
  } = useStore()

  const editorRef = useRef<any>(null)
  const completionDisposableRef = useRef<any>(null)
  const monaco = useMonaco()

  const runQuery = async () => {
    const query = editorRef.current?.getValue()?.trim() || activeQuery.trim()
    if (!query || !activeConnectionId || queryLoading) return

    setColumnViewContext(null)
    setQueryLoading(true)
    setQueryResult(null)
    try {
      const result = await apiExecuteQuery(userId, activeConnectionId, query, activeDatabase || undefined)
      setQueryResult(result)
    } catch (err: any) {
      setQueryResult({
        rows: [],
        columns: ['Error'],
        row_count: 0,
        error: err?.response?.data?.detail || String(err),
      } as any)
    } finally {
      setQueryLoading(false)
    }
  }

  useImperativeHandle(ref, () => ({ run: runQuery }))

  useEffect(() => {
    if (!monaco || !activeConnectionId) return

    const conn = connections.find(c => c.id === activeConnectionId)
    if (!conn) return

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
    }
  }

  return (
    <div className="h-full flex flex-col bg-surface-200">
      <div className="flex-1" onKeyDown={handleKeyDown}>
        <Editor
          height="100%"
          defaultLanguage="sql"
          theme={theme === 'dark' ? 'vs-dark' : 'light'}
          value={activeQuery}
          onChange={(val) => setActiveQuery(val || '')}
          onMount={(editor) => { editorRef.current = editor }}
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
