import { useEffect, useMemo, useState } from 'react'
import { Search, X, Loader2, AlertCircle, Check } from 'lucide-react'
import { apiGetLlmModels, type LlmModelInfo } from '../../api/client'
import { useUserSession } from '../../hooks/useUserSession'

interface Props {
  provider: string
  baseUrl: string
  apiKey?: string
  currentValue: string
  onSelect: (modelId: string) => void
  onClose: () => void
}

export default function ModelPickerModal({ provider, baseUrl, apiKey, currentValue, onSelect, onClose }: Props) {
  const { userId } = useUserSession()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [models, setModels] = useState<LlmModelInfo[]>([])
  const [hasDescription, setHasDescription] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setLoading(true)
    setError(null)
    apiGetLlmModels(userId, provider, baseUrl, apiKey)
      .then(r => {
        setModels(r.models)
        setHasDescription(r.has_description)
      })
      .catch(e => setError(e?.response?.data?.detail || `Could not reach ${provider}.`))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, baseUrl, apiKey])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return models
    return models.filter(m =>
      m.id.toLowerCase().includes(q) ||
      m.name.toLowerCase().includes(q) ||
      (m.description || '').toLowerCase().includes(q)
    )
  }, [models, query])

  return (
    <div className="fixed inset-0 z-[10010] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className={`bg-surface-100 border border-surface-50 rounded-xl shadow-2xl w-full flex flex-col ${
          hasDescription ? 'max-w-2xl max-h-[75vh]' : 'max-w-sm max-h-[65vh]'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-50 flex-shrink-0">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            Select a model · {provider === 'ollama' ? 'Ollama' : 'OpenRouter'}
          </h2>
          <button onClick={onClose} className="btn-ghost p-1"><X size={20} /></button>
        </div>

        <div className="px-5 pt-3 pb-2 flex-shrink-0">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              autoFocus
              className="w-full bg-surface-300 border border-surface-50 rounded px-2.5 py-1.5 pl-8 text-xs text-gray-800 dark:text-gray-200 focus:outline-none focus:border-accent"
              placeholder="Search models…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {loading ? (
            <div className="flex items-center justify-center gap-2 text-xs text-gray-500 py-10">
              <Loader2 size={16} className="animate-spin" /> Loading models…
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center gap-2 text-xs text-red-400 py-10 px-4 text-center">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-xs text-gray-500 text-center py-10 px-4">
              {models.length === 0
                ? provider === 'ollama'
                  ? 'No local models found. Pull one first, e.g. "ollama pull llama3".'
                  : 'No models found.'
                : 'No models match your search.'}
            </div>
          ) : (
            <ul className="space-y-0.5">
              {filtered.map((m) => {
                const selected = m.id === currentValue
                return (
                  <li key={m.id}>
                    <button
                      onClick={() => { onSelect(m.id); onClose() }}
                      className={`w-full text-left px-3 py-2 rounded flex items-start gap-2 hover:bg-surface-300 ${
                        selected ? 'bg-surface-300' : ''
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">{m.name}</span>
                          {m.name !== m.id && (
                            <span className="text-[11px] text-gray-500 font-mono truncate">{m.id}</span>
                          )}
                        </div>
                        {m.description && (
                          <p className="text-[13px] text-gray-500 mt-0.5 line-clamp-3">{m.description}</p>
                        )}
                      </div>
                      {selected && <Check size={14} className="text-accent flex-shrink-0 mt-0.5" />}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
