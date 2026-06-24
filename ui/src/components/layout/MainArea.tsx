import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import QueryEditor from '../db/QueryEditor'
import ResultsTable from '../db/ResultsTable'
import { useStore } from '../../store'
import { Database } from 'lucide-react'

export default function MainArea() {
  const { activeConnectionId, connections } = useStore()
  const activeConn = connections.find((c) => c.id === activeConnectionId)

  if (!activeConnectionId) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 text-gray-600">
        <Database size={48} strokeWidth={1} />
        <div className="text-center">
          <p className="text-sm font-medium text-gray-400">No connection selected</p>
          <p className="text-xs mt-1">Choose a connection from the panel to start querying</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Connection breadcrumb */}
      <div className="flex items-center gap-2 px-3 py-2 bg-surface-300 border-b border-surface-50 text-xs text-gray-400 flex-shrink-0">
        <Database size={12} className="text-accent" />
        <span className="text-gray-700 dark:text-gray-300 font-medium">{activeConn?.name}</span>
        <span className="text-gray-600">·</span>
        <span>{activeConn?.db_type}</span>
        {activeConn?.database && (
          <>
            <span className="text-gray-600">·</span>
            <span>{activeConn.database}</span>
          </>
        )}
      </div>

      {/* Editor + Results */}
      <PanelGroup direction="vertical" className="flex-1">
        <Panel defaultSize={40} minSize={20}>
          <QueryEditor />
        </Panel>
        <PanelResizeHandle className="h-1 bg-surface-50 hover:bg-accent transition-colors cursor-row-resize" />
        <Panel defaultSize={60} minSize={20}>
          <ResultsTable />
        </Panel>
      </PanelGroup>
    </div>
  )
}
