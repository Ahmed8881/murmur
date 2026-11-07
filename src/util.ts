import type { Persona, Stance, StanceCount } from "./types.ts";

/** Run `fn` over `items` with at most `limit` in flight. Keeps input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function countStances(personas: Pick<Persona, "stance">[]): StanceCount {
  const c: StanceCount = { yes: 0, maybe: 0, no: 0 };
  for (const p of personas) c[p.stance]++;
  return c;
}

/** Split `total` across segments by weight (largest remainder). All-zero weights split evenly. */
export function allocate(total: number, weights: number[]): number[] {
  const w = weights.map((x) => Math.max(0, x));
  const sum = w.reduce((a, b) => a + b, 0);
  const raw = w.map((x) => (sum ? x / sum : 1 / w.length) * total);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left <= 0) break;
    out[i]++;
    left--;
  }
  return out;
}

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : 0));

export const STANCES: Stance[] = ["yes", "maybe", "no"];

export const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
