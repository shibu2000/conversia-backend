import path from "node:path";
import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db, type Transaction } from "../../db";
import {
  chatbotConfigs,
  knowledgeChunks,
  knowledgeCollections,
  knowledgeDocuments,
  knowledgeSources,
} from "../../db/schema";
import { aiGateway } from "../../ai/ai-gateway";
import { notFound, validationError } from "../../core/errors";
import { newId } from "../../core/ids";
import { likePattern, paginate, resolveOrderBy, type ListQuery, type Paginated } from "../../core/list-query";
import type { AuthContext } from "../auth/auth.types";
import { deleteFile, storeFile } from "../uploads/storage.service";
import { initialPipeline, toChunk, toCollection, toDocument, toSource } from "./knowledge.mapper";
import type { CreateSourceInput } from "./knowledge.schema";

/** Rollups computed from live rows rather than kept as denormalised counters. */
const sourceDocumentCount = sql<number>`(SELECT count(*) FROM knowledge_documents d WHERE d.source_id = knowledge_sources.id)`;
const sourceChunkCount = sql<number>`(SELECT count(*) FROM knowledge_chunks c JOIN knowledge_documents d ON d.id = c.document_id WHERE d.source_id = knowledge_sources.id)`;

export async function listCollections(companyId: string) {
  const rows = await db
    .select({
      collection: knowledgeCollections,
      // Table names are written out rather than interpolated from the schema
      // objects: inside a SELECT list Drizzle renders a column reference
      // unqualified, which makes `collection_id = id` ambiguous against the
      // outer row. Explicit qualification is unambiguous.
      sourceCount: sql<number>`(SELECT count(*) FROM knowledge_sources s WHERE s.collection_id = knowledge_collections.id)`,
      documentCount: sql<number>`(SELECT count(*) FROM knowledge_documents d JOIN knowledge_sources s ON s.id = d.source_id WHERE s.collection_id = knowledge_collections.id)`,
      chunkCount: sql<number>`(SELECT count(*) FROM knowledge_chunks c JOIN knowledge_documents d ON d.id = c.document_id JOIN knowledge_sources s ON s.id = d.source_id WHERE s.collection_id = knowledge_collections.id)`,
    })
    .from(knowledgeCollections)
    .where(eq(knowledgeCollections.companyId, companyId))
    .orderBy(asc(knowledgeCollections.name));

  return rows.map((row) =>
    toCollection(row.collection, {
      sourceCount: Number(row.sourceCount),
      documentCount: Number(row.documentCount),
      chunkCount: Number(row.chunkCount),
    }),
  );
}

export async function createCollection(
  companyId: string,
  input: { name: string; description: string; availableToChatbot: boolean },
) {
  const id = newId("kbc");
  await db.insert(knowledgeCollections).values({ id, companyId, ...input });
  const collections = await listCollections(companyId);
  return collections.find((collection) => collection.id === id)!;
}

export async function updateCollection(companyId: string, collectionId: string, patch: Record<string, unknown>) {
  const [updated] = await db
    .update(knowledgeCollections)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(knowledgeCollections.id, collectionId), eq(knowledgeCollections.companyId, companyId)))
    .returning({ id: knowledgeCollections.id });

  if (!updated) throw notFound("Collection", collectionId);

  const collections = await listCollections(companyId);
  return collections.find((collection) => collection.id === collectionId)!;
}

const SOURCE_SORT = {
  name: knowledgeSources.name,
  type: knowledgeSources.type,
  status: knowledgeSources.status,
  size: knowledgeSources.sizeBytes,
  lastIndexed: knowledgeSources.lastIndexedAt,
  documents: sourceDocumentCount,
  chunks: sourceChunkCount,
};

