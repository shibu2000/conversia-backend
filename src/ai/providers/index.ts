import { env } from "../../config/env";
import { OllamaChatProvider, OllamaEmbeddingProvider } from "./ollama";
import { OpenAIChatProvider, OpenAIEmbeddingProvider } from "./openai";
import { VoyageEmbeddingProvider } from "./voyage";
import type { AIProviderSet, ChatProvider, EmbeddingProvider } from "./types";

export * from "./types";

/**
 * Whether the AI layer is configured.
 *
 * Synchronous and side-effect free on purpose: `isEnabled()` is consulted twice
 * per widget question, and a reachability check there would put a network round
 * trip in front of every visitor's message. Whether the model is *reachable* is
 * a separate question, answered when a call fails.
 */
export function aiConfigured(): boolean {
  return env.aiConfigured;
}

let providers: AIProviderSet | null = null;

/**
 * Chat and embeddings are resolved independently — see the note on
 * `AI_CHAT_PROVIDER`/`AI_EMBEDDING_PROVIDER` in `config/env.ts`. Most
 * deployments set one `AI_PROVIDER` and both resolve to it; a workspace using
 * a chat-only aggregator alongside a separate embeddings source sets the two
 * overrides instead.
 */
export function aiProviders(): AIProviderSet {
  if (!providers) {
    providers = { embedding: buildEmbeddingProvider(), chat: buildChatProvider() };
  }
  return providers;
}

function buildChatProvider(): ChatProvider {
  switch (env.aiChatProvider) {
    case "ollama":
      return new OllamaChatProvider();
    case "openai":
      return new OpenAIChatProvider();
    default:
      throw new Error(`No chat provider configured. Set AI_PROVIDER or AI_CHAT_PROVIDER to "ollama" or "openai".`);
  }
}

function buildEmbeddingProvider(): EmbeddingProvider {
  switch (env.aiEmbeddingProvider) {
    case "ollama":
      return new OllamaEmbeddingProvider();
    case "openai":
      return new OpenAIEmbeddingProvider();
    case "voyage":
      return new VoyageEmbeddingProvider();
    default:
      throw new Error(
        `No embedding provider configured. Set AI_PROVIDER or AI_EMBEDDING_PROVIDER to "ollama", "openai" or "voyage".`,
      );
  }
}
