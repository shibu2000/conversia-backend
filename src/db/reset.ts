import { closePool, pool } from "./index";
import { env } from "../config/env";
import { logger } from "../config/logger";

/**
 * Drop and recreate the public schema. Development only — a production
 * deployment that needs this needs a restore, not a script.
 */
async function main(): Promise<void> {
  if (env.isProduction) throw new Error("db:reset is disabled when NODE_ENV=production.");
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
  await pool.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
  await pool.query("CREATE SCHEMA public");
  logger.warn("Dropped and recreated the public schema. Run db:migrate next.");
}

main()
  .then(closePool)
  .catch(async (error: Error) => {
    logger.error(error.message);
    await closePool();
    process.exit(1);
  });
