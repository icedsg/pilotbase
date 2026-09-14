import { useEffect, useState } from 'react'
import { Settings as SettingsIcon, X, Loader2, CheckCircle2, AlertCircle, FolderOpen, ListFilter } from 'lucide-react'
import { apiGetLlmSettings, apiPutLlmSettings, apiTestLlm, type LlmSettings } from '../../api/client'
import { useUserSession } from '../../hooks/useUserSession'
import { desktop, isDesktop } from '../../lib/desktop'
import ModelPickerModal from './ModelPickerModal'

interface Props {
  onClose: () => void
}

type Provider = 'ollama' | 'openrouter'

const PROVIDER_DEFAULTS: Record<Provider, { base_url: string }> = {
  ollama: { base_url: 'http://localhost:11434/v1' },
  openrouter: { base_url: 'https://openrouter.ai/api/v1' },
}

type TestStatus = { kind: 'testing' | 'ok' | 'error'; text: string } | null

const INPUT_CLS =
  'w-full bg-surface-300 border border-surface-50 rounded px-2.5 py-1.5 text-xs text-gray-800 dark:text-gray-200 focus:outline-none focus:border-accent'

export default function SettingsModal({ onClose }: Props) {
  const { userId } = useUserSession()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [hasApiKey, setHasApiKey] = useState(false)
  const [provider, setProvider] = useState<Provider>('ollama')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [flashModel, setFlashModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [testStatus, setTestStatus] = useState<TestStatus>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [pickerTarget, setPickerTarget] = useState<'model' | 'flash_model' | null>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => {
    apiGetLlmSettings(userId)
      .then((s: LlmSettings) => {
        setProvider(s.provider)
        setBaseUrl(s.base_url)
        setModel(s.model)
        setFlashModel(s.flash_model)
        setHasApiKey(s.has_api_key)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const switchProvider = (next: Provider) => {
    setProvider(next)
    setBaseUrl(PROVIDER_DEFAULTS[next].base_url)
    setApiKey('')
    setHasApiKey(false)
    setTestStatus(null)
  }

  const keyRequired = provider === 'openrouter' && !hasApiKey && !apiKey.trim()
  const canSave = !!model.trim() && !!baseUrl.trim() && !keyRequired

  const runTest = async () => {
    setTestStatus({ kind: 'testing', text: 'Testing…' })
    try {
      const r = await apiTestLlm(userId)
      if (r.ok) {
        setTestStatus({ kind: 'ok', text: `OK · ${r.model} · ${r.latency_ms} ms` })
      } else {
        setTestStatus({ kind: 'error', text: r.error || 'Test failed.' })
      }
    } catch (e: any) {
      setTestStatus({ kind: 'error', text: e?.response?.data?.detail || 'Test failed.' })
    }
  }

  const save = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      await apiPutLlmSettings(userId, {
        provider, base_url: baseUrl, model, flash_model: flashModel,
        api_key: apiKey.trim() || undefined,
      })
      onClose()
    } catch (e: any) {
      setSaveError(e?.response?.data?.detail || 'Failed to save settings.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-100 border border-surface-50 rounded-xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-50 flex-shrink-0">
          <div className="flex items-center gap-2">
            <SettingsIcon size={18} className="text-gray-500" />
            <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Settings</h2>
          </div>
          <button onClick={onClose} className="btn-ghost p-1"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 text-xs text-gray-500 py-10">
              <Loader2 size={16} className="animate-spin" /> Loading…
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <div className="text-xs font-medium text-gray-700 dark:text-gray-300">AI provider</div>
                <div className="flex gap-3 text-xs text-gray-700 dark:text-gray-300">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" checked={provider === 'ollama'} onChange={() => switchProvider('ollama')} />
                    Ollama (local)
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" checked={provider === 'openrouter'} onChange={() => switchProvider('openrouter')} />
                    OpenRouter
                  </label>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-700 dark:text-gray-300">Base URL</label>
                <input className={INPUT_CLS} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-700 dark:text-gray-300">Model</label>
                <div className="flex gap-1.5">
                  <input className={INPUT_CLS} value={model} onChange={(e) => setModel(e.target.value)} placeholder="required" />
                  <button
                    onClick={() => setPickerTarget('model')}
                    disabled={!baseUrl.trim()}
                    title="Browse available models"
                    className="btn-ghost px-2 border border-surface-50 rounded disabled:opacity-40 flex-shrink-0"
                  >
                    <ListFilter size={14} />
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-700 dark:text-gray-300">Flash model <span className="text-gray-500 font-normal">(optional)</span></label>
                <div className="flex gap-1.5">
                  <input className={INPUT_CLS} value={flashModel} onChange={(e) => setFlashModel(e.target.value)} />
                  <button
                    onClick={() => setPickerTarget('flash_model')}
                    disabled={!baseUrl.trim()}
                    title="Browse available models"
                    className="btn-ghost px-2 border border-surface-50 rounded disabled:opacity-40 flex-shrink-0"
                  >
                    <ListFilter size={14} />
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-700 dark:text-gray-300">API key</label>
                <input
                  type="password"
                  className={INPUT_CLS}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={hasApiKey ? 'leave blank to keep current' : ''}
                />
                {keyRequired && (
                  <p className="text-[13px] text-red-400">Required for OpenRouter.</p>
                )}
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button onClick={runTest} className="btn-ghost text-xs px-2.5 py-1.5 border border-surface-50 rounded">
                  Test
                </button>
                {testStatus && (
                  <p className={`flex items-center gap-1.5 text-xs ${testStatus.kind === 'error' ? 'text-red-400' : testStatus.kind === 'ok' ? 'text-green-400' : 'text-gray-500'}`}>
                    {testStatus.kind === 'testing' && <Loader2 size={13} className="animate-spin flex-shrink-0" />}
                    {testStatus.kind === 'ok' && <CheckCircle2 size={13} className="flex-shrink-0" />}
                    {testStatus.kind === 'error' && <AlertCircle size={13} className="flex-shrink-0" />}
                    <span>{testStatus.text}</span>
                  </p>
                )}
              </div>

              {isDesktop && desktop && (
                <div className="pt-3 border-t border-surface-50 space-y-1.5">
                  <div className="text-xs font-medium text-gray-700 dark:text-gray-300">About</div>
                  <p className="text-[13px] text-gray-500">Version {desktop.version}</p>
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] text-gray-500 font-mono truncate" title={desktop.dataDir}>{desktop.dataDir}</p>
                    <button
                      onClick={() => desktop!.openExternal(`file://${desktop!.dataDir}`)}
                      className="btn-ghost flex items-center gap-1 text-[13px] flex-shrink-0"
                    >
                      <FolderOpen size={13} /> Open folder
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-surface-50 flex-shrink-0">
          {saveError && <p className="text-[13px] text-red-400 mr-auto">{saveError}</p>}
          <button onClick={onClose} className="btn-ghost text-xs px-3 py-1.5">Cancel</button>
          <button
            onClick={save}
            disabled={!canSave || saving || loading}
            className="flex items-center gap-2 bg-accent hover:bg-accent-hover text-white px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            Save
          </button>
        </div>
      </div>

      {pickerTarget && (
        <ModelPickerModal
          provider={provider}
          baseUrl={baseUrl}
          apiKey={apiKey}
          currentValue={pickerTarget === 'model' ? model : flashModel}
          onSelect={(id) => (pickerTarget === 'model' ? setModel(id) : setFlashModel(id))}
          onClose={() => setPickerTarget(null)}
        />
      )}
    </div>
  )
}