export async function listSources(companyId: string, query: ListQuery): Promise<Paginated<ReturnType<typeof toSource>>> {
  const conditions: SQL[] = [eq(knowledgeSources.companyId, companyId)];

  if (query.search) {
    const pattern = likePattern(query.search);
    conditions.push(
      or(
        ilike(knowledgeSources.name, pattern),
        ilike(knowledgeSources.origin, pattern),
        ilike(knowledgeCollections.name, pattern),
      )!,
    );
  }
  if (query.filters.status) conditions.push(inArray(knowledgeSources.status, query.filters.status as never));
  if (query.filters.type) conditions.push(inArray(knowledgeSources.type, query.filters.type as never));
  if (query.filters.collectionId) conditions.push(inArray(knowledgeSources.collectionId, query.filters.collectionId));

  const where = and(...conditions);

  const [[total], rows] = await Promise.all([
    db
      .select({ value: count() })
      .from(knowledgeSources)
      .leftJoin(knowledgeCollections, eq(knowledgeCollections.id, knowledgeSources.collectionId))
      .where(where),
    db
      .select({
        source: knowledgeSources,
        collectionName: knowledgeCollections.name,
        documentCount: sourceDocumentCount,
        chunkCount: sourceChunkCount,
      })
      .from(knowledgeSources)
      .leftJoin(knowledgeCollections, eq(knowledgeCollections.id, knowledgeSources.collectionId))
      .where(where)
      .orderBy(resolveOrderBy(query, SOURCE_SORT, "name"))
      .limit(query.pageSize)
      .offset(query.offset),
  ]);

  return paginate(
    rows.map((row) =>
      toSource(row.source, row.collectionName, {
        documentCount: Number(row.documentCount),
        chunkCount: Number(row.chunkCount),
      }),
    ),
    Number(total?.value ?? 0),
    query,
  );
}

export async function getSource(companyId: string, sourceId: string) {
  const [row] = await db
    .select({
      source: knowledgeSources,
      collectionName: knowledgeCollections.name,
      documentCount: sourceDocumentCount,
      chunkCount: sourceChunkCount,
    })
    .from(knowledgeSources)
    .leftJoin(knowledgeCollections, eq(knowledgeCollections.id, knowledgeSources.collectionId))
    .where(and(eq(knowledgeSources.id, sourceId), eq(knowledgeSources.companyId, companyId)))
    .limit(1);

  if (!row) throw notFound("Source", sourceId);

  return toSource(row.source, row.collectionName, {
    documentCount: Number(row.documentCount),
    chunkCount: Number(row.chunkCount),
  });
}

/**
 * Create a source and its documents.
 *
 * Uploaded bytes are stored and recorded; a website source records its crawl
 * settings; a manual source stores the text that was typed. In every case the
 * document lands in `pending`.
 *
 * Nothing here extracts, chunks or embeds. That pipeline is the AI layer's, and
 * marking a document `ready` without running it would tell an administrator
 * their policy PDF is searchable when it is a row in a table and nothing more.
 */
