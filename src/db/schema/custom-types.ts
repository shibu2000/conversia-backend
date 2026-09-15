import { customType } from "drizzle-orm/pg-core";

/**
 * Postgres `tsvector`.
 *
 * Drizzle has no built-in mapping for it, and the columns that use it are
 * always generated and never read into JavaScript — they exist to be matched
 * against in a WHERE clause. Declaring the type keeps the generated migration
 * correct instead of emitting `text`.
 */
export const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tsvector";
  },
});

/**
 * pgvector's `vector(n)`.
 *
 * The wire format is a bracketed list — `[0.1,-0.2,…]` — not a Postgres array,
 * so it needs its own mapping in both directions. The width is fixed at the
 * column because an HNSW index requires it; changing embedding model therefore
 * means a migration, which is the honest cost of the vectors becoming
 * incompatible rather than merely differently sized.
 */
export const vector = (name: string, config: { dimensions: number }) =>
  customType<{ data: number[]; driverData: string; config: { dimensions: number } }>({
    dataType(columnConfig) {
      return `vector(${columnConfig!.dimensions})`;
    },
    toDriver(value: number[]): string {
      return `[${value.join(",")}]`;
    },
    fromDriver(value: string): number[] {
      return value.slice(1, -1).split(",").map(Number);
    },
  })(name, config);
