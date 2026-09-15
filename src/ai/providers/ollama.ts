import { env } from "../../config/env";
import type { ChatProvider, ChatRequest, ChatResponse, EmbeddingKind, EmbeddingProvider } from "./types";

/**
 * Ollama, for models running on the same machine.
 *
 * No API key and no per-token cost, which makes it the right thing to develop
 * against — but the adapter is written to the same interface a paid provider
 * will implement, so nothing downstream can come to depend on that.
 */

const DEFAULT_BASE_URL = "http://localhost:11434";

/**
 * nomic-embed-text is asymmetric: it wants to know whether it is reading a
 * stored passage or a question about one. Skipping the prefixes still returns
 * vectors, but measurably worse-separated ones, and the confidence threshold in
 * the chatbot config is calibrated against the prefixed scale.
 */
const TASK_PREFIX: Record<EmbeddingKind, string> = {
  document: "search_document: ",
  query: "search_query: ",
};

/**
 * As packaged for Ollama, nomic-embed-text has a 2048-token context — not the
 * 8192 the model card advertises — and it does not complain when given more.
 * The chunker's ceiling is set below this, and the guard below is the backstop.
 */
const NOMIC_CONTEXT_TOKENS = 2048;

async function callOllama<T>(baseUrl: string, path: string, body: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(env.AI_REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Ollama ${path} returned ${response.status}: ${detail.slice(0, 200)}`);
  }

  return (await response.json()) as T;
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly id = env.AI_EMBEDDING_MODEL ?? "nomic-embed-text:latest";
  readonly dimensions = env.AI_EMBEDDING_DIMENSIONS;
  readonly maxInputTokens = NOMIC_CONTEXT_TOKENS;
  private readonly baseUrl = env.aiEmbeddingBaseUrl ?? DEFAULT_BASE_URL;

  async embed(texts: string[], kind: EmbeddingKind): Promise<number[][]> {
    if (texts.length === 0) return [];

    const prefix = TASK_PREFIX[kind];
    const payload = await callOllama<{ embeddings: number[][] }>(this.baseUrl, "/api/embed", {
      model: this.id,
      input: texts.map((text) => prefix + text),
    });

    const embeddings = payload.embeddings ?? [];
    if (embeddings.length !== texts.length) {
      throw new Error(`Expected ${texts.length} embeddings from ${this.id}, received ${embeddings.length}.`);
    }

    // A width that disagrees with the column is caught here rather than as a
    // pgvector insert error, which names neither the model nor the setting.
    for (const embedding of embeddings) {
      if (embedding.length !== this.dimensions) {
        throw new Error(
          `${this.id} returned ${embedding.length}-dimension vectors but AI_EMBEDDING_DIMENSIONS is ${this.dimensions}.`,
        );
      }
    }

    return embeddings;
  }
}

interface OllamaChatResponse {
  message?: {
    content?: string;
    tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: Record<string, unknown> } }>;
  };
  prompt_eval_count?: number;
  eval_count?: number;
}

export class OllamaChatProvider implements ChatProvider {
  readonly id = env.AI_CHAT_MODEL ?? "qwen3:8b";
  private readonly baseUrl = env.aiChatBaseUrl ?? DEFAULT_BASE_URL;

  async complete(request: ChatRequest): Promise<ChatResponse> {
    const messages: Array<Record<string, unknown>> = [
      { role: "system", content: request.system },
      { role: "user", content: request.user },
    ];

    for (const entry of request.history ?? []) {
      messages.push(
        entry.role === "assistant"
          ? {
              role: "assistant",
              content: entry.content,
              ...(entry.toolCalls?.length
                ? {
                    tool_calls: entry.toolCalls.map((call) => ({
                      id: call.id,
                      function: { name: call.name, arguments: call.arguments },
                    })),
                  }
                : {}),
            }
          : { role: "tool", content: entry.content },
      );
    }

    const payload = await callOllama<OllamaChatResponse>(this.baseUrl, "/api/chat", {
      model: this.id,
      messages,
      stream: false,
      // Qwen3 reasons out loud unless told not to. The reasoning is not shown to
      // a customer, and generating it costs seconds per answer.
      think: false,
      ...(request.tools?.length
        ? {
            tools: request.tools.map((tool) => ({
              type: "function",
              function: { name: tool.name, description: tool.description, parameters: tool.parameters },
            })),
          }
        : {}),
      options: { temperature: request.temperature, num_predict: request.maxTokens },
    });

    const toolCalls = (payload.message?.tool_calls ?? [])
      .filter((call) => call.function?.name)
      .map((call, index) => ({
        id: call.id ?? `call_${index}`,
        name: call.function!.name!,
        arguments: call.function?.arguments ?? {},
      }));

    return {
      text: (payload.message?.content ?? "").trim(),
      // Reported by the runtime, not estimated. The retrieval tester shows these.
      tokensIn: payload.prompt_eval_count ?? 0,
      tokensOut: payload.eval_count ?? 0,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    };
  }
}
