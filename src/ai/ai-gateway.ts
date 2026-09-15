import { aiLayerNotImplemented } from "../core/errors";
import type { ProductReference } from "../db/schema";

/**
 * The AI seam.
 *
 * Everything the future AI layer will own is declared here as an interface and
 * nothing more. The rest of the application depends on *this* module, never on
 * a provider SDK, so adding the AI layer means supplying an implementation of
 * `AIGateway` and registering it — no call site changes.
 *
 * The default implementation throws `ai_layer_not_implemented` (HTTP 501) for
 * every capability. That is deliberate. A stub that returned a keyword match
 * dressed up as a similarity score, or a canned paragraph presented as a
 * generated answer, would make the product look finished while lying about what
 * it does — and the first person to trust one of those answers would be the
 * customer of a company that bought this.
 *
 * What is NOT implemented, and is intentionally left to that layer:
 *   - document text extraction, chunking and embedding
 *   - vector storage and semantic retrieval (RAG)
 *   - LLM orchestration, prompting and streaming
 *   - tool calling and agent loops
 *   - intent classification and confidence scoring
 *   - website crawling and AI-suggested onboarding content
 *
 * What is already real and needs no AI: FAQ search, product search, lead and
 * ticket creation, assignment, and every workflow the widget drives. Those run
 * against the same records the workspace edits.
 */

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  documentName: string;
  sourceName: string;
  chunkIndex: number;
  similarity: number;
  excerpt: string;
  usedInAnswer: boolean;
}

export interface RetrievalRequest {
  companyId: string;
  question: string;
  collectionIds?: string[];
  threshold?: number;
  maxChunks?: number;
}

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  answered: boolean;
  answer: string;
  fallbackReason?: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
}

export interface AssistantTurnRequest {
  companyId: string;
  conversationId: string | null;
  question: string;
  locale?: string;
  /**
   * Present only on the widget path.
   *
   * Tools act on behalf of a live conversation, so the retrieval tester — which
   * has no widget, no visitor and no conversation — gets the knowledge path
   * alone rather than a tool that would file a real lead from a test query.
   */
  embedKey?: string;
  /**
   * The best curated answer the FAQ search found, offered as *context* rather
   * than as a decision already taken.
   *
   * The lexical search runs first because it is cheap and often right — but it
   * cannot tell a question about a product from a complaint about one, so what
   * it finds is a candidate the model weighs, not an answer that pre-empts it.
   */
  faqCandidate?: { id: string; question: string; answer: string; rank: number } | null;
}

export interface AssistantTurnResult {
  /**
   * Which kind of turn this was.
   *
   * `knowledge` answers are grounded in retrieved passages and are subject to
   * the company's `knowledgeConfidenceThreshold`. `conversational` ones — a
   * greeting, a thank-you, "are you a bot" — have nothing to retrieve, so that
   * threshold does not apply to them; gating a hello on a similarity score
   * would be applying a measure of the wrong thing.
   */
  kind: "knowledge" | "conversational" | "tool";
  answer: string;
  /** Retrieval confidence. Always 0 for a conversational turn. */
  confidence: number;
  /**
   * The answer rests on an identifier the customer quoted verbatim — an order
   * reference, an SKU — rather than on semantic similarity.
   *
   * The confidence threshold does not apply to these, because cosine does not
   * measure this kind of match: "NW-10432" scores 0.575 against the passage that
   * defines it. The number reported stays the true similarity; this flag says
   * why it is not the thing to judge by.
   */
  exactTermMatch?: boolean;
  /**
   * What a tool produced, when the model chose to act rather than answer.
   *
   * A `proposal` is the important one: creating a lead or a ticket needs a
   * validated email, and the only thing in this system that validates an email
   * is a form. So a write tool fills the form in and hands it to the customer
   * to confirm rather than writing a record off the back of a chat turn.
   */
  tool?:
    | { kind: "products"; products: ProductReference[] }
    | { kind: "proposal"; form: "lead" | "ticket"; prefill: Record<string, string | undefined>; message: string }
    | { kind: "created"; form: "lead" | "ticket"; reference: string; message: string }
    | { kind: "handoff"; message: string; agentsAvailable: boolean };
  /**
   * What the assistant did, for the agent's AI trace.
   *
   * Part of the result rather than fetched afterwards: two visitors can be
   * mid-question at the same moment, and a trace held anywhere but on the turn
   * it belongs to would eventually be attached to the wrong conversation.
   */
  trace?: { name: string; args: Record<string, unknown>; status: "success" | "error"; durationMs: number; summary: string };
  /** Set when the answer came from a curated FAQ, so its match count is credited. */
  faqId?: string;
  citations: RetrievedChunk[];
  intent: string;
}

export interface DocumentProcessingRequest {
  companyId: string;
  documentId: string;
  storageKey: string | null;
  mimeType: string;
}

export interface WebsiteAnalysisRequest {
  companyId: string;
  url: string;
  maxDepth: number;
}

export interface AIGateway {
  /** Semantic retrieval over a company's indexed knowledge. */
  retrieve(request: RetrievalRequest): Promise<RetrievalResult>;
  /** A generated assistant turn, grounded in retrieved context. */
  answer(request: AssistantTurnRequest): Promise<AssistantTurnResult>;
  /** Extract → chunk → embed → index one uploaded document. */
  processDocument(request: DocumentProcessingRequest): Promise<void>;
  /** Crawl a site and propose onboarding content for human review. */
  analyzeWebsite(request: WebsiteAnalysisRequest): Promise<{ analysisId: string }>;
  /** Whether an implementation is registered and configured. */
  isEnabled(): boolean;
}

class UnavailableAIGateway implements AIGateway {
  isEnabled(): boolean {
    return false;
  }

  retrieve(): Promise<RetrievalResult> {
    throw aiLayerNotImplemented("Semantic retrieval");
  }

  answer(): Promise<AssistantTurnResult> {
    throw aiLayerNotImplemented("Generated answers");
  }

  processDocument(): Promise<void> {
    throw aiLayerNotImplemented("Document processing");
  }

  analyzeWebsite(): Promise<{ analysisId: string }> {
    throw aiLayerNotImplemented("Website analysis");
  }
}

let gateway: AIGateway = new UnavailableAIGateway();

/** Called once at boot by the AI layer when it is built. */
export function registerAIGateway(implementation: AIGateway): void {
  gateway = implementation;
}

export function aiGateway(): AIGateway {
  return gateway;
}
