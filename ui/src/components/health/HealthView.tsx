import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, ChevronRight, Copy, Loader2, RefreshCw, ShieldCheck } from 'lucide-react'
import { apiGetLastMigration, apiHealthSnapshot, apiListDatabases, apiSaveLastMigration } from '../../api/client'
import { useUserSession } from '../../hooks/useUserSession'
import { useStore, type HealthTab } from '../../store'
import { openExternalLink } from '../../lib/desktop'
import { explainFor, fmtInt, fmtMs, type Ranking, type Stmt } from '../../lib/health/pgss'
import { fmtAge, type LockTree, type Node, type RootAdvice } from '../../lib/health/locktree'
import { dialectForDbType, findingsFor, lockTree, rankSlow, worthShowing, type HealthSection, type HealthSnapshot } from '../../lib/health/view'
import type { MigrationFinding } from '../../lib/health/sqlmigrate'

const CARD = 'rounded border border-surface-50 bg-surface-300'
const CODE = 'font-mono text-xs whitespace-pre-wrap break-words bg-surface-200 rounded p-2 text-gray-700 dark:text-gray-300'

const oneLine = (q: string) => q.replace(/\s+/g, ' ').trim()

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      className="btn-ghost p-1 flex-shrink-0"
      title="Copy"
      onClick={() => {
        navigator.clipboard.writeText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1200)
      }}
    >
      {done ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
    </button>
  )
}

function Code({ text, onEdit }: { text: string; onEdit?: (sql: string) => void }) {
  return (
    <div className="flex items-start gap-1">
      <pre className={`${CODE} flex-1 min-w-0`}>{text}</pre>
      <div className="flex flex-col items-center gap-1">
        <CopyButton text={text} />
        {onEdit && (
          <button className="btn-ghost text-[11px] px-1 whitespace-nowrap" onClick={() => onEdit(text)} title="Open in the query editor without running it">
            Editor
          </button>
        )}
      </div>
    </div>
  )
}

/** The section's message when it can't show data: what is missing and the line that fixes it. */
function Unavailable({ section }: { section: HealthSection }) {
  return (
    <div className="p-3 space-y-2 text-sm text-gray-600 dark:text-gray-400">
      <p>{section.reason}</p>
      {section.fix && (
        <>
          <p className="text-xs">To turn it on (Pilotbase won't run this for you):</p>
          <Code text={section.fix} />
        </>
      )}
    </div>
  )
}

function StatementRow({ stmt, engine, onEdit }: { stmt: Stmt; engine: 'postgres' | 'mysql'; onEdit: (sql: string) => void }) {
  const [open, setOpen] = useState(false)
  const explain = explainFor(stmt.query, engine)
  return (
    <div className="border-t border-surface-50">
      <button className="w-full text-left px-3 py-2 hover:bg-surface-200 flex items-start gap-2" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={14} className="mt-0.5 flex-shrink-0" /> : <ChevronRight size={14} className="mt-0.5 flex-shrink-0" />}
        <span className="w-12 flex-shrink-0 text-right text-xs font-medium text-gray-700 dark:text-gray-200">{(stmt.share * 100).toFixed(stmt.share >= 0.1 ? 0 : 1)}%</span>
        <span className="flex-1 min-w-0">
          <span className="block font-mono text-xs truncate text-gray-700 dark:text-gray-300">{oneLine(stmt.query) || stmt.queryid}</span>
          {stmt.flags.length > 0 && (
            <span className="flex flex-wrap gap-1 mt-1">
              {stmt.flags.map((f, i) => (
                <span key={`${f.id}${i}`} className="text-[11px] px-1.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-400">{f.label}</span>
              ))}
            </span>
          )}
        </span>
        <span className="w-20 flex-shrink-0 text-right text-xs text-gray-500">{fmtInt(stmt.calls)} call{stmt.calls === 1 ? '' : 's'}</span>
        <span className="w-20 flex-shrink-0 text-right text-xs text-gray-500">{fmtMs(stmt.meanMs)} each</span>
        <span className="w-20 flex-shrink-0 text-right text-xs text-gray-500">{fmtMs(stmt.totalMs)} total</span>
      </button>
      {open && (
        <div className="px-3 pb-3 pl-9 space-y-2 text-xs text-gray-600 dark:text-gray-400">
          {stmt.flags.map((f, i) => <p key={`${f.id}${i}`}><span className="font-medium">{f.label}.</span> {f.detail}</p>)}
          <Code text={stmt.query} />
          <p>See its plan{explain.hasParams && engine === 'postgres' ? ' (GENERIC_PLAN keeps the $1 placeholders; PostgreSQL 16 or newer)' : ''}:</p>
          <Code text={explain.generic} onEdit={onEdit} />
        </div>
      )}
    </div>
  )
}

