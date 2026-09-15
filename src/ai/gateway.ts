import { logger } from "../config/logger";
import { aiLayerNotImplemented } from "../core/errors";
import { generateAnswer } from "./answer/answerer";
import { wakeIndexingWorker } from "./indexing/worker";
import { aiConfigured, aiProviders } from "./providers";
import { retrieveChunks } from "./retrieval/retriever";
import type {
  AIGateway,
  AssistantTurnRequest,
  AssistantTurnResult,
  DocumentProcessingRequest,
  RetrievalRequest,
  RetrievalResult,
  WebsiteAnalysisRequest,
} from "./ai-gateway";

/** The default when the chatbot config does not set one. */
const DEFAULT_THRESHOLD = 0.65;
const DEFAULT_MAX_CHUNKS = 8;

export class ConversiaAIGateway implements AIGateway {
  isEnabled(): boolean {
    return aiConfigured();
  }

  /**
   * Queue a document. Returns as soon as the worker has been nudged.
   *
   * Deliberately not the work itself: `queueForProcessing` awaits this inside
   * the HTTP request that uploaded the file, so doing extraction and embedding
   * here would hold that request open for the length of a large PDF. It also
   * never throws — `reindexDocument` calls it without a catch, and a throw there
   * would leave the document stranded at "Processing".
   */
  async processDocument(request: DocumentProcessingRequest): Promise<void> {
    logger.debug("Queued a document for indexing", {
      documentId: request.documentId,
      companyId: request.companyId,
    });
    wakeIndexingWorker();
  }

  /**
   * Retrieval for the tester screen.
   *
   * That screen labels `answer` as "Context that would be sent" and says in so
   * many words that the final wording is produced at answer time — so this
   * assembles the context and runs no generation. It also never throws: the
   * tester has no error branch, and a rejected promise would render a blank page
   * instead of telling an administrator what went wrong.
   */
  async retrieve(request: RetrievalRequest): Promise<RetrievalResult> {
    const started = Date.now();
    const threshold = request.threshold ?? DEFAULT_THRESHOLD;
    const model = aiProviders().chat.id;

    try {
      const chunks = await retrieveChunks({
        companyId: request.companyId,
        question: request.question,
        collectionIds: request.collectionIds,
        limit: request.maxChunks ?? DEFAULT_MAX_CHUNKS,
      });

      // Chunks below the threshold are returned, not hidden. Seeing a passage
      // score 0.61 against a threshold of 0.65 is how an administrator learns
      // their wording is close but their threshold is too strict.
      const scored = chunks.map((chunk) => ({
        chunkId: chunk.chunkId,
        documentId: chunk.documentId,
        documentName: chunk.documentName,
        sourceName: chunk.sourceName,
        chunkIndex: chunk.chunkIndex,
        similarity: chunk.similarity,
        excerpt: chunk.excerpt,
        // Below the threshold but quoting the customer's own identifier: the
        // tester shows the real similarity beside it rather than inflating it.
        usedInAnswer: chunk.similarity >= threshold || chunk.exactMatch,
      }));

      const used = scored.filter((chunk) => chunk.usedInAnswer);
      const context = used
        .map((chunk, index) => `[${index + 1}] ${chunk.documentName}\n${chunk.excerpt}`)
        .join("\n\n");

      return {
        chunks: scored,
        answered: used.length > 0,
        answer: context,
        fallbackReason: used.length > 0 ? undefined : noMatchReason(scored, threshold),
        model,
        // An estimate, and only ever displayed. The real count comes back from
        // the model at answer time.
        tokensIn: Math.ceil(context.length / 4),
        tokensOut: 0,
        latencyMs: Date.now() - started,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Retrieval failed", { companyId: request.companyId, error: message });
      return {
        chunks: [],
        answered: false,
        answer: "",
        fallbackReason: `Retrieval could not run: ${message}`,
        model,
        tokensIn: 0,
        tokensOut: 0,
        latencyMs: Date.now() - started,
      };
    }
  }

  answer(request: AssistantTurnRequest): Promise<AssistantTurnResult> {
    return generateAnswer(request);
  }

  analyzeWebsite(_request: WebsiteAnalysisRequest): Promise<{ analysisId: string }> {
    // Crawling is a later phase. Saying so is better than returning an empty
    // analysis the wizard would present as a finished one.
    throw aiLayerNotImplemented("Website analysis");
  }
}

/** A complete sentence: the tester drops this straight into prose. */
function noMatchReason(chunks: Array<{ similarity: number }>, threshold: number): string {
  if (chunks.length === 0) {
    return "Nothing in this workspace's indexed knowledge matched that question. Either no document covers it, or the documents that do have not finished indexing.";
  }
  const best = chunks[0]!.similarity.toFixed(2);
  return `The closest passage scored ${best}, below the ${threshold.toFixed(2)} confidence threshold, so the assistant would decline rather than answer from it.`;
}
