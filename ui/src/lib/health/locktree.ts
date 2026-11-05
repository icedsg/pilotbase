// lockTree (CR-0236): who blocks whom, from one pg_stat_activity + pg_blocking_pids() result. Browser only.
import { parsePasted, pick, type PasteFormat } from "./pastetable.ts";

export const LOCK_QUERY = `SELECT a.pid,
       pg_blocking_pids(a.pid) AS blocked_by,
       a.usename, a.application_name, a.client_addr,
       a.state, a.wait_event_type, a.wait_event,
       now() - a.xact_start AS xact_age,
       now() - a.state_change AS state_age,
       l.mode AS waiting_for, l.locktype, l.relation::regclass AS relation,
       left(a.query, 500) AS query
FROM pg_stat_activity a
LEFT JOIN LATERAL (SELECT * FROM pg_locks l WHERE l.pid = a.pid AND NOT l.granted LIMIT 1) l ON true
WHERE a.backend_type = 'client backend' AND a.pid <> pg_backend_pid()
ORDER BY a.xact_start NULLS LAST;`;

export type Session = {
  pid: number;
  blockedBy: number[];
  user: string;
  app: string;
  client: string;
  state: string;
  waitType: string;
  waitEvent: string;
  xactAgeS: number | null;
  stateAgeS: number | null;
  waitingFor: string; // lock mode it wants
  lockType: string;
  relation: string;
  query: string;
  missing?: boolean; // a blocker that isn't in the paste
};

export type Node = { s: Session; children: Node[]; alsoBehind: number[]; blocked: number };
export type RootAdvice = { pid: number; kind: "terminate" | "cancel"; sql: string; why: string };
export type LockTree = {
  format: PasteFormat;
  sessions: Session[];
  roots: Node[];
  waiting: number;
  longestWaitS: number | null;
  cycle: number[]; // pids that wait on each other, if any
  advice: RootAdvice[];
  warnings: string[];
  idle: Session[]; // sessions that block nobody and wait for nothing
};

