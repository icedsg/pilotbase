// statementsRanker (CR-0236): rank pg_stat_statements rows by the share of total database time they use, with
// per-call numbers and flags for the shapes worth a second look. Browser only. CR-0321: also MySQL 8's
// performance_schema.events_statements_summary_by_digest (picoseconds, rows examined vs sent, full scans).
import { parsePasted, pick, type PasteFormat, type PastedTable } from "./pastetable.ts";

export const PGSS_QUERY = `SELECT queryid, calls, total_exec_time, total_plan_time, mean_exec_time, rows,
       shared_blks_hit, shared_blks_read, temp_blks_written, wal_bytes,
       left(query, 2000) AS query
FROM pg_stat_statements
WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
ORDER BY total_exec_time DESC
LIMIT 200;`;

export const PGSS_COPY = `\\copy (${PGSS_QUERY.slice(0, -1).replace(/\n\s*/g, " ")}) to 'pgss.csv' with (format csv, header)`;

export const MYSQL_QUERY = `SELECT DIGEST, COUNT_STAR, SUM_TIMER_WAIT, AVG_TIMER_WAIT,
       SUM_ROWS_EXAMINED, SUM_ROWS_SENT, SUM_ROWS_AFFECTED, SUM_NO_INDEX_USED,
       SUM_CREATED_TMP_DISK_TABLES, SUM_SORT_MERGE_PASSES,
       LEFT(DIGEST_TEXT, 2000) AS DIGEST_TEXT
FROM performance_schema.events_statements_summary_by_digest
WHERE SCHEMA_NAME = DATABASE()
ORDER BY SUM_TIMER_WAIT DESC
LIMIT 200;`;

export type Engine = "postgres" | "mysql";
export type FlagId = "share" | "nplus1" | "noindex" | "scan" | "slow" | "io" | "temp" | "wal" | "control";
export type Flag = { id: FlagId; label: string; detail: string };

export type Stmt = {
  queryid: string;
  query: string;
  calls: number;
  totalMs: number; // exec + plan
  execMs: number;
  planMs: number;
  meanMs: number;
  rows: number;
  hit: number;
  read: number;
  tempWritten: number;
  walBytes: number | null;
  share: number; // of total time, 0..1
  cumShare: number;
  rowsPerCall: number;
  readPerCall: number;
  hitRatio: number | null;
  walPerCall: number | null;
  examined: number | null; // MySQL: rows examined, all calls
  examinedPerRow: number | null; // rows examined per row sent or changed
  noIndexCalls: number | null; // MySQL: calls that did a full table or index scan
  tmpDisk: number; // MySQL: on-disk temporary tables + sort merge passes
  rankByMean: number; // 1-based position if sorted by mean time
  flags: Flag[];
};

export type Ranking = {
  format: PasteFormat;
  engine: Engine;
  version: "13+" | "12 or older" | "MySQL 8 performance_schema";
  stmts: Stmt[];
  totalMs: number;
  top5Share: number;
  missing: string[];
  meanTop: Stmt | null; // what sorting by mean_exec_time puts first
  notes: string[];
};

