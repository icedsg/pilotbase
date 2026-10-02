import { useState } from 'react'
import { X, Loader2, KeyRound } from 'lucide-react'
import { apiSetDbCredential, apiDeleteDbCredential } from '../../api/client'
import { useUserSession } from '../../hooks/useUserSession'
import type { DbConnection } from '../../types'

/** SQL engines where a database can be opened with its own login. */
export const DB_LOGIN_TYPES = new Set(['postgresql', 'mysql', 'mariadb', 'mssql', 'db2', 'cockroachdb', 'snowflake'])

const INPUT_CLS = 'w-full bg-surface-300 border border-surface-50 rounded px-3 py-1.5 text-gray-800 dark:text-gray-200 focus:outline-none focus:border-accent'

interface Props {
  conn: DbConnection
  database: string
  /** Error that brought the user here, shown for context. */
  reason?: string
  onClose: () => void
  onSaved: (dbCredentials: { database: string; username: string }[]) => void
}

export default function DbCredentialsDialog({ conn, database, reason, onClose, onSaved }: Props) {
  const { userId } = useUserSession()
  const existing = conn.db_credentials?.find(c => c.database === database)
  const [username, setUsername] = useState(existing?.username ?? '')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const others = (conn.db_credentials || []).filter(c => c.database !== database)

  const save = async () => {
    if (!username) { setError('Username is required.'); return }
    setBusy(true)
    setError(null)
    try {
      const res = await apiSetDbCredential(userId, conn.id, database, username, password || undefined)
      if (!res.success) { setError(res.error || 'Login failed.'); return }
      onSaved([...others, { database, username }])
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to save login.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    setError(null)
    try {
      await apiDeleteDbCredential(userId, conn.id, database)
      onSaved(others)
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to remove login.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-surface-100 border border-surface-50 rounded-xl w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-50">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2">
            <KeyRound size={16} /> Database login
          </h2>
          <button onClick={onClose} className="btn-ghost p-1"><X size={20} /></button>
        </div>

        <form className="p-5 space-y-3 text-sm" onSubmit={e => { e.preventDefault(); save() }}>
          <p className="text-xs text-gray-500">
            Use a different user for <span className="font-mono text-gray-700 dark:text-gray-300">{database}</span> on{' '}
            <span className="font-mono text-gray-700 dark:text-gray-300">{conn.host}{conn.port ? `:${conn.port}` : ''}</span>.
            Other databases keep using <span className="font-mono">{conn.username || 'the connection login'}</span>.
          </p>
          {reason && (
            <div className="text-xs text-red-400 bg-red-500/10 rounded px-2 py-1.5 break-words">{reason}</div>
          )}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Username</label>
            <input className={INPUT_CLS} value={username} onChange={e => setUsername(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Password</label>
            <input
              type="password"
              className={INPUT_CLS}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={existing ? 'Leave blank to keep current' : ''}
            />
          </div>
          {error && <div className="text-xs text-red-400 break-words">{error}</div>}

          <div className="flex items-center gap-2 pt-1">
            {existing && (
              <button type="button" onClick={remove} disabled={busy} className="btn-ghost text-xs text-red-400">
                Use connection login
              </button>
            )}
            <div className="flex-1" />
            <button type="button" onClick={onClose} className="btn-ghost text-xs">Cancel</button>
            <button type="submit" disabled={busy} className="btn-primary text-xs flex items-center gap-1.5">
              {busy && <Loader2 size={13} className="animate-spin" />}
              Test &amp; save
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
