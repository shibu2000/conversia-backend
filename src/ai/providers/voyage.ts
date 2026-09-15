import { env } from "../../config/env";
import type { EmbeddingKind, EmbeddingProvider } from "./types";

/**
 * Voyage AI — an embeddings specialist with no chat endpoint of its own, which
 * is why this file exports only `VoyageEmbeddingProvider` and `aiProviders()`
 * never asks it to resolve a `ChatProvider`. It exists purely to be the
 * embeddings half of a pairing like "xKiro for chat, Voyage for embeddings" —
 * two single-purpose vendors standing in for the one dual-purpose `AI_PROVIDER`
 * default.
 *
 * Unlike nomic, `input_type` is a first-class request parameter here rather
 * than a prefix string the caller has to prepend — `EmbeddingKind` maps onto it
 * directly.
 */

const BASE_URL = "https://api.voyageai.com/v1";

/**
 * `voyage-4-lite`: 1M-token context, and — as of this integration — inside
 * Voyage's free 200-million-token allowance for new accounts, which is what
 * makes it the right default for a workspace that has not chosen a paid model.
 * Free credits are a launch promotion, not a contract; verify current terms at
 * https://docs.voyageai.com/docs/pricing before relying on it in production.
 */
const DEFAULT_MODEL = "voyage-4-lite";

interface VoyageEmbeddingsResponse {
  data: Array<{ embedding: number[]; index: number }>;
}

export class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly id = env.AI_EMBEDDING_MODEL ?? DEFAULT_MODEL;
  readonly dimensions = env.AI_EMBEDDING_DIMENSIONS;
  // Voyage documents this per model (120K–1M tokens); not worth a config knob
  // for a limit this generous — the chunker's own ceiling binds first.
  readonly maxInputTokens = 32_000;

  async embed(texts: string[], kind: EmbeddingKind): Promise<number[][]> {
    if (texts.length === 0) return [];

    const apiKey = env.aiEmbeddingApiKey;
    if (!apiKey) {
      throw new Error("No API key configured for Voyage. Set AI_API_KEY or AI_EMBEDDING_API_KEY.");
    }

    const response = await fetch(`${env.aiEmbeddingBaseUrl ?? BASE_URL}/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        input: texts,
        model: this.id,
        input_type: kind,
        output_dimension: this.dimensions,
      }),
      signal: AbortSignal.timeout(env.AI_REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Voyage /embeddings returned ${response.status}: ${detail.slice(0, 200)}`);
    }

    const payload = (await response.json()) as VoyageEmbeddingsResponse;
    const embeddings = payload.data
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((entry) => entry.embedding);

    if (embeddings.length !== texts.length) {
      throw new Error(`Expected ${texts.length} embeddings from ${this.id}, received ${embeddings.length}.`);
    }

    for (const embedding of embeddings) {
      if (embedding.length !== this.dimensions) {
        throw new Error(
          `${this.id} returned ${embedding.length}-dimension vectors but AI_EMBEDDING_DIMENSIONS is ${this.dimensions}. ` +
            `Voyage models only support a fixed set of output dimensions — check which ones ${this.id} allows.`,
        );
      }
    }

    return embeddings;
  }
}
