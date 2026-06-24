import { useRef } from 'react'
import Editor from '@monaco-editor/react'
import { Play, Loader2, Copy } from 'lucide-react'
import { useStore } from '../../store'
import { useUserSession } from '../../hooks/useUserSession'
import { apiExecuteQuery } from '../../api/client'

export default function QueryEditor() {
  const { userId } = useUserSession()
  const {
    activeConnectionId,
    activeQuery,
    setActiveQuery,
    setQueryResult,
    queryLoading,
    setQueryLoading,
    theme,
  } = useStore()

  const editorRef = useRef<any>(null)

  const runQuery = async () => {
    const query = editorRef.current?.getValue()?.trim() || activeQuery.trim()
    if (!query || !activeConnectionId || queryLoading) return

    setQueryLoading(true)
    setQueryResult(null)
    try {
      const result = await apiExecuteQuery(userId, activeConnectionId, query)
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      runQuery()
    }
  }

  return (
    <div className="h-full flex flex-col bg-surface-200">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-300 border-b border-surface-50 flex-shrink-0">
        <button
          onClick={runQuery}
          disabled={!activeConnectionId || queryLoading}
          className="btn-primary flex items-center gap-1.5"
        >
          {queryLoading ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Play size={13} fill="currentColor" />
          )}
          <span>Run</span>
          <span className="text-[10px] opacity-60 ml-0.5">Ctrl+↵</span>
        </button>

        <button
          onClick={() => navigator.clipboard.writeText(activeQuery)}
          className="btn-ghost flex items-center gap-1"
          title="Copy query"
        >
          <Copy size={12} />
        </button>
      </div>

      {/* Monaco Editor */}
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
          }}
        />
      </div>
    </div>
  )
}