function SlowStatements({ section, ranking, engine, onEdit }: { section: HealthSection; ranking: Ranking | null; engine: 'postgres' | 'mysql'; onEdit: (sql: string) => void }) {
  if (section.state !== 'ok') return <Unavailable section={section} />
  if (!ranking) return <p className="p-3 text-sm text-gray-500">No statements recorded for this database yet.</p>
  const { shown, hidden } = worthShowing(ranking)
  return (
    <div>
      <p className="px-3 py-2 text-xs text-gray-500">
        The percentage is each statement's share of the time the database spent on all {fmtInt(ranking.stmts.length)} listed
        {section.since ? `, counted since ${new Date(section.since).toLocaleString()}` : ', counted since the statistics were last reset'}.
        {ranking.stmts.length > 1 && ` The top ${Math.min(5, ranking.stmts.length)} take ${(ranking.top5Share * 100).toFixed(0)}%.`}
      </p>
      {section.note && <p className="px-3 pb-2 text-xs text-amber-700 dark:text-amber-400">{section.note}</p>}
      {shown.map((s, i) => <StatementRow key={s.queryid || i} stmt={s} engine={engine} onEdit={onEdit} />)}
      {hidden > 0 && <p className="px-3 py-2 border-t border-surface-50 text-xs text-gray-500">{fmtInt(hidden)} more not shown: a small share of the time, or housekeeping like SET and COMMIT.</p>}
    </div>
  )
}

function LockNode({ node, depth }: { node: Node; depth: number }) {
  const s = node.s
  return (
    <>
      <div className="flex items-start gap-2 py-1 text-xs" style={{ paddingLeft: depth * 18 }}>
        <span className="font-mono font-medium text-gray-700 dark:text-gray-200 flex-shrink-0">{s.pid}</span>
        <span className="min-w-0">
          <span className="text-gray-600 dark:text-gray-400">
            {s.state || (s.missing ? 'not visible from this database' : 'unknown')}
            {s.stateAgeS != null ? ` for ${fmtAge(s.stateAgeS)}` : ''}
            {s.user ? ` · ${s.user}` : ''}
            {s.waitingFor ? ` · wants ${s.waitingFor}${s.relation ? ` on ${s.relation}` : ''}` : ''}
          </span>
          {s.query && <span className="block font-mono truncate text-gray-500">{oneLine(s.query)}</span>}
        </span>
      </div>
      {node.children.map((c) => <LockNode key={c.s.pid} node={c} depth={depth + 1} />)}
    </>
  )
}

function Advice({ advice, onEdit }: { advice: RootAdvice; onEdit: (sql: string) => void }) {
  return (
    <div className="space-y-1 text-xs text-gray-600 dark:text-gray-400">
      <p>{advice.why}</p>
      <Code text={advice.sql} onEdit={onEdit} />
    </div>
  )
}

