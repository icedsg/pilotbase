import { useState } from 'react'
import { Terminal, GitMerge, Download, Database, Bot, History, Sun, Moon, ScrollText } from 'lucide-react'
import { useStore } from '../../store'
import BackupModal from '../backup/BackupModal'
import QueryHistoryPanel from '../db/QueryHistoryPanel'
import MigrationTargetPicker from '../migration/MigrationTargetPicker'

interface Props {
  leftOpen: boolean
  rightOpen: boolean
  onToggleLeft: () => void
  onToggleRight: () => void
}

export default function ActivityBar({ leftOpen, rightOpen, onToggleLeft, onToggleRight }: Props) {
  const {
    theme, toggleTheme, activeConnectionId, activeDatabase,
    sqlPanelOpen, setSqlPanelOpen, sqlLogPanelOpen, setSqlLogPanelOpen,
  } = useStore()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [backupOpen, setBackupOpen] = useState(false)
  const [migrationOpen, setMigrationOpen] = useState(false)

  const canMigrate = !!(activeConnectionId && activeDatabase)

  return (
    <div className="w-11 flex flex-col items-center py-2 gap-1 bg-surface-300 border-r border-surface-50 flex-shrink-0">
      <button
        onClick={() => setSqlPanelOpen(!sqlPanelOpen)}
        className={`btn-ghost p-2 rounded ${sqlPanelOpen ? 'text-accent' : ''}`}
        title="Execute SQL Query"
      >
        <Terminal size={20} />
      </button>

      <button
        onClick={() => setMigrationOpen(true)}
        disabled={!canMigrate}
        className="btn-ghost p-2 rounded disabled:opacity-40 disabled:cursor-not-allowed"
        title={canMigrate ? 'Plan Migration' : 'Select a connection and database first'}
      >
        <GitMerge size={20} />
      </button>

      <button
        onClick={() => setBackupOpen(true)}
        disabled={!activeConnectionId}
        className="btn-ghost p-2 rounded disabled:opacity-40 disabled:cursor-not-allowed"
        title={activeConnectionId ? 'Run or download backups for the active connection' : 'Select a connection first'}
      >
        <Download size={20} />
      </button>

      <button
        onClick={() => setSqlLogPanelOpen(!sqlLogPanelOpen)}
        className={`btn-ghost p-2 rounded ${sqlLogPanelOpen ? 'text-accent' : ''}`}
        title="Executed SQL Scripts"
      >
        <ScrollText size={20} />
      </button>

      <div className="flex-1" />

      <button
        onClick={onToggleLeft}
        className={`btn-ghost p-2 rounded ${leftOpen ? 'text-accent' : ''}`}
        title={leftOpen ? 'Close connections panel' : 'Open connections panel'}
      >
        <Database size={20} />
      </button>

      <button
        onClick={onToggleRight}
        className={`btn-ghost p-2 rounded ${rightOpen ? 'text-accent' : ''}`}
        title={rightOpen ? 'Close AI agent panel' : 'Open AI agent panel'}
      >
        <Bot size={20} />
      </button>

      <button
        onClick={() => setHistoryOpen(true)}
        className="btn-ghost p-2 rounded"
        title="Query history — all scripts executed on the server"
      >
        <History size={20} />
      </button>

      <button onClick={toggleTheme} className="btn-ghost p-2 rounded" title="Toggle theme">
        {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
      </button>

      {historyOpen && <QueryHistoryPanel onClose={() => setHistoryOpen(false)} />}
      {backupOpen && activeConnectionId && (
        <BackupModal connId={activeConnectionId} onClose={() => setBackupOpen(false)} />
      )}
      {migrationOpen && activeConnectionId && activeDatabase && (
        <MigrationTargetPicker
          sourceConnId={activeConnectionId}
          sourceDb={activeDatabase}
          onClose={() => setMigrationOpen(false)}
        />
      )}
    </div>
  )
}