const num = (v: string | undefined) => {
  if (v == null || v.trim() === "") return 0;
  const n = Number(v.replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export const fmtMs = (ms: number) =>
  ms >= 3_600_000 ? `${(ms / 3_600_000).toFixed(1)} h` : ms >= 60_000 ? `${(ms / 60_000).toFixed(1)} min` : ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)} s` : ms >= 1 ? `${ms.toFixed(ms >= 100 ? 0 : 1)} ms` : `${(ms * 1000).toFixed(0)} µs`;
export const fmtBytes = (b: number) =>
  b >= 1 << 30 ? `${(b / (1 << 30)).toFixed(1)} GB` : b >= 1 << 20 ? `${(b / (1 << 20)).toFixed(1)} MB` : b >= 1024 ? `${(b / 1024).toFixed(0)} kB` : `${Math.round(b)} B`;
export const fmtInt = (n: number) => Math.round(n).toLocaleString("en-US");
const BLOCK = 8192;

const CONTROL = /^\s*(begin|commit|end|rollback|savepoint|release|set|reset|show|discard|deallocate|listen|unlisten|start transaction)\b/i;
const isSelect = (q: string) => /^\s*(with\b[\s\S]*?\)\s*)?select\b/i.test(q);
// one row back from an aggregate says nothing about how many rows it read
const isAggregate = (q: string) => /\b(count|sum|avg|min|max|array_agg|string_agg|json_agg|jsonb_agg|bool_and|bool_or)\s*\(|\bgroup\s+by\b|\bdistinct\b/i.test(q);

const PS = 1e9; // performance_schema timers are picoseconds; 1e9 of them is a millisecond

function mysqlStatements(t: PastedTable, notes: string[]): Stmt[] {
  const c = t.columns;
  const col = {
    query: pick(c, "digest_text", "query"),
    digest: pick(c, "digest"),
    calls: pick(c, "count_star")!,
    total: pick(c, "sum_timer_wait")!,
    mean: pick(c, "avg_timer_wait"),
    examined: pick(c, "sum_rows_examined"),
    sent: pick(c, "sum_rows_sent"),
    affected: pick(c, "sum_rows_affected"),
    noIndex: pick(c, "sum_no_index_used"),
    tmpDisk: pick(c, "sum_created_tmp_disk_tables"),
    merge: pick(c, "sum_sort_merge_passes"),
  };
  if (!col.query) notes.push("No DIGEST_TEXT column: statements are shown by digest only.");
  if (!col.examined || !col.sent) notes.push("No SUM_ROWS_EXAMINED or SUM_ROWS_SENT column: the rows-examined check is skipped.");
  return t.rows.map((r) => {
    const calls = num(r[col.calls]);
    const totalMs = num(r[col.total]) / PS;
    const rows = (col.sent ? num(r[col.sent]) : 0) + (col.affected ? num(r[col.affected]) : 0);
    const examined = col.examined && col.sent ? num(r[col.examined]) : null;
    return {
      queryid: col.digest && r[col.digest] !== "NULL" ? r[col.digest] : "",
      query: col.query && r[col.query] !== "NULL" ? r[col.query] : "",
      calls,
      totalMs,
      execMs: totalMs,
      planMs: 0,
      meanMs: col.mean ? num(r[col.mean]) / PS : calls ? totalMs / calls : 0,
      rows,
      hit: 0,
      read: 0,
      tempWritten: 0,
      walBytes: null,
      share: 0,
      cumShare: 0,
      rowsPerCall: calls ? rows / calls : 0,
      readPerCall: 0,
      hitRatio: null,
      walPerCall: null,
      examined,
      examinedPerRow: examined != null ? examined / Math.max(1, rows) : null,
      noIndexCalls: col.noIndex ? num(r[col.noIndex]) : null,
      tmpDisk: (col.tmpDisk ? num(r[col.tmpDisk]) : 0) + (col.merge ? num(r[col.merge]) : 0),
      rankByMean: 0,
      flags: [] as Flag[],
    } satisfies Stmt;
  });
}

export function rankStatements(text: string): Ranking {
  const t = parsePasted(text);
  const c = t.columns;
  if (pick(c, "count_star") && pick(c, "sum_timer_wait")) {
    const notes: string[] = [];
    const stmts = mysqlStatements(t, notes);
    return finish(t, "mysql", stmts, [], notes);
  }
  const col = {
    query: pick(c, "query"),
    queryid: pick(c, "queryid"),
    calls: pick(c, "calls"),
    total: pick(c, "total_exec_time", "total_time"),
    plan: pick(c, "total_plan_time"),
    mean: pick(c, "mean_exec_time", "mean_time"),
    rows: pick(c, "rows"),
    hit: pick(c, "shared_blks_hit"),
    read: pick(c, "shared_blks_read"),
    temp: pick(c, "temp_blks_written"),
    wal: pick(c, "wal_bytes"),
  };
  if (!col.calls || !col.total)
    throw new Error(`Couldn't find the calls and total_exec_time (or total_time) columns. Found: ${c.join(", ") || "none"}. Run the query above and paste its whole result.`);
  const missing = (["rows", "shared_blks_read", "wal_bytes"] as const).filter((k) => !pick(c, k));
  const notes: string[] = [];
  if (!col.query) notes.push("No query column: statements are shown by queryid only.");
  if (!col.plan) notes.push("No total_plan_time column: planning time isn't counted (it is only tracked when pg_stat_statements.track_planning is on).");

  const stmts = t.rows
    .map((r) => {
      const calls = num(r[col.calls!]);
      const execMs = num(r[col.total!]);
      const planMs = col.plan ? num(r[col.plan]) : 0;
      const read = col.read ? num(r[col.read]) : 0;
      const hit = col.hit ? num(r[col.hit]) : 0;
      const walBytes = col.wal ? num(r[col.wal]) : null;
      const rows = col.rows ? num(r[col.rows]) : 0;
      return {
        queryid: col.queryid ? r[col.queryid] : "",
        query: col.query ? r[col.query] : "",
        calls,
        totalMs: execMs + planMs,
        execMs,
        planMs,
        meanMs: col.mean ? num(r[col.mean]) : calls ? execMs / calls : 0,
        rows,
        hit,
        read,
        tempWritten: col.temp ? num(r[col.temp]) : 0,
        walBytes,
        share: 0,
        cumShare: 0,
        rowsPerCall: calls ? rows / calls : 0,
        readPerCall: calls ? read / calls : 0,
        hitRatio: hit + read > 0 ? hit / (hit + read) : null,
        walPerCall: walBytes != null && calls ? walBytes / calls : null,
        examined: null,
        examinedPerRow: null,
        noIndexCalls: null,
        tmpDisk: 0,
        rankByMean: 0,
        flags: [] as Flag[],
      } satisfies Stmt;
    });
  return finish(t, col.total === "total_time" ? "12 or older" : "13+", stmts, missing, notes);
}

