import { useRef } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { Play, Loader2, Copy, Box } from 'lucide-react'
import QueryEditor, { type QueryEditorHandle } from '../db/QueryEditor'
import ResultsTable from '../db/ResultsTable'
import VectorChunksView from '../db/VectorChunksView'
import NoSQLDocumentView from '../db/NoSQLDocumentView'
import { useStore } from '../../store'
import { LogoIcon } from '../common/Logo'
import DbTypeIcon from '../db/DbTypeIcon'

export default function MainArea() {
  const {
    activeConnectionId, connections, activeDatabase, activeQuery, queryLoading,
    vectorViewContext, nosqlViewContext,
  } = useStore()
  const activeConn = connections.find((c) => c.id === activeConnectionId)
  const queryEditorRef = useRef<QueryEditorHandle>(null)

  const isSpecialView = !!(vectorViewContext || nosqlViewContext)
  const specialLabel = vectorViewContext?.collection ?? nosqlViewContext?.collection

  if (!activeConnectionId) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 text-gray-600">
        <LogoIcon size={62} />
        <div className="text-center">
          <p className="text-sm font-medium text-gray-400">No connection selected</p>
          <p className="text-xs mt-1">Choose a connection from the panel to start querying</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-surface-300 border-b border-surface-50 flex-shrink-0">
        {/* Left: connection identity */}
        <div className="flex items-center gap-2 text-xs text-gray-400 min-w-0">
          <LogoIcon size={16} className="flex-shrink-0" />
          <span className="text-gray-700 dark:text-gray-300 font-medium truncate">{activeConn?.name}</span>
          <span className="text-gray-500">·</span>
          <span className="text-gray-500">{activeConn?.db_type}</span>
          {isSpecialView && specialLabel && (
            <>
              <span className="text-gray-600">/</span>
              <div className="flex items-center gap-1 text-gray-300">
                <Box size={12} className="text-violet-400 flex-shrink-0" />
                <span className="font-mono font-medium truncate">{specialLabel}</span>
              </div>
            </>
          )}
        </div>

        {/* Right: SQL controls only when not in special view */}
        {!isSpecialView && (
          <div className="flex items-center gap-2 flex-shrink-0 ml-4">
            <button
              onClick={() => queryEditorRef.current?.run()}
              disabled={!activeConnectionId || queryLoading}
              className="flex items-center gap-1 bg-accent hover:bg-accent-hover text-white px-2 py-0.5 rounded text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {queryLoading
                ? <Loader2 size={12} className="animate-spin" />
                : <Play size={12} fill="currentColor" />
              }
              <span>Run</span>
              <span className="text-[10px] opacity-60 ml-0.5">Ctrl+↵</span>
            </button>

            <button
              onClick={() => navigator.clipboard.writeText(activeQuery)}
              className="btn-ghost p-1"
              title="Copy query"
            >
              <Copy size={14} />
            </button>

            {activeDatabase && (
              <span className="text-[15px] text-gray-500 dark:text-gray-400">
                db: <span className="text-gray-700 dark:text-gray-200 font-medium">{activeDatabase}</span>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Main content */}
      {isSpecialView ? (
        <div className="flex-1 min-h-0">
          {vectorViewContext ? <VectorChunksView /> : <NoSQLDocumentView />}
        </div>
      ) : (
        <PanelGroup direction="vertical" className="flex-1">
          <Panel defaultSize={40} minSize={20}>
            <QueryEditor ref={queryEditorRef} />
          </Panel>
          <PanelResizeHandle className="h-1 bg-surface-50 hover:bg-accent transition-colors cursor-row-resize" />
          <Panel defaultSize={60} minSize={20}>
            <ResultsTable />
          </Panel>
        </PanelGroup>
      )}
    </div>
  )
}
