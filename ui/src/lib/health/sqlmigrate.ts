// Checks for a migration file: index and constraint changes that take a long lock on a big table, and the form that
// doesn't. PostgreSQL: lock modes, checked on PostgreSQL 18 (change-requests/CR-0190-screens/migrate in the ops repo).
// MySQL: the algorithm MySQL 8.4 picks for each ALTER TABLE (INSTANT, INPLACE or COPY), checked by running every case
// on MySQL 8.4 with ALGORITHM= and LOCK= (CR-0205-screens/mysql). Works on the text (statements split outside strings
// and comments), not on a parser's AST, so it still runs on files the parser rejects. Nothing is run and nothing
// leaves the browser.

export type MigrationFinding = {
  level: "stop" | "check" | "note";
  line: number;
  title: string;
  detail: string;
  /** The safer way to write it. */
  safe?: string;
  link?: { label: string; href: string };
  /** MySQL: the algorithm and lock MySQL 8.4 uses, and whether the table is rebuilt. */
  algorithm?: { algo: MysqlAlgo; lock: "NONE" | "SHARED" | null; rebuild: boolean };
};

export type MigrationDialect = "postgresql" | "mysql";
export type MysqlAlgo = "INSTANT" | "INPLACE" | "COPY";
export const MIGRATION_DIALECTS: string[] = ["postgresql", "mysql"];

export const INVALID_INDEX_ARTICLE = "https://pilotbase.pro/articles/postgres-invalid-indexes-find-drop-rebuild";
export const UNUSED_INDEX_ARTICLE = "https://pilotbase.pro/articles/postgres-unused-duplicate-indexes-drop-safely";
export const VIRTUAL_COLUMNS_ARTICLE = "https://pilotbase.pro/articles/postgres-18-virtual-generated-columns";

type Statement = { text: string; line: number };

/** Statements with comments removed, split on ; outside quotes and dollar-quoted bodies (MySQL: backticks, # comments, backslash escapes). */
export function splitStatements(sql: string, dialect: MigrationDialect = "postgresql"): Statement[] {
  const my = dialect === "mysql";
  const out: Statement[] = [];
  let buf = "";
  let line = 1;
  let start = 0;
  const push = () => {
    if (buf.trim()) out.push({ text: buf.trim().replace(/\s+/g, " "), line: start });
    buf = "";
    start = 0;
  };
  const add = (s: string) => {
    if (!start && s.trim()) start = line;
    buf += s;
    line += s.split("\n").length - 1;
  };
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const two = sql.slice(i, i + 2);
    if (two === "--" || (my && c === "#")) {
      const end = sql.indexOf("\n", i);
      i = end < 0 ? sql.length : end;
    } else if (two === "/*") {
      const end = sql.indexOf("*/", i + 2);
      const skipped = sql.slice(i, end < 0 ? sql.length : end + 2);
      line += skipped.split("\n").length - 1;
      buf += " ";
      i += skipped.length;
    } else if (c === "'" || c === '"' || (my && c === "`")) {
      let j = i + 1;
      while (j < sql.length && (sql[j] !== c || sql[j + 1] === c)) j += sql[j] === c || (my && c !== "`" && sql[j] === "\\") ? 2 : 1;
      add(sql.slice(i, j + 1));
      i = j + 1;
    } else if (c === "$" && !my) {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i, i + 64))?.[0];
      const end = tag ? sql.indexOf(tag, i + tag.length) : -1;
      if (tag && end >= 0) {
        add(sql.slice(i, end + tag.length));
        i = end + tag.length;
      } else {
        add(c);
        i++;
      }
    } else if (c === ";") {
      push();
      i++;
    } else {
      add(c);
      i++;
    }
  }
  push();
  return out;
}

