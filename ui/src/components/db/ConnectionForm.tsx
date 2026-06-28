import { useState } from 'react'
import { X, CheckCircle, XCircle, Loader2 } from 'lucide-react'
import { apiCreateConnection, apiUpdateConnection, apiTestConnectionParams } from '../../api/client'
import { useUserSession } from '../../hooks/useUserSession'
import type { DbConnection } from '../../types'

const DB_TYPES = [
  { value: 'postgresql', label: 'PostgreSQL',  group: 'SQL' },
  { value: 'mysql',      label: 'MySQL',        group: 'SQL' },
  { value: 'mariadb',    label: 'MariaDB',      group: 'SQL' },
  { value: 'sqlite',     label: 'SQLite',       group: 'SQL' },
  { value: 'mssql',      label: 'SQL Server',   group: 'SQL' },
  { value: 'mongodb',    label: 'MongoDB',      group: 'NoSQL' },
  { value: 'redis',      label: 'Redis',        group: 'NoSQL' },
  { value: 'qdrant',     label: 'Qdrant',       group: 'Vector' },
  { value: 'chroma',     label: 'ChromaDB',     group: 'Vector' },
  { value: 'weaviate',   label: 'Weaviate',     group: 'Vector' },
]

const DEFAULT_PORTS: Record<string, number> = {
  postgresql: 5432,
  mysql:      3306,
  mariadb:    3306,
  mssql:      1433,
  mongodb:    27017,
  redis:      6379,
  qdrant:     6333,
  chroma:     8000,
  weaviate:   8080,
}

const API_KEY_TYPES = new Set(['qdrant', 'weaviate', 'chroma'])
const REDIS_TYPES   = new Set(['redis'])
const FILE_TYPES    = new Set(['sqlite'])
const CAN_LIST_DBS  = new Set(['postgresql', 'mysql', 'mariadb', 'mongodb'])

type TestStatus = 'idle' | 'testing' | 'ok' | 'error'

const INPUT_CLS = 'w-full bg-surface-300 border border-surface-50 rounded px-3 py-1.5 text-gray-800 dark:text-gray-200 focus:outline-none focus:border-accent'

interface Props {
  onClose: () => void
  onSaved: (conn?: DbConnection) => void
  connection?: DbConnection
}

