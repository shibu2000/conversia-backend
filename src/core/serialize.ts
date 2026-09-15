/**
 * Row → API shape helpers.
 *
 * The frontend's types use ISO strings for timestamps and plain numbers for
 * money. The driver hands back `Date` objects and (for `numeric`) strings, so
 * every mapper runs values through these rather than trusting `JSON.stringify`
 * to do something sensible — which for `null` vs `undefined` it does not.
 */
export function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** Same as `iso`, for columns declared NOT NULL. */
export function isoRequired(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function num(value: string | number | null | undefined, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function numOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** `null` is a value the UI renders; `undefined` means "field absent". */
export function orUndefined<T>(value: T | null): T | undefined {
  return value === null ? undefined : value;
}
