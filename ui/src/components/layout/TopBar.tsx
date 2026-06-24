import { Settings, Database, GitMerge, Download, Wifi, WifiOff, Sun, Moon } from 'lucide-react'
import Logo from '../common/Logo'
import { useStore } from '../../store'

export default function TopBar() {
  const { session, wsConnected, activeConnectionId, theme, toggleTheme } = useStore()

  return (
    <header className="h-11 flex items-center justify-between px-4 bg-surface-300 border-b border-surface-50 flex-shrink-0">
      {/* Left: Logo */}
      <div className="flex items-center gap-6">
        <Logo size="sm" />

        {/* Navigation tools */}
        <nav className="hidden md:flex items-center gap-1">
          <button className="btn-ghost flex items-center gap-1.5">
            <Database size={14} />
            <span>Connections</span>
          </button>
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

      {/* Right: status + user */}
      <div className="flex items-center gap-3">
        {/* WebSocket status */}
        <span className="flex items-center gap-1.5 text-xs text-gray-500">
          {wsConnected ? (
            <Wifi size={13} className="text-green-500" />
          ) : (
            <WifiOff size={13} className="text-red-500" />
          )}
          <span className="hidden sm:inline">{wsConnected ? 'Live' : 'Offline'}</span>
        </span>

        {/* User badge */}
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
      </div>
    </header>
  )
}
