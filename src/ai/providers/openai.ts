import OpenAI from "openai";
import { env } from "../../config/env";
import type { ChatProvider, ChatRequest, ChatResponse, EmbeddingKind, EmbeddingProvider, ToolInvocation } from "./types";

/**
 * Any vendor that speaks the OpenAI Chat Completions / Embeddings shape.
 *
 * That covers OpenAI itself and, more to the point, the aggregators and
 * gateways built to be a drop-in replacement for it — xKiro among them. The
 * adapter talks to whichever `baseURL` it is given; the vendor is a
 * configuration choice, not a code path.
 *
 * A model aggregator's free tier is routinely chat-only — it fronts many
 * vendors' chat models but implements no `/embeddings` endpoint of its own —
 * which is why this file exports the two providers separately rather than one
 * class implementing both. `aiProviders()` builds chat and embeddings from
 * independently configured base URLs precisely so a workspace can point chat
 * at a vendor like that while embeddings keep coming from somewhere that
 * actually offers them.
 */

/** OpenAI's own embedding models cap around here; kept as a conservative default for compatible vendors that do not publish their own. */
const DEFAULT_EMBEDDING_MAX_INPUT_TOKENS = 8191;

function clientFor(baseUrl: string | undefined, apiKey: string | undefined): OpenAI {
  if (!apiKey) {
    throw new Error("No API key configured for the OpenAI-compatible provider. Set AI_API_KEY (or the AI_CHAT_API_KEY / AI_EMBEDDING_API_KEY override).");
  }
  return new OpenAI({ baseURL: baseUrl, apiKey, timeout: env.AI_REQUEST_TIMEOUT_MS });
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly id = env.AI_EMBEDDING_MODEL ?? "text-embedding-3-small";
  readonly dimensions = env.AI_EMBEDDING_DIMENSIONS;
  readonly maxInputTokens = DEFAULT_EMBEDDING_MAX_INPUT_TOKENS;
  private readonly client = clientFor(env.aiEmbeddingBaseUrl, env.aiEmbeddingApiKey);

  async embed(texts: string[], _kind: EmbeddingKind): Promise<number[][]> {
    if (texts.length === 0) return [];

    // Unlike nomic, OpenAI-family embedding models are symmetric — no
    // document/query prefix — so `kind` only matters to adapters that need it.
    const response = await this.client.embeddings.create({ model: this.id, input: texts });

    const embeddings = response.data
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((entry) => entry.embedding);

    if (embeddings.length !== texts.length) {
      throw new Error(`Expected ${texts.length} embeddings from ${this.id}, received ${embeddings.length}.`);
    }

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

export class OpenAIChatProvider implements ChatProvider {
  readonly id = env.AI_CHAT_MODEL ?? "gpt-4o-mini";
  private readonly client = clientFor(env.aiChatBaseUrl, env.aiChatApiKey);

  async complete(request: ChatRequest): Promise<ChatResponse> {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: request.system },
      { role: "user", content: request.user },
    ];

    // Pairs an assistant turn that called a tool with the tool's result. Only
    // exercised once a caller starts passing a second pass through `history` —
    // `answer/decide.ts` does not yet — but the shape has to round-trip
    // correctly once one does, since a `tool` message with no matching
    // `tool_call_id` is a 400 from the API rather than a quietly ignored field.
    let lastToolCallId: string | undefined;
    for (const entry of request.history ?? []) {
      if (entry.role === "assistant") {
        const toolCalls = toOpenAIToolCalls(entry.toolCalls);
        lastToolCallId = toolCalls?.[0]?.id;
        messages.push({
          role: "assistant",
          content: entry.content || null,
          ...(toolCalls ? { tool_calls: toolCalls } : {}),
        });
      } else {
        messages.push({ role: "tool", content: entry.content, tool_call_id: lastToolCallId ?? "unknown" });
      }
    }

    const completion = await this.client.chat.completions.create({
      model: this.id,
      messages,
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      ...(request.tools?.length
        ? {
            tools: request.tools.map((tool) => ({
              type: "function" as const,
              function: { name: tool.name, description: tool.description, parameters: tool.parameters },
            })),
          }
        : {}),
    });

    const choice = completion.choices[0];
    const toolCalls = fromOpenAIToolCalls(choice?.message?.tool_calls);

    return {
      text: (choice?.message?.content ?? "").trim(),
      tokensIn: completion.usage?.prompt_tokens ?? 0,
      tokensOut: completion.usage?.completion_tokens ?? 0,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    };
  }
}

function toOpenAIToolCalls(
  calls: ToolInvocation[] | undefined,
): OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] | undefined {
  if (!calls?.length) return undefined;
  return calls.map((call) => ({
    id: call.id,
    type: "function" as const,
    function: { name: call.name, arguments: JSON.stringify(call.arguments) },
  }));
}

function fromOpenAIToolCalls(
  calls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] | undefined,
): ToolInvocation[] {
  if (!calls?.length) return [];

  // This app's tools are all JSON-schema function tools — the API's other tool
  // kind ("custom", freeform text input) never appears for a request that
  // never declares one, but the SDK's response type is a union of both.
  return calls
    .filter((call): call is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall => call.type === "function")
    .filter((call) => call.function?.name)
    .map((call) => ({
      id: call.id,
      name: call.function.name,
      // The API hands back arguments as a JSON-encoded string, not an object —
      // the one real difference from Ollama's already-parsed shape. A model
      // occasionally emits arguments that do not quite parse; that call is
      // dropped rather than crashing the whole turn on one bad tool call.
      arguments: parseArguments(call.function.arguments),
    }))
    .filter((call): call is ToolInvocation => call.arguments !== null);
}

function parseArguments(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return null;
  }
}
