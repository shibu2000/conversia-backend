import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closePool, db } from "./index";
import { ensureEmbeddingDimensions } from "./ensure-embedding-dimensions";
import { logger } from "../config/logger";

/**
 * Apply pending migrations from `drizzle/`.
 *
 * drizzle-kit generates the SQL; this applies it. Keeping generation and
 * application as separate steps means production always runs SQL that someone
 * has read and committed, never a schema diff computed at deploy time.
 *
 * The embedding column's width is the one deliberate exception: it follows
 * `AI_EMBEDDING_DIMENSIONS` rather than a committed migration, so a fresh
 * deployment picks up whichever provider its environment names without
 * anyone hand-authoring a migration for it. See `ensure-embedding-dimensions`
 * for why this is safe only before real embeddings exist.
 */
async function main(): Promise<void> {
  await migrate(db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  logger.info("Migrations applied.");
  await ensureEmbeddingDimensions();
}

main()
  .then(closePool)
  .catch(async (error: Error) => {
    logger.error(`Migration failed: ${error.message}`);
    await closePool();
    process.exit(1);
  });
