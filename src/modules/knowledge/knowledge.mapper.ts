import { iso, isoRequired } from "../../core/serialize";
import type { knowledgeChunks, knowledgeCollections, knowledgeDocuments, knowledgeSources } from "../../db/schema";

type CollectionRow = typeof knowledgeCollections.$inferSelect;
type SourceRow = typeof knowledgeSources.$inferSelect;
type DocumentRow = typeof knowledgeDocuments.$inferSelect;
type ChunkRow = typeof knowledgeChunks.$inferSelect;

export function toCollection(
  row: CollectionRow,
  counts: { sourceCount: number; documentCount: number; chunkCount: number },
) {
  return {
    id: row.id,
    companyId: row.companyId,
    name: row.name,
    description: row.description,
    availableToChatbot: row.availableToChatbot,
    sourceCount: Number(counts.sourceCount),
    documentCount: Number(counts.documentCount),
    chunkCount: Number(counts.chunkCount),
  };
}

export function toSource(
  row: SourceRow,
  collectionName: string | null,
  counts: { documentCount: number; chunkCount: number },
) {
  return {
    id: row.id,
    companyId: row.companyId,
    collectionId: row.collectionId,
    collectionName: collectionName ?? "",
    name: row.name,
    type: row.type,
    status: row.status,
    origin: row.origin,
    documentCount: Number(counts.documentCount),
    chunkCount: Number(counts.chunkCount),
    sizeBytes: Number(row.sizeBytes),
    lastIndexedAt: iso(row.lastIndexedAt),
    enabled: row.enabled,
    errorMessage: row.errorMessage,
    crawl: row.crawl ?? undefined,
    addedByName: row.addedByName,
    createdAt: isoRequired(row.createdAt),
    updatedAt: isoRequired(row.updatedAt),
  };
}

export function toDocument(row: DocumentRow, sourceName: string | null, chunkCount: number) {
  return {
    id: row.id,
    companyId: row.companyId,
    sourceId: row.sourceId,
    sourceName: sourceName ?? "",
    name: row.name,
    mimeType: row.mimeType,
    sizeBytes: Number(row.sizeBytes),
    pageCount: row.pageCount,
    status: row.status,
    progress: row.progress,
    chunkCount: Number(chunkCount),
    tokenCount: row.tokenCount,
    // These stay `pending` until the AI layer exists. Reporting anything else
    // would claim indexing work that has not happened.
    embeddingStatus: row.embeddingStatus,
    embeddingModel: row.embeddingModel,
    vectorCount: row.vectorCount,
    indexStatus: row.indexStatus,
    language: row.language,
    extractedText: row.extractedText,
    url: row.url ?? undefined,
    errorMessage: row.errorMessage,
    pipeline: row.pipeline,
    retrievalCount30d: row.retrievalCount30d,
    createdAt: isoRequired(row.createdAt),
    updatedAt: isoRequired(row.updatedAt),
  };
}

export function toChunk(row: ChunkRow) {
  return {
    id: row.id,
    documentId: row.documentId,
    index: row.chunkIndex,
    text: row.text,
    tokenCount: row.tokenCount,
    locator: row.locator,
    embeddingStatus: row.embeddingStatus,
    retrievalCount30d: row.retrievalCount30d,
  };
}

/**
 * The initial processing log for a newly created document.
 *
 * Only the upload stage is complete. Everything after it is genuinely waiting
 * on a pipeline that has not been built, and the detail text says so rather
 * than implying a queue is working through it.
 */
export function initialPipeline(now: Date): DocumentRow["pipeline"] {
  const at = now.toISOString();
  return [
    { stage: "upload", status: "ready", startedAt: at, finishedAt: at, detail: "File received and stored." },
    { stage: "extract", status: "pending", startedAt: null, finishedAt: null, detail: "Waiting for the processing pipeline." },
    { stage: "chunk", status: "pending", startedAt: null, finishedAt: null, detail: "Waiting for extraction." },
    { stage: "embed", status: "pending", startedAt: null, finishedAt: null, detail: "Waiting for chunking." },
    { stage: "index", status: "pending", startedAt: null, finishedAt: null, detail: "Waiting for embeddings." },
  ];
}