export async function createSource(
  companyId: string,
  auth: AuthContext,
  input: CreateSourceInput,
  files: Array<{ originalname: string; mimetype: string; buffer: Buffer }> = [],
) {
  const [collection] = await db
    .select({ id: knowledgeCollections.id })
    .from(knowledgeCollections)
    .where(and(eq(knowledgeCollections.id, input.collectionId), eq(knowledgeCollections.companyId, companyId)))
    .limit(1);

  if (!collection) {
    throw validationError("That collection is not in this workspace.", { collectionId: "Choose a collection." });
  }

  if (input.type !== "website" && input.type !== "manual" && files.length === 0) {
    throw validationError("Add at least one file.", { files: "Attach a document to upload." });
  }

  const sourceId = newId("kbs");
  const now = new Date();

  // Bytes are written to storage before the transaction opens: a failed write
  // must not leave a committed row pointing at a file that does not exist.
  const stored = await Promise.all(
    files.map(async (file) => ({
      file,
      result: await storeFile(companyId, file.buffer, path.extname(file.originalname)),
    })),
  );

  try {
    await db.transaction(async (tx) => {
      await tx.insert(knowledgeSources).values({
        id: sourceId,
        companyId,
        collectionId: input.collectionId,
        name: input.name,
        type: input.type,
        status: "pending",
        origin: input.origin || (input.crawl?.rootUrl ?? files.map((file) => file.originalname).join(", ")),
        sizeBytes: stored.reduce((sum, entry) => sum + entry.result.sizeBytes, 0),
        enabled: true,
        crawl: input.crawl
          ? {
              rootUrl: input.crawl.rootUrl,
              maxDepth: input.crawl.maxDepth,
              pagesDiscovered: 0,
              pagesIndexed: 0,
              refreshIntervalHours: input.crawl.refreshIntervalHours,
              lastCrawlAt: null,
            }
          : null,
        addedById: auth.userId,
        addedByName: auth.name,
        createdAt: now,
        updatedAt: now,
      });

      if (stored.length > 0) {
        await tx.insert(knowledgeDocuments).values(
          stored.map((entry) => ({
            id: newId("doc"),
            companyId,
            sourceId,
            name: entry.file.originalname,
            mimeType: entry.file.mimetype,
            sizeBytes: entry.result.sizeBytes,
            status: "pending" as const,
            progress: 0,
            pipeline: initialPipeline(now),
            storageKey: entry.result.storageKey,
            checksum: entry.result.checksum,
            createdAt: now,
            updatedAt: now,
          })),
        );
      } else {
        // Website and manual sources still get one document row, so the source
        // has something to report progress against.
        await tx.insert(knowledgeDocuments).values({
          id: newId("doc"),
          companyId,
          sourceId,
          name: input.name,
          mimeType: input.type === "website" ? "text/html" : "text/plain",
          sizeBytes: input.content ? Buffer.byteLength(input.content) : 0,
          status: "pending",
          progress: 0,
          // Text typed into the dashboard needs no extraction, so it is stored
          // directly. It is still not chunked or embedded — that is the AI layer.
          extractedText: input.content ?? "",
          url: input.crawl?.rootUrl,
          pipeline: initialPipeline(now),
          createdAt: now,
          updatedAt: now,
        });
      }
    });
  } catch (error) {
    await Promise.all(stored.map((entry) => deleteFile(entry.result.storageKey)));
    throw error;
  }

  // ─── The AI layer's turn ────────────────────────────────────────────────
  //
  // Extraction, chunking and embedding belong to the processing pipeline. The
  // documents are already stored and recorded, so handing them over is a
  // separate step that can fail without losing the upload — the source simply
  // stays `pending` and can be re-indexed.
  await queueForProcessing(companyId, sourceId);

  return getSource(companyId, sourceId);
}

/**
 * Hand a source's documents to the processing pipeline.
 *
 * A no-op until an `AIGateway` is registered, which is why an uploaded document
 * sits at `pending` with `vectorCount: 0` on this deployment. That is an honest
 * report of the state, not a stub pretending to work.
 */
async function queueForProcessing(companyId: string, sourceId: string): Promise<boolean> {
  if (!aiGateway().isEnabled()) return false;

  const documents = await db
    .select({
      id: knowledgeDocuments.id,
      storageKey: knowledgeDocuments.storageKey,
      mimeType: knowledgeDocuments.mimeType,
    })
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.sourceId, sourceId));

  await db
    .update(knowledgeDocuments)
    .set({ status: "processing", updatedAt: new Date() })
    .where(eq(knowledgeDocuments.sourceId, sourceId));

  await Promise.all(
    documents.map((document) =>
      aiGateway()
        .processDocument({ companyId, documentId: document.id, storageKey: document.storageKey, mimeType: document.mimeType })
        .catch(async (error: unknown) => {
          // One document failing must not take the rest of the batch with it.
          await db
            .update(knowledgeDocuments)
            .set({
              status: "failed",
              errorMessage: error instanceof Error ? error.message : "Processing failed.",
              updatedAt: new Date(),
            })
            .where(eq(knowledgeDocuments.id, document.id));
        }),
    ),
  );

  return true;
}