function Locks({ section, tree, onEdit }: { section: HealthSection; tree: LockTree | null; onEdit: (sql: string) => void }) {
  if (section.state !== 'ok') return <Unavailable section={section} />
  return (
    <div className="p-3 space-y-3">
      {section.note && <p className="text-xs text-amber-700 dark:text-amber-400">{section.note}</p>}
      {!tree || tree.waiting === 0 ? (
        <p className="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-2">
          <Check size={15} className="text-green-500" />
          Nothing is waiting on a lock right now{tree ? ` (${fmtInt(tree.sessions.length)} other session${tree.sessions.length === 1 ? '' : 's'} connected)` : ''}.
        </p>
      ) : (
        <>
          <p className="text-sm text-gray-700 dark:text-gray-200 flex items-center gap-2">
            <AlertTriangle size={15} className="text-amber-500" />
            {tree.waiting} session{tree.waiting === 1 ? ' is' : 's are'} waiting
            {tree.longestWaitS != null ? `, the longest for ${fmtAge(tree.longestWaitS)}` : ''}.
          </p>
          <div>{tree.roots.map((r) => <LockNode key={r.s.pid} node={r} depth={0} />)}</div>
          {tree.warnings.map((w) => <p key={w} className="text-xs text-amber-700 dark:text-amber-400">{w}</p>)}
          {tree.advice.map((a) => <Advice key={a.pid} advice={a} onEdit={onEdit} />)}
        </>
      )}
    </div>
  )
}

const LEVEL_STYLE: Record<MigrationFinding['level'], string> = {
  stop: 'bg-red-500/15 text-red-700 dark:text-red-400',
  check: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  note: 'bg-surface-200 text-gray-600 dark:text-gray-400',
}

function MigrationCheck({ tab, dbType }: { tab: HealthTab; dbType: string | undefined }) {
  const { userId } = useUserSession()
  const [sql, setSql] = useState('')
  const [checked, setChecked] = useState<{ sql: string; at: string } | null>(null)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    if (!userId) return
    apiGetLastMigration(userId, tab.connectionId).then(({ check }) => {
      if (!check) return
      setSql(check.sql_text)
      setChecked({ sql: check.sql_text, at: check.checked_at })
    }).catch(() => {})
  }, [userId, tab.connectionId])

  const run = async () => {
    const text = sql.trim()
    if (!text) return
    setChecked({ sql: text, at: new Date().toISOString() })
    setSaveError('')
    try {
      await apiSaveLastMigration(userId, tab.connectionId, text)
    } catch {
      setSaveError("The check ran, but it couldn't be saved for next time.")
    }
  }

  const findings = checked ? findingsFor(checked.sql, dialectForDbType(dbType)) : []
  return (
    <div className="p-3 space-y-2">
      <p className="text-xs text-gray-500">
        Paste a migration before you run it. It is only read here, never sent to the database.
      </p>
      <textarea
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        rows={4}
        spellCheck={false}
        placeholder="ALTER TABLE orders ADD COLUMN note text; CREATE INDEX ON orders (customer_id);"
        className="w-full font-mono text-xs bg-surface-200 border border-surface-50 rounded p-2 outline-none focus:border-accent text-gray-800 dark:text-gray-200"
      />
      <div className="flex items-center gap-3">
        <button onClick={run} disabled={!sql.trim()} className="bg-accent hover:bg-accent-hover text-white px-3 py-1 rounded text-xs font-medium disabled:opacity-50">
          Check migration
        </button>
        {checked && <span className="text-xs text-gray-500">Last checked {new Date(checked.at).toLocaleString()}</span>}
        {saveError && <span className="text-xs text-amber-700 dark:text-amber-400">{saveError}</span>}
      </div>
      {checked && findings.length === 0 && (
        <p className="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-2">
          <Check size={15} className="text-green-500" /> No statement here takes a long lock that this check knows about.
        </p>
      )}
      {findings.map((f, i) => (
        <div key={i} className="border-t border-surface-50 pt-2 space-y-1 text-xs text-gray-600 dark:text-gray-400">
          <p className="flex items-center gap-2 flex-wrap">
            <span className={`px-1.5 rounded text-[11px] font-medium ${LEVEL_STYLE[f.level]}`}>{f.level}</span>
            <span className="font-medium text-gray-700 dark:text-gray-200">{f.title}</span>
            <span className="text-gray-500">line {f.line}</span>
          </p>
          <p>{f.detail}</p>
          {f.safe && <Code text={f.safe} />}
          {f.link && (
            <a href={f.link.href} target="_blank" rel="noreferrer" onClick={(e) => openExternalLink(f.link!.href, e)} className="text-accent hover:underline">
              {f.link.label}
            </a>
          )}
        </div>
      ))}
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={CARD}>
      <h2 className="px-3 py-2 text-sm font-semibold text-gray-800 dark:text-gray-100 border-b border-surface-50">{title}</h2>
      {children}
    </section>
  )
}

