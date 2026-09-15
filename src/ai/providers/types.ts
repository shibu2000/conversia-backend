/**
 * What the AI layer needs from a model vendor, and nothing more.
 *
 * Every provider detail stops here. The indexer, the retriever and the answerer
 * import these interfaces and never a vendor SDK, so moving from a model running
 * on this laptop to one behind an API is a change of adapter and configuration —
 * not a change to any code that reasons about documents or answers.
 */

/**
 * What a piece of text is *for*.
 *
 * Asymmetric embedding models encode a question and a passage differently, and
 * each expresses that in its own way: nomic prepends `search_query:` or
 * `search_document:`, other vendors take an `input_type` parameter, some do
 * nothing at all. Callers say which kind of text they have and let the adapter
 * translate — the alternative is nomic's prefix strings leaking into the chunker.
 */
export type EmbeddingKind = "document" | "query";

export interface EmbeddingProvider {
  /** The model id, recorded on every chunk it embeds. */
  readonly id: string;
  readonly dimensions: number;
  /**
   * The model's real input ceiling.
   *
   * Worth honouring rather than trusting: an over-long input is silently
   * truncated by some runtimes, which produces a vector for the first half of a
   * passage and no indication that the rest was dropped.
   */
  readonly maxInputTokens: number;
  embed(texts: string[], kind: EmbeddingKind): Promise<number[][]>;
}

/** A tool offered to the model, described in the JSON-schema shape every vendor takes. */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolInvocation {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** One entry of the exchange so far, so a tool result can be fed back. */
export interface ChatMessage {
  role: "assistant" | "tool";
  content: string;
  toolCalls?: ToolInvocation[];
}

export interface ChatRequest {
  system: string;
  user: string;
  /** 0–1. The chatbot config calls this "creativity". */
  temperature: number;
  maxTokens: number;
  tools?: ToolDefinition[];
  /** The assistant turn and tool result from a first pass, on the second. */
  history?: ChatMessage[];
}

export interface ChatResponse {
  text: string;
  tokensIn: number;
  tokensOut: number;
  /** Present when the model asked for a tool instead of answering. */
  toolCalls?: ToolInvocation[];
}

export interface ChatProvider {
  readonly id: string;
  complete(request: ChatRequest): Promise<ChatResponse>;
}

export interface AIProviderSet {
  embedding: EmbeddingProvider;
  chat: ChatProvider;
}
