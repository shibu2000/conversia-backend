/**
 * Deterministic pseudo-randomness.
 *
 * Seeded so the demo dataset is identical between runs: a bug report that says
 * "lead L-4231 shows the wrong owner" has to be reproducible, and a dataset
 * that reshuffles on every seed makes that impossible.
 */
export class Rng {
  private state: number;

  constructor(seed: string) {
    let hash = 2166136261;
    for (let index = 0; index < seed.length; index += 1) {
      hash ^= seed.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    this.state = hash >>> 0 || 1;
  }

  /** xorshift32 — fast and good enough for fixtures. */
  next(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state / 4294967296;
  }

  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  float(min: number, max: number, decimals = 2): number {
    return Number((this.next() * (max - min) + min).toFixed(decimals));
  }

  bool(probability = 0.5): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  weighted<T>(entries: ReadonlyArray<readonly [T, number]>): T {
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
    let roll = this.next() * total;
    for (const [value, weight] of entries) {
      roll -= weight;
      if (roll <= 0) return value;
    }
    return entries[entries.length - 1][0];
  }

  sample<T>(items: readonly T[], count: number): T[] {
    const pool = [...items];
    const result: T[] = [];
    for (let index = 0; index < Math.min(count, pool.length); index += 1) {
      result.push(pool.splice(Math.floor(this.next() * pool.length), 1)[0]);
    }
    return result;
  }
}

const DAY = 86_400_000;

export function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY);
}

export function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 3_600_000);
}

export function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000);
}

export function daysAhead(days: number): Date {
  return new Date(Date.now() + days * DAY);
}
