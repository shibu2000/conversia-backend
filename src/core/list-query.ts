import type { Request } from "express";
import { asc, desc, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ListQuery {
  page: number;
  pageSize: number;
  offset: number;
  search?: string;
  sortBy?: string;
  sortDir: "asc" | "desc";
  filters: Record<string, string[]>;
}

const MAX_PAGE_SIZE = 200;

/**
 * Parse the query string the frontend's `useListQuery` hook produces.
 *
 * It sends `filters[status]=open` (repeating the key for a multi-select), plus
 * `page`, `pageSize`, `search`, `sortBy` and `sortDir`. A filter value of `all`
 * or an empty string means "no filter" — matching the frontend's own
 * `passesFilters` semantics, so a dropdown left on "All" behaves identically
 * against the API as it did against the fixtures.
 */
export function parseListQuery(
  req: Request,
  defaults: { sortBy?: string; sortDir?: "asc" | "desc"; pageSize?: number } = {},
): ListQuery {
  const source = req.query as Record<string, unknown>;

  const page = Math.max(1, toInt(source.page, 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, toInt(source.pageSize, defaults.pageSize ?? 25)));
  const rawSearch = typeof source.search === "string" ? source.search.trim() : "";
  const sortBy = typeof source.sortBy === "string" && source.sortBy ? source.sortBy : defaults.sortBy;
  const sortDir = source.sortDir === "asc" ? "asc" : source.sortDir === "desc" ? "desc" : (defaults.sortDir ?? "desc");

  const filters: Record<string, string[]> = {};
  const rawFilters = source.filters;
  if (rawFilters && typeof rawFilters === "object" && !Array.isArray(rawFilters)) {
    for (const [key, value] of Object.entries(rawFilters as Record<string, unknown>)) {
      const values = (Array.isArray(value) ? value : [value])
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        // 200 chars is far past any legitimate filter value and stops a
        // hand-built URL from turning a filter into a huge bind parameter.
        .filter((entry) => entry !== "" && entry !== "all" && entry.length <= 200);
      if (values.length > 0) filters[key] = values.slice(0, 50);
    }
  }

  return { page, pageSize, offset: (page - 1) * pageSize, search: rawSearch || undefined, sortBy, sortDir, filters };
}

export function paginate<T>(items: T[], total: number, query: Pick<ListQuery, "page" | "pageSize">): Paginated<T> {
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
  return { items, page: Math.min(query.page, totalPages), pageSize: query.pageSize, total, totalPages };
}

/**
 * Resolve `sortBy` against a column whitelist.
 *
 * Anything unrecognised falls back to the default, so a hand-edited URL cannot
 * steer ORDER BY at an arbitrary expression. Nulls sort last in both directions:
 * an unassigned row should never outrank a real value at the top of a table.
 */
export function resolveOrderBy(
  query: ListQuery,
  columns: Record<string, PgColumn | SQL>,
  fallback: string,
): SQL {
  const column = (query.sortBy && columns[query.sortBy]) ?? columns[fallback];
  const direction = query.sortDir === "asc" ? asc : desc;
  return direction(column as PgColumn);
}

function toInt(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Escape `%` and `_` so a user's search text cannot act as a LIKE wildcard. */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}
