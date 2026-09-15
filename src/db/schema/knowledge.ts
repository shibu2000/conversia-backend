import { relations, sql } from "drizzle-orm";
import { bigint, boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { env } from "../../config/env";
import { companies } from "./companies";
import { tsvector, vector } from "./custom-types";
import { users } from "./users";
import { knowledgeSourceTypeEnum, processingStatusEnum } from "./enums";

/**
 * The width of the embedding column, sourced from `AI_EMBEDDING_DIMENSIONS` so
 * this declaration always matches what `ensureEmbeddingDimensions()`
 * (`src/db/ensure-embedding-dimensions.ts`) maintains in the real database.
 *
 * Fixed *at boot* rather than truly dynamic, because an HNSW index cannot span
 * widths — the column is one fixed width at a time, chosen from the
 * environment when the process starts. Changing the model on an established
 * deployment (real embeddings already stored) still needs the reviewed
 * migration path; only a table with no embeddings yet resizes automatically.
 */
export const EMBEDDING_DIMENSIONS = env.AI_EMBEDDING_DIMENSIONS;

/**
 * Knowledge Base: collections → sources → documents → chunks.
 *
 * This schema covers document *management*: what was uploaded, where it came
 * from, how large it is, and where it sits in the processing pipeline.
 * Extraction, chunking, embedding and vector search belong to the AI layer and
 * are not implemented in this codebase. The columns those stages will populate
 * exist and default to a pending state — so the pipeline can be added without a
 * migration that rewrites live rows — but nothing here writes a vector, and
 * `embeddingStatus` staying `pending` is an honest report rather than a stub.
 */
export const knowledgeCollections = pgTable(
  "knowledge_collections",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    /** Collections can be withheld from the chatbot (internal HR docs, runbooks). */
    availableToChatbot: boolean("available_to_chatbot").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("knowledge_collections_company_idx").on(table.companyId)],
);

export interface CrawlSettings {
  rootUrl: string;
  maxDepth: number;
  pagesDiscovered: number;
  pagesIndexed: number;
  refreshIntervalHours: number;
  lastCrawlAt: string | null;
}

export const knowledgeSources = pgTable(
  "knowledge_sources",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    collectionId: text("collection_id")
      .notNull()
      .references(() => knowledgeCollections.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: knowledgeSourceTypeEnum("type").notNull(),
    status: processingStatusEnum("status").notNull().default("pending"),
    /** Filename for uploads, URL for crawls. */
    origin: text("origin").notNull().default(""),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
    lastIndexedAt: timestamp("last_indexed_at", { withTimezone: true }),
    enabled: boolean("enabled").notNull().default(true),
    errorMessage: text("error_message"),
    /** Crawl settings, present only for `website` sources. */
    crawl: jsonb("crawl").$type<CrawlSettings>(),
    addedById: text("added_by_id").references(() => users.id, { onDelete: "set null" }),
    addedByName: text("added_by_name").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("knowledge_sources_company_idx").on(table.companyId),
    index("knowledge_sources_collection_idx").on(table.collectionId),
    index("knowledge_sources_status_idx").on(table.companyId, table.status),
    index("knowledge_sources_name_trgm_idx").using("gin", sql`${table.name} gin_trgm_ops`),
  ],
);

export interface PipelineStage {
  stage: "upload" | "extract" | "chunk" | "embed" | "index";
  status: "pending" | "processing" | "ready" | "failed" | "outdated";
  startedAt: string | null;
  finishedAt: string | null;
  detail: string;
}