export async function updateSource(companyId: string, sourceId: string, patch: Record<string, unknown>) {
  if (patch.collectionId) {
    const [collection] = await db
      .select({ id: knowledgeCollections.id })
      .from(knowledgeCollections)
      .where(and(eq(knowledgeCollections.id, patch.collectionId as string), eq(knowledgeCollections.companyId, companyId)))
      .limit(1);
    if (!collection) {
      throw validationError("That collection is not in this workspace.", { collectionId: "Choose a collection." });
    }
  }

  const [updated] = await db
    .update(knowledgeSources)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(knowledgeSources.id, sourceId), eq(knowledgeSources.companyId, companyId)))
    .returning({ id: knowledgeSources.id });

  if (!updated) throw notFound("Source", sourceId);
  return getSource(companyId, sourceId);
}

/**
 * Queue a source for re-processing.
 *
 * With no AI layer registered, this resets the documents to `pending` and says
 * so — it does not pretend a job is running. Once the gateway is implemented
 * this is where it gets handed the work.
 */
export async function reindexSource(companyId: string, sourceId: string) {
  const source = await getSource(companyId, sourceId);
  const now = new Date();
  const enabled = aiGateway().isEnabled();

  await db.transaction(async (tx) => {
    await tx
      .update(knowledgeSources)
      .set({ status: enabled ? "processing" : "pending", errorMessage: null, updatedAt: now })
      .where(eq(knowledgeSources.id, sourceId));

    await tx
      .update(knowledgeDocuments)
      .set({
        status: enabled ? "processing" : "pending",
        progress: 0,
        embeddingStatus: "pending",
        indexStatus: "pending",
        errorMessage: null,
        pipeline: initialPipeline(now),
        updatedAt: now,
      })
      .where(eq(knowledgeDocuments.sourceId, sourceId));
  });

  if (enabled) await queueForProcessing(companyId, sourceId);

  return { source: await getSource(companyId, sourceId), queued: enabled };
}

export async function deleteSource(companyId: string, sourceId: string) {
  const documents = await db
    .select({ storageKey: knowledgeDocuments.storageKey })
    .from(knowledgeDocuments)
    .innerJoin(knowledgeSources, eq(knowledgeSources.id, knowledgeDocuments.sourceId))
    .where(and(eq(knowledgeSources.id, sourceId), eq(knowledgeSources.companyId, companyId)));

  const [deleted] = await db
    .delete(knowledgeSources)
    .where(and(eq(knowledgeSources.id, sourceId), eq(knowledgeSources.companyId, companyId)))
    .returning({ id: knowledgeSources.id });

  if (!deleted) throw notFound("Source", sourceId);

  // Rows cascade; the bytes do not, so they are removed after the row is gone.
  // Deleting files first would strand the documents if the delete failed.
  await Promise.all(documents.filter((row) => row.storageKey).map((row) => deleteFile(row.storageKey!)));
}

const documentChunkCount = sql<number>`(SELECT count(*) FROM knowledge_chunks c WHERE c.document_id = knowledge_documents.id)`;

export async function listDocuments(companyId: string, query: ListQuery, sourceId?: string) {
  const conditions: SQL[] = [eq(knowledgeDocuments.companyId, companyId)];
  if (sourceId) conditions.push(eq(knowledgeDocuments.sourceId, sourceId));

  if (query.search) {
    const pattern = likePattern(query.search);
    conditions.push(or(ilike(knowledgeDocuments.name, pattern), ilike(knowledgeSources.name, pattern))!);
  }
  if (query.filters.status) conditions.push(inArray(knowledgeDocuments.status, query.filters.status as never));
  if (query.filters.sourceId) conditions.push(inArray(knowledgeDocuments.sourceId, query.filters.sourceId));

  const where = and(...conditions);

  const [[total], rows] = await Promise.all([
    db
      .select({ value: count() })
      .from(knowledgeDocuments)
      .leftJoin(knowledgeSources, eq(knowledgeSources.id, knowledgeDocuments.sourceId))
      .where(where),
    db
      .select({ document: knowledgeDocuments, sourceName: knowledgeSources.name, chunkCount: documentChunkCount })
      .from(knowledgeDocuments)
      .leftJoin(knowledgeSources, eq(knowledgeSources.id, knowledgeDocuments.sourceId))
      .where(where)
      .orderBy(query.sortDir === "asc" ? asc(knowledgeDocuments.updatedAt) : desc(knowledgeDocuments.updatedAt))
      .limit(query.pageSize)
      .offset(query.offset),
  ]);

  return paginate(
    rows.map((row) => toDocument(row.document, row.sourceName, Number(row.chunkCount))),
    Number(total?.value ?? 0),
    query,
  );
}

