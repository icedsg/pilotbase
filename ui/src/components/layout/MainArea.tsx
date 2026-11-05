import { useRef, useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { Activity, Play, Loader2, Copy, WandSparkles, Save } from 'lucide-react'
import QueryEditor, { type QueryEditorHandle } from '../db/QueryEditor'
import ResultsTable from '../db/ResultsTable'
import VectorChunksView from '../db/VectorChunksView'
import NoSQLDocumentView from '../db/NoSQLDocumentView'
import NoSQLQueryResultsView from '../db/NoSQLQueryResultsView'
import MigrationFlow from '../migration/MigrationFlow'
import HealthView from '../health/HealthView'
import { hasHealthView } from '../../lib/health/view'
import MainTabBar from './MainTabBar'
import { useStore } from '../../store'
import { LogoIcon } from '../common/Logo'
import { isNoSqlJsonDbType } from '../../utils/dbTypes'
import { apiCreateSavedQuery } from '../../api/client'
import { useUserSession } from '../../hooks/useUserSession'

export default function MainArea() {
  const {
    activeConnectionId, connections, mainTabs, activeMainTabId, focusConnectionQueryTab, openHealthTab,
  } = useStore()
  const activeConn = connections.find((c) => c.id === activeConnectionId)
  const activeTab = mainTabs.find((t) => t.id === activeMainTabId)
  const queryEditorRef = useRef<QueryEditorHandle>(null)
  const { userId } = useUserSession()
  const [saveName, setSaveName] = useState('')
  const [saving, setSaving] = useState(false)
  const isNoSqlJsonConn = isNoSqlJsonDbType(activeConn?.db_type)

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
          <button
            onClick={() => focusConnectionQueryTab(activeConnectionId)}
            className="flex-shrink-0"
          >
            <LogoIcon size={16} />
          </button>
          <span className="text-gray-700 dark:text-gray-300 font-medium truncate">{activeConn?.name}</span>
          <span className="text-gray-500 flex-shrink-0">·</span>
          <span className="text-gray-500 flex-shrink-0">{activeConn?.db_type}</span>
          {hasHealthView(activeConn?.db_type) && (
            <button
              onClick={() => openHealthTab(activeConnectionId)}
              className={`btn-ghost flex items-center gap-1 text-xs ml-2 flex-shrink-0 ${activeTab?.kind === 'health' ? 'text-accent' : ''}`}
              title="Slow statements, locks and migration checks"
              aria-label="Health"
            >
              <Activity size={13} className="flex-shrink-0" />
              {!(activeTab?.kind === 'query' && activeTab.sqlPanelOpen) && 'Health'}
            </button>
          )}
        </div>

        {/* Right: SQL controls only when the active tab is a query tab with the panel open */}
        {activeTab?.kind === 'query' && activeTab.sqlPanelOpen && (
          <div className="flex items-center gap-2 flex-shrink-0 ml-4">
            <button
              onClick={() => queryEditorRef.current?.run()}
              disabled={activeTab.loading}
              className="flex items-center gap-1 bg-accent hover:bg-accent-hover text-white px-2 py-0.5 rounded text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {activeTab.loading
                ? <Loader2 size={12} className="animate-spin" />
                : <Play size={12} fill="currentColor" />
              }
              <span>Run</span>
              <span className="text-[10px] opacity-60 ml-0.5">Ctrl+↵</span>
            </button>

            {!isNoSqlJsonConn && (
              <button onClick={() => queryEditorRef.current?.format()} className="btn-ghost flex items-center gap-1 text-xs" title="Format SQL (Shift+Alt+F)">
                <WandSparkles size={14} /> Format
              </button>
            )}

            <form className="flex items-center gap-1" onSubmit={async (e) => {
              e.preventDefault()
              const name = saveName.trim()
              if (!name || !activeTab.query.trim() || saving) return
              setSaving(true)
              try {
                await apiCreateSavedQuery(userId, activeTab.connectionId, name, activeTab.query)
                setSaveName('')
                window.dispatchEvent(new CustomEvent('pilotbase:saved-query-changed'))
              } finally { setSaving(false) }
            }}>
              <input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="Query name" maxLength={120}
                className="w-28 bg-surface-200 border border-surface-50 rounded px-1.5 py-0.5 text-xs outline-none focus:border-accent" />
              <button type="submit" disabled={!saveName.trim() || !activeTab.query.trim() || saving} className="btn-ghost p-1 disabled:opacity-40" title="Save query">
                <Save size={14} />
              </button>
            </form>

            <button
              onClick={() => navigator.clipboard.writeText(activeTab.query)}
              className="btn-ghost p-1"
              title="Copy query"
            >
              <Copy size={14} />
            </button>

            {activeTab.database && (
              <span className="text-[15px] text-gray-500 dark:text-gray-400">
                db: <span className="text-gray-700 dark:text-gray-200 font-medium">{activeTab.database}</span>
              </span>
            )}
          </div>
        )}
      </div>

      <MainTabBar />

      {/* Main content */}
      {!activeTab ? (
        <div className="flex-1 min-h-0 flex items-center justify-center text-gray-600 text-xs">
          Select a database or table from the panel to get started
        </div>
      ) : activeTab.kind === 'vector' ? (
        <div className="flex-1 min-h-0"><VectorChunksView tab={activeTab} /></div>
      ) : activeTab.kind === 'nosql' ? (
        <div className="flex-1 min-h-0"><NoSQLDocumentView tab={activeTab} /></div>
      ) : activeTab.kind === 'migration' ? (
        <div className="flex-1 min-h-0"><MigrationFlow tab={activeTab} /></div>
      ) : activeTab.kind === 'health' ? (
        <div className="flex-1 min-h-0"><HealthView key={activeTab.id} tab={activeTab} /></div>
      ) : activeTab.sqlPanelOpen ? (
        <PanelGroup direction="vertical" className="flex-1">
          <Panel defaultSize={40} minSize={20}>
            <QueryEditor ref={queryEditorRef} tab={activeTab} />
          </Panel>
          <PanelResizeHandle className="h-1 bg-surface-50 hover:bg-accent transition-colors cursor-row-resize" />
          <Panel defaultSize={60} minSize={20}>
            {isNoSqlJsonConn ? <NoSQLQueryResultsView tab={activeTab} /> : <ResultsTable tab={activeTab} />}
          </Panel>
        </PanelGroup>
      ) : (
        <div className="flex-1 min-h-0">
          {isNoSqlJsonConn ? <NoSQLQueryResultsView tab={activeTab} /> : <ResultsTable tab={activeTab} />}
        </div>
      )}
    </div>
  )
}