export const knowledgeDocuments = pgTable(
  "knowledge_documents",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    sourceId: text("source_id")
      .notNull()
      .references(() => knowledgeSources.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    mimeType: text("mime_type").notNull().default("text/plain"),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
    pageCount: integer("page_count"),
    status: processingStatusEnum("status").notNull().default("pending"),
    /** 0–100 completion of the processing pipeline. */
    progress: integer("progress").notNull().default(0),
    tokenCount: integer("token_count").notNull().default(0),

    // Populated by the future embedding pipeline. Left pending here.
    embeddingStatus: processingStatusEnum("embedding_status").notNull().default("pending"),
    embeddingModel: text("embedding_model").notNull().default(""),
    vectorCount: integer("vector_count").notNull().default(0),
    indexStatus: processingStatusEnum("index_status").notNull().default("pending"),

    language: text("language").notNull().default("en"),
    extractedText: text("extracted_text").notNull().default(""),
    url: text("url"),
    errorMessage: text("error_message"),
    /** Per-stage log the document processing view renders. */
    pipeline: jsonb("pipeline").$type<PipelineStage[]>().notNull().default(sql`'[]'::jsonb`),
    retrievalCount30d: integer("retrieval_count_30d").notNull().default(0),
    /**
     * Where the bytes live: a relative key under the configured storage root.
     * Local disk in development, an object-store key in production — the column
     * holds whichever the active driver produced.
     */
    storageKey: text("storage_key"),
    checksum: text("checksum"),
    /**
     * Held by the indexing worker while it processes this document.
     *
     * A claim older than the stale window is reclaimable, which is what stops a
     * crash mid-document stranding it at `processing` forever.
     */
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("knowledge_documents_claim_idx").on(table.status, table.claimedAt),
    index("knowledge_documents_company_idx").on(table.companyId, table.updatedAt.desc()),
    index("knowledge_documents_source_idx").on(table.sourceId),
    index("knowledge_documents_status_idx").on(table.companyId, table.status),
    index("knowledge_documents_name_trgm_idx").using("gin", sql`${table.name} gin_trgm_ops`),
  ],
);

export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    documentId: text("document_id")
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    text: text("text").notNull(),
    tokenCount: integer("token_count").notNull().default(0),
    /** Page or heading the chunk came from. */
    locator: text("locator").notNull().default(""),
    embeddingStatus: processingStatusEnum("embedding_status").notNull().default("pending"),
    retrievalCount30d: integer("retrieval_count_30d").notNull().default(0),
    /**
     * The semantic index: one vector per chunk, written by the AI layer.
     *
     * Null until that chunk has been embedded, so retrieval filters on
     * `IS NOT NULL` rather than assuming every row is searchable.
     */
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    /**
     * Which model produced the vector.
     *
     * Two models' vectors are not comparable, so this is what lets a provider
     * change mark the affected documents `outdated` instead of quietly mixing
     * incompatible spaces inside one index.
     */
    embeddingModel: text("embedding_model").notNull().default(""),
    /**
     * Lexical index over chunk text, for keyword lookup in the admin UI.
     *
     * Kept alongside the vector rather than replaced by it: exact-term lookup
     * and semantic similarity answer different questions, and the chunk list
     * screen searches by wording.
     */
    searchVector: tsvector("search_vector").generatedAlwaysAs(sql`to_tsvector('english'::regconfig, coalesce(text, ''))`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("knowledge_chunks_document_index_idx").on(table.documentId, table.chunkIndex),
    index("knowledge_chunks_company_idx").on(table.companyId),
    index("knowledge_chunks_search_idx").using("gin", table.searchVector),
  ],
);

export const knowledgeCollectionsRelations = relations(knowledgeCollections, ({ one, many }) => ({
  company: one(companies, { fields: [knowledgeCollections.companyId], references: [companies.id] }),
  sources: many(knowledgeSources),
}));

export const knowledgeSourcesRelations = relations(knowledgeSources, ({ one, many }) => ({
  collection: one(knowledgeCollections, {
    fields: [knowledgeSources.collectionId],
    references: [knowledgeCollections.id],
  }),
  documents: many(knowledgeDocuments),
}));

export const knowledgeDocumentsRelations = relations(knowledgeDocuments, ({ one, many }) => ({
  source: one(knowledgeSources, { fields: [knowledgeDocuments.sourceId], references: [knowledgeSources.id] }),
  chunks: many(knowledgeChunks),
}));

export const knowledgeChunksRelations = relations(knowledgeChunks, ({ one }) => ({
  document: one(knowledgeDocuments, { fields: [knowledgeChunks.documentId], references: [knowledgeDocuments.id] }),
}));
