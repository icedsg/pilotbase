import { useEffect, useState } from 'react'
import { X, Webhook, Loader2, Copy, Check } from 'lucide-react'
import { apiPapiStatus, apiPapiEnable, apiPapiDisable } from '../../api/client'
import { useUserSession } from '../../hooks/useUserSession'
import { useStore } from '../../store'

const BASE = import.meta.env.VITE_API_URL || ''

interface Props {
  connId: string
  onClose: () => void
}

export default function ApiConfigModal({ connId, onClose }: Props) {
  const { userId } = useUserSession()
  const { connections } = useStore()
  const conn = connections.find((c) => c.id === connId)
  const [enabled, setEnabled] = useState(false)
  const [enabledAt, setEnabledAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const baseUrl = `${BASE}/api/v1/papi/${connId}`

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => {
    apiPapiStatus(userId, connId)
      .then((s) => { setEnabled(s.enabled); setEnabledAt(s.enabled_at) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [connId, userId])

  const toggle = async () => {
    setToggling(true)
    setError('')
    try {
      const s = enabled ? await apiPapiDisable(userId, connId) : await apiPapiEnable(userId, connId)
      setEnabled(s.enabled)
      setEnabledAt(s.enabled_at)
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to update API status.')
    } finally {
      setToggling(false)
    }
  }

  const copyBaseUrl = () => {
    navigator.clipboard.writeText(baseUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-100 border border-surface-50 rounded-xl shadow-2xl w-full max-w-lg flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-50">
          <div className="flex items-center gap-2">
            <Webhook size={18} className="text-gray-500" />
            <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Generated API</h2>
            {conn && <span className="text-xs text-gray-500">— {conn.name}</span>}
          </div>
          <button onClick={onClose} className="btn-ghost p-1"><X size={20} /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-gray-500 py-6 justify-center">
              <Loader2 size={16} className="animate-spin" /> Loading…
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-gray-800 dark:text-gray-200 font-medium">
                    {enabled ? 'Enabled' : 'Disabled'}
                  </div>
                  {enabled && enabledAt && (
                    <div className="text-[13px] text-gray-500">since {new Date(enabledAt).toLocaleString()}</div>
                  )}
                  {!enabled && (
                    <div className="text-[13px] text-gray-500">Adds guid / created_at / last_updated / is_deleted to every table.</div>
                  )}
                </div>
                <button
                  onClick={toggle}
                  disabled={toggling}
                  className={`px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50 ${
                    enabled ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20' : 'bg-accent hover:bg-accent-hover text-white'
                  }`}
                >
                  {toggling ? <Loader2 size={14} className="animate-spin" /> : enabled ? 'Disable' : 'Enable'}
                </button>
              </div>

              {error && <p className="text-xs text-red-400">{error}</p>}

              {enabled && (
                <div className="space-y-2 pt-2 border-t border-surface-50">
                  <label className="block text-xs text-gray-500">Base URL</label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs font-mono bg-surface-300 border border-surface-50 rounded px-2 py-1.5 truncate">{baseUrl}</code>
                    <button onClick={copyBaseUrl} className="btn-ghost p-1.5" title="Copy">
                      {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                    </button>
                  </div>
                  <p className="text-[13px] text-gray-500 leading-relaxed">
                    Call <code className="font-mono">POST {'{base}'}/apitokens</code> to mint a session token, then send it
                    as <code className="font-mono">Authorization: Bearer &lt;token&gt;</code> on every other call
                    (<code className="font-mono">GET/POST/PUT/DELETE {'{base}'}/{'{table}'}</code>). No FK or data
                    validation is performed — bring your own on the client.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