/** Seconds from a PostgreSQL interval as text: '00:02:13.5', '1 day 02:00:00', '3 days', '-00:00:01'. */
export function intervalSeconds(v: string): number | null {
  const t = (v ?? "").trim();
  if (!t) return null;
  let s = 0;
  const days = t.match(/(-?\d+)\s+days?/);
  if (days) s += Number(days[1]) * 86400;
  const hms = t.match(/(-)?(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (hms) s += (hms[1] ? -1 : 1) * (Number(hms[2]) * 3600 + Number(hms[3]) * 60 + Number(hms[4]));
  if (!days && !hms) {
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return s;
}

export const fmtAge = (s: number | null) =>
  s == null ? "–" : s >= 86400 ? `${(s / 86400).toFixed(1)} d` : s >= 3600 ? `${(s / 3600).toFixed(1)} h` : s >= 60 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${s.toFixed(s < 10 ? 1 : 0)} s`;

const short = (q: string, n: number) => {
  const one = q.replace(/\s+/g, " ").trim().replace(/;$/, "");
  return one.length > n ? one.slice(0, n) + "…" : one;
};
const pids = (v: string) => (v.match(/\d+/g) ?? []).map(Number);

export function buildLockTree(text: string): LockTree {
  const t = parsePasted(text);
  const c = t.columns;
  const col = {
    pid: pick(c, "pid"),
    blockedBy: pick(c, "blocked_by", "pg_blocking_pids", "blocking_pids", "blocked_by_pids"),
    user: pick(c, "usename", "user", "username"),
    app: pick(c, "application_name", "app"),
    client: pick(c, "client_addr"),
    state: pick(c, "state"),
    waitType: pick(c, "wait_event_type"),
    waitEvent: pick(c, "wait_event"),
    xact: pick(c, "xact_age", "transaction_age"),
    stateAge: pick(c, "state_age"),
    mode: pick(c, "waiting_for", "mode"),
    lockType: pick(c, "locktype"),
    rel: pick(c, "relation"),
    query: pick(c, "query"),
  };
  if (!col.pid || !col.blockedBy)
    throw new Error(`Couldn't find the pid and blocked_by (pg_blocking_pids) columns. Found: ${c.join(", ") || "none"}. Run the query above and paste its whole result.`);
  const g = (r: Record<string, string>, k?: string) => (k ? r[k] ?? "" : "");
  const sessions: Session[] = t.rows
    .filter((r) => /^\d+$/.test(g(r, col.pid).trim()))
    .map((r) => ({
      pid: Number(g(r, col.pid)),
      blockedBy: pids(g(r, col.blockedBy)),
      user: g(r, col.user),
      app: g(r, col.app),
      client: g(r, col.client),
      state: g(r, col.state),
      waitType: g(r, col.waitType),
      waitEvent: g(r, col.waitEvent),
      xactAgeS: intervalSeconds(g(r, col.xact)),
      stateAgeS: intervalSeconds(g(r, col.stateAge)),
      waitingFor: g(r, col.mode),
      lockType: g(r, col.lockType),
      relation: g(r, col.rel),
      query: g(r, col.query),
    }));
  if (!sessions.length) throw new Error("No sessions in the pasted rows.");

  const by = new Map(sessions.map((s) => [s.pid, s]));
  // blockers that aren't in the paste (another database, filtered out) still need a place in the tree
  for (const s of [...sessions])
    for (const b of s.blockedBy)
      if (!by.has(b)) {
        const m: Session = { pid: b, blockedBy: [], user: "", app: "", client: "", state: "", waitType: "", waitEvent: "", xactAgeS: null, stateAgeS: null, waitingFor: "", lockType: "", relation: "", query: "", missing: true };
        by.set(b, m);
        sessions.push(m);
      }

  // depth = longest chain of blockers above a session; a waiter hangs under its deepest blocker
  const depth = new Map<number, number>();
  const cycle = new Set<number>();
  const visit = (pid: number, path: Set<number>): number => {
    if (depth.has(pid)) return depth.get(pid)!;
    if (path.has(pid)) {
      for (const p of path) cycle.add(p);
      return 0;
    }
    path.add(pid);
    const s = by.get(pid)!;
    const d = s.blockedBy.length ? 1 + Math.max(...s.blockedBy.map((b) => visit(b, path))) : 0;
    path.delete(pid);
    depth.set(pid, d);
    return d;
  };
  for (const s of sessions) visit(s.pid, new Set());

  const nodes = new Map<number, Node>(sessions.map((s) => [s.pid, { s, children: [], alsoBehind: [], blocked: 0 }]));
  const roots: Node[] = [];
  for (const s of sessions) {
    const n = nodes.get(s.pid)!;
    const blockers = s.blockedBy.filter((b) => !(cycle.has(b) && cycle.has(s.pid) && depth.get(b)! >= depth.get(s.pid)!));
    if (!blockers.length) {
      roots.push(n);
      continue;
    }
    const parent = [...blockers].sort((a, b) => depth.get(b)! - depth.get(a)!)[0];
    nodes.get(parent)!.children.push(n);
    n.alsoBehind = s.blockedBy.filter((b) => b !== parent);
  }
  const count = (n: Node): number => (n.blocked = n.children.reduce((a, ch) => a + 1 + count(ch), 0));
  roots.forEach(count);
  const blockingRoots = roots.filter((r) => r.children.length).sort((a, b) => b.blocked - a.blocked);
  const idle = roots.filter((r) => !r.children.length && !r.s.missing).map((r) => r.s);

  const advice: RootAdvice[] = blockingRoots.map(({ s, blocked }) => {
    const who = `${blocked} session${blocked === 1 ? "" : "s"}`;
    if (s.missing)
      return { pid: s.pid, kind: "cancel", sql: `SELECT pid, state, query FROM pg_stat_activity WHERE pid = ${s.pid};`, why: `Session ${s.pid} blocks ${who} but isn't in the paste (another database, or not a client backend). Look it up first.` };
    if (/^idle in transaction/.test(s.state))
      return {
        pid: s.pid,
        kind: "terminate",
        sql: `SELECT pg_terminate_backend(${s.pid});`,
        why: `${s.state === "idle in transaction (aborted)" ? "Its transaction already failed but was never rolled back" : "It opened a transaction and stopped sending anything"}${s.stateAgeS != null ? ` ${fmtAge(s.stateAgeS)} ago` : ""}, so there's no statement to cancel: pg_cancel_backend does nothing here. Terminating ends the session and rolls back its transaction${s.app ? ` (find out why ${s.app} left it open)` : ""}. It blocks ${who}.`,
      };
    return {
      pid: s.pid,
      kind: "cancel",
      sql: `SELECT pg_cancel_backend(${s.pid});   -- stop its current statement\n-- if it's still blocking a few seconds later:\nSELECT pg_terminate_backend(${s.pid});`,
      why: `It's ${s.state || "running"}${s.query ? `: ${short(s.query, 80)}` : ""}. Cancelling stops the running statement; inside a transaction the whole transaction fails and its locks are released at once, leaving the session idle in transaction (aborted). It blocks ${who}.`,
    };
  });

  const warnings: string[] = [];
  if (cycle.size) warnings.push(`Sessions ${[...cycle].join(", ")} wait on each other: a deadlock. Postgres ends one of them after deadlock_timeout (1 s by default); if they stay, look for an advisory lock or a lock outside Postgres.`);
  for (const s of sessions)
    if (/AccessExclusiveLock/.test(s.waitingFor) && nodes.get(s.pid)!.children.length)
      warnings.push(`Session ${s.pid} wants an AccessExclusiveLock${s.relation ? ` on ${s.relation}` : ""} (${short(s.query, 60)}) and ${nodes.get(s.pid)!.blocked} session${nodes.get(s.pid)!.blocked === 1 ? " is" : "s are"} queued behind it, even plain SELECTs. Run DDL with SET lock_timeout = '3s' so it gives up instead of stopping the table.`);
  const waits = sessions.filter((s) => s.blockedBy.length);
  const longestWaitS = waits.length ? Math.max(...waits.map((s) => s.stateAgeS ?? 0)) : null;
  return { format: t.format, sessions, roots: blockingRoots, waiting: waits.length, longestWaitS, cycle: [...cycle], advice, warnings, idle };
}
