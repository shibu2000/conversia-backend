import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { knowledgeChunks, knowledgeDocuments, knowledgeSources, type PipelineStage } from "../../db/schema";
import { logger } from "../../config/logger";
import { newId } from "../../core/ids";
import { readFile } from "../../modules/uploads/storage.service";
import { chunkDocument, estimateTokens } from "../chunking/chunker";
import { extractDocument } from "../extract";
import { aiProviders } from "../providers";

/**
 * Indexing one document: extract, chunk, embed, store.
 *
 * Progress is written as it goes rather than at the end, because the document
 * view renders the `pipeline` array verbatim. A screen that sits at "Waiting for
 * the processing pipeline" while work is actually happening is a screen that
 * lies, so each stage is committed the moment it starts and the moment it ends.
 */

/** How many chunks go to the embedding model at once. */
const EMBED_BATCH = 32;

interface ClaimedDocument {
  id: string;
  companyId: string;
  sourceId: string;
  name: string;
  mimeType: string;
  storageKey: string | null;
  extractedText: string;
}

export async function processDocument(document: ClaimedDocument): Promise<void> {
  const started = Date.now();

  try {
    const extracted = await runExtract(document);
    const chunks = await runChunk(document, extracted.text);
    const embedded = await runEmbed(document, chunks);
    await runIndex(document, extracted.pageCount, chunks, embedded);

    logger.info("Indexed a knowledge document", {
      documentId: document.id,
      companyId: document.companyId,
      chunks: chunks.length,
      ms: Date.now() - started,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Processing failed.";
    logger.error("Failed to index a knowledge document", {
      documentId: document.id,
      companyId: document.companyId,
      error: message,
    });
    await failDocument(document.id, message);
  }
}

async function runExtract(document: ClaimedDocument) {
  await setStage(document.id, "extract", "processing", "Reading the document.", 5);

  // Manual entries and crawled pages already carry their text; there are no
  // bytes on disk to read, and `storageKey` is null for exactly that reason.
  if (!document.storageKey) {
    const text = document.extractedText.trim();
    if (!text) {
      // Almost always a website source: the crawler is a later phase, so there
      // is genuinely nothing to read yet. Say which it is.
      throw new Error(
        document.mimeType === "text/html"
          ? "Website crawling is not installed yet, so there is no content to index for this source."
          : "This source has no content to index.",
      );
    }
    await setStage(document.id, "extract", "ready", "Content was written in the dashboard.", 20);
    return { text, pageCount: null };
  }

  const buffer = await readFile(document.storageKey);
  const extracted = await extractDocument(buffer, document.mimeType, document.name);

  await db
    .update(knowledgeDocuments)
    .set({ extractedText: extracted.text, pageCount: extracted.pageCount, updatedAt: new Date() })
    .where(eq(knowledgeDocuments.id, document.id));

  const detail = extracted.pageCount
    ? `Read ${extracted.pageCount} ${extracted.pageCount === 1 ? "page" : "pages"} of text.`
    : `Read ${extracted.text.length.toLocaleString("en-GB")} characters of text.`;
  await setStage(document.id, "extract", "ready", detail, 20);

  return extracted;
}

async function runChunk(document: ClaimedDocument, text: string) {
  await setStage(document.id, "chunk", "processing", "Splitting the text into passages.", 25);

  const chunks = chunkDocument(text);
  if (chunks.length === 0) throw new Error("The document produced no text that could be indexed.");

  await setStage(
    document.id,
    "chunk",
    "ready",
    `Split into ${chunks.length} ${chunks.length === 1 ? "passage" : "passages"}, on headings and paragraphs.`,
    45,
  );
  return chunks;
}

async function runEmbed(document: ClaimedDocument, chunks: ReturnType<typeof chunkDocument>) {
  const { embedding } = aiProviders();
  await setStage(document.id, "embed", "processing", `Embedding ${chunks.length} passages.`, 50);

  const vectors: number[][] = [];
  for (let index = 0; index < chunks.length; index += EMBED_BATCH) {
    const batch = chunks.slice(index, index + EMBED_BATCH);
    vectors.push(...(await embedding.embed(batch.map((chunk) => chunk.text), "document")));

    // 50 → 85 across the batches, so a long document's bar actually moves.
    const progress = 50 + Math.round(((index + batch.length) / chunks.length) * 35);
    await setStage(document.id, "embed", "processing", `Embedded ${vectors.length} of ${chunks.length} passages.`, progress);
  }

  const noun = vectors.length === 1 ? "passage" : "passages";
  await setStage(document.id, "embed", "ready", `Embedded ${vectors.length} ${noun} with ${embedding.id}.`, 85);
  return vectors;
}

async function runIndex(
  document: ClaimedDocument,
  pageCount: number | null,
  chunks: ReturnType<typeof chunkDocument>,
  vectors: number[][],
) {
  const { embedding } = aiProviders();
  await setStage(document.id, "index", "processing", "Writing the search index.", 90);

  const now = new Date();
  const tokenCount = chunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0);

  await db.transaction(async (tx) => {
    // Re-indexing replaces rather than appends: `(document_id, chunk_index)` is
    // unique, and stale chunks from a previous run would otherwise stay
    // retrievable alongside the new ones.
    await tx.delete(knowledgeChunks).where(eq(knowledgeChunks.documentId, document.id));

    await tx.insert(knowledgeChunks).values(
      chunks.map((chunk, index) => ({
        id: newId("chk"),
        companyId: document.companyId,
        documentId: document.id,
        chunkIndex: index,
        text: chunk.text,
        tokenCount: chunk.tokenCount,
        locator: chunk.locator,
        embeddingStatus: "ready" as const,
        embedding: vectors[index]!,
        embeddingModel: embedding.id,
      })),
    );

    await tx
      .update(knowledgeDocuments)
      .set({
        status: "ready",
        progress: 100,
        embeddingStatus: "ready",
        indexStatus: "ready",
        embeddingModel: embedding.id,
        vectorCount: vectors.length,
        tokenCount,
        pageCount,
        errorMessage: null,
        claimedAt: null,
        pipeline: stagesWith(await currentPipeline(tx, document.id), "index", "ready", "Indexed and searchable."),
        updatedAt: now,
      })
      .where(eq(knowledgeDocuments.id, document.id));

    await rollUpSource(tx, document.sourceId, now);
  });
}

/**
 * A source is only as ready as its least-ready document.
 *
 * The sources list shows one status per source, and reporting Ready while one
 * of its five PDFs failed would hide the failure behind an aggregate.
 */
async function rollUpSource(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], sourceId: string, now: Date) {
  const [counts] = await tx
    .select({
      total: sql<number>`count(*)::int`,
      ready: sql<number>`count(*) filter (where ${knowledgeDocuments.status} = 'ready')::int`,
      failed: sql<number>`count(*) filter (where ${knowledgeDocuments.status} = 'failed')::int`,
    })
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.sourceId, sourceId));

  if (!counts) return;

  const status = counts.failed > 0 ? "failed" : counts.ready === counts.total ? "ready" : "processing";
  await tx
    .update(knowledgeSources)
    .set({ status, lastIndexedAt: status === "ready" ? now : undefined, updatedAt: now })
    .where(eq(knowledgeSources.id, sourceId));
}