const IDENT = String.raw`(?:"[^"]+"|\`[^\`]+\`|[\w$]+)(?:\.(?:"[^"]+"|\`[^\`]+\`|[\w$]+))?`;
const bare = (name: string) => name.replace(/["`]/g, "").split(".").pop()!.toLowerCase();
const VOLATILE_DEFAULT = /\bDEFAULT\s+\(?\s*(random|gen_random_uuid|uuidv4|uuidv7|uuid_generate_v\d|clock_timestamp|timeofday|nextval)\s*\(/i;

/** True when the SQL has at least one statement these checks know about. */
export const looksLikeMigration = (sql: string) => /\b(CREATE\s+(UNIQUE\s+)?INDEX|DROP\s+INDEX|REINDEX|ALTER\s+TABLE)\b/i.test(sql);

export function checkMigration(sql: string, dialect: MigrationDialect = "postgresql"): MigrationFinding[] {
  if (dialect === "mysql") return checkMysql(sql);
  const findings: MigrationFinding[] = [];
  const created = new Set<string>(); // tables made in this file: empty, so their DDL is quick
  const notValid = new Map<string, number>(); // constraint name -> transaction it was added in
  const notNullChecks = new Map<string, { table: string; col: string; valid: boolean }>(); // CHECK (col IS NOT NULL) by name
  let inTx = false;
  let tx = 0;
  let lockTimeout = false;
  let statementTimeout = false;
  let warnedTimeout = false;

  const add = (f: MigrationFinding) => findings.push(f);

  for (const { text, line } of splitStatements(sql)) {
    let m: RegExpExecArray | null;
    if (/^(BEGIN|START\s+TRANSACTION)\b/i.test(text)) { inTx = true; tx++; continue; }
    if (/^(COMMIT|END|ROLLBACK)\b/i.test(text) && !/^ROLLBACK\s+TO\b/i.test(text)) { inTx = false; continue; }
    if (/^SET\s+(LOCAL\s+|SESSION\s+)?lock_timeout\b/i.test(text)) {
      lockTimeout = !/(=|\bTO)\s*'?0'?\s*$/i.test(text) && !/\bDEFAULT\s*$/i.test(text);
      continue;
    }
    if (/^SET\s+(LOCAL\s+|SESSION\s+)?statement_timeout\b/i.test(text)) {
      statementTimeout = !/(=|\bTO)\s*'?0'?\s*$/i.test(text) && !/\bDEFAULT\s*$/i.test(text);
      continue;
    }
    if ((m = new RegExp(String.raw`^CREATE\s+(?:(?:GLOBAL\s+|LOCAL\s+)?(?:TEMP|TEMPORARY)\s+|UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(${IDENT})`, "i").exec(text))) {
      created.add(bare(m[1]));
      continue;
    }

    const needsTimeout = (table: string) => {
      if (lockTimeout || warnedTimeout) return;
      warnedTimeout = true;
      add({
        level: "note",
        line,
        title: "No lock_timeout before the first lock",
        detail: `This statement needs a lock on ${table} that conflicts with every query. If one long query or an open transaction is using the table, the migration waits, and every new query on the table queues up behind the migration: the table is down until the old query ends, however quick the change itself is.`,
        safe: "SET lock_timeout = '5s';   -- fail fast instead of queueing; retry the migration later",
      });
    };

    // ---- CREATE INDEX
    if ((m = new RegExp(String.raw`^CREATE\s+(UNIQUE\s+)?INDEX\s+(CONCURRENTLY\s+)?(IF\s+NOT\s+EXISTS\s+)?(?:(${IDENT})\s+)?ON\s+(ONLY\s+)?(${IDENT})`, "i").exec(text))) {
      const [, , concurrently, ifNotExists, name, , table] = m;
      if (created.has(bare(table))) continue;
      if (!concurrently) {
        add({
          level: "check",
          line,
          title: `CREATE INDEX without CONCURRENTLY on ${table}`,
          detail: `A plain CREATE INDEX holds a SHARE lock on ${table} for the whole build: reads go on, every INSERT, UPDATE and DELETE waits. On a table of a few million rows that is seconds; on a big one, minutes.`,
          safe: text.replace(/\bINDEX\b/i, "INDEX CONCURRENTLY") + ";   -- outside a transaction",
        });
        continue;
      }
      if (inTx)
        add({
          level: "stop",
          line,
          title: "CREATE INDEX CONCURRENTLY inside a transaction",
          detail: "PostgreSQL refuses it: \"CREATE INDEX CONCURRENTLY cannot run inside a transaction block\". Many migration tools wrap each file in a transaction; this statement needs the tool's no-transaction switch, or a file of its own.",
        });
      if (lockTimeout || statementTimeout)
        add({
          level: "check",
          line,
          title: `${lockTimeout ? "lock_timeout" : "statement_timeout"} is set for a concurrent build`,
          detail: "A concurrent build waits, sometimes for a long time, for transactions that were open when it started. It blocks nobody while it waits, but lock_timeout and statement_timeout both apply to that wait: when one fires, the build is cancelled and its index stays behind INVALID, often complete and maintained on every write. Turn both off for this statement.",
          safe: "SET lock_timeout = 0;\nSET statement_timeout = 0;",
          link: { label: "Invalid indexes: find them and clear them", href: INVALID_INDEX_ARTICLE },
        });
      add(
        ifNotExists
          ? {
              level: "check",
              line,
              title: `IF NOT EXISTS can skip a broken ${name ?? "index"}`,
              detail: "If a concurrent build fails or is cancelled, the index stays behind marked INVALID. On the next run IF NOT EXISTS sees the name, prints a notice and skips, so the migration passes and the index is never built. Check pg_index.indisvalid after the build, or drop the invalid index first.",
              safe: name ? `DROP INDEX CONCURRENTLY IF EXISTS ${name};   -- only when it is invalid; then build it again` : undefined,
              link: { label: "Invalid indexes: find them and clear them", href: INVALID_INDEX_ARTICLE },
            }
          : {
              level: "note",
              line,
              title: "A failed concurrent build leaves an invalid index",
              detail: "If this is cancelled, times out or hits a duplicate, the index stays in the table marked INVALID, the name is taken and a rerun fails with \"already exists\". Drop it (DROP INDEX CONCURRENTLY) before trying again.",
              link: { label: "Invalid indexes: find them and clear them", href: INVALID_INDEX_ARTICLE },
            },
      );
      continue;
    }

    // ---- DROP INDEX / REINDEX
    if ((m = /^DROP\s+INDEX\s+(CONCURRENTLY\s+)?/i.exec(text))) {
      if (m[1]) {
        if (inTx) add({ level: "stop", line, title: "DROP INDEX CONCURRENTLY inside a transaction", detail: "PostgreSQL refuses it: \"DROP INDEX CONCURRENTLY cannot run inside a transaction block\". Run it outside BEGIN ... COMMIT, in a file your migration tool does not wrap in a transaction." });
      } else {
        add({
          level: "check",
          line,
          title: "DROP INDEX without CONCURRENTLY",
          detail: "A plain DROP INDEX takes an ACCESS EXCLUSIVE lock on the index's table. The drop itself is instant, but it waits for every running query on the table, and every new query waits behind it.",
          safe: text.replace(/^DROP\s+INDEX\b/i, "DROP INDEX CONCURRENTLY") + ";   -- outside a transaction, one index per statement",
          link: { label: "Dropping an index safely", href: UNUSED_INDEX_ARTICLE },
        });
      }
      continue;
    }
    if ((m = /^REINDEX\s+(?:\([^)]*\)\s*)?(INDEX|TABLE|SCHEMA|DATABASE|SYSTEM)\s+(CONCURRENTLY\s+)?/i.exec(text))) {
      const concurrently = m[2] || /^REINDEX\s+\([^)]*\bCONCURRENTLY\b/i.test(text);
      if (!concurrently)
        add({
          level: "check",
          line,
          title: `REINDEX ${m[1].toUpperCase()} without CONCURRENTLY`,
          detail: "A plain REINDEX blocks writes to the table for the whole rebuild, and reads that would use the index wait too.",
          safe: text.replace(new RegExp(String.raw`\b(${m[1]})\b`, "i"), "$1 CONCURRENTLY") + ";   -- outside a transaction",
        });
      else if (inTx) add({ level: "stop", line, title: "REINDEX CONCURRENTLY inside a transaction", detail: "PostgreSQL refuses it: \"REINDEX CONCURRENTLY cannot run inside a transaction block\"." });
      else if (/INDEX/i.test(m[1])) add({ level: "note", line, title: "A failed REINDEX CONCURRENTLY leaves a _ccnew index", detail: "If the rebuild is cancelled or fails, the half-built copy stays behind as an invalid index with the suffix _ccnew, next to the original. Drop it before trying again.", link: { label: "Invalid indexes: find them and clear them", href: INVALID_INDEX_ARTICLE } });
      continue;
    }

    // ---- ALTER TABLE
    if ((m = new RegExp(String.raw`^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(${IDENT})\s+(.*)$`, "i").exec(text))) {
      const table = m[1];
      const body = m[2];
      if (created.has(bare(table))) continue;
      const validate = /\bVALIDATE\s+CONSTRAINT\s+("[^"]+"|[\w$]+)/i.exec(body);
      if (validate) {
        const nn = notNullChecks.get(bare(validate[1]));
        if (nn) nn.valid = true;
        if (inTx && notValid.get(bare(validate[1])) === tx)
          add({
            level: "check",
            line,
            title: `VALIDATE CONSTRAINT in the same transaction as NOT VALID`,
            detail: "Adding the constraint NOT VALID takes its lock for an instant, but a lock is held until COMMIT. Validating in the same transaction keeps that lock for the whole scan, which is what NOT VALID was meant to avoid. Commit between the two steps.",
          });
        continue; // VALIDATE alone takes SHARE UPDATE EXCLUSIVE: reads and writes go on
      }
      const hasNotValid = /\bNOT\s+VALID\b/i.test(body);
      const constraint = /\bADD\s+CONSTRAINT\s+("[^"]+"|[\w$]+)/i.exec(body)?.[1];
      if (hasNotValid && constraint) notValid.set(bare(constraint), inTx ? tx : -1);
      const nnCheck = /\bADD\s+CONSTRAINT\s+("[^"]+"|[\w$]+)\s+CHECK\s*\(\s*\(?\s*("[^"]+"|[\w$]+)\s*\)?\s+IS\s+NOT\s+NULL\s*\)/i.exec(body);
      if (nnCheck) notNullChecks.set(bare(nnCheck[1]), { table: bare(table), col: bare(nnCheck[2]), valid: !hasNotValid });
      for (const d of body.matchAll(/\bDROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?("[^"]+"|[\w$]+)/gi)) notNullChecks.delete(bare(d[1]));
      const flag = (f: Omit<MigrationFinding, "line">) => add({ ...f, line });

      const setNotNull = /\bALTER\s+(?:COLUMN\s+)?("[^"]+"|[\w$]+)\s+SET\s+NOT\s+NULL\b/i.exec(body);
      // a validated CHECK (col IS NOT NULL) earlier in the file lets PostgreSQL skip the scan
      if (setNotNull && ![...notNullChecks.values()].some((c) => c.valid && c.table === bare(table) && c.col === bare(setNotNull[1]))) {
        const col = setNotNull[1];
        const c = `${bare(table)}_${bare(col)}_not_null`;
        flag({
          level: "check",
          title: `SET NOT NULL on ${table}.${col}`,
          detail: `PostgreSQL reads every row of ${table} to prove there is no NULL, holding an ACCESS EXCLUSIVE lock: no reads and no writes until the scan ends. If a validated CHECK (${col} IS NOT NULL) already exists, the scan is skipped. (PostgreSQL 18 can also do it in two steps directly: ADD CONSTRAINT ... NOT NULL ${col} NOT VALID, then VALIDATE CONSTRAINT.)`,
          safe: `ALTER TABLE ${table} ADD CONSTRAINT ${c} CHECK (${col} IS NOT NULL) NOT VALID;\nALTER TABLE ${table} VALIDATE CONSTRAINT ${c};   -- scans without blocking reads or writes\nALTER TABLE ${table} ALTER COLUMN ${col} SET NOT NULL;   -- instant now\nALTER TABLE ${table} DROP CONSTRAINT ${c};`,
        });
      }
      if (/\bFOREIGN\s+KEY\b/i.test(body) && /\bREFERENCES\b/i.test(body) && !hasNotValid) {
        const ref = new RegExp(String.raw`\bREFERENCES\s+(${IDENT})`, "i").exec(body)?.[1] ?? "the referenced table";
        flag({
          level: "check",
          title: `ADD FOREIGN KEY without NOT VALID on ${table}`,
          detail: `Every existing row is checked against ${ref} while a SHARE ROW EXCLUSIVE lock is held on both tables: reads go on, but no INSERT, UPDATE or DELETE on ${table} or ${ref} until the check ends.`,
          safe: `${text.replace(/\s*$/, "")} NOT VALID;\nALTER TABLE ${table} VALIDATE CONSTRAINT ${constraint ?? "<constraint name>"};   -- separate transaction; writes go on`,
        });
      } else if (/\bADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?("[^"]+"|[\w$]+)\s+[^,]*\bREFERENCES\b/i.test(body) && !/\bFOREIGN\s+KEY\b/i.test(body)) {
        flag({
          level: "note",
          title: `New column with REFERENCES on ${table}`,
          detail: "Fine while the new column is all NULL (nothing to check), but the SHARE ROW EXCLUSIVE lock on both tables still has to be granted. With a DEFAULT, every row is checked under that lock.",
        });
      }
      if (/\bADD\s+(?:CONSTRAINT\s+(?:"[^"]+"|[\w$]+)\s+)?CHECK\s*\(/i.test(body) && !hasNotValid)
        flag({
          level: "check",
          title: `ADD CHECK without NOT VALID on ${table}`,
          detail: `Every row of ${table} is checked under an ACCESS EXCLUSIVE lock: no reads and no writes until the scan ends.`,
          safe: `${text.replace(/\s*$/, "")} NOT VALID;\nALTER TABLE ${table} VALIDATE CONSTRAINT ${constraint ?? "<constraint name>"};   -- separate transaction; reads and writes go on`,
        });
      const key = /\bADD\s+(?:CONSTRAINT\s+("[^"]+"|[\w$]+)\s+)?(PRIMARY\s+KEY|UNIQUE)\b(?!\s+USING\s+INDEX)/i.exec(body);
      if (key) {
        const unique = /UNIQUE/i.test(key[2]);
        const idx = key[1] ?? `${bare(table)}_${unique ? "key" : "pkey"}`;
        flag({
          level: "check",
          title: `ADD ${unique ? "UNIQUE" : "PRIMARY KEY"} builds its index under lock on ${table}`,
          detail: `The index behind the constraint is built while ${table} is locked ACCESS EXCLUSIVE: no reads and no writes for the whole build.`,
          safe: `CREATE UNIQUE INDEX CONCURRENTLY ${idx} ON ${table} (...);   -- outside a transaction\nALTER TABLE ${table} ADD CONSTRAINT ${idx} ${unique ? "UNIQUE" : "PRIMARY KEY"} USING INDEX ${idx};`,
        });
      }
      const retype = /\bALTER\s+(?:COLUMN\s+)?("[^"]+"|[\w$]+)\s+(?:SET\s+DATA\s+)?TYPE\s+/i.exec(body);
      if (retype)
        flag({
          level: "check",
          title: `Type change on ${table}.${retype[1]}`,
          detail: `Most type changes rewrite the whole table and every index on it under an ACCESS EXCLUSIVE lock. A few don't (varchar(n) to a longer varchar or to text, numeric to a wider precision). For the rest: add a new column, backfill in batches, swap the names.`,
        });
      if (/\bADD\s+(?:COLUMN\s+)?[^,]*\bGENERATED\s+ALWAYS\s+AS\s*\(.*\)\s*STORED\b/i.test(body))
        flag({
          level: "check",
          title: `Stored generated column rewrites ${table}`,
          detail: `Adding a STORED generated column computes it for every row and rewrites the table under an ACCESS EXCLUSIVE lock. From PostgreSQL 18 a VIRTUAL generated column is added instantly and computed when read (it cannot be indexed).`,
          link: { label: "Virtual generated columns in Postgres 18", href: VIRTUAL_COLUMNS_ARTICLE },
        });
      else if (/\bADD\s+(?:COLUMN\s+)?/i.test(body) && VOLATILE_DEFAULT.test(body))
        flag({
          level: "check",
          title: `New column with a volatile default rewrites ${table}`,
          detail: `A constant default is stored once in the catalog and the column appears instantly. A default that differs per row (random(), clock_timestamp(), a new uuid, a sequence) has to be written into every row, so the table is rewritten under an ACCESS EXCLUSIVE lock. Add the column without the default, set the default for new rows, then backfill in batches.`,
        });
      needsTimeout(table); // quick or not, every ALTER TABLE has to be granted its lock first
      continue;
    }
  }

  const order = { stop: 0, check: 1, note: 2 };
  return findings.sort((a, b) => order[a.level] - order[b.level] || a.line - b.line);
}

// ---------------------------------------------------------------- MySQL
// What MySQL 8.4 does for each ALTER TABLE action, from running each one with ALGORITHM= and LOCK= on a real 8.4.
// Without an ALGORITHM clause MySQL takes the best one the action allows, and one action in a statement that can't be
// INSTANT makes the whole statement INPLACE or COPY. On 2M rows: INSTANT ~0.01 s; adding an index in place 1 s with
// writes going on; COPY (int to bigint, a STORED generated column, a CHECK, a foreign key) 5-12 s with every write
// waiting until the end.

type MyAction = { algo: MysqlAlgo; lock: "NONE" | "SHARED" | null; rebuild: boolean; what: string; instantAdd?: boolean; stop?: string; safe?: string };
const RANK = (a: MyAction) => (a.algo === "COPY" ? 4 : a.algo === "INSTANT" ? 0 : a.lock === "SHARED" ? 3 : a.rebuild ? 2 : 1);
const MY_NONDETERMINISTIC = /\bDEFAULT\s*\(\s*(rand|uuid|uuid_short|sysdate)\s*\(/i;

/** Splits on commas outside parentheses and quotes. */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      while (j < s.length && s[j] !== c) j += s[j] === "\\" && c !== "`" ? 2 : 1;
      cur += s.slice(i, j + 1);
      i = j;
      continue;
    }
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const COPY_TYPE_RULES =
  "INSTANT: same type with a new name, default or comment, or ENUM/SET values added at the end. INPLACE, writes go on: a longer VARCHAR that stays on the same side of 255 bytes (varchar(63) or less in utf8mb4). INPLACE with a rebuild: NULL to NOT NULL or back, moving the column (FIRST/AFTER). COPY, writes wait: every other type change (int to bigint, a shorter VARCHAR, crossing 255 bytes, text to mediumtext, datetime to timestamp, decimal precision, a column character set).";

function classifyMysql(action: string, fkChecksOff: boolean, whole: string, table: string): MyAction | null {
  const a = action.trim();
  const col = (re: RegExp) => re.exec(a)?.[1] ?? "";
  if (/^(ALGORITHM|LOCK)\b/i.test(a)) return null;
  // ---- columns
  if (/^ADD\s+(?:COLUMN\s+)?(?!(?:CONSTRAINT|INDEX|KEY|UNIQUE|FULLTEXT|SPATIAL|PRIMARY|FOREIGN|CHECK|PARTITION)\b)/i.test(a)) {
    const name = col(/^ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(`[^`]+`|[\w$]+)/i);
    if (/\b(?:GENERATED\s+ALWAYS\s+)?AS\s*\(.*\)\s*STORED\b/i.test(a))
      return { algo: "COPY", lock: "SHARED", rebuild: true, what: `ADD COLUMN ${name}, a STORED generated column`, safe: "virtual" };
    if (/\bAUTO_INCREMENT\b/i.test(a)) return { algo: "INPLACE", lock: "SHARED", rebuild: true, what: `ADD COLUMN ${name} AUTO_INCREMENT` };
    if (MY_NONDETERMINISTIC.test(a))
      return { algo: "COPY", lock: "SHARED", rebuild: true, what: `ADD COLUMN ${name} with a per-row default`, stop: `MySQL refuses it while binary logging is on (the default in 8.4): "Statement is unsafe because it uses a system function that may return a different value on the replica". With the binary log off it copies the table. Add the column without the default, fill it in batches, then set the default.` };
    const def = /\bDEFAULT\s*(\(.*\))/i.exec(a);
    if (def)
      return { algo: "COPY", lock: "SHARED", rebuild: true, what: `ADD COLUMN ${name} with an expression default`, safe: `ALTER TABLE ${table} ${a.replace(/\s*\bDEFAULT\s*\(.*\)/i, "")};   -- instant\nALTER TABLE ${table} ALTER COLUMN ${name} SET DEFAULT ${def[1]};   -- instant; old rows stay NULL, fill them in batches` };
    return { algo: "INSTANT", lock: null, rebuild: false, what: `ADD COLUMN ${name}`, instantAdd: true };
  }
  if (/^DROP\s+(?:COLUMN\s+)?(?!(?:INDEX|KEY|PRIMARY|FOREIGN|CHECK|CONSTRAINT|PARTITION)\b)/i.test(a))
    return { algo: "INSTANT", lock: null, rebuild: false, what: `DROP COLUMN ${col(/^DROP\s+(?:COLUMN\s+)?(?:IF\s+EXISTS\s+)?(`[^`]+`|[\w$]+)/i)}`, instantAdd: true };
  if (/^RENAME\s+COLUMN\b/i.test(a)) return { algo: "INSTANT", lock: null, rebuild: false, what: `RENAME COLUMN ${col(/^RENAME\s+COLUMN\s+(`[^`]+`|[\w$]+)/i)}` };
  if (/^ALTER\s+(?:COLUMN\s+)?(?!INDEX\b)(`[^`]+`|[\w$]+)\s+(SET\s+DEFAULT|DROP\s+DEFAULT)\b/i.test(a))
    return { algo: "INSTANT", lock: null, rebuild: false, what: `ALTER COLUMN ${col(/^ALTER\s+(?:COLUMN\s+)?(`[^`]+`|[\w$]+)/i)} ${/DROP\s+DEFAULT/i.test(a) ? "DROP" : "SET"} DEFAULT` };
  if (/^(MODIFY|CHANGE)\b/i.test(a)) {
    const name = col(/^(?:MODIFY|CHANGE)\s+(?:COLUMN\s+)?(`[^`]+`|[\w$]+)/i);
    if (/\b(?:GENERATED\s+ALWAYS\s+)?AS\s*\(.*\)\s*STORED\b/i.test(a)) return { algo: "COPY", lock: "SHARED", rebuild: true, what: `${a.split(/\s/)[0].toUpperCase()} ${name} to a STORED generated column` };
    // the old definition isn't in the file: the algorithm depends on it
    return { algo: "COPY", lock: "SHARED", rebuild: true, what: `${a.split(/\s/)[0].toUpperCase()} ${name}`, stop: "depends" };
  }
  // ---- indexes and keys
  if (/^ADD\s+FULLTEXT\b/i.test(a)) return { algo: "INPLACE", lock: "SHARED", rebuild: true, what: "ADD FULLTEXT INDEX" };
  if (/^ADD\s+SPATIAL\b/i.test(a)) return { algo: "INPLACE", lock: "SHARED", rebuild: false, what: "ADD SPATIAL INDEX" };
  if (/^ADD\s+(?:CONSTRAINT\s+(?:`[^`]+`|[\w$]+)\s+)?PRIMARY\s+KEY\b/i.test(a)) return { algo: "INPLACE", lock: "NONE", rebuild: true, what: "ADD PRIMARY KEY" };
  if (/^DROP\s+PRIMARY\s+KEY\b/i.test(a))
    return /\bADD\s+(?:CONSTRAINT\s+(?:`[^`]+`|[\w$]+)\s+)?PRIMARY\s+KEY\b/i.test(whole)
      ? { algo: "INPLACE", lock: "NONE", rebuild: true, what: "DROP PRIMARY KEY" }
      : { algo: "COPY", lock: "SHARED", rebuild: true, what: "DROP PRIMARY KEY without adding a new one" };
  if (/^ADD\s+(?:CONSTRAINT\s+(?:`[^`]+`|[\w$]+)\s+)?FOREIGN\s+KEY\b/i.test(a))
    return fkChecksOff
      ? { algo: "INPLACE", lock: "NONE", rebuild: false, what: "ADD FOREIGN KEY (foreign_key_checks off)" }
      : { algo: "COPY", lock: "SHARED", rebuild: true, what: "ADD FOREIGN KEY" };
  if (/^ADD\s+(?:CONSTRAINT\s+(?:`[^`]+`|[\w$]+)\s+)?CHECK\s*\(/i.test(a))
    return /\bNOT\s+ENFORCED\s*$/i.test(a)
      ? { algo: "INSTANT", lock: null, rebuild: false, what: "ADD CHECK ... NOT ENFORCED" }
      : { algo: "COPY", lock: "SHARED", rebuild: true, what: "ADD CHECK" };
  if (/^ADD\s+(?:CONSTRAINT\s+(?:`[^`]+`|[\w$]+)\s+)?(?:UNIQUE|INDEX|KEY)\b/i.test(a)) return { algo: "INPLACE", lock: "NONE", rebuild: false, what: /UNIQUE/i.test(a) ? "ADD UNIQUE INDEX" : "ADD INDEX" };
  if (/^DROP\s+(INDEX|KEY|FOREIGN\s+KEY)\b/i.test(a)) return { algo: "INPLACE", lock: "NONE", rebuild: false, what: `DROP ${/FOREIGN/i.test(a) ? "FOREIGN KEY" : "INDEX"}` };
  if (/^DROP\s+CHECK\b/i.test(a)) return { algo: "INSTANT", lock: null, rebuild: false, what: "DROP CHECK" };
  // DROP CONSTRAINT may name a CHECK (instant), a foreign key or a unique key (in place): INPLACE covers all three
  if (/^DROP\s+CONSTRAINT\b/i.test(a)) return { algo: "INPLACE", lock: "NONE", rebuild: false, what: "DROP CONSTRAINT" };
  if (/^RENAME\s+(INDEX|KEY)\b/i.test(a)) return { algo: "INPLACE", lock: "NONE", rebuild: false, what: "RENAME INDEX" };
  if (/^ALTER\s+INDEX\b.*\b(IN)?VISIBLE$/i.test(a)) return { algo: "INPLACE", lock: "NONE", rebuild: false, what: "ALTER INDEX ... VISIBLE/INVISIBLE" };
  // ---- table options
  if (/^CONVERT\s+TO\s+(CHARACTER\s+SET|CHARSET)\b/i.test(a)) return { algo: "COPY", lock: "SHARED", rebuild: true, what: "CONVERT TO CHARACTER SET" };
  if (/^(DEFAULT\s+)?(CHARACTER\s+SET|CHARSET|COLLATE)\b/i.test(a)) return { algo: "INPLACE", lock: "NONE", rebuild: false, what: "default character set (new columns only)" };
  if (/^(ENGINE|ROW_FORMAT|KEY_BLOCK_SIZE)\s*=?|^FORCE$/i.test(a)) return { algo: "INPLACE", lock: "NONE", rebuild: true, what: a.split(/\s*=\s*|\s+/)[0].toUpperCase() };
  if (/^(AUTO_INCREMENT|COMMENT)\s*=?/i.test(a)) return { algo: "INPLACE", lock: "NONE", rebuild: false, what: a.split(/\s*=\s*|\s+/)[0].toUpperCase() };
  if (/^RENAME(\s+(TO|AS))?\s/i.test(a)) return { algo: "INSTANT", lock: null, rebuild: false, what: "RENAME TO" };
  return null;
}

const DDL_IN_STRING = /'((?:ALTER\s+TABLE|CREATE\s+(?:UNIQUE\s+|FULLTEXT\s+|SPATIAL\s+)?INDEX|DROP\s+INDEX)\b(?:[^'\\]|''|\\.)*)'/gi;

/** MySQL has no IF NOT EXISTS for indexes, so migrations often build the DDL as a string for PREPARE
 *  (SET @s = (SELECT IF(..., 'SELECT 1', 'ALTER TABLE ...'))): check the DDL in those strings too, at the SET's line. */
function withPrepared(stmts: Statement[]): Statement[] {
  return stmts.flatMap((st) => {
    if (!/^SET\s+@/i.test(st.text)) return [st];
    const inner = [...st.text.matchAll(DDL_IN_STRING)].map((m) => ({ text: m[1].replace(/''/g, "'").replace(/\\(.)/g, "$1").replace(/\s*;\s*$/, ""), line: st.line }));
    return inner.length ? inner : [st];
  });
}

const guardClause = (x: { algo: MysqlAlgo; lock: "NONE" | "SHARED" | null }) => (x.algo === "INSTANT" ? "ALGORITHM=INSTANT" : `ALGORITHM=${x.algo}, LOCK=${x.lock ?? "NONE"}`);

function checkMysql(sql: string): MigrationFinding[] {
  const findings: MigrationFinding[] = [];
  const created = new Set<string>();
  let fkChecksOff = false;
  let lockWait = false;
  let warnedWait = false;
  let inTx = false;
  let warnedTx = false;
  const add = (f: MigrationFinding) => findings.push(f);

  for (const { text, line } of withPrepared(splitStatements(sql, "mysql"))) {
    let m: RegExpExecArray | null;
    if (/^(BEGIN|START\s+TRANSACTION)\b/i.test(text)) { inTx = true; continue; }
    if (/^(COMMIT|ROLLBACK)\b/i.test(text)) { inTx = false; continue; }
    if ((m = /^SET\s+(?:SESSION\s+|@@(?:session\.)?)?foreign_key_checks\s*=\s*(\S+)/i.exec(text))) { fkChecksOff = /^(0|OFF|'OFF')$/i.test(m[1]); continue; }
    if ((m = /^SET\s+(?:SESSION\s+|@@(?:session\.)?)?lock_wait_timeout\s*=\s*(\S+)/i.exec(text))) { lockWait = Number(m[1]) > 0 && Number(m[1]) < 3600; continue; }
    if ((m = new RegExp(String.raw`^CREATE\s+(?:TEMPORARY\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(${IDENT})`, "i").exec(text))) { created.add(bare(m[1])); continue; }

    let table = "";
    let body = "";
    let kind: "alter" | "create" | "drop" = "alter";
    if ((m = new RegExp(String.raw`^ALTER\s+(?:ONLINE\s+)?(?:IGNORE\s+)?TABLE\s+(${IDENT})\s+(.*)$`, "i").exec(text))) [table, body] = [m[1], m[2]];
    else if ((m = new RegExp(String.raw`^CREATE\s+(?:(UNIQUE|FULLTEXT|SPATIAL)\s+)?INDEX\s+(${IDENT})\s+(?:USING\s+\w+\s+)?ON\s+(${IDENT})\s*(\(.*\))(.*)$`, "i").exec(text))) {
      kind = "create";
      table = m[3];
      body = `ADD ${m[1] ? m[1] + " " : ""}INDEX ${m[2]} ${m[4]}${m[5].replace(/\b(ALGORITHM|LOCK)\s*=?\s*(\w+)/gi, ", $1=$2")}`;
    } else if ((m = new RegExp(String.raw`^DROP\s+INDEX\s+(${IDENT})\s+ON\s+(${IDENT})(.*)$`, "i").exec(text))) {
      kind = "drop";
      table = m[2];
      body = `DROP INDEX ${m[1]}${m[3].replace(/\b(ALGORITHM|LOCK)\s*=?\s*(\w+)/gi, ", $1=$2")}`;
    } else continue;
    if (created.has(bare(table))) continue;

    if (!lockWait && !warnedWait) {
      warnedWait = true;
      add({
        level: "note",
        line,
        title: "No lock_wait_timeout before the first ALTER",
        detail: `Every ALTER, even an INSTANT one, needs an exclusive metadata lock on ${table} for a moment. If an open transaction has touched the table, the ALTER waits, and every new query on the table, reads too, waits behind it. MySQL's default lock_wait_timeout is a year: in our run one open transaction held ${table === "" ? "the table" : table} unreadable for 8 s until it committed. With lock_wait_timeout = 3 the ALTER gave up after 3 s and the queued reads went on.`,
        safe: "SET SESSION lock_wait_timeout = 5;   -- give up instead of queueing every query; retry later",
      });
    }
    if (inTx && !warnedTx) {
      warnedTx = true;
      add({ level: "note", line, title: "DDL inside a transaction commits it", detail: "MySQL can't roll back DDL: every ALTER TABLE, CREATE INDEX and DROP INDEX first commits the open transaction. If a later statement fails, the earlier ones stay applied. Write the migration so it can be run again from the failed statement." });
    }

    const actions = splitTop(body);
    const given = {
      algo: /(?:^|,)\s*ALGORITHM\s*=?\s*(\w+)/i.exec(body)?.[1].toUpperCase(),
      lock: /(?:^|,)\s*LOCK\s*=?\s*(\w+)/i.exec(body)?.[1].toUpperCase(),
    };
    const cls = actions.map((a) => classifyMysql(a, fkChecksOff, body, table)).filter((x): x is MyAction => !!x);
    const unknown = actions.filter((a) => !/^(ALGORITHM|LOCK)\b/i.test(a) && !classifyMysql(a, fkChecksOff, body, table));
    if (!cls.length) {
      if (unknown.length) add({ level: "note", line, title: `Not classified: ${unknown[0].split(/\s+/).slice(0, 3).join(" ")} on ${table}`, detail: "These checks don't know which algorithm MySQL uses for this. Add ALGORITHM=INPLACE, LOCK=NONE (or ALGORITHM=INSTANT): MySQL then refuses the statement instead of copying the table." });
      continue;
    }
    const depends = cls.find((c) => c.stop === "depends");
    const worst = cls.reduce((w, c) => (RANK(c) > RANK(w) ? c : w));
    // one non-instant action takes the instant ADD/DROP COLUMN with it into a rebuild
    const mixed = worst.algo !== "INSTANT" && cls.some((c) => c.instantAdd);
    const res = { algo: worst.algo, lock: worst.lock, rebuild: cls.some((c) => c.rebuild) || mixed };
    const what = cls.map((c) => c.what).join(", ");
    const stripped = text.replace(/\s*,\s*(ALGORITHM|LOCK)\s*=?\s*\w+/gi, "").replace(/\s+(ALGORITHM|LOCK)\s*=?\s*\w+/gi, "");
    const guarded = (x: { algo: MysqlAlgo; lock: "NONE" | "SHARED" | null }) => (kind === "alter" ? `${stripped}, ${guardClause(x)};` : `${stripped} ${guardClause(x).replace(",", "")};`);
    const refuser = cls.find((c) => c.stop && c.stop !== "depends");

    if (refuser) {
      add({ level: "stop", line, title: `${refuser.what} on ${table}`, detail: refuser.stop!, algorithm: res });
      continue;
    }
    // the statement already says which algorithm: does MySQL allow it?
    if (given.algo && given.algo !== "DEFAULT" && !depends) {
      const order = ["INSTANT", "INPLACE", "COPY"];
      const tooStrict = order.indexOf(given.algo) < order.indexOf(res.algo) || (given.algo === "INPLACE" && given.lock === "NONE" && res.lock === "SHARED");
      if (tooStrict) {
        add({ level: "stop", line, title: `MySQL refuses ALGORITHM=${given.algo}${given.lock ? `, LOCK=${given.lock}` : ""} for ${what} on ${table}`, detail: `MySQL 8.4 can do this only as ${guardClause(res)}${res.rebuild ? ", rebuilding the table" : ""}, so the statement fails with "ALGORITHM=${given.algo} is not supported". That is what the clause is for; plan the change another way or accept the slower algorithm.`, algorithm: res });
        continue;
      }
      if (given.algo === "COPY") {
        add({ level: "check", line, title: `ALGORITHM=COPY on ${table}`, detail: `COPY rebuilds ${table} row by row while every INSERT, UPDATE and DELETE waits.${res.algo !== "COPY" ? ` MySQL can do this as ${guardClause(res)}.` : ""}`, safe: res.algo !== "COPY" ? guarded(res) : undefined, algorithm: { algo: "COPY", lock: "SHARED", rebuild: true } });
        continue;
      }
    }

    if (depends) {
      add({
        level: "check",
        line,
        title: `${depends.what} on ${table}: INSTANT, INPLACE or COPY depends on the old type`,
        detail: `${COPY_TYPE_RULES} Add the clause below: MySQL then refuses the statement instead of copying the table.`,
        safe: given.algo ? undefined : guarded({ algo: "INPLACE", lock: "NONE" }),
        algorithm: res,
      });
      continue;
    }
    const guard = given.algo ? undefined : guarded(res);
    if (res.algo === "COPY") {
      const copyDetail: Record<string, string> = {
        "ADD FOREIGN KEY": `With foreign_key_checks on, MySQL copies ${table} to check every row against the parent, and writes wait for the whole copy (11.7 s on 2M rows in our run). With SET foreign_key_checks = 0 it is added in place in about a second, writes going on, but existing rows are not checked: find orphans with a LEFT JOIN first.`,
        "expr default": `Any DEFAULT in parentheses, even DEFAULT ('x') or DEFAULT (CURRENT_DATE), makes MySQL 8.4 copy ${table}, and writes wait until the copy ends. A plain default (DEFAULT 'x', DEFAULT CURRENT_TIMESTAMP) is instant, and so is setting the expression default afterwards.`,
        "ADD CHECK": `MySQL copies ${table} to check every row, and writes wait for the whole copy (7 s on 2M rows in our run). There is no NOT VALID in MySQL: NOT ENFORCED is instant but then the check is not enforced at all. For a big table use an online schema change tool (gh-ost, pt-online-schema-change).`,
      };
      add({
        level: "check",
        line,
        title: `COPY: ${what} on ${table}`,
        detail: copyDetail[worst.what.endsWith("expression default") ? "expr default" : worst.what] ?? `MySQL copies ${table} into a new table, and every INSERT, UPDATE and DELETE waits until the copy ends; reads go on. In our run on 2M rows that was 5-8 s with writes stopped. For a big table use an online schema change tool (gh-ost, pt-online-schema-change), or add a new column, backfill it in batches and swap.`,
        safe: worst.safe && worst.safe !== "virtual" ? worst.safe : worst.safe === "virtual" ? `${stripped.replace(/\bSTORED\b/i, "VIRTUAL")};   -- computed when read, added without a copy (it can still be indexed)` : (worst.what === "ADD FOREIGN KEY" ? `SET foreign_key_checks = 0;\n${stripped};   -- ALGORITHM=INPLACE, LOCK=NONE: existing rows are not checked\nSET foreign_key_checks = 1;` : undefined),
        algorithm: res,
      });
      continue;
    }
    if (res.lock === "SHARED") {
      add({ level: "check", line, title: `INPLACE, LOCK=SHARED: ${what} on ${table}`, detail: `Built in place, but MySQL needs a shared lock for it: reads go on, every INSERT, UPDATE and DELETE on ${table} waits until it ends.${/FULLTEXT/.test(what) ? " The first FULLTEXT index on a table also rebuilds it to add the hidden FTS_DOC_ID column, and afterwards ADD COLUMN on this table copies it instead of being instant." : ""}`, safe: guard, algorithm: res });
      continue;
    }
    if (res.algo === "INPLACE") {
      add({
        level: mixed ? "check" : "note",
        line,
        title: `INPLACE${res.rebuild ? ", rebuilds the table" : ""}: ${what} on ${table}`,
        detail: mixed
          ? `Alone, ${cls.filter((c) => c.instantAdd).map((c) => c.what).join(" and ")} is INSTANT, but MySQL runs a statement with one algorithm: with ${cls.filter((c) => !c.instantAdd).map((c) => c.what).join(" and ")} the whole ${table} is rebuilt (on 2M rows: 4.8 s together, 1.0 s as two statements). Split it into two ALTER TABLE statements.`
          : res.rebuild
            ? `MySQL rebuilds ${table} in place. Writes go on (in our run the slowest write waited 0.4 s), but it reads and writes the whole table, and a replica applies it only after it ends, so replicas fall behind by that long.`
            : `Done in place without copying ${table}: reads and writes go on. Building an index still reads the whole table (1 s for 2M rows in our run), and a replica applies it only after it ends.`,
        safe: guard,
        algorithm: res,
      });
      continue;
    }
    add({ level: "note", line, title: `INSTANT: ${what} on ${table}`, detail: `Only the table's metadata changes, at once, whatever its size.${cls.some((c) => c.what.startsWith("DROP COLUMN")) ? " A column that is part of an index is the exception: dropping it rebuilds the table in place." : ""} It falls back to a rebuild or a copy when the table has a FULLTEXT index or ROW_FORMAT=COMPRESSED, or after 64 instant ADD or DROP COLUMN changes to one table. ALGORITHM=INSTANT makes MySQL refuse instead.`, safe: guard, algorithm: res });
  }

  const order = { stop: 0, check: 1, note: 2 };
  return findings.sort((a, b) => order[a.level] - order[b.level] || a.line - b.line);
}
