import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { type BsbRecord, InMemoryBsbDirectory, normalizeBsb } from "./bsb.js";

/** Zero-based CSV column positions. Defaults follow the AP+ BSB Database CSV layout. */
export interface BsbCsvColumns {
  bsb: number;
  bank: number;
  branch: number;
  state?: number;
}

export const DEFAULT_BSB_COLUMNS: BsbCsvColumns = { bsb: 0, bank: 1, branch: 2, state: 5 };

export interface ParseResult {
  records: BsbRecord[];
  /** Non-empty lines ignored because the first column wasn't a valid BSB (headers land here). */
  skipped: number;
}

/** Minimal RFC 4180 line splitter: handles quoted fields, escaped quotes and commas in quotes. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

export function parseBsbCsv(text: string, columns: BsbCsvColumns = DEFAULT_BSB_COLUMNS): ParseResult {
  const records: BsbRecord[] = [];
  let skipped = 0;
  // Strip a UTF-8 BOM, which spreadsheet exports often add.
  for (const line of text.replace(/^﻿/, "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const f = splitCsvLine(line);
    const bsb = normalizeBsb(f[columns.bsb]);
    if (!bsb) {
      skipped++;
      continue;
    }
    const state = columns.state === undefined ? undefined : f[columns.state];
    records.push({
      bsb,
      bank: f[columns.bank] ?? "",
      branch: f[columns.branch] ?? "",
      ...(state ? { state } : {}),
    });
  }
  return { records, skipped };
}

/** JSON: an array of `{ bsb, bank, branch, state? }`. Invalid entries are skipped. */
export function parseBsbJson(text: string): ParseResult {
  const data: unknown = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error("BSB JSON must be an array of records");
  const records: BsbRecord[] = [];
  let skipped = 0;
  for (const item of data) {
    const bsb = normalizeBsb((item as { bsb?: unknown })?.bsb);
    if (!bsb) {
      skipped++;
      continue;
    }
    const r = item as Partial<BsbRecord>;
    records.push({
      bsb,
      bank: r.bank ?? "",
      branch: r.branch ?? "",
      ...(r.state ? { state: r.state } : {}),
    });
  }
  return { records, skipped };
}

export interface LoadBsbOptions {
  columns?: BsbCsvColumns;
  /** Fail instead of returning an empty directory. Default true, so a wrong file can't silently disable checks. */
  requireRecords?: boolean;
}

/** Load a `.csv` or `.json` BSB file into a directory. */
export async function loadBsbDirectory(
  path: string,
  opts: LoadBsbOptions = {},
): Promise<{ directory: InMemoryBsbDirectory; count: number; skipped: number }> {
  const ext = extname(path).toLowerCase();
  if (ext !== ".csv" && ext !== ".json") {
    throw new Error(`Unsupported BSB file type "${ext}" (use .csv or .json)`);
  }
  const text = await readFile(path, "utf8");
  const { records, skipped } = ext === ".json" ? parseBsbJson(text) : parseBsbCsv(text, opts.columns);
  if (opts.requireRecords !== false && records.length === 0) {
    throw new Error(`No valid BSB records found in ${path}; check the file format or column mapping`);
  }
  return { directory: new InMemoryBsbDirectory(records), count: records.length, skipped };
}
