import { useState } from 'react'
import { Database, Box, FileText, GitMerge, X, Check } from 'lucide-react'
import { useStore, type MainTab } from '../../store'
import CloseTabConfirm from '../common/CloseTabConfirm'

const SKIP_CLOSE_TAB_CONFIRM_KEY = 'pilotbase_skip_close_tab_confirm'

function tabLabel(tab: MainTab, connections: { id: string; name: string }[]): string {
  if (tab.kind === 'query') {
    const conn = connections.find((c) => c.id === tab.connectionId)
    return conn ? (tab.database ? `${conn.name} · ${tab.database}` : conn.name) : 'Query'
  }
  if (tab.kind === 'vector' || tab.kind === 'nosql') return tab.context.collection
  const source = connections.find((c) => c.id === tab.sourceConnId)?.name ?? tab.sourceConnId
  const target = connections.find((c) => c.id === tab.targetConnId)?.name ?? tab.targetConnId
  return `${source} → ${target}`
}

function tabHasContent(tab: MainTab): boolean {
  if (tab.kind === 'query') return tab.query.trim() !== '' || tab.result !== null
  return true
}

function TabIcon({ kind }: { kind: MainTab['kind'] }) {
  if (kind === 'query') return <Database size={12} className="flex-shrink-0" />
  if (kind === 'vector') return <Box size={12} className="flex-shrink-0" />
  if (kind === 'nosql') return <FileText size={12} className="flex-shrink-0" />
  return <GitMerge size={12} className="flex-shrink-0" />
}

function MigrationDot({ tab }: { tab: MainTab }) {
  if (tab.kind !== 'migration') return null
  const active = tab.checking || tab.job?.status === 'running'
  const done = tab.job?.status === 'done'
  const error = tab.job?.status === 'error'
  if (!active && !done && !error) return null
  return (
    <span className="relative flex h-2 w-2 flex-shrink-0">
      {active && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />}
      <span
        className={`relative inline-flex rounded-full h-2 w-2 ${
          error ? 'bg-red-500' : 'bg-green-500'
        }`}
      />
    </span>
  )
}

export default function MainTabBar() {
  const { mainTabs, activeMainTabId, connections, setActiveMainTab, setActiveConnection, closeMainTab } = useStore()
  const [pendingClose, setPendingClose] = useState<{ tabId: string; label: string } | null>(null)

  if (mainTabs.length === 0) return null

  const focusTab = (tab: MainTab) => {
    setActiveMainTab(tab.id)
    if (tab.kind === 'query' || tab.kind === 'vector' || tab.kind === 'nosql') {
      const connId = tab.kind === 'query' ? tab.connectionId : tab.context.connId
      setActiveConnection(connId)
    }
  }

  const requestClose = (tab: MainTab, e: React.MouseEvent) => {
    e.stopPropagation()
    const skip = localStorage.getItem(SKIP_CLOSE_TAB_CONFIRM_KEY) === 'true'
    if (skip || !tabHasContent(tab)) {
      closeMainTab(tab.id)
      return
    }
    setPendingClose({ tabId: tab.id, label: tabLabel(tab, connections) })
  }

  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-surface-50 flex-shrink-0 overflow-x-auto bg-surface-300">
      {mainTabs.map((tab) => (
        <div
          key={tab.id}
          onClick={() => focusTab(tab)}
          className={`group flex items-center gap-1.5 pl-2 pr-1 py-1 rounded text-xs max-w-[200px] flex-shrink-0 cursor-pointer ${
            tab.id === activeMainTabId ? 'bg-accent/20 text-accent' : 'text-gray-600 dark:text-gray-400 hover:bg-surface-200'
          }`}
        >
          <TabIcon kind={tab.kind} />
          <span className="truncate font-mono">{tabLabel(tab, connections)}</span>
          {tab.kind === 'migration' && tab.job?.status === 'done' && <Check size={12} className="text-green-500 flex-shrink-0" />}
          <MigrationDot tab={tab} />
          <button
            onClick={(e) => requestClose(tab, e)}
            className="opacity-0 group-hover:opacity-100 flex-shrink-0 hover:text-red-500"
            title="Close tab"
          >
            <X size={12} />
          </button>
        </div>
      ))}

      {pendingClose && (
        <CloseTabConfirm
          tabLabel={pendingClose.label}
          onCancel={() => setPendingClose(null)}
          onConfirm={() => {
            closeMainTab(pendingClose.tabId)
            setPendingClose(null)
          }}
          onConfirmDontAskAgain={() => {
            localStorage.setItem(SKIP_CLOSE_TAB_CONFIRM_KEY, 'true')
            closeMainTab(pendingClose.tabId)
            setPendingClose(null)
          }}
        />
      )}
    </div>
  )
}