export default function HealthView({ tab }: { tab: HealthTab }) {
  const { userId } = useUserSession()
  const { connections, focusConnectionQueryTab, updateQueryTab, updateHealthTab } = useStore()
  const conn = connections.find((c) => c.id === tab.connectionId)
  const [databases, setDatabases] = useState<string[]>([])
  const [snap, setSnap] = useState<HealthSnapshot | null>(null)
  const [readAt, setReadAt] = useState<Date | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!userId) return
    apiListDatabases(userId, tab.connectionId).then(({ databases: found }) => {
      setDatabases(found)
      // A server login with no database of its own (MySQL): read the first one rather than every schema's mix.
      if (!tab.database && !conn?.database && found.length) updateHealthTab(tab.id, { database: found[0] })
    }).catch(() => {})
  }, [userId, tab.connectionId])

  const database = tab.database ?? conn?.database ?? null
  const read = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    setError('')
    try {
      setSnap(await apiHealthSnapshot(userId, tab.connectionId, database))
      setReadAt(new Date())
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Couldn't read this database's health.")
    } finally {
      setLoading(false)
    }
  }, [userId, tab.connectionId, database])

  useEffect(() => { read() }, [read])

  const openInEditor = (sql: string) => {
    const tabId = focusConnectionQueryTab(tab.connectionId)
    updateQueryTab(tabId, { query: sql, database, sqlPanelOpen: true })
  }

  const engine = snap?.engine ?? 'postgres'
  const ranking = snap ? rankSlow(snap.slow) : null
  const tree = snap ? lockTree(snap.locks, engine) : null

  return (
    <div className="h-full overflow-y-auto" data-testid="health-view">
      <div className="max-w-5xl mx-auto p-4 space-y-4">
        <header className="flex items-center gap-3 flex-wrap">
          <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Health</h1>
          {databases.length > 0 && (
            <select
              value={database ?? ''}
              onChange={(e) => updateHealthTab(tab.id, { database: e.target.value })}
              aria-label="Database"
              className="bg-surface-200 border border-surface-50 rounded px-1.5 py-0.5 text-xs text-gray-700 dark:text-gray-300"
            >
              {database && !databases.includes(database) && <option value={database}>{database}</option>}
              {databases.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
          <button onClick={read} disabled={loading} className="btn-ghost flex items-center gap-1 text-xs disabled:opacity-50">
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh
          </button>
          {readAt && <span className="text-xs text-gray-500">Read at {readAt.toLocaleTimeString()}</span>}
          <span className="ml-auto text-xs text-gray-500 flex items-center gap-1">
            <ShieldCheck size={13} /> Read only: nothing here changes your database.
          </span>
        </header>

        {error && <p className={`${CARD} p-3 text-sm text-red-600 dark:text-red-400`}>{error}</p>}

        <Card title="Slow statements">
          {snap ? <SlowStatements section={snap.slow} ranking={ranking} engine={engine} onEdit={openInEditor} /> : <p className="p-3 text-sm text-gray-500">{loading ? 'Reading…' : 'Not read yet.'}</p>}
        </Card>
        <Card title="Locks">
          {snap ? <Locks section={snap.locks} tree={tree} onEdit={openInEditor} /> : <p className="p-3 text-sm text-gray-500">{loading ? 'Reading…' : 'Not read yet.'}</p>}
        </Card>
        <Card title="Last migration check">
          <MigrationCheck tab={tab} dbType={conn?.db_type} />
        </Card>
      </div>
    </div>
  )
}
