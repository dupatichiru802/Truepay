/**
 * Fuzzy name matching, modelled on Confirmation of Payee outcomes:
 * match / close_match / no_match.
 */

export type NameMatchResult = "match" | "close_match" | "no_match";

export interface NameMatchOptions {
  /** Score >= this is a full match. Default 0.97. */
  matchThreshold?: number;
  /** Score >= this (and below matchThreshold) is a close match. Default 0.90. */
  closeThreshold?: number;
}

const NOISE = new Set([
  "mr", "mrs", "ms", "miss", "dr", "prof", "jr", "sr",
  "pty", "ltd", "limited", "inc", "the", "atf", "as", "trustee", "for", "t/a", "and", "&",
]);

export function normalizeName(name: string): string[] {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !NOISE.has(t));
}

function jaro(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const am = new Array<boolean>(a.length).fill(false);
  const bm = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - range);
    const hi = Math.min(b.length - 1, i + range);
    for (let j = lo; j <= hi; j++) {
      if (!bm[j] && a[i] === b[j]) {
        am[i] = bm[j] = true;
        matches++;
        break;
      }
    }
  }
  if (!matches) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!am[i]) continue;
    while (!bm[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  t /= 2;
  return (matches / a.length + matches / b.length + (matches - t) / matches) / 3;
}

export function jaroWinkler(a: string, b: string): number {
  const j = jaro(a, b);
  let p = 0;
  while (p < 4 && p < a.length && p < b.length && a[p] === b[p]) p++;
  return j + p * 0.1 * (1 - j);
}

/** Token-order-insensitive similarity in [0,1]. Handles "SMITH John" vs "John Smith". */
export function nameSimilarity(a: string, b: string): number {
  const ta = normalizeName(a);
  const tb = normalizeName(b);
  if (!ta.length || !tb.length) return 0;

  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const used = new Set<number>();
  let total = 0;
  for (const s of short) {
    let best = 0;
    let bestIdx = -1;
    long.forEach((l, i) => {
      if (used.has(i)) return;
      // A bare initial matches a token starting with that letter.
      const score =
        s.length === 1 || l.length === 1
          ? s[0] === l[0] ? 0.9 : 0
          : jaroWinkler(s, l);
      if (score > best) {
        best = score;
        bestIdx = i;
      }
    });
    if (bestIdx >= 0) used.add(bestIdx);
    total += best;
  }
  // Penalise unmatched tokens on the longer side (e.g. extra middle names) lightly.
  const coverage = short.length / long.length;
  return (total / short.length) * (0.85 + 0.15 * coverage);
}

export function matchNames(
  provided: string,
  onRecord: string,
  opts: NameMatchOptions = {},
): { result: NameMatchResult; score: number } {
  const { matchThreshold = 0.97, closeThreshold = 0.90 } = opts;
  const score = nameSimilarity(provided, onRecord);
  const result: NameMatchResult =
    score >= matchThreshold ? "match" : score >= closeThreshold ? "close_match" : "no_match";
  return { result, score: Number(score.toFixed(3)) };
}