export async function getDocument(companyId: string, documentId: string) {
  const [row] = await db
    .select({ document: knowledgeDocuments, sourceName: knowledgeSources.name, chunkCount: documentChunkCount })
    .from(knowledgeDocuments)
    .leftJoin(knowledgeSources, eq(knowledgeSources.id, knowledgeDocuments.sourceId))
    .where(and(eq(knowledgeDocuments.id, documentId), eq(knowledgeDocuments.companyId, companyId)))
    .limit(1);

  if (!row) throw notFound("Document", documentId);
  return toDocument(row.document, row.sourceName, Number(row.chunkCount));
}

export async function getDocumentChunks(companyId: string, documentId: string) {
  await getDocument(companyId, documentId);

  const rows = await db
    .select()
    .from(knowledgeChunks)
    .where(and(eq(knowledgeChunks.documentId, documentId), eq(knowledgeChunks.companyId, companyId)))
    .orderBy(asc(knowledgeChunks.chunkIndex));

  return rows.map(toChunk);
}

export async function reindexDocument(companyId: string, documentId: string) {
  const document = await getDocument(companyId, documentId);
  const now = new Date();
  const enabled = aiGateway().isEnabled();

  await db
    .update(knowledgeDocuments)
    .set({
      status: enabled ? "processing" : "pending",
      progress: 0,
      embeddingStatus: "pending",
      indexStatus: "pending",
      errorMessage: null,
      pipeline: initialPipeline(now),
      updatedAt: now,
    })
    .where(eq(knowledgeDocuments.id, documentId));

  if (enabled) {
    const [row] = await db
      .select({ storageKey: knowledgeDocuments.storageKey, mimeType: knowledgeDocuments.mimeType })
      .from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.id, documentId))
      .limit(1);
    await aiGateway().processDocument({
      companyId,
      documentId,
      storageKey: row?.storageKey ?? null,
      mimeType: row?.mimeType ?? document.mimeType,
    });
  }

  return { document: await getDocument(companyId, documentId), queued: enabled };
}

export async function deleteDocument(companyId: string, documentId: string) {
  const [row] = await db
    .select({ storageKey: knowledgeDocuments.storageKey })
    .from(knowledgeDocuments)
    .where(and(eq(knowledgeDocuments.id, documentId), eq(knowledgeDocuments.companyId, companyId)))
    .limit(1);

  if (!row) throw notFound("Document", documentId);

  await db.delete(knowledgeDocuments).where(eq(knowledgeDocuments.id, documentId));
  if (row.storageKey) await deleteFile(row.storageKey);
}

/** Download the original bytes of an uploaded document. */
export async function getDocumentFile(companyId: string, documentId: string) {
  const [row] = await db
    .select({
      name: knowledgeDocuments.name,
      mimeType: knowledgeDocuments.mimeType,
      storageKey: knowledgeDocuments.storageKey,
    })
    .from(knowledgeDocuments)
    .where(and(eq(knowledgeDocuments.id, documentId), eq(knowledgeDocuments.companyId, companyId)))
    .limit(1);

  if (!row?.storageKey) throw notFound("Document file", documentId);
  return row;
}

/**
 * Retrieval test.
 *
 * Semantic retrieval is the AI layer's. With no gateway registered this returns
 * a well-formed, honest result: no chunks, `answered: false`, and a reason that
 * names the missing capability. The frontend already renders exactly that
 * shape for a miss, so the diagnostic screen stays useful and truthful instead
 * of reporting similarity scores no model computed.
 */
