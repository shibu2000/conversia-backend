import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, types } from "pg";
import { env } from "../config/env";
import { logger } from "../config/logger";
import * as schema from "./schema";

/**
 * `numeric` and `bigint` arrive as strings by default because they can exceed
 * the range of a JS number. Every such column in this schema is money, a count
 * or a bounded score, so parsing them here keeps the API contract honest —
 * `priceUsd` is declared `number` in the frontend's types and must not arrive
 * as `"129.00"`.
 */
types.setTypeParser(types.builtins.NUMERIC, (value) => (value === null ? null : Number(value)));
types.setTypeParser(types.builtins.INT8, (value) => (value === null ? null : Number(value)));

export const pool = new Pool(
  env.DATABASE_URL
    ? {
        connectionString: env.DATABASE_URL,
        max: env.PG_POOL_MAX,
        ssl: env.pgSsl ? { rejectUnauthorized: false } : undefined,
      }
    : {
        host: env.PGHOST,
        port: env.PGPORT,
        database: env.PGDATABASE,
        user: env.PGUSER,
        password: env.PGPASSWORD,
        max: env.PG_POOL_MAX,
        ssl: env.pgSsl ? { rejectUnauthorized: false } : undefined,
      },
);

pool.on("error", (error) => {
  logger.error("Unexpected Postgres pool error", { error: error.message });
});

export const db = drizzle(pool, { schema, logger: env.LOG_LEVEL === "debug" });

export type Database = typeof db;

/**
 * A transaction handle. Anything that writes more than one row — assigning a
 * lead and recording its history, creating a ticket and its first timeline
 * event — takes this, so a half-written audit trail is not possible.
 */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Either the pool or an open transaction, so services compose either way. */
export type Executor = Database | Transaction;

export async function verifyConnection(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT 1");
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}

export { schema };
