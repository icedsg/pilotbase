import { useState } from 'react'
import { GitMerge, Download, History, Sun, Moon, PanelLeft, PanelRight } from 'lucide-react'
import Logo from '../common/Logo'
import { useStore } from '../../store'
import QueryHistoryPanel from '../db/QueryHistoryPanel'

interface Props {
  leftOpen: boolean
  rightOpen: boolean
  onToggleLeft: () => void
  onToggleRight: () => void
}

export default function TopBar({ leftOpen, rightOpen, onToggleLeft, onToggleRight }: Props) {
  const { theme, toggleTheme } = useStore()
  const [historyOpen, setHistoryOpen] = useState(false)

  return (
    <header className="h-11 flex items-center justify-between px-2 bg-surface-300 border-b border-surface-50 flex-shrink-0">
      <div className="flex items-center gap-4">
        <button
          onClick={onToggleLeft}
          className={`btn-ghost p-1.5 rounded ${leftOpen ? 'text-accent' : ''}`}
          title={leftOpen ? 'Close connections panel' : 'Open connections panel'}
        >
          <PanelLeft size={20} />
        </button>

        <Logo size="sm" />

        <nav className="hidden md:flex items-center gap-1">
          <button className="btn-ghost flex items-center gap-1.5">
            <GitMerge size={18} />
            <span>Migration</span>
          </button>
          <button className="btn-ghost flex items-center gap-1.5">
            <Download size={18} />
            <span>Backups</span>
          </button>
        </nav>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => setHistoryOpen(true)}
          className="btn-ghost p-1.5 rounded"
          title="Query history — all scripts executed on the server"
        >
          <History size={20} />
        </button>

        <button onClick={toggleTheme} className="btn-ghost p-1.5 rounded" title="Toggle theme">
          {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
        </button>

        <button
          onClick={onToggleRight}
          className={`btn-ghost p-1.5 rounded ${rightOpen ? 'text-accent' : ''}`}
          title={rightOpen ? 'Close AI agent panel' : 'Open AI agent panel'}
        >
          <PanelRight size={20} />
        </button>
      </div>

      {historyOpen && <QueryHistoryPanel onClose={() => setHistoryOpen(false)} />}
    </header>
  )
}