export async function runRetrievalTest(
  companyId: string,
  input: { question: string; collectionIds?: string[]; threshold?: number; maxChunks?: number },
) {
  const startedAt = Date.now();

  if (!aiGateway().isEnabled()) {
    return {
      id: newId("rt"),
      question: input.question,
      askedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
      chunks: [],
      answer: "",
      answered: false,
      fallbackReason:
        "Semantic retrieval is not enabled on this deployment. Documents are stored and managed, but the embedding and vector-search layer has not been installed yet, so there is nothing to retrieve against.",
      model: "",
      tokensIn: 0,
      tokensOut: 0,
    };
  }

  const result = await aiGateway().retrieve({ companyId, ...input });
  return {
    id: newId("rt"),
    question: input.question,
    askedAt: new Date().toISOString(),
    latencyMs: result.latencyMs,
    chunks: result.chunks,
    answer: result.answer,
    answered: result.answered,
    fallbackReason: result.fallbackReason,
    model: result.model,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
  };
}

/**
 * The collections a new workspace starts with.
 *
 * Without at least one, the Add Source dialog has nothing to put a source in
 * and the API rejects an empty `collectionId` — so a brand-new company could
 * not add any knowledge at all. Three is the smallest set that also makes the
 * point of collections visible on day one: two the chatbot may use, and one it
 * may not.
 */
export async function createDefaultCollections(tx: Transaction, companyId: string): Promise<void> {
  await tx.insert(knowledgeCollections).values([
    {
      id: newId("kbc"),
      companyId,
      name: "Policies",
      description: "Customer-facing policy documents: returns, shipping, warranty.",
      availableToChatbot: true,
    },
    {
      id: newId("kbc"),
      companyId,
      name: "Product Documentation",
      description: "Spec sheets, care guides and sizing charts for the catalogue.",
      availableToChatbot: true,
    },
    {
      id: newId("kbc"),
      companyId,
      name: "Internal",
      description: "Staff handbooks and runbooks. Withheld from the chatbot by default.",
      availableToChatbot: false,
    },
  ]);
}

/**
 * Delete a collection.
 *
 * Refuses while it still holds sources rather than cascading. A collection is a
 * grouping, and deleting a grouping should not silently destroy the documents
 * inside it — the stored files would go with them. Move or delete the sources
 * first, deliberately.
 */
export async function deleteCollection(companyId: string, collectionId: string) {
  const [collection] = await db
    .select({
      id: knowledgeCollections.id,
      name: knowledgeCollections.name,
      sourceCount: sql<number>`(SELECT count(*) FROM knowledge_sources s WHERE s.collection_id = knowledge_collections.id)`,
    })
    .from(knowledgeCollections)
    .where(and(eq(knowledgeCollections.id, collectionId), eq(knowledgeCollections.companyId, companyId)))
    .limit(1);

  if (!collection) throw notFound("Collection", collectionId);

  if (Number(collection.sourceCount) > 0) {
    throw validationError(
      `“${collection.name}” still holds ${collection.sourceCount} source${Number(collection.sourceCount) === 1 ? "" : "s"}. Move or delete them first.`,
    );
  }

  // A collection referenced by the published chatbot config would leave a
  // dangling id behind; strip it so the widget's knowledge selection stays true.
  await db.transaction(async (tx) => {
    await tx.delete(knowledgeCollections).where(eq(knowledgeCollections.id, collectionId));

    const [config] = await tx
      .select({ knowledge: chatbotConfigs.knowledge })
      .from(chatbotConfigs)
      .where(eq(chatbotConfigs.companyId, companyId))
      .limit(1);

    if (config?.knowledge?.collectionIds?.includes(collectionId)) {
      await tx
        .update(chatbotConfigs)
        .set({
          knowledge: {
            ...config.knowledge,
            collectionIds: config.knowledge.collectionIds.filter((id) => id !== collectionId),
          },
          hasUnpublishedChanges: true,
          updatedAt: new Date(),
        })
        .where(eq(chatbotConfigs.companyId, companyId));
    }
  });
}
