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
  /** Fixed-width files only: "Effective Date" from the header record. */
  effectiveDate?: string;
  /** Fixed-width files only: record count the trailer says the file contains. */
  declaredCount?: number;
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

/**
 * AP+ BSB Database fixed-width (.txt) layout, 0-based:
 *   0-6 BSB "nnn-nnn" | 7-9 bank mnemonic | 10-44 branch name | 45-79 address | 80-99 suburb
 *   then state(3) postcode(4) flags(4, "PEH").
 * State/postcode/flags are matched from the end of the line because stray control characters
 * in the address area (a tab occurs in real files) shift everything after them.
 */
export function parseBsbFixedWidth(text: string): ParseResult {
  const records: BsbRecord[] = [];
  let skipped = 0;
  let effectiveDate: string | undefined;
  let declaredCount: number | undefined;

  for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    if (!raw.trim()) continue;
    if (raw.startsWith("HEADER RECORD")) {
      effectiveDate = /Effective Date:\s*(\d{1,2} \w{3} \d{4})/.exec(raw)?.[1];
      continue;
    }
    if (raw.startsWith("TRAILER RECORD")) {
      const n = /:\s*([\d,]+)/.exec(raw)?.[1];
      if (n) declaredCount = Number(n.replace(/,/g, ""));
      continue;
    }

    const line = raw.replace(/\t/g, " ");
    const bsb = normalizeBsb(line.slice(0, 7));
    const tail = /(.{3})(\d{4})([ PEH]{0,4})\s*$/.exec(line);
    if (!bsb || !tail) {
      skipped++;
      continue;
    }

    const branch = line.slice(10, 45).trim();
    const active = !/(merged|closed)\s*$/i.test(branch);
    const ref = active ? undefined : /BSB\s*(\d{3})\D?(\d{3})/i.exec(line.slice(45, 80));
    const state = tail[1].trim();
    const flags = tail[3].replace(/\s/g, "");

    records.push({
      bsb,
      bank: line.slice(7, 10).trim(),
      branch,
      ...(state ? { state } : {}),
      ...(flags ? { flags } : {}),
      ...(active ? {} : { active: false }),
      ...(ref ? { mergedInto: `${ref[1]}-${ref[2]}` } : {}),
    });
  }
  return { records, skipped, effectiveDate, declaredCount };
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
  /** Fixed-width files: don't throw when the record count differs from the trailer. Default false. */
  allowCountMismatch?: boolean;
}

/** Load a `.txt` (AP+ fixed-width), `.csv` or `.json` BSB file into a directory. */
export async function loadBsbDirectory(
  path: string,
  opts: LoadBsbOptions = {},
): Promise<{
  directory: InMemoryBsbDirectory;
  count: number;
  skipped: number;
  effectiveDate?: string;
}> {
  const ext = extname(path).toLowerCase();
  if (ext !== ".csv" && ext !== ".json" && ext !== ".txt") {
    throw new Error(`Unsupported BSB file type "${ext}" (use .txt, .csv or .json)`);
  }
  const text = await readFile(path, "utf8");
  const parsed =
    ext === ".json" ? parseBsbJson(text) : ext === ".txt" ? parseBsbFixedWidth(text) : parseBsbCsv(text, opts.columns);
  const { records, skipped, effectiveDate, declaredCount } = parsed;
  if (!opts.allowCountMismatch && declaredCount !== undefined && records.length !== declaredCount) {
    throw new Error(
      `${path}: trailer declares ${declaredCount} records but ${records.length} parsed (${skipped} unparseable); file may be truncated`,
    );
  }
  if (opts.requireRecords !== false && records.length === 0) {
    throw new Error(`No valid BSB records found in ${path}; check the file format or column mapping`);
  }
  return { directory: new InMemoryBsbDirectory(records), count: records.length, skipped, effectiveDate };
}