async function failDocument(documentId: string, message: string): Promise<void> {
  const now = new Date();
  const pipeline = await currentPipeline(db, documentId);
  // Mark whichever stage was in flight as the one that failed, so the timeline
  // points at the step that broke rather than just saying the document did.
  const inFlight = pipeline.find((stage) => stage.status === "processing")?.stage ?? "extract";

  await db.transaction(async (tx) => {
    await tx
      .update(knowledgeDocuments)
      .set({
        status: "failed",
        errorMessage: message,
        embeddingStatus: "failed",
        indexStatus: "failed",
        claimedAt: null,
        pipeline: stagesWith(pipeline, inFlight, "failed", message),
        updatedAt: now,
      })
      .where(eq(knowledgeDocuments.id, documentId));

    const [row] = await tx
      .select({ sourceId: knowledgeDocuments.sourceId })
      .from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.id, documentId))
      .limit(1);
    if (row) await rollUpSource(tx, row.sourceId, now);
  });
}

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

async function currentPipeline(executor: Executor, documentId: string): Promise<PipelineStage[]> {
  const [row] = await executor
    .select({ pipeline: knowledgeDocuments.pipeline })
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.id, documentId))
    .limit(1);
  return row?.pipeline ?? [];
}

function stagesWith(
  pipeline: PipelineStage[],
  stage: PipelineStage["stage"],
  status: PipelineStage["status"],
  detail: string,
): PipelineStage[] {
  const at = new Date().toISOString();
  return pipeline.map((entry) =>
    entry.stage === stage
      ? {
          ...entry,
          status,
          startedAt: entry.startedAt ?? at,
          finishedAt: status === "processing" ? null : at,
          detail,
        }
      : entry,
  );
}

async function setStage(
  documentId: string,
  stage: PipelineStage["stage"],
  status: PipelineStage["status"],
  detail: string,
  progress: number,
): Promise<void> {
  const pipeline = await currentPipeline(db, documentId);
  await db
    .update(knowledgeDocuments)
    .set({
      pipeline: stagesWith(pipeline, stage, status, detail),
      progress,
      // The claim is refreshed on every stage, so a long document is not
      // reclaimed by another worker halfway through embedding it.
      claimedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(knowledgeDocuments.id, documentId)));
}
