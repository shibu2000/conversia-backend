import { sql } from "drizzle-orm";
import { db } from "../../db";
import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { processDocument } from "./document-processor";

/**
 * The indexing worker.
 *
 * Documents are claimed from the table they already live in rather than from a
 * queue of their own. `knowledge_documents.status` is the queue, `claimed_at` is
 * the lease, and `FOR UPDATE SKIP LOCKED` is what makes that safe — two API
 * instances polling the same table will never take the same document, and no
 * broker has to be running for an upload to be indexed.
 */

/**
 * How long a claim is trusted.
 *
 * A worker refreshes its claim at every pipeline stage, so this only elapses
 * when the process actually died. Then the document is reclaimed instead of
 * sitting at "Processing" for good.
 */
const STALE_CLAIM_MINUTES = 10;

let timer: NodeJS.Timeout | null = null;
let running = false;
let stopped = false;

export function startIndexingWorker(): void {
  if (timer) return;
  stopped = false;
  timer = setInterval(() => void tick(), env.AI_WORKER_INTERVAL_MS);
  // Nothing should be held open by this timer at shutdown.
  timer.unref();
  logger.info("Indexing worker started", { intervalMs: env.AI_WORKER_INTERVAL_MS, batch: env.AI_WORKER_BATCH });
}

export function stopIndexingWorker(): void {
  stopped = true;
  if (timer) clearInterval(timer);
  timer = null;
}

/**
 * Nudge the worker.
 *
 * Called when a document is queued so an upload is picked up now rather than at
 * the next interval. It only shortens the wait — a missed nudge costs a couple
 * of seconds, never a lost document.
 */
export function wakeIndexingWorker(): void {
  if (!stopped) void tick();
}

async function tick(): Promise<void> {
  // One pass at a time. Overlapping passes would not corrupt anything — the
  // claim prevents that — but they would multiply concurrent model calls.
  if (running || stopped) return;
  running = true;

  try {
    for (;;) {
      const documents = await claim();
      if (documents.length === 0) return;
      // Sequential: the embedding model is one process on one machine, and
      // three documents racing it is slower than three in turn.
      for (const document of documents) {
        if (stopped) return;
        await processDocument(document);
      }
    }
  } catch (error) {
    logger.error("Indexing worker pass failed", { error: error instanceof Error ? error.message : String(error) });
  } finally {
    running = false;
  }
}

interface ClaimedRow extends Record<string, unknown> {
  id: string;
  company_id: string;
  source_id: string;
  name: string;
  mime_type: string;
  storage_key: string | null;
  extracted_text: string;
}

async function claim() {
  const { rows } = await db.execute<ClaimedRow>(sql`
    UPDATE knowledge_documents
    SET claimed_at = now()
    WHERE id IN (
      SELECT id FROM knowledge_documents
      WHERE status = 'processing'
        AND (claimed_at IS NULL OR claimed_at < now() - ${sql.raw(`interval '${STALE_CLAIM_MINUTES} minutes'`)})
      ORDER BY created_at
      LIMIT ${env.AI_WORKER_BATCH}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, company_id, source_id, name, mime_type, storage_key, extracted_text
  `);

  return rows.map((row) => ({
    id: row.id,
    companyId: row.company_id,
    sourceId: row.source_id,
    name: row.name,
    mimeType: row.mime_type,
    storageKey: row.storage_key,
    extractedText: row.extracted_text,
  }));
}
