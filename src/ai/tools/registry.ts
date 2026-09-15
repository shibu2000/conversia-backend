import { z } from "zod";
import { logger } from "../../config/logger";
import * as widget from "../../modules/widget/widget.service";
import type { Tool, ToolContext, ToolResult } from "./types";

/**
 * The four tools with real services behind them.
 *
 * `lookup_order`, `book_appointment` and `check_availability` are in the
 * catalogue and deliberately absent here. The first needs an identity check
 * before anyone can read an order by quoting its reference; the other two have
 * a table and nothing else — no availability model, no reference counter, no
 * write path. Offering a tool that cannot work would have the assistant promise
 * something and then fail in front of a customer.
 */

const searchProducts: Tool<{ query: string }> = {
  name: "search_products",
  description:
    "Search the company's product catalogue and show the customer what it finds. " +
    "Use whenever they want to see, compare or learn about something the company sells — " +
    "asking what is available, asking for a recommendation, or asking about one item by name. " +
    "Do not use it when they already own the item and are reporting a problem with it.",
  parameters: z.object({
    query: z.string().trim().min(1).max(200).describe("What the customer is looking for, in their own words"),
  }),
  kind: "read",
  async run(args, context) {
    const products = await widget.searchProducts(context.embedKey, args.query, 3);
    return { kind: "products", products };
  },
};

const createLead: Tool<{ interest: string; quantity?: string; company?: string }> = {
  name: "create_lead",
  description:
    "Pass a sales enquiry to the team. Use when the customer wants to buy, wants a quote, " +
    "or asks to speak to sales. Do not ask for their name or email — those are already known " +
    "or will be collected by a form.",
  parameters: z.object({
    interest: z.string().trim().min(1).max(2000).describe("What the customer is interested in"),
    quantity: z.string().trim().max(120).optional().describe("How many, if they said"),
    company: z.string().trim().max(160).optional().describe("Their company, if they said"),
  }),
  kind: "write",
  async run(args, context) {
    return propose("lead", context, {
      name: context.customer?.name,
      email: context.customer?.email ?? undefined,
      phone: context.customer?.phone ?? undefined,
      company: args.company,
      product_interest: args.interest,
      quantity: args.quantity,
    });
  },
};

const createTicket: Tool<{ subject: string; description: string; orderReference?: string }> = {
  name: "create_ticket",
  description:
    "Raise a support ticket. Use when something has gone wrong and the customer needs help " +
    "that cannot be answered from the knowledge base. Do not ask for their name or email — " +
    "those are already known or will be collected by a form.",
  parameters: z.object({
    subject: z.string().trim().min(1).max(200).describe("A short summary of the problem"),
    description: z.string().trim().min(1).max(5000).describe("The problem in the customer's own words"),
    orderReference: z.string().trim().max(64).optional().describe("Their order reference, if they gave one"),
  }),
  kind: "write",
  async run(args, context) {
    return propose("ticket", context, {
      name: context.customer?.name,
      email: context.customer?.email ?? undefined,
      order_reference: args.orderReference,
      subject: args.subject,
      description: args.description,
    });
  },
};

const escalateToHuman: Tool<Record<string, never>> = {
  name: "escalate_to_human",
  description:
    "Hand the conversation to a person. Use when the customer asks for a human, or when they " +
    "are clearly frustrated and nothing you can do will help.",
  parameters: z.object({}),
  kind: "write",
  async run(_args, context) {
    // The exception to propose-before-write: a handoff creates no record a
    // person has to unpick, and making someone confirm a request to speak to
    // someone is the opposite of helping.
    const result = await widget.requestHandoff(context.embedKey, context.conversationId ?? undefined);
    return {
      kind: "handoff",
      message: result.agentsAvailable ? result.queueMessage : (result.outsideHoursMessage ?? result.queueMessage),
      agentsAvailable: result.agentsAvailable,
    };
  },
};

/**
 * A write tool's output: either a filled form for the customer to check, or the
 * record itself when the workspace has said confirmation is not needed and we
 * already hold a validated identity.
 */
async function propose(
  form: "lead" | "ticket",
  context: ToolContext,
  prefill: Record<string, string | undefined>,
): Promise<ToolResult> {
  const identified = Boolean(context.customer?.name && context.customer?.email);
  const confirmFirst = form === "ticket" ? context.tickets.confirmBeforeCreate : true;

  // Without a validated email there is nothing to create from: both schemas
  // require one, and an address taken down in conversation is not validated.
  // The form is the only thing in this system that checks an email is an email.
  if (!identified || confirmFirst) {
    return {
      kind: "proposal",
      form,
      prefill,
      message:
        form === "lead"
          ? "I can pass this to our sales team — just check these details."
          : "I can raise this for you — just check these details.",
    };
  }

  const customer = context.customer!;

  if (form === "lead") {
    const { leadReference } = await widget.submitLead(context.embedKey, {
      name: customer.name,
      email: customer.email!,
      phone: customer.phone ?? undefined,
      company: prefill.company,
      interest: prefill.product_interest ?? "General enquiry",
      quantity: prefill.quantity,
      conversationId: context.conversationId ?? undefined,
    });
    return { kind: "created", form, reference: leadReference, message: `Passed to our sales team as ${leadReference}.` };
  }

  const { ticketReference } = await widget.submitTicket(context.embedKey, {
    name: customer.name,
    email: customer.email!,
    orderReference: prefill.order_reference,
    subject: prefill.subject ?? "Support request",
    description: prefill.description ?? "",
    conversationId: context.conversationId ?? undefined,
    // The agent's queue should show which tickets a model filed.
    createdByAi: true,
  });
  return { kind: "created", form, reference: ticketReference, message: `Logged as ${ticketReference}.` };
}

const ALL: Tool<never>[] = [searchProducts, createLead, createTicket, escalateToHuman] as Tool<never>[];

/**
 * The tools this workspace has switched on, minus any it cannot honour.
 *
 * `enabledTools` has been configurable in the dashboard since before the AI
 * layer existed and read by nothing. Offering a tool whose feature is disabled
 * — ticket creation with tickets turned off — would have the assistant offer
 * something the next step refuses.
 */
export function toolsFor(context: ToolContext): Tool<never>[] {
  const enabled = new Set(context.ai.enabledTools ?? []);

  return ALL.filter((tool) => {
    if (!enabled.has(tool.name)) return false;
    if (tool.name === "create_lead") return context.leads.enabled;
    if (tool.name === "create_ticket") return context.tickets.enabled;
    return true;
  });
}

/** Validate the model's arguments, then run. */
export async function runTool(tool: Tool<never>, rawArgs: unknown, context: ToolContext): Promise<ToolResult> {
  const parsed = tool.parameters.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    logger.warn("Model called a tool with arguments that did not validate", {
      tool: tool.name,
      issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    });
    throw new Error(`${tool.name} was called with invalid arguments.`);
  }

  return tool.run(parsed.data as never, context);
}
