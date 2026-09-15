import { sql, type SQL } from "drizzle-orm";

/**
 * A correlated `count(*)` subquery.
 *
 * Written as raw SQL with an explicit inner alias and a fully-qualified outer
 * reference, because interpolating Drizzle column objects into a SELECT-list
 * subquery renders them *unqualified*: `WHERE assigned_user_id = id` then binds
 * `id` to the inner table instead of the outer row. That is not a syntax error
 * — it silently returns zero, or fails as ambiguous only when a third table is
 * joined in. Both failure modes are quiet, so the qualification is explicit.
 *
 * Every argument is a literal written in this codebase; none is ever derived
 * from a request. Values are still bound as parameters everywhere else.
 */
export function correlatedCount(options: {
  /** Inner table to count rows from, e.g. `"leads"`. */
  from: string;
  /** Short alias for the inner table, e.g. `"l"`. */
  as: string;
  /** Predicate joining inner to outer, e.g. `"l.assigned_user_id = users.id"`. */
  on: string;
  /** Optional extra condition, e.g. `"l.status = 'published'"`. */
  and?: string;
}): SQL<number> {
  const extra = options.and ? ` AND ${options.and}` : "";
  return sql<number>`(SELECT count(*) FROM ${sql.raw(options.from)} ${sql.raw(options.as)} WHERE ${sql.raw(options.on)}${sql.raw(extra)})`;
}
