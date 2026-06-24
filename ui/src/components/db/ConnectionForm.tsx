import { useState } from 'react'
import { X } from 'lucide-react'
import { apiCreateConnection } from '../../api/client'
import { useUserSession } from '../../hooks/useUserSession'

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

// Vector DBs use an API key instead of username/password
const API_KEY_TYPES  = new Set(['qdrant', 'weaviate', 'chroma'])
// Redis: password only, no username; db is a 0–15 index
const REDIS_TYPES    = new Set(['redis'])
// File-based — no host/port
const FILE_TYPES     = new Set(['sqlite'])

interface Props {
  onClose: () => void
  onSaved: () => void
}

export default function ConnectionForm({ onClose, onSaved }: Props) {
  const { userId } = useUserSession()
  const [form, setForm] = useState({
    name:       '',
    db_type:    'postgresql',
    host:       'localhost',
    port:       5432,
    database:   '',
    username:   '',
    password:   '',
    api_key:    '',   // serialised into extra_params for vector DBs
    ssl_mode:   '',
  })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  const set = (k: string, v: string | number) => setForm(f => ({ ...f, [k]: v }))

  const handleDbTypeChange = (newType: string) => {
    setForm(f => ({
      ...f,
      db_type: newType,
      port:    DEFAULT_PORTS[newType] ?? f.port,
    }))
  }

  const isFileBased  = FILE_TYPES.has(form.db_type)
  const isApiKeyAuth = API_KEY_TYPES.has(form.db_type)
  const isRedis      = REDIS_TYPES.has(form.db_type)

  const save = async () => {
    if (!form.name) { setError('Name is required.'); return }
    setSaving(true)
    setError(null)
    try {
      const extra_params = form.api_key ? JSON.stringify({ api_key: form.api_key }) : undefined
      const { api_key: _discard, ...rest } = form
      await apiCreateConnection(userId, { ...rest, extra_params } as any)
      onSaved()
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to save connection.')
    } finally {
      setSaving(false)
    }
  }

  // Group DB types for the <select>
  const groups = Array.from(new Set(DB_TYPES.map(d => d.group)))

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-surface-100 border border-surface-50 rounded-xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-50">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Add Connection</h2>
          <button onClick={onClose} className="btn-ghost p-1"><X size={15} /></button>
        </div>

        <div className="p-5 space-y-3 text-sm">
          {/* Name */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Name *</label>
            <input
              value={form.name}
              onChange={e => set('name', e.target.value)}
              className="w-full bg-surface-300 border border-surface-50 rounded px-3 py-1.5 text-gray-800 dark:text-gray-200 focus:outline-none focus:border-accent"
            />
          </div>

          {/* DB Type */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Database Type</label>
            <select
              value={form.db_type}
              onChange={e => handleDbTypeChange(e.target.value)}
              className="w-full bg-surface-300 border border-surface-50 rounded px-3 py-1.5 text-gray-800 dark:text-gray-200 focus:outline-none focus:border-accent"
            >
              {groups.map(g => (
                <optgroup key={g} label={g}>
                  {DB_TYPES.filter(d => d.group === g).map(d => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* SQLite: file path only */}
          {isFileBased && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">File Path</label>
              <input
                value={form.database}
                onChange={e => set('database', e.target.value)}
                placeholder="/path/to/database.db"
                className="w-full bg-surface-300 border border-surface-50 rounded px-3 py-1.5 text-gray-800 dark:text-gray-200 focus:outline-none focus:border-accent"
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
                  onChange={e => set('host', e.target.value)}
                  className="w-full bg-surface-300 border border-surface-50 rounded px-3 py-1.5 text-gray-800 dark:text-gray-200 focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Port</label>
                <input
                  type="number"
                  value={form.port}
                  onChange={e => set('port', parseInt(e.target.value))}
                  className="w-full bg-surface-300 border border-surface-50 rounded px-3 py-1.5 text-gray-800 dark:text-gray-200 focus:outline-none focus:border-accent"
                />
              </div>
            </div>
          )}

          {/* Database / keyspace / db-index */}
          {!isFileBased && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                {isRedis ? 'DB Index (0–15)' : isApiKeyAuth ? 'Collection' : 'Database'}
              </label>
              <input
                value={form.database}
                onChange={e => set('database', e.target.value)}
                placeholder={isRedis ? '0' : ''}
                className="w-full bg-surface-300 border border-surface-50 rounded px-3 py-1.5 text-gray-800 dark:text-gray-200 focus:outline-none focus:border-accent"
              />
            </div>
          )}

          {/* Auth: API key for vector/chroma */}
          {isApiKeyAuth && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">API Key</label>
              <input
                value={form.api_key}
                onChange={e => set('api_key', e.target.value)}
                placeholder="optional"
                className="w-full bg-surface-300 border border-surface-50 rounded px-3 py-1.5 text-gray-800 dark:text-gray-200 focus:outline-none focus:border-accent"
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
                  onChange={e => set('username', e.target.value)}
                  className="w-full bg-surface-300 border border-surface-50 rounded px-3 py-1.5 text-gray-800 dark:text-gray-200 focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Password</label>
                <input
                  type="password"
                  value={form.password}
                  onChange={e => set('password', e.target.value)}
                  className="w-full bg-surface-300 border border-surface-50 rounded px-3 py-1.5 text-gray-800 dark:text-gray-200 focus:outline-none focus:border-accent"
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
                onChange={e => set('password', e.target.value)}
                placeholder="optional"
                className="w-full bg-surface-300 border border-surface-50 rounded px-3 py-1.5 text-gray-800 dark:text-gray-200 focus:outline-none focus:border-accent"
              />
            </div>
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-surface-50">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary">
            {saving ? 'Saving…' : 'Save Connection'}
          </button>
        </div>
      </div>
    </div>
  )
}
