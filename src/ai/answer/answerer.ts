import { logger } from "../../config/logger";
import { companyContext, type CompanyContext } from "../context/company-context";
import { aiProviders } from "../providers";
import { chatbotCollectionIds, retrieveChunks, type ScoredChunk } from "../retrieval/retriever";
import { answerConversationally, classifyConversational } from "./conversation";
import { buildSystemPrompt, buildUserPrompt, INSUFFICIENT } from "./prompt";
import { recentExchange, rewriteForRetrieval } from "./rewrite";
import { decideTurn } from "./decide";
import type { AssistantTurnRequest, AssistantTurnResult } from "../ai-gateway";

/**
 * One assistant turn.
 *
 * Two paths. A conversational turn — hello, thanks, "are you a bot" — is
 * answered from the company profile, which is assembled from the company's own
 * records. Everything else must be grounded in a retrieved passage or declined.
 *
 * Reached only after the FAQ and the product catalogue have both missed, so by
 * the time this runs nothing curated covered the question.
 */

/** Roughly 1.6 tokens per word, plus room to finish a sentence. */
const WORDS_TO_TOKENS = 1.8;

export async function generateAnswer(request: AssistantTurnRequest): Promise<AssistantTurnResult> {
  const context = await companyContext(request.companyId);
  if (!context) return empty();

  if (!request.embedKey) return routeKnowledgeOnly(request, context);

  const conversational = classifyConversational(request.question);
  if (conversational) {
    return {
      kind: "conversational",
      answer: await answerConversationally(conversational, context),
      // Not a retrieval confidence, and the caller does not apply the knowledge
      // threshold to this kind. Zero is the honest value: nothing was retrieved.
      confidence: 0,
      citations: [],
      intent: "smalltalk",
    };
  }

  /**
   * One decision, with the curated answer, the retrieved passages and the tools
   * all in front of the model at once.
   *
   * It used to be a sequence of cheap guesses — a regex for product intent, a
   * lexical FAQ match — each able to answer before anything understood the
   * question. That is what returned a fitness tracker to "my tracking link is
   * not working", and the bike light for sale to a customer reporting a damaged
   * one.
   */
  const history = request.conversationId ? await recentExchange(request.companyId, request.conversationId) : [];
  const decision = await decideTurn(request, context, request.faqCandidate ?? null, history);

  if (decision) {
    return { ...decision.result, trace: decision.trace, faqId: decision.faqId };
  }

  return empty();
}

/** Used by the retrieval tester and anything else with no widget behind it. */
async function routeKnowledgeOnly(
  request: AssistantTurnRequest,
  context: CompanyContext,
): Promise<AssistantTurnResult> {
  const conversational = classifyConversational(request.question);
  if (conversational) {
    return {
      kind: "conversational",
      answer: await answerConversationally(conversational, context),
      confidence: 0,
      citations: [],
      intent: "smalltalk",
    };
  }
  return answerFromKnowledge(request, context);
}



async function answerFromKnowledge(
  request: AssistantTurnRequest,
  context: CompanyContext,
): Promise<AssistantTurnResult> {
  const collectionIds = await chatbotCollectionIds(request.companyId, context.knowledge.collectionIds ?? []);
  if (collectionIds.length === 0) return empty();

  const threshold = context.ai.knowledgeConfidenceThreshold ?? 0.65;
  const limit = Math.max(1, context.knowledge.maxChunksPerAnswer ?? 4);
  const search = { companyId: request.companyId, collectionIds, limit };

  let chunks = await retrieveChunks({ ...search, question: request.question });

  /**
   * Second attempt, only if the first failed.
   *
   * Deciding in advance whether a message is a follow-up means guessing from its
   * wording, and the wording does not tell you: "can I return swimwear" is four
   * words and complete, "how long do I have" is five and is not. Retrieval
   * answers the question directly and costs 25ms, so the rewrite is paid for
   * only on a turn that was going to be declined anyway.
   */
  if (belowThreshold(chunks, threshold) && !chunks.some((chunk) => chunk.exactMatch) && request.conversationId) {
    const history = await recentExchange(request.companyId, request.conversationId);
    const rewritten = await rewriteForRetrieval(request.question, history);

    if (rewritten) {
      const retried = await retrieveChunks({ ...search, question: rewritten });
      if (best(retried) > best(chunks)) {
        logger.debug("Follow-up rewrite improved retrieval", {
          companyId: request.companyId,
          before: best(chunks).toFixed(3),
          after: best(retried).toFixed(3),
        });
        chunks = retried;
      }
    }
  }

  if (chunks.length === 0) return empty();

  const exactTermMatch = chunks.some((chunk) => chunk.exactMatch);

  /**
   * Confidence is the best passage's similarity — a number the retrieval
   * actually measured.
   *
   * Not the model's own estimate of itself: an LLM asked how sure it is returns
   * a confident-sounding number regardless, and that number would then decide
   * whether a customer gets an answer or a person.
   */
  const confidence = chunks[0]!.similarity;

  const { chat } = aiProviders();
  const completion = await chat.complete({
    system: buildSystemPrompt(context.ai, context.profile),
    // The customer's own words, not the rewritten query — the reply should
    // answer what they asked, not what a rewrite decided they meant.
    user: buildUserPrompt(request.question, chunks),
    temperature: clampTemperature(context.ai.creativity),
    maxTokens: Math.round((context.ai.maxResponseWords || 120) * WORDS_TO_TOKENS),
  });

  const text = completion.text.trim();

  // The model saying it cannot answer is a real answer about the knowledge base,
  // and it must not be dressed up as one about the question.
  if (!text || text.toUpperCase().includes(INSUFFICIENT)) {
    logger.debug("AI declined to answer from the retrieved context", {
      companyId: request.companyId,
      topSimilarity: confidence,
    });
    return empty();
  }

  return {
    kind: "knowledge",
    answer: text,
    confidence,
    exactTermMatch,
    // Citations are the passages the model was actually shown. An answer whose
    // citations were chosen after the fact would be decoration.
    citations: chunks.map((chunk) => ({
      chunkId: chunk.chunkId,
      documentId: chunk.documentId,
      documentName: chunk.documentName,
      sourceName: chunk.sourceName,
      chunkIndex: chunk.chunkIndex,
      similarity: chunk.similarity,
      excerpt: excerpt(chunk),
      usedInAnswer: true,
    })),
    // No classifier exists yet. Labelling this anything else would be inventing
    // a measurement, and the conversation record would carry the invention.
    intent: "unknown",
  };
}

function best(chunks: ScoredChunk[]): number {
  return chunks[0]?.similarity ?? 0;
}

function belowThreshold(chunks: ScoredChunk[], threshold: number): boolean {
  return best(chunks) < threshold;
}

/** Confidence 0 with no citations — the caller reads this as "no answer". */
function empty(): AssistantTurnResult {
  return { kind: "knowledge", answer: "", confidence: 0, citations: [], intent: "unknown" };
}

function excerpt(chunk: ScoredChunk): string {
  return chunk.excerpt.length > 400 ? `${chunk.excerpt.slice(0, 400).trimEnd()}…` : chunk.excerpt;
}

function clampTemperature(creativity: number): number {
  if (!Number.isFinite(creativity)) return 0.2;
  return Math.min(1, Math.max(0, creativity));
}
