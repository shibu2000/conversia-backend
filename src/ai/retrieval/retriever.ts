import { sql } from "drizzle-orm";
import { db } from "../../db";
import { knowledgeCollections } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import { aiProviders } from "../providers";
import type { RetrievedChunk } from "../ai-gateway";

/**
 * Semantic search over one company's indexed knowledge.
 *
 * Every query filters on `knowledge_chunks.company_id`, and that value comes
 * from the authenticated session — never from a request body, and never
 * inferred from a document id. A retrieval that crossed tenants would put one
 * customer's internal documents into another customer's chat answer, which is
 * the single worst thing this layer could do.
 */

export interface RetrievalOptions {
  companyId: string;
  question: string;
  /** When given, the search is confined to these collections. */
  collectionIds?: string[];
  limit: number;
}

export interface ScoredChunk extends Omit<RetrievedChunk, "usedInAnswer"> {
  locator: string;
  /** Postgres `ts_rank` for this chunk, 0 when only the vector search found it. */
  lexicalRank: number;
  /**
   * The customer quoted an identifier that appears verbatim in this passage.
   *
   * Cosine similarity does not measure this. "NW-10432" scores 0.575 against the
   * very chunk that defines it, because an order reference carries almost no
   * semantic content — and `ts_rank` does not separate it either (0.099, below
   * ordinary prose at 0.174). Presence of the exact token does.
   */
  exactMatch: boolean;
}

/** How many candidates each search contributes before fusion. */
const CANDIDATES = 20;

/**
 * The constant in reciprocal rank fusion. 60 is the value from the original
 * paper and the usual default: large enough that the top few ranks are not
 * wildly over-weighted relative to each other.
 */
const RRF_K = 60;

export async function retrieveChunks(options: RetrievalOptions): Promise<ScoredChunk[]> {
  const { embedding } = aiProviders();
  const [queryVector] = await embedding.embed([options.question], "query");
  if (!queryVector) return [];

  const vector = toVector(queryVector);
  const identifiers = identifierTokens(options.question);
  const collectionIds = options.collectionIds?.length ? options.collectionIds : null;
  const scope = collectionIds
    ? sql`AND s.collection_id = ANY(${sql.param(collectionIds)}::text[])`
    : sql``;

  /**
   * Two searches, fused.
   *
   * Vector search is strong on meaning and weak on exact strings — an order
   * reference or an SKU embeds as noise. Full-text search is the reverse. The
   * GIN index behind `search_vector` already exists, so running both costs one
   * more index scan.
   *
   * Reciprocal rank fusion decides *which* passages are worth looking at: a
   * chunk both searches rank highly beats one that only one of them found. What
   * comes back is still ordered by, and scored with, the true cosine — the
   * confidence threshold is calibrated against that number, and the tester
   * displays it, so fusion must not change what it means.
   */
  const { rows } = await db.execute<{
    chunk_id: string;
    document_id: string;
    document_name: string;
    source_name: string;
    chunk_index: number;
    locator: string;
    text: string;
    similarity: number;
    lexical_rank: number;
  }>(sql`
    WITH scoped AS (
      SELECT c.id, c.document_id, c.chunk_index, c.locator, c.text, c.embedding, c.search_vector,
             d.name AS document_name, s.name AS source_name
      FROM knowledge_chunks c
      JOIN knowledge_documents d ON d.id = c.document_id
      JOIN knowledge_sources   s ON s.id = d.source_id
      WHERE c.company_id = ${options.companyId}
        AND c.embedding IS NOT NULL
        AND s.enabled
        AND d.status = 'ready'
        ${scope}
    ),
    semantic AS (
      SELECT id, row_number() OVER (ORDER BY embedding <=> ${vector}::vector) AS rank
      FROM scoped ORDER BY embedding <=> ${vector}::vector LIMIT ${CANDIDATES}
    ),
    lexical AS (
      SELECT id,
             ts_rank(search_vector, websearch_to_tsquery('english', ${options.question})) AS score,
             row_number() OVER (ORDER BY ts_rank(search_vector, websearch_to_tsquery('english', ${options.question})) DESC) AS rank
      FROM scoped
      WHERE search_vector @@ websearch_to_tsquery('english', ${options.question})
      ORDER BY score DESC LIMIT ${CANDIDATES}
    )
    SELECT sc.id           AS chunk_id,
           sc.document_id  AS document_id,
           sc.document_name,
           sc.source_name,
           sc.chunk_index  AS chunk_index,
           sc.locator,
           sc.text,
           1 - (sc.embedding <=> ${vector}::vector) AS similarity,
           coalesce(l.score, 0) AS lexical_rank
    FROM scoped sc
    LEFT JOIN semantic v ON v.id = sc.id
    LEFT JOIN lexical  l ON l.id = sc.id
    WHERE v.id IS NOT NULL OR l.id IS NOT NULL
    ORDER BY (coalesce(1.0 / (${RRF_K} + v.rank), 0) + coalesce(1.0 / (${RRF_K} + l.rank), 0)) DESC
    LIMIT ${options.limit}
  `);

  return rows
    .map((row) => ({
      chunkId: row.chunk_id,
      documentId: row.document_id,
      documentName: row.document_name,
      sourceName: row.source_name,
      chunkIndex: Number(row.chunk_index),
      locator: row.locator,
      excerpt: row.text,
      // Cosine distance inverted. The UI renders this on a 0–1 scale and colours
      // it against the company's threshold, so it must stay a real similarity.
      similarity: clamp(Number(row.similarity)),
      lexicalRank: Number(row.lexical_rank),
      exactMatch: identifiers.some((token) => row.text.toLowerCase().includes(token)),
    }))
    // Fusion chose the candidates; cosine orders them. The tester's "best score"
    // tile reads the first row, so the list has to be sorted by the number it
    // shows.
    .sort((a, b) => b.similarity - a.similarity);
}

/**
 * Which collections the chatbot may draw on.
 *
 * A collection marked `available_to_chatbot = false` — an HR handbook, an
 * internal runbook — is withheld deliberately. Resolving that here means no
 * caller can forget to.
 */
export async function chatbotCollectionIds(companyId: string, configured: string[]): Promise<string[]> {
  const rows = await db
    .select({ id: knowledgeCollections.id })
    .from(knowledgeCollections)
    .where(and(eq(knowledgeCollections.companyId, companyId), eq(knowledgeCollections.availableToChatbot, true)));

  const allowed = rows.map((row) => row.id);
  if (configured.length === 0) return allowed;

  const permitted = new Set(allowed);
  return configured.filter((id) => permitted.has(id));
}

/**
 * Identifier-shaped tokens in a question: order references, SKUs, model numbers.
 *
 * Something is identifier-shaped when it mixes letters and digits ("TRL-220",
 * "P1", "NW-10432") or is a long run of digits. Ordinary words never qualify, so
 * this cannot fire on prose — which matters, because a match here bypasses the
 * similarity threshold.
 */
export function identifierTokens(question: string): string[] {
  const tokens = question.toLowerCase().match(/[a-z0-9][a-z0-9-]*/g) ?? [];
  return tokens.filter(
    (token) =>
      (/\d/.test(token) && /[a-z]/.test(token)) || (/^\d{4,}$/.test(token)),
  );
}

function toVector(values: number[]): string {
  return `[${values.join(",")}]`;
}

/** Floating-point error can put cosine similarity a hair outside 0–1. */
function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
