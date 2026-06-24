import { useState } from 'react'
import { X } from 'lucide-react'
import { apiCreateConnection } from '../../api/client'
import { useUserSession } from '../../hooks/useUserSession'

const DB_TYPES = [
  'postgresql', 'mysql', 'mariadb', 'sqlite', 'mssql',
]

interface Props {
  onClose: () => void
  onSaved: () => void
}

export default function ConnectionForm({ onClose, onSaved }: Props) {
  const { userId } = useUserSession()
  const [form, setForm] = useState({
    name: '',
    db_type: 'postgresql',
    host: 'localhost',
    port: 5432,
    database: '',
    username: '',
    password: '',
    ssl_mode: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (k: string, v: string | number) => setForm((f) => ({ ...f, [k]: v }))

  const save = async () => {
    if (!form.name) { setError('Name is required.'); return }
    setSaving(true)
    setError(null)
    try {
      await apiCreateConnection(userId, form as any)
      onSaved()
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to save connection.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-surface-100 border border-surface-50 rounded-xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-50">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Add Connection</h2>
          <button onClick={onClose} className="btn-ghost p-1"><X size={15} /></button>
        </div>

        <div className="p-5 space-y-3 text-sm">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Name *</label>
            <input value={form.name} onChange={(e) => set('name', e.target.value)}
              className="w-full bg-surface-300 border border-surface-50 rounded px-3 py-1.5 text-gray-800 dark:text-gray-200 focus:outline-none focus:border-accent" />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Database Type</label>
            <select value={form.db_type} onChange={(e) => set('db_type', e.target.value)}
              className="w-full bg-surface-300 border border-surface-50 rounded px-3 py-1.5 text-gray-800 dark:text-gray-200 focus:outline-none focus:border-accent">
              {DB_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          {form.db_type !== 'sqlite' && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="block text-xs text-gray-400 mb-1">Host</label>
                  <input value={form.host} onChange={(e) => set('host', e.target.value)}
                    className="w-full bg-surface-300 border border-surface-50 rounded px-3 py-1.5 text-gray-800 dark:text-gray-200 focus:outline-none focus:border-accent" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Port</label>
                  <input type="number" value={form.port} onChange={(e) => set('port', parseInt(e.target.value))}
                    className="w-full bg-surface-300 border border-surface-50 rounded px-3 py-1.5 text-gray-800 dark:text-gray-200 focus:outline-none focus:border-accent" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Database</label>
                <input value={form.database} onChange={(e) => set('database', e.target.value)}
                  className="w-full bg-surface-300 border border-surface-50 rounded px-3 py-1.5 text-gray-800 dark:text-gray-200 focus:outline-none focus:border-accent" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Username</label>
                  <input value={form.username} onChange={(e) => set('username', e.target.value)}
                    className="w-full bg-surface-300 border border-surface-50 rounded px-3 py-1.5 text-gray-800 dark:text-gray-200 focus:outline-none focus:border-accent" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Password</label>
                  <input type="password" value={form.password} onChange={(e) => set('password', e.target.value)}
                    className="w-full bg-surface-300 border border-surface-50 rounded px-3 py-1.5 text-gray-800 dark:text-gray-200 focus:outline-none focus:border-accent" />
                </div>
              </div>
            </>
          )}

          {form.db_type === 'sqlite' && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">File Path</label>
              <input value={form.database} onChange={(e) => set('database', e.target.value)}
                placeholder="/path/to/database.db"
                className="w-full bg-surface-300 border border-surface-50 rounded px-3 py-1.5 text-gray-800 dark:text-gray-200 focus:outline-none focus:border-accent" />
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
