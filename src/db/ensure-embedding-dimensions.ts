import { sql } from "drizzle-orm";
import { env } from "../config/env";
import { logger } from "../config/logger";
import { db } from "./index";

const TABLE = "knowledge_chunks";
const COLUMN = "embedding";
const INDEX_NAME = "knowledge_chunks_embedding_idx";

/**
 * Makes the embedding column's width follow `AI_EMBEDDING_DIMENSIONS`
 * automatically, instead of every provider swap needing a hand-written
 * migration for a step that is genuinely mechanical.
 *
 * Deliberately scoped to *initial* setup, not to changing an established
 * deployment's provider. pgvector's HNSW index is fixed to one width, and a
 * stored embedding is not just "the wrong size" for a different model — it is
 * a vector from a different model's geometry entirely, which resizing the
 * column cannot fix. So this only ever acts automatically while the table
 * holds no real embeddings yet; the moment it does, it refuses loudly and
 * names the reviewed path (drop index, alter the column, re-embed everything)
 * instead of guessing at one.
 *
 * Safe to call on every boot: a matching width is a single read-only query and
 * nothing else happens.
 */
export async function ensureEmbeddingDimensions(): Promise<void> {
  const target = env.AI_EMBEDDING_DIMENSIONS;
  if (!Number.isInteger(target) || target <= 0) {
    throw new Error(`AI_EMBEDDING_DIMENSIONS must be a positive integer, got ${target}.`);
  }

  const current = await currentWidth();
  if (current === null) {
    logger.warn(`"${TABLE}"."${COLUMN}" does not exist yet — run migrations before starting the AI layer.`);
    return;
  }
  if (current === target) return;

  const hasEmbeddings = await tableHasEmbeddings();
  if (hasEmbeddings) {
    throw new Error(
      `"${TABLE}"."${COLUMN}" is vector(${current}) with real embeddings stored, but AI_EMBEDDING_DIMENSIONS is ` +
        `now ${target}. This is a provider change on an established deployment, not a fresh setup, and cannot be ` +
        `applied automatically: the stored vectors are not just the wrong width, they are from a different ` +
        `model's vector space entirely. Migrate the column (drop the HNSW index, ALTER COLUMN ... TYPE ` +
        `vector(${target}), recreate the index) and reindex every knowledge source so chunks are re-embedded with ` +
        `the new model, then restart.`,
    );
  }

  logger.info(`Resizing "${TABLE}"."${COLUMN}" from vector(${current}) to vector(${target}) — no embeddings stored yet.`);

  await db.execute(sql.raw(`DROP INDEX IF EXISTS "${INDEX_NAME}"`));
  await db.execute(sql.raw(`ALTER TABLE "${TABLE}" ALTER COLUMN "${COLUMN}" TYPE vector(${target})`));
  await db.execute(
    sql.raw(
      `CREATE INDEX "${INDEX_NAME}" ON "${TABLE}" USING hnsw ("${COLUMN}" vector_cosine_ops) WITH (m = 16, ef_construction = 64)`,
    ),
  );

  logger.info(`"${TABLE}"."${COLUMN}" is now vector(${target}).`);
}

/** `null` when the column does not exist yet (migrations have not run). */
async function currentWidth(): Promise<number | null> {
  const result = await db.execute<{ formatted: string | null }>(sql`
    SELECT format_type(a.atttypid, a.atttypmod) AS formatted
    FROM pg_attribute a
    WHERE a.attrelid = to_regclass(${`public.${TABLE}`})
      AND a.attname = ${COLUMN}
      AND NOT a.attisdropped
  `);

  const formatted = result.rows[0]?.formatted;
  if (!formatted) return null;

  // format_type renders pgvector's type as "vector(768)".
  const match = /^vector\((\d+)\)$/.exec(formatted);
  return match ? Number(match[1]) : null;
}

async function tableHasEmbeddings(): Promise<boolean> {
  const result = await db.execute<{ exists: boolean }>(
    sql.raw(`SELECT EXISTS (SELECT 1 FROM "${TABLE}" WHERE "${COLUMN}" IS NOT NULL) AS "exists"`),
  );
  return Boolean(result.rows[0]?.exists);
}
