// node --test ui/tests/health.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { worthShowing, findingsFor, hasHealthView, lockTree, opensHealthFirst, rankSlow, worstLevel, type HealthSection } from '../src/lib/health/view.ts'

const ok = (rows: Record<string, string>[]): HealthSection => ({ state: 'ok', rows, reason: '', fix: '', note: '', since: null })

const pgRow = (over: Record<string, string>) => ({
  queryid: '9007199254740993', calls: '10', total_exec_time: '100', total_plan_time: '0', mean_exec_time: '10', rows: '10',
  shared_blks_hit: '100', shared_blks_read: '0', temp_blks_written: '0', wal_bytes: '0', query: 'SELECT 1', ...over,
})

test('Health is first only on the engines that have it, and only when the connection has nothing open', () => {
  assert.equal(opensHealthFirst('postgresql', false), true)
  assert.equal(opensHealthFirst('mariadb', false), true)
  assert.equal(opensHealthFirst('postgresql', true), false)
  assert.equal(opensHealthFirst('sqlite', false), false)
  assert.equal(opensHealthFirst('mongodb', false), false)
  assert.equal(hasHealthView(undefined), false)
})

test('slow statements rank by share of total time and keep the 64-bit queryid', () => {
  const r = rankSlow(ok([
    pgRow({ query: 'SELECT small', total_exec_time: '100', mean_exec_time: '10' }),
    pgRow({ query: 'SELECT big', total_exec_time: '900', mean_exec_time: '90' }),
  ]))!
  assert.equal(r.stmts[0].query, 'SELECT big')
  assert.equal(r.stmts[0].share, 0.9)
  assert.equal(r.stmts[0].queryid, '9007199254740993')
  assert.ok(r.stmts[0].flags.some((f) => f.id === 'share'))
})

test('a statement that reads from disk is flagged', () => {
  const r = rankSlow(ok([pgRow({ query: 'SELECT * FROM big', shared_blks_read: '100000', calls: '1', mean_exec_time: '4000', total_exec_time: '4000' })]))!
  assert.ok(r.stmts[0].flags.some((f) => f.id === 'io'))
})

test('housekeeping and rounding dust stay out of the slow list, and the count says so', () => {
  const r = rankSlow(ok([
    pgRow({ query: 'SELECT big', total_exec_time: '10000' }),
    pgRow({ query: 'SET NAMES utf8mb4', total_exec_time: '500' }),
    pgRow({ query: 'SELECT tiny', total_exec_time: '1' }),
  ]))!
  const { shown, hidden } = worthShowing(r)
  assert.deepEqual(shown.map((s) => s.query), ['SELECT big'])
  assert.equal(hidden, 2)
})

test('nothing to rank is empty, not an error', () => {
  assert.equal(rankSlow(ok([])), null)
  assert.equal(rankSlow(ok([pgRow({ calls: '0', total_exec_time: '0' })])), null)
  assert.equal(rankSlow({ ...ok([]), state: 'off' }), null)
})

test('PostgreSQL lock tree: the idle transaction is the root and gets a terminate line', () => {
  const tree = lockTree(ok([
    { pid: '10', blocked_by: '', usename: 'app', state: 'idle in transaction', state_age: '0:05:00', xact_age: '0:05:00', waiting_for: '', relation: '', query: 'UPDATE a SET x = 1' },
    { pid: '20', blocked_by: '10', usename: 'app', state: 'active', state_age: '0:01:00', xact_age: '0:01:00', waiting_for: 'AccessExclusiveLock', relation: 'a', query: 'ALTER TABLE a ADD b int' },
    { pid: '30', blocked_by: '20', usename: 'app', state: 'active', state_age: '0:00:30', xact_age: '0:00:30', waiting_for: 'AccessShareLock', relation: 'a', query: 'SELECT * FROM a' },
  ]), 'postgres')!
  assert.equal(tree.waiting, 2)
  assert.equal(tree.roots[0].s.pid, 10)
  assert.equal(tree.roots[0].blocked, 2)
  assert.match(tree.advice[0].sql, /pg_terminate_backend\(10\)/)
  assert.equal(tree.longestWaitS, 60)
})

test('MySQL lock tree reads comma-separated blockers and offers KILL, not a PostgreSQL function', () => {
  const tree = lockTree(ok([
    { pid: '7', blocked_by: '', usename: 'app', state: 'idle in transaction', state_age: '120', xact_age: '120', waiting_for: '', relation: '', query: '' },
    { pid: '8', blocked_by: '7', usename: 'app', state: 'lock wait', state_age: '12', xact_age: '12', waiting_for: 'X,REC_NOT_GAP', relation: 'shop.orders', query: 'UPDATE orders SET a = 1' },
  ]), 'mysql')!
  assert.equal(tree.waiting, 1)
  assert.equal(tree.advice[0].sql, 'KILL 7;')
  assert.doesNotMatch(JSON.stringify(tree.advice), /pg_/)
})

test('sessions with no waits are not a lock problem', () => {
  const tree = lockTree(ok([{ pid: '1', blocked_by: '', usename: 'app', state: 'idle', state_age: '0:00:01', xact_age: '', waiting_for: '', relation: '', query: 'SELECT 1' }]), 'postgres')!
  assert.equal(tree.waiting, 0)
  assert.equal(tree.advice.length, 0)
  assert.equal(lockTree(ok([]), 'postgres'), null)
})

test('migration check names the lock in each dialect and stays quiet on empty text', () => {
  const pg = findingsFor('CREATE INDEX i ON orders (a);', 'postgresql')
  assert.equal(worstLevel(pg), 'check')
  assert.match(pg[0].safe ?? '', /CONCURRENTLY/)
  const my = findingsFor('ALTER TABLE orders MODIFY COLUMN a BIGINT;', 'mysql')
  assert.equal(my[0].algorithm?.algo, 'COPY')
  assert.deepEqual(findingsFor('   ', 'postgresql'), [])
  assert.equal(worstLevel([]), null)
})
