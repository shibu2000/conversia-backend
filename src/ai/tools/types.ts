import type { z } from "zod";
import type { ChatbotAIConfig, LeadCaptureConfig, ProductReference, TicketAutomationConfig } from "../../db/schema";
import type { KnownVisitor } from "../../modules/widget/conversation.service";

/**
 * What the assistant can do, as opposed to what it can say.
 *
 * The split that matters is `kind`. A read tool runs: its result can be shown,
 * ignored or discarded and nothing in the workspace changed. A write tool
 * creates a record someone will act on, so it never executes on the model's say
 * so — it returns a proposal the customer confirms. A search can be run twice;
 * a lead cannot be un-created.
 */

export interface ToolContext {
  /**
   * Resolved from the embed key server-side, never from the model.
   *
   * A tool argument is text a language model produced. Letting one name the
   * tenant it is acting for would put the isolation boundary in the hands of
   * the least predictable component in the system.
   */
  companyId: string;
  embedKey: string;
  conversationId: string | null;
  /** Whoever the pre-chat form or an earlier submission identified, if anyone. */
  customer: KnownVisitor | null;
  ai: ChatbotAIConfig;
  leads: LeadCaptureConfig;
  tickets: TicketAutomationConfig;
}

/** Shown to the customer as products, rather than described in prose. */
export interface ProductsResult {
  kind: "products";
  products: ProductReference[];
}

/** A record the customer must confirm before it is written. */
export interface ProposalResult {
  kind: "proposal";
  form: "lead" | "ticket";
  prefill: Record<string, string | undefined>;
  message: string;
}

/** A record that was written, with the reference to quote back. */
export interface CreatedResult {
  kind: "created";
  form: "lead" | "ticket";
  reference: string;
  message: string;
}

/** Facts for the model to answer from, the same way a retrieved passage is. */
export interface DataResult {
  kind: "data";
  data: unknown;
}

export interface HandoffResult {
  kind: "handoff";
  message: string;
  agentsAvailable: boolean;
}

export type ToolResult = ProductsResult | ProposalResult | CreatedResult | DataResult | HandoffResult;

export interface Tool<A = unknown> {
  /** Must match a key in the frontend's `AI_TOOL_CATALOG`. */
  name: string;
  description: string;
  /** One schema, used both to describe the tool and to validate what comes back. */
  parameters: z.ZodType<A>;
  kind: "read" | "write";
  run(args: A, context: ToolContext): Promise<ToolResult>;
}

/** A short line for the agent's AI trace. Never shown to the customer. */
export function summarise(result: ToolResult): string {
  switch (result.kind) {
    case "products":
      return `${result.products.length} product(s) matched.`;
    case "proposal":
      return `Proposed a ${result.form} for the customer to confirm.`;
    case "created":
      return `Created ${result.form} ${result.reference}.`;
    case "handoff":
      return result.agentsAvailable ? "Handed over to an available agent." : "Queued for a colleague.";
    case "data":
      return "Returned data.";
  }
}
