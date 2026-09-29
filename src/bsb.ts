/** BSB helpers: format validation and directory lookup. */

export interface BsbRecord {
  bsb: string; // canonical "062-000"
  bank: string; // institution mnemonic, e.g. "CBA"
  branch: string;
  state?: string;
}

export interface BsbDirectory {
  lookup(bsb: string): Promise<BsbRecord | undefined> | BsbRecord | undefined;
}

/** Returns canonical "NNN-NNN" or undefined when the input is not a valid BSB shape. */
export function normalizeBsb(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const m = /^(\d{3})[- ]?(\d{3})$/.exec(input.trim());
  return m ? `${m[1]}-${m[2]}` : undefined;
}

/** Australian account numbers are 6-10 digits (spaces/hyphens tolerated on input). */
export function normalizeAccountNumber(input: unknown): string | undefined {
  if (typeof input !== "string" && typeof input !== "number") return undefined;
  const digits = String(input).replace(/[\s-]/g, "");
  return /^\d{6,10}$/.test(digits) ? digits : undefined;
}

/** In-memory directory; load it from the APCA BSB Database file or your own source. */
export class InMemoryBsbDirectory implements BsbDirectory {
  private readonly map = new Map<string, BsbRecord>();

  constructor(records: BsbRecord[] = []) {
    for (const r of records) {
      const key = normalizeBsb(r.bsb);
      if (key) this.map.set(key, { ...r, bsb: key });
    }
  }

  lookup(bsb: string): BsbRecord | undefined {
    const key = normalizeBsb(bsb);
    return key ? this.map.get(key) : undefined;
  }
}
