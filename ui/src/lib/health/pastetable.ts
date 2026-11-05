// Read a pasted query result into rows of named string columns (CR-0236: statementsRanker, lockTree).
// Accepts CSV (COPY ... CSV HEADER, \copy, exports), tab-separated text (a copied result grid or spreadsheet),
// a JSON array of objects (json_agg), psql's aligned table output and the mysql client's +---+ boxed table (CR-0321). Values stay strings: pg_stat_statements'
// queryid is a 64-bit number that JavaScript numbers would round.

export type PasteFormat = "json" | "psql" | "mysql" | "tsv" | "csv";
export type PastedTable = { format: PasteFormat; columns: string[]; rows: Record<string, string>[] };

const norm = (h: string) => h.trim().replace(/^"|"$/g, "").toLowerCase();

function parseDelimited(text: string, sep: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) row.push(cell), (cell = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell), out.push(row), (row = []), (cell = "");
    } else cell += ch;
  }
  if (cell !== "" || row.length) row.push(cell), out.push(row);
  return out.filter((r) => r.some((c) => c.trim() !== ""));
}

function fromJson(text: string): PastedTable {
  // quote long integers before JSON.parse so they keep every digit
  const safe = text.replace(/([:\[,]\s*)(-?\d{16,})(?=\s*[,}\]])/g, '$1"$2"');
  let data = JSON.parse(safe);
  if (data && !Array.isArray(data) && typeof data === "object") {
    const arr = Object.values(data).find(Array.isArray);
    data = arr ?? [data];
  }
  if (!Array.isArray(data) || !data.length || typeof data[0] !== "object") throw new Error("The JSON should be an array of rows, like the output of json_agg.");
  const columns = [...new Set(data.flatMap((r: object) => Object.keys(r)))].map(norm);
  const rows = data.map((r: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [norm(k), v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)])),
  );
  return { format: "json", columns, rows };
}

function fromPsql(lines: string[], ruleAt: number): PastedTable {
  // column boundaries come from the +'s in the ---+--- rule under the header
  const rule = lines[ruleAt];
  const cuts = [...rule.matchAll(/\+/g)].map((m) => m.index!);
  const split = (line: string) => {
    const cells: string[] = [];
    let start = 0;
    for (const c of cuts) cells.push(line.slice(start, c)), (start = c + 1);
    cells.push(line.slice(start));
    return cells.map((c) => c.replace(/^ /, "").replace(/ ?\|$/, "").trimEnd());
  };
  const columns = split(lines[ruleAt - 1]).map((c) => norm(c.replace(/\|/g, "")));
  const rows: Record<string, string>[] = [];
  let prev: string[] | null = null;
  for (const line of lines.slice(ruleAt + 1)) {
    if (!line.trim() || /^\(\d+ rows?\)$/.test(line.trim())) continue;
    const cells = split(line);
    // a value with a newline continues on the next line; psql ends the cell with '+'
    if (prev && prev.some((c) => c.endsWith("+"))) {
      prev = prev.map((c, i) => (c.endsWith("+") ? c.slice(0, -1).trimEnd() + "\n" + (cells[i] ?? "").trimEnd() : c + (cells[i]?.trim() ? " " + cells[i].trim() : "")));
      rows[rows.length - 1] = Object.fromEntries(columns.map((c, i) => [c, (prev![i] ?? "").trim()]));
      continue;
    }
    prev = cells;
    rows.push(Object.fromEntries(columns.map((c, i) => [c, (cells[i] ?? "").trim()])));
  }
  return { format: "psql", columns, rows };
}

function fromMysqlBox(lines: string[]): PastedTable {
  // the mysql client's table: +----+----+ rules and | a | b | rows; column boundaries from the +'s in the first rule
  const cuts = [...lines[0].matchAll(/\+/g)].map((m) => m.index!);
  const split = (line: string) => cuts.slice(0, -1).map((c, i) => line.slice(c + 1, cuts[i + 1]).trim());
  const body = lines.filter((l) => l.startsWith("|"));
  const columns = split(body[0]).map(norm);
  const rows = body.slice(1).map((l) => Object.fromEntries(columns.map((c, i) => [c, split(l)[i] ?? ""])));
  return { format: "mysql", columns, rows };
}

export function parsePasted(text: string): PastedTable {
  // only blank lines are trimmed at the start: psql's header line begins with alignment spaces
  const t = text.replace(/^﻿/, "").replace(/^(\s*\n)+/, "").trimEnd();
  if (!t.trim()) throw new Error("Paste the query result first.");
  if (/^\s*[[{]/.test(t)) return fromJson(t.trim());
  const lines = t.split(/\r?\n/);
  const boxAt = lines.findIndex((l) => /^\+-+(\+-+)*\+$/.test(l.trim()));
  if (boxAt >= 0 && lines[boxAt + 1]?.trim().startsWith("|")) return fromMysqlBox(lines.slice(boxAt).map((l) => l.trim()).filter((l) => /^[+|]/.test(l)));
  const ruleAt = lines.findIndex((l, i) => i > 0 && /^-+(\+-+)+-*$/.test(l.trim()) && lines[i - 1].includes("|"));
  if (ruleAt > 0) return fromPsql(lines.slice(Math.max(0, ruleAt - 1)), 1);
  const sep = lines[0].includes("\t") ? "\t" : lines[0].includes(",") ? "," : lines[0].includes("|") ? "|" : ",";
  const grid = parseDelimited(t, sep);
  if (grid.length < 2) throw new Error("Found a header but no rows. Paste the whole result, header line included.");
  const columns = grid[0].map(norm);
  const rows = grid.slice(1).map((r) => Object.fromEntries(columns.map((c, i) => [c, (r[i] ?? "").trim()])));
  return { format: sep === "\t" ? "tsv" : "csv", columns, rows };
}

/** The first column name present, from a list of aliases (older and newer Postgres versions). */
export const pick = (columns: string[], ...names: string[]) => names.find((n) => columns.includes(n));
