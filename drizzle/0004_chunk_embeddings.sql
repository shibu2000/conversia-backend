-- Semantic index over knowledge chunks.
--
-- `vector` is the pgvector extension, created here for the same reason `pg_trgm`
-- is created in 0000: the schema below cannot be applied without it.
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "embedding" vector(768);--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD COLUMN "embedding_model" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "knowledge_documents_claim_idx" ON "knowledge_documents" USING btree ("status","claimed_at");--> statement-breakpoint
-- HNSW rather than IVFFlat: no training pass is needed, so the index is correct
-- from the first row, and it holds up under the `company_id` filter that every
-- retrieval in a multi-tenant product applies. Cosine, to match the similarity
-- the UI displays.
CREATE INDEX "knowledge_chunks_embedding_idx" ON "knowledge_chunks" USING hnsw ("embedding" vector_cosine_ops) WITH (m = 16, ef_construction = 64);
