import { Client } from "pg";
import { env } from "../config/env";
import { logger } from "../config/logger";

/**
 * Create the application database if it does not exist.
 *
 * Connects to the `postgres` maintenance database, because you cannot create a
 * database from inside the one you are creating. Safe to run repeatedly.
 */
async function main(): Promise<void> {
  if (env.DATABASE_URL) {
    logger.info("DATABASE_URL is set — assuming the database already exists. Skipping creation.");
    return;
  }

  const client = new Client({
    host: env.PGHOST,
    port: env.PGPORT,
    user: env.PGUSER,
    password: env.PGPASSWORD,
    database: "postgres",
    ssl: env.pgSsl ? { rejectUnauthorized: false } : undefined,
  });

  await client.connect();
  try {
    const existing = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [env.PGDATABASE]);
    if (existing.rowCount) {
      logger.info(`Database "${env.PGDATABASE}" already exists.`);
      return;
    }
    // Identifiers cannot be bound as parameters; the name is validated first.
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(env.PGDATABASE)) {
      throw new Error(`Refusing to create a database with an unsafe name: ${env.PGDATABASE}`);
    }
    await client.query(`CREATE DATABASE "${env.PGDATABASE}"`);
    logger.info(`Created database "${env.PGDATABASE}".`);
  } finally {
    await client.end();
  }
}

main().catch((error: Error) => {
  logger.error(error.message);
  process.exit(1);
});
