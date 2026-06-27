import { useEffect, useState } from 'react'
import { X, CheckCircle, XCircle } from 'lucide-react'
import { apiAdminCreateDatabase, apiAdminCreateUser, apiListDatabases } from '../../api/client'
import { useUserSession } from '../../hooks/useUserSession'
import type { DbConnection } from '../../types'

const INPUT_CLS = 'w-full bg-surface-300 border border-surface-50 rounded px-3 py-1.5 text-gray-800 dark:text-gray-200 focus:outline-none focus:border-accent text-sm'

interface Msg { type: 'success' | 'error'; text: string }

interface Props {
  conn: DbConnection
  onClose: () => void
}

export default function AdminActionsPanel({ conn, onClose }: Props) {
  const { userId } = useUserSession()
  const [tab, setTab] = useState<'database' | 'user'>('database')

  // Create database
  const [dbName,    setDbName]    = useState('')
  const [dbLoading, setDbLoading] = useState(false)
  const [dbMsg,     setDbMsg]     = useState<Msg | null>(null)

  // Create user
  const [username,    setUsername]    = useState('')
  const [password,    setPassword]    = useState('')
  const [grantDb,     setGrantDb]     = useState('')
  const [databases,   setDatabases]   = useState<string[]>([])
  const [userLoading, setUserLoading] = useState(false)
  const [userMsg,     setUserMsg]     = useState<Msg | null>(null)

  useEffect(() => {
    apiListDatabases(userId, conn.id)
      .then(r => setDatabases(r.databases))
      .catch(() => {})
  }, [conn.id, userId])

  const createDb = async () => {
    if (!dbName.trim()) return
    setDbLoading(true)
    setDbMsg(null)
    try {
      const res = await apiAdminCreateDatabase(userId, conn.id, dbName.trim())
      setDbMsg({ type: 'success', text: res.message })
      setDbName('')
      // Refresh database list for the user-grant dropdown
      apiListDatabases(userId, conn.id).then(r => setDatabases(r.databases)).catch(() => {})
    } catch (e: any) {
      setDbMsg({ type: 'error', text: e?.response?.data?.detail || 'Failed to create database.' })
    } finally {
      setDbLoading(false)
    }
  }

  const createUser = async () => {
    if (!username.trim() || !password) return
    setUserLoading(true)
    setUserMsg(null)
    try {
      const res = await apiAdminCreateUser(userId, conn.id, username.trim(), password, grantDb || undefined)
      setUserMsg({ type: 'success', text: res.message })
      setUsername('')
      setPassword('')
      setGrantDb('')
    } catch (e: any) {
      setUserMsg({ type: 'error', text: e?.response?.data?.detail || 'Failed to create user.' })
    } finally {
      setUserLoading(false)
    }
  }

  const tabCls = (t: typeof tab) =>
    `flex-1 px-4 py-2 text-xs font-medium transition-colors ${tab === t ? 'text-accent border-b-2 border-accent' : 'text-gray-500 hover:text-gray-300'}`

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-surface-100 border border-surface-50 rounded-xl w-full max-w-sm shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-50">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            {conn.name} — Admin
          </h2>
          <button onClick={onClose} className="btn-ghost p-1"><X size={15} /></button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-surface-50">
          <button className={tabCls('database')} onClick={() => setTab('database')}>Create Database</button>
          <button className={tabCls('user')}     onClick={() => setTab('user')}>Create User</button>
        </div>

        <div className="p-5 space-y-3">
          {tab === 'database' && (
            <>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Database Name</label>
                <input
                  value={dbName}
                  onChange={e => setDbName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createDb()}
                  placeholder="new_database"
                  className={INPUT_CLS}
                />
              </div>
              {dbMsg && (
                <div className={`flex items-start gap-2 text-xs ${dbMsg.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                  {dbMsg.type === 'success' ? <CheckCircle size={13} className="flex-shrink-0 mt-0.5" /> : <XCircle size={13} className="flex-shrink-0 mt-0.5" />}
                  <span>{dbMsg.text}</span>
                </div>
              )}
              <button
                onClick={createDb}
                disabled={!dbName.trim() || dbLoading}
                className="btn-primary w-full"
              >
                {dbLoading ? 'Creating…' : 'Create Database'}
              </button>
            </>
          )}

          {tab === 'user' && (
            <>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Username</label>
                <input
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Grant access to database <span className="text-gray-600">(optional)</span></label>
                <select
                  value={grantDb}
                  onChange={e => setGrantDb(e.target.value)}
                  className={INPUT_CLS}
                >
                  <option value="">— none —</option>
                  {databases.map(db => (
                    <option key={db} value={db}>{db}</option>
                  ))}
                </select>
              </div>
              {userMsg && (
                <div className={`flex items-start gap-2 text-xs ${userMsg.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                  {userMsg.type === 'success' ? <CheckCircle size={13} className="flex-shrink-0 mt-0.5" /> : <XCircle size={13} className="flex-shrink-0 mt-0.5" />}
                  <span>{userMsg.text}</span>
                </div>
              )}
              <button
                onClick={createUser}
                disabled={!username.trim() || !password || userLoading}
                className="btn-primary w-full"
              >
                {userLoading ? 'Creating…' : 'Create User'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
