// Turns the Health snapshot from the API into what the view shows, using the same ranking and lock tree code as the
// free tools on pilotbase.pro. Rows arrive as named string columns, which is the JSON form those tools already read.
import { rankStatements, type Ranking } from './pgss.ts'
import { buildLockTree, type LockTree } from './locktree.ts'
import { checkMigration, type MigrationDialect, type MigrationFinding } from './sqlmigrate.ts'

export type HealthEngine = 'postgres' | 'mysql'
export type SectionState = 'ok' | 'off' | 'no_access' | 'error'
export interface HealthSection {
  state: SectionState
  rows: Record<string, string>[]
  reason: string
  fix: string
  note: string
  since: string | null
}
export interface HealthSnapshot {
  engine: HealthEngine
  slow: HealthSection
  locks: HealthSection
}

const HEALTH_DB_TYPES = new Set(['postgresql', 'mysql', 'mariadb'])
export const hasHealthView = (dbType: string | null | undefined) => !!dbType && HEALTH_DB_TYPES.has(dbType)

export const migrationDialect = (engine: HealthEngine): MigrationDialect => (engine === 'mysql' ? 'mysql' : 'postgresql')
export const dialectForDbType = (dbType: string | null | undefined): MigrationDialect =>
  dbType === 'mysql' || dbType === 'mariadb' ? 'mysql' : 'postgresql'

/** Null when there is nothing to rank yet (a fresh server, or statistics just reset). */
export function rankSlow(section: HealthSection): Ranking | null {
  if (section.state !== 'ok' || !section.rows.length) return null
  try {
    return rankStatements(JSON.stringify(section.rows))
  } catch {
    return null // every row had zero calls
  }
}

/** Null when no other session is connected. MySQL gets KILL where the tool's advice is written for PostgreSQL. */
export function lockTree(section: HealthSection, engine: HealthEngine): LockTree | null {
  if (section.state !== 'ok' || !section.rows.length) return null
  const tree = buildLockTree(JSON.stringify(section.rows))
  if (engine === 'postgres') return tree
  return {
    ...tree,
    advice: tree.advice.map((a) => ({
      ...a,
      kind: 'terminate' as const,
      sql: `KILL ${a.pid};`,
      why: /^idle in transaction/.test(tree.sessions.find((s) => s.pid === a.pid)?.state ?? '')
        ? 'It opened a transaction and stopped sending anything. KILL ends the session and rolls its transaction back.'
        : 'KILL ends the session and rolls its transaction back. KILL QUERY stops only the running statement.',
    })),
    warnings: tree.warnings.map((w) => w.replace('Postgres ends', 'The server ends').replace('after deadlock_timeout (1 s by default)', 'on its own')),
  }
}

/** What belongs under "Slow statements": not transaction control or SET, and not the rounding dust below 0.1% of the time. */
export function worthShowing(ranking: Ranking, limit = 10) {
  const real = ranking.stmts.filter((s) => !s.flags.some((f) => f.id === 'control') && s.share >= 0.001)
  return { shown: real.slice(0, limit), hidden: ranking.stmts.length - Math.min(real.length, limit) }
}

export const findingsFor = (sql: string, dialect: MigrationDialect): MigrationFinding[] =>
  sql.trim() ? checkMigration(sql, dialect) : []

export const worstLevel = (findings: MigrationFinding[]): MigrationFinding['level'] | null =>
  findings.find((f) => f.level === 'stop')?.level ?? findings.find((f) => f.level === 'check')?.level ?? findings[0]?.level ?? null

/** The first-screen rule: Health only where the engine has it and the connection has nothing open yet. */
export function opensHealthFirst(dbType: string | null | undefined, connectionHasTab: boolean) {
  return hasHealthView(dbType) && !connectionHasTab
}
