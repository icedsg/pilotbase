import { Settings, GitMerge, Download, Wifi, WifiOff, Sun, Moon, PanelLeft, PanelRight } from 'lucide-react'
import Logo from '../common/Logo'
import { useStore } from '../../store'

interface Props {
  leftOpen: boolean
  rightOpen: boolean
  onToggleLeft: () => void
  onToggleRight: () => void
}

export default function TopBar({ leftOpen, rightOpen, onToggleLeft, onToggleRight }: Props) {
  const { session, wsConnected, theme, toggleTheme } = useStore()

  return (
    <header className="h-11 flex items-center justify-between px-2 bg-surface-300 border-b border-surface-50 flex-shrink-0">
      <div className="flex items-center gap-4">
        <button
          onClick={onToggleLeft}
          className={`btn-ghost p-1.5 rounded ${leftOpen ? 'text-accent' : ''}`}
          title={leftOpen ? 'Close connections panel' : 'Open connections panel'}
        >
          <PanelLeft size={15} />
        </button>

        <Logo size="sm" />

        <nav className="hidden md:flex items-center gap-1">
          <button className="btn-ghost flex items-center gap-1.5">
            <GitMerge size={14} />
            <span>Migration</span>
          </button>
          <button className="btn-ghost flex items-center gap-1.5">
            <Download size={14} />
            <span>Backups</span>
          </button>
        </nav>
      </div>

      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5 text-xs text-gray-500">
          {wsConnected ? (
            <Wifi size={13} className="text-green-500" />
          ) : (
            <WifiOff size={13} className="text-red-500" />
          )}
          <span className="hidden sm:inline">{wsConnected ? 'Live' : 'Offline'}</span>
        </span>

        {session && (
          <span className="text-xs text-gray-500 hidden sm:inline">
            {session.email || session.userId?.slice(0, 8) || 'user'}
            <span className="ml-1 text-accent">({session.role})</span>
          </span>
        )}

        <button onClick={toggleTheme} className="btn-ghost p-1.5 rounded" title="Toggle theme">
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>

        <button className="btn-ghost p-1.5 rounded" title="Settings">
          <Settings size={15} />
        </button>

        <button
          onClick={onToggleRight}
          className={`btn-ghost p-1.5 rounded ${rightOpen ? 'text-accent' : ''}`}
          title={rightOpen ? 'Close AI agent panel' : 'Open AI agent panel'}
        >
          <PanelRight size={15} />
        </button>
      </div>
    </header>
  )
}