function finish(t: PastedTable, version: Ranking["version"] | "mysql", list: Stmt[], missing: string[], notes: string[]): Ranking {
  const engine: Engine = version === "mysql" ? "mysql" : "postgres";
  const stmts = list.filter((s) => s.calls > 0 || s.totalMs > 0);
  if (!stmts.length) throw new Error("No statements with calls in the pasted rows.");

  const totalMs = stmts.reduce((a, s) => a + s.totalMs, 0) || 1;
  const totalRead = stmts.reduce((a, s) => a + s.read, 0);
  const totalWal = stmts.reduce((a, s) => a + (s.walBytes ?? 0), 0);
  stmts.sort((a, b) => b.totalMs - a.totalMs);
  let cum = 0;
  for (const s of stmts) (s.share = s.totalMs / totalMs), (cum += s.share), (s.cumShare = cum);
  [...stmts].sort((a, b) => b.meanMs - a.meanMs).forEach((s, i) => (s.rankByMean = i + 1));

  for (const s of stmts) {
    const f = s.flags;
    const pct = (x: number) => `${(x * 100).toFixed(x >= 0.1 ? 0 : 1)}%`;
    if (CONTROL.test(s.query)) {
      f.push({ id: "control", label: "transaction control", detail: "BEGIN, COMMIT, SET and the like. Their time is round trips, not work; nothing to tune here except fewer round trips." });
      continue;
    }
    if (s.share >= 0.2) f.push({ id: "share", label: `${pct(s.share)} of all time`, detail: `This one statement takes ${pct(s.share)} of the time the database spent on everything listed. Making it 2x faster saves more than removing most of the rest.` });
    if (isSelect(s.query) && !isAggregate(s.query) && s.calls >= 1000 && s.rowsPerCall <= 1 && s.meanMs < 1)
      f.push({ id: "nplus1", label: "many one-row calls", detail: `${fmtInt(s.calls)} calls returning ${s.rowsPerCall < 1 ? "at most one row" : "one row"} each. If they come from a loop in the app (N+1), one query with WHERE id = ANY($1) or a join does the same work in one round trip; each call here is fast, the count is the cost.` });
    const scan = s.examinedPerRow != null && s.examined != null && s.examinedPerRow >= 1000 && s.examined / Math.max(1, s.calls) >= 10_000;
    if (scan)
      f.push({ id: "scan", label: `${fmtInt(s.examinedPerRow!)} rows read per row`, detail: `Each call examines ${fmtInt(s.examined! / Math.max(1, s.calls))} rows to send or change ${s.rowsPerCall < 10 ? s.rowsPerCall.toFixed(Number.isInteger(s.rowsPerCall) ? 0 : 1) : fmtInt(s.rowsPerCall)}${s.noIndexCalls ? `, and ${s.noIndexCalls === s.calls ? "every call" : `${fmtInt(s.noIndexCalls)} of ${fmtInt(s.calls)} calls`} did a full table or index scan` : ""}. That's the sign of a missing index for this query's WHERE (and ORDER BY), or a LIKE '%...' no index can serve. EXPLAIN it with real values.` });
    if (!scan && isSelect(s.query) && !isAggregate(s.query) && s.rowsPerCall <= 1 && s.meanMs >= 5 && s.calls >= 10)
      f.push({ id: "noindex", label: "slow single-row lookup", detail: `${fmtMs(s.meanMs)} per call for ${s.rowsPerCall <= 0 ? "no rows" : "one row"}. A lookup that returns one row should take well under a millisecond with a matching index; this looks like a scan. Run EXPLAIN on it.` });
    if (s.meanMs >= 500) f.push({ id: "slow", label: "slow per call", detail: `${fmtMs(s.meanMs)} per call, ${fmtInt(s.calls)} call${s.calls === 1 ? "" : "s"}. ${s.share < 0.05 ? "Slow, but a small share of total time: fix it if a user waits on it, not to lower the load." : "Slow and a large share of the total: worth tuning first."}` });
    if (s.read > 0 && (s.readPerCall * BLOCK >= 8 << 20 || (totalRead > 0 && s.read / totalRead >= 0.25 && (s.hitRatio ?? 1) < 0.9)))
      f.push({ id: "io", label: "reads from disk", detail: `${fmtBytes(s.readPerCall * BLOCK)} read from outside shared_buffers per call${s.hitRatio != null ? `, ${(s.hitRatio * 100).toFixed(0)}% cache hits` : ""}${totalRead ? `; ${pct(s.read / totalRead)} of all blocks read` : ""}. These reads come from the OS cache or disk. Fewer pages touched (an index, a narrower range) helps more than more memory.` });
    if (s.tmpDisk > 0) f.push({ id: "temp", label: "spills to disk", detail: `${fmtInt(s.tmpDisk)} on-disk temporary tables or sort merge passes: a GROUP BY, DISTINCT or sort didn't fit in memory (tmp_table_size, sort_buffer_size). EXPLAIN ANALYZE shows which step; fewer rows in, or an index that gives the order, helps more than bigger buffers.` });
    if (s.tempWritten > 0) f.push({ id: "temp", label: "spills to disk", detail: `${fmtBytes((s.tempWritten * BLOCK) / Math.max(1, s.calls))} of temp files written per call: a sort or hash didn't fit in work_mem. EXPLAIN ANALYZE shows which node; raise work_mem for this query or need fewer rows.` });
    if (s.walPerCall != null && (s.walPerCall >= 1 << 20 || (totalWal > 0 && (s.walBytes ?? 0) / totalWal >= 0.5)))
      f.push({ id: "wal", label: "heavy WAL", detail: `${fmtBytes(s.walPerCall)} of WAL per call${totalWal ? `, ${pct((s.walBytes ?? 0) / totalWal)} of all WAL` : ""}. WAL is what replicas and backups have to carry. ${s.walPerCall >= 1 << 20 ? "A big write per call: split it into batches and check that every updated column needs updating." : "Small per call but it adds up: updates that touch indexed columns can't be HOT and write every index, and wide rows write more."}` });
  }

  const meanTop = [...stmts].filter((s) => !CONTROL.test(s.query)).sort((a, b) => b.meanMs - a.meanMs)[0] ?? null;
  const top5Share = stmts.slice(0, 5).reduce((a, s) => a + s.share, 0);
  return { format: t.format, engine, version: version === "mysql" ? "MySQL 8 performance_schema" : version, stmts, totalMs, top5Share, missing, meanTop, notes };
}

/** EXPLAIN statements to copy for one query: GENERIC_PLAN (PostgreSQL 16+) works with the $1 placeholders as they are. */
export function explainFor(query: string, engine: Engine = "postgres") {
  const q = query.trim().replace(/;\s*$/, "");
  if (engine === "mysql") {
    // a digest has ? where the values were; EXPLAIN ANALYZE runs the query, so it needs real values
    const hasParams = /\?/.test(q.replace(/'[^']*'/g, ""));
    return { generic: `EXPLAIN FORMAT=TREE\n${q};`, analyze: `EXPLAIN ANALYZE\n${q};`, hasParams };
  }
  const hasParams = /\$\d+/.test(q);
  return {
    generic: hasParams ? `EXPLAIN (GENERIC_PLAN)\n${q};` : `EXPLAIN\n${q};`,
    analyze: `EXPLAIN (ANALYZE, BUFFERS)\n${q};`,
    hasParams,
  };
}
