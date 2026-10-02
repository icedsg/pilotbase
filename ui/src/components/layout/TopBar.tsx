import { useEffect, useState } from 'react'
import Logo from '../common/Logo'
import { useStore } from '../../store'
import { useUserSession } from '../../hooks/useUserSession'
import { apiHealth, apiGetLlmStatus, HealthInfo } from '../../api/client'

type Status = 'checking' | 'up' | 'down'

const POLL_MS = 30_000

export default function TopBar() {
  const { activeConnectionId, focusConnectionQueryTab, setSettingsModalOpen } = useStore()
  const { userId } = useUserSession()
  const [apiStatus, setApiStatus] = useState<Status>('checking')
  const [aiStatus, setAiStatus] = useState<Status>('checking')
  const [mcp, setMcp] = useState<HealthInfo['mcp'] | null>(null)
  const [isDesktop, setIsDesktop] = useState(false)

  const resetToNormalView = () => {
    if (activeConnectionId) focusConnectionQueryTab(activeConnectionId)
  }

  // A health ping for the API, and for the AI agent, a real reachability check
  // (GET .../models on the configured provider) — not just "is it configured",
  // so "available"/"unavailable" reflects whether it would actually work right
  // now. It never invokes the model itself, so polling doesn't spend tokens.
  useEffect(() => {
    let cancelled = false

    const check = async () => {
      try {
        const h = await apiHealth()
        if (!cancelled) {
          setApiStatus('up')
          setIsDesktop(!!h.desktop)
          setMcp(h.mcp ?? null)
        }
      } catch {
        if (!cancelled) {
          setApiStatus('down')
          setMcp(null)
        }
      }

      if (!userId) return
      try {
        const r = await apiGetLlmStatus(userId)
        if (!cancelled) setAiStatus(r.available ? 'up' : 'down')
      } catch {
        if (!cancelled) setAiStatus('down')
      }
    }

    check()
    const timer = setInterval(check, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [userId])

  return (
    <header className="h-11 flex items-center justify-between px-3 bg-surface-300 border-b border-surface-50 flex-shrink-0">
      <Logo size="sm" onClick={resetToNormalView} />
      <div className="flex items-center gap-3">
        <span className="text-xs text-gray-500">Local services</span>
        <StatusPill label="API" status={apiStatus} upText="running" downText="down" />
        <StatusPill
          label="AI Agent"
          status={aiStatus}
          upText="available"
          downText="unavailable"
          onConfigure={aiStatus === 'down' ? () => setSettingsModalOpen(true) : undefined}
        />
        {/* MCP server (/mcp) — only on desktop, where Claude Desktop / Cowork
            connect through the stdio bridge (Help → Copy Claude MCP config). */}
        {isDesktop && mcp && (
          <StatusPill
            label="MCP"
            status={mcp.enabled ? 'up' : 'down'}
            upText={mcp.allow_writes ? 'read-write' : 'read-only'}
            downText="off"
            title={
              mcp.enabled
                ? `MCP: ${mcp.tools ?? 0} tools, ${mcp.allow_writes ? 'writes enabled' : 'read-only'}. Connect Claude via Help → Copy Claude MCP config.`
                : 'MCP: disabled (MCP_ENABLED=false)'
            }
          />
        )}
      </div>
    </header>
  )
}

function StatusPill({
  label, status, upText, downText, onConfigure, title,
}: {
  label: string
  status: Status
  upText: string
  downText: string
  onConfigure?: () => void
  title?: string
}) {
  const dot = status === 'up' ? 'bg-green-400' : status === 'down' ? 'bg-red-400' : 'bg-gray-500 animate-pulse'
  const text = status === 'checking' ? 'checking…' : status === 'up' ? upText : downText
  const textColor = status === 'up' ? 'text-green-400' : status === 'down' ? 'text-red-400' : 'text-gray-500'

  return (
    <span className="flex items-center gap-1.5 text-xs" title={title ?? `${label}: ${text}`}>
      <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${dot}`} />
      <span className="text-gray-400">{label}:</span>
      {onConfigure ? (
        <button onClick={onConfigure} className={`${textColor} hover:underline cursor-pointer`}>
          Configure
        </button>
      ) : (
        <span className={textColor}>{text}</span>
      )}
    </span>
  )
}