export default function ConnectionForm({ onClose, onSaved, connection }: Props) {
  const { userId } = useUserSession()
  const isEdit = !!connection

  const [form, setForm] = useState({
    name:     connection?.name     ?? '',
    db_type:  connection?.db_type  ?? 'postgresql',
    host:     connection?.host     ?? 'localhost',
    port:     connection?.port     ?? 5432,
    database: connection?.database ?? '',
    username: connection?.username ?? '',
    password: '',
    api_key:  '',
    ssl_mode: connection?.ssl_mode ?? '',
  })
  const [saving,      setSaving]      = useState(false)
  const [saveError,   setSaveError]   = useState<string | null>(null)
  const [testStatus,  setTestStatus]  = useState<TestStatus>('idle')
  const [testMessage, setTestMessage] = useState<string | null>(null)
  const [databases,   setDatabases]   = useState<string[]>([])

  const set = (k: string, v: string | number) => setForm(f => ({ ...f, [k]: v }))

  const setAndResetTest = (k: string, v: string | number) => {
    set(k, v)
    setTestStatus('idle')
    setTestMessage(null)
    setDatabases([])
  }

  const handleDbTypeChange = (newType: string) => {
    setForm(f => ({ ...f, db_type: newType, port: DEFAULT_PORTS[newType] ?? f.port }))
    setTestStatus('idle')
    setTestMessage(null)
    setDatabases([])
  }

  const runTest = async () => {
    setTestStatus('testing')
    setTestMessage(null)
    try {
      const extra_params = form.api_key ? JSON.stringify({ api_key: form.api_key }) : undefined
      const res = await apiTestConnectionParams(userId, {
        db_type:      form.db_type,
        host:         form.host     || undefined,
        port:         form.port     || undefined,
        database:     form.database || undefined,
        username:     form.username || undefined,
        password:     form.password || undefined,
        ssl_mode:     form.ssl_mode || undefined,
        extra_params,
      })
      if (res.success) {
        setTestStatus('ok')
        setTestMessage('Connection successful!')
        setDatabases(res.databases)
      } else {
        setTestStatus('error')
        setTestMessage(res.error || 'Connection failed.')
      }
    } catch (e: any) {
      setTestStatus('error')
      setTestMessage(e?.response?.data?.detail || 'Failed to connect.')
    }
  }

  const save = async () => {
    if (!form.name) { setSaveError('Name is required.'); return }
    setSaving(true)
    setSaveError(null)
    try {
      if (isEdit) {
        const extra_params = form.api_key ? JSON.stringify({ api_key: form.api_key }) : undefined
        const updated = await apiUpdateConnection(userId, connection!.id, {
          name:       form.name     || undefined,
          host:       form.host     || undefined,
          port:       form.port     || undefined,
          database:   form.database || undefined,
          username:   form.username || undefined,
          password:   form.password || undefined,
          ssl_mode:   form.ssl_mode || undefined,
          extra_params,
        } as any)
        onSaved({ ...connection!, name: form.name, host: form.host as any, port: form.port as any, database: form.database as any, username: form.username as any, ssl_mode: form.ssl_mode as any })
      } else {
        const extra_params = form.api_key ? JSON.stringify({ api_key: form.api_key }) : undefined
        const { api_key: _discard, ...rest } = form
        await apiCreateConnection(userId, { ...rest, extra_params } as any)
        onSaved()
      }
    } catch (e: any) {
      setSaveError(e?.response?.data?.detail || 'Failed to save connection.')
    } finally {
      setSaving(false)
    }
  }

  const isFileBased  = FILE_TYPES.has(form.db_type)
  const isApiKeyAuth = API_KEY_TYPES.has(form.db_type)
  const isRedis      = REDIS_TYPES.has(form.db_type)
  const canListDbs   = CAN_LIST_DBS.has(form.db_type)
  const showDbDropdown = canListDbs && testStatus === 'ok' && databases.length > 0
  const canSave = isEdit ? true : testStatus === 'ok'

  const groups = Array.from(new Set(DB_TYPES.map(d => d.group)))

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-surface-100 border border-surface-50 rounded-xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-50">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            {isEdit ? 'Edit Connection' : 'Add Connection'}
          </h2>
          <button onClick={onClose} className="btn-ghost p-1"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-3 text-sm">
          {/* Name */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Name *</label>
            <input
              value={form.name}
              onChange={e => set('name', e.target.value)}
              className={INPUT_CLS}
              placeholder="My Database"
            />
          </div>

          {/* DB Type */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Database Type</label>
            {isEdit ? (
              <input value={DB_TYPES.find(d => d.value === form.db_type)?.label ?? form.db_type} disabled className={INPUT_CLS + ' opacity-50 cursor-not-allowed'} />
            ) : (
              <select
                value={form.db_type}
                onChange={e => handleDbTypeChange(e.target.value)}
                className={INPUT_CLS}
              >
                {groups.map(g => (
                  <optgroup key={g} label={g}>
                    {DB_TYPES.filter(d => d.group === g).map(d => (
                      <option key={d.value} value={d.value}>{d.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            )}
          </div>

          {/* SQLite: file path only */}
          {isFileBased && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">File Path</label>
              <input
                value={form.database}
                onChange={e => setAndResetTest('database', e.target.value)}
                placeholder="/path/to/database.db"
                className={INPUT_CLS}
              />
            </div>
          )}

          {/* Host + Port for all networked DBs */}
          {!isFileBased && (
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <label className="block text-xs text-gray-400 mb-1">Host</label>
                <input
                  value={form.host}
                  onChange={e => setAndResetTest('host', e.target.value)}
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Port</label>
                <input
                  type="number"
                  value={form.port}
                  onChange={e => setAndResetTest('port', parseInt(e.target.value))}
                  className={INPUT_CLS}
                />
              </div>
            </div>
          )}

          {/* Database / keyspace / db-index */}
          {!isFileBased && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                {isRedis ? 'DB Index (0–15)' : isApiKeyAuth ? 'Collection' : 'Database'}
                {canListDbs && <span className="text-gray-600 ml-1">(optional)</span>}
              </label>
              {showDbDropdown ? (
                <select
                  value={form.database}
                  onChange={e => set('database', e.target.value)}
                  className={INPUT_CLS}
                >
                  <option value="">— no specific database —</option>
                  {databases.map(db => (
                    <option key={db} value={db}>{db}</option>
                  ))}
                </select>
              ) : (
                <input
                  value={form.database}
                  onChange={e => set('database', e.target.value)}
                  placeholder={
                    canListDbs ? 'Leave blank — databases listed after test'
                    : isRedis  ? '0'
                    : ''
                  }
                  className={INPUT_CLS}
                />
              )}
            </div>
          )}

          {/* Auth: API key for vector DBs */}
          {isApiKeyAuth && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">API Key</label>
              <input
                value={form.api_key}
                onChange={e => setAndResetTest('api_key', e.target.value)}
                placeholder={isEdit ? 'leave blank to keep current' : 'optional'}
                className={INPUT_CLS}
              />
            </div>
          )}

          {/* Auth: username + password for SQL & MongoDB */}
          {!isFileBased && !isApiKeyAuth && !isRedis && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Username</label>
                <input
                  value={form.username}
                  onChange={e => setAndResetTest('username', e.target.value)}
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Password</label>
                <input
                  type="password"
                  value={form.password}
                  onChange={e => setAndResetTest('password', e.target.value)}
                  placeholder={isEdit ? 'leave blank to keep current' : ''}
                  className={INPUT_CLS}
                />
              </div>
            </div>
          )}

          {/* Auth: password only for Redis */}
          {isRedis && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">Password</label>
              <input
                type="password"
                value={form.password}
                onChange={e => setAndResetTest('password', e.target.value)}
                placeholder={isEdit ? 'leave blank to keep current' : 'optional'}
                className={INPUT_CLS}
              />
            </div>
          )}

          {/* Test status */}
          {testStatus === 'ok' && testMessage && (
            <div className="flex items-center gap-2 text-green-400 text-xs py-1">
              <CheckCircle size={17} className="flex-shrink-0" />
              <span>{testMessage}</span>
              {databases.length > 0 && <span className="text-gray-500">· {databases.length} database(s) found</span>}
            </div>
          )}
          {testStatus === 'error' && testMessage && (
            <div className="flex items-start gap-2 text-red-400 text-xs py-1">
              <XCircle size={17} className="flex-shrink-0 mt-0.5" />
              <span className="break-words">{testMessage}</span>
            </div>
          )}

          {saveError && <p className="text-xs text-red-400">{saveError}</p>}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-surface-50">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button
            onClick={runTest}
            disabled={testStatus === 'testing'}
            className="btn-ghost"
          >
            {testStatus === 'testing'
              ? <span className="flex items-center gap-1.5"><Loader2 size={16} className="animate-spin" />Testing…</span>
              : 'Test Connection'}
          </button>
          <button
            onClick={save}
            disabled={saving || !canSave}
            className="btn-primary"
            title={!canSave ? 'Run a successful test first' : undefined}
          >
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Save Connection'}
          </button>
        </div>
      </div>
    </div>
  )
}
