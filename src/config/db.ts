import { Pool, types, type PoolClient, type QueryResultRow } from "pg";
import { env } from "./env";
import { logger } from "./logger";

/**
 * Postgres access.
 *
 * `numeric` comes back as a string by default because it can exceed the range
 * of a JS number. Every numeric column in this schema is money or a bounded
 * score, so parsing to a number here keeps the API contract (`priceUsd: number`)
 * honest instead of leaking strings into JSON responses.
 */
types.setTypeParser(types.builtins.NUMERIC, (value) => (value === null ? null : Number(value)));
types.setTypeParser(types.builtins.INT8, (value) => (value === null ? null : Number(value)));

export const pool = new Pool(
  env.DATABASE_URL
    ? { connectionString: env.DATABASE_URL, max: env.PG_POOL_MAX, ssl: env.pgSsl ? { rejectUnauthorized: false } : undefined }
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

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const startedAt = Date.now();
  const result = await pool.query<T>(text, params as never[]);
  const durationMs = Date.now() - startedAt;
  if (durationMs > 250) logger.warn("Slow query", { durationMs, text: text.replace(/\s+/g, " ").slice(0, 160) });
  return result.rows;
}

/** First row, or `undefined`. Repositories turn that into a 404. */
export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  const rows = await query<T>(text, params);
  return rows[0];
}

export async function execute(text: string, params: unknown[] = []): Promise<number> {
  const result = await pool.query(text, params as never[]);
  return result.rowCount ?? 0;
}

/**
 * Run a unit of work inside a transaction.
 *
 * Anything that writes more than one row — assigning a lead and recording its
 * history, creating a ticket and its first timeline event — goes through here,
 * so a half-written audit trail is not possible.
 */
export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function verifyConnection(): Promise<void> {
  await query("SELECT 1");
}

export async function closePool(): Promise<void> {
  await pool.end();
}
