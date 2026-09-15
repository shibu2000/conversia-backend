import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { messages } from "../../db/schema";
import { logger } from "../../config/logger";
import { aiProviders } from "../providers";

/**
 * Making a follow-up searchable.
 *
 * "How long do I have?" carries no subject, so embedding it retrieves nothing —
 * the question only means something next to the one before it. Rewriting it into
 * "How long do I have to return swimwear?" gives the vector search something to
 * match.
 *
 * Only the retrieval query is rewritten. The customer's own wording still goes
 * to the generator, so the reply answers what they actually asked rather than
 * what a rewrite decided they meant.
 */

/** Enough to resolve a pronoun; short enough to keep the rewrite prompt cheap. */
const HISTORY_TURNS = 6;

export async function recentExchange(companyId: string, conversationId: string): Promise<string[]> {
  const rows = await db
    .select({ role: messages.role, body: messages.body })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.companyId, companyId),
        eq(messages.isInternal, false),
        // System rows are bookkeeping — "the visitor asked for a person" is not
        // part of what was discussed.
        inArray(messages.role, ["customer", "assistant", "agent"]),
      ),
    )
    .orderBy(desc(messages.at))
    .limit(HISTORY_TURNS);

  return rows
    .reverse()
    .filter((row) => row.body.trim())
    .map((row) => `${row.role === "customer" ? "Customer" : "Assistant"}: ${row.body.trim()}`);
}

/**
 * Rewrite a follow-up into a question that stands on its own.
 *
 * Returns null when there is nothing to work with or the model declines, and the
 * caller then falls back to the original question — a failed rewrite must never
 * be worse than not having tried.
 */
export async function rewriteForRetrieval(question: string, history: string[]): Promise<string | null> {
  if (history.length === 0) return null;

  const { chat } = aiProviders();

  try {
    const completion = await chat.complete({
      system: [
        "You rewrite a customer's latest message into a standalone search query.",
        "Resolve pronouns and implied subjects using the conversation.",
        "Keep the customer's own terms. Add nothing that was not said.",
        "Reply with the rewritten question only — no quotes, no explanation.",
        "If the message already stands on its own, reply with it unchanged.",
      ].join("\n"),
      user: `CONVERSATION:\n${history.join("\n")}\n\nLATEST MESSAGE: ${question}\n\nSTANDALONE QUESTION:`,
      // Deterministic: this is a mechanical transformation, not a creative one.
      temperature: 0,
      maxTokens: 60,
    });

    const rewritten = completion.text.trim().replace(/^["']|["']$/g, "");
    if (!rewritten || rewritten.length > 300) return null;
    if (rewritten.toLowerCase() === question.trim().toLowerCase()) return null;

    logger.debug("Rewrote a follow-up for retrieval", { from: question, to: rewritten });
    return rewritten;
  } catch (error) {
    logger.warn("Follow-up rewrite failed; using the question as asked", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
