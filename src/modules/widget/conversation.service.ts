import { and, asc, eq, gt, sql } from "drizzle-orm";
import { db, type Transaction } from "../../db";
import { conversations, customers, messages, users } from "../../db/schema";
import { newId } from "../../core/ids";
import { notifyVisitorActivity, type VisitorActivity } from "../notifications/notifications.service";
import { formatConversationReference, nextReference } from "../shared/reference.service";
import type { ProductReference } from "../../db/schema";

/**
 * Persisting widget conversations.
 *
 * Without this, the Conversations inbox shows nothing a real visitor ever said
 * — which makes the module that exists to show customer conversations the one
 * place you cannot see them. Every question and every answer is written as it
 * happens, so an agent picking up a handoff reads the same thread the visitor
 * did.
 *
 * A conversation starts anonymous. It is attached to a customer the moment one
 * identifies themselves by submitting a lead or a ticket.
 */

/** Resume a widget conversation, or start one. */
export async function resolveConversation(
  tx: Transaction,
  companyId: string,
  conversationId: string | undefined,
  locale: string,
): Promise<{ id: string; isNew: boolean }> {
  if (conversationId) {
    const [existing] = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.companyId, companyId)))
      .limit(1);

    // An id the caller invented, or one from another workspace, silently starts
    // a fresh thread rather than erroring: the visitor did nothing wrong and a
    // broken session should not stop them talking to the company.
    if (existing) return { id: existing.id, isNew: false };
  }

  const id = newId("cnv");
  const now = new Date();

  await tx.insert(conversations).values({
    id,
    companyId,
    reference: await nextReference(tx, companyId, "conversation", formatConversationReference),
    customerId: null,
    // A short, stable handle so the inbox has something to show before the
    // visitor gives a name.
    visitorLabel: `Visitor ${id.slice(-4)}`,
    channel: "web_widget",
    status: "active",
    intent: "unknown",
    subject: "Website chat",
    locale,
    // Nothing has been resolved by an assistant, because there is no assistant.
    resolvedByAi: false,
    aiConfidence: "0",
    createdAt: now,
    updatedAt: now,
    lastMessageAt: now,
  });

  return { id, isNew: true };
}

export interface RecordedTurn {
  /** What the visitor asked. */
  question: string;
  /** What the widget replied, as prose. Empty for a product carousel. */
  answer: string;
  /**
   * How the reply was produced.
   *
   * For everything except `ai_answer` this is a fact about which deterministic
   * branch ran, not a classification — no model was involved in choosing it.
   */
  outcome: "faq_answer" | "products" | "needs_ai_backend" | "ai_answer" | "form_proposed";
  products?: ProductReference[];
  /** The FAQ that matched, so an agent can see which answer was served. */
  faqId?: string;
}

/**
 * Write one exchange: the visitor's message, then the widget's reply.
 *
 * The conversation's `intent` is set from the branch that answered. That is a
 * record of how the question was handled — an honest label for a deterministic
 * path — and is deliberately not presented as an inferred intent.
 */
export async function recordTurn(
  tx: Transaction,
  companyId: string,
  conversationId: string,
  turn: RecordedTurn,
): Promise<void> {
  const now = new Date();

  await tx.insert(messages).values({
    id: newId("msg"),
    conversationId,
    companyId,
    role: "customer",
    body: turn.question,
    at: now,
  });

  await tx.insert(messages).values({
    id: newId("msg"),
    conversationId,
    companyId,
    // `assistant` is the widget speaking, which it did — by serving a curated
    // answer or a catalogue result, not by generating one.
    role: "assistant",
    body: turn.answer,
    products: turn.products ?? [],
    at: new Date(now.getTime() + 1),
  });

  const intent =
    turn.outcome === "faq_answer"
      ? "faq"
      : turn.outcome === "products"
        ? "product_discovery"
        : // An AI answer's real intent is the AI layer's to classify; until it
          // does, "unknown" is the honest label.
          "unknown";

  const preview = (turn.answer || turn.question).slice(0, 140);

  const [updated] = await tx
    .update(conversations)
    .set({
      messageCount: sql`${conversations.messageCount} + 2`,
      // Unread from the company's point of view: nobody there has read it.
      unreadCount: sql`${conversations.unreadCount} + 1`,
      preview,
      intent: intent as never,
      lastMessageAt: now,
      updatedAt: now,
      // The subject follows the first real question, so the inbox row is
      // readable at a glance instead of every row saying "Website chat".
      subject: sql`CASE WHEN ${conversations.subject} = 'Website chat' THEN ${turn.question.slice(0, 120)} ELSE ${conversations.subject} END`,
    })
    .where(eq(conversations.id, conversationId))
    .returning(NOTIFIABLE);

  await notifyOnFirstUnread(tx, companyId, updated, turn.question, "started");
}

/** The columns a notification needs: who to tell, and what to call the visitor. */
const NOTIFIABLE = {
  id: conversations.id,
  assignedUserId: conversations.assignedUserId,
  customerId: conversations.customerId,
  visitorLabel: conversations.visitorLabel,
  unreadCount: conversations.unreadCount,
  messageCount: conversations.messageCount,
};

interface NotifiableConversation {
  id: string;
  assignedUserId: string | null;
  customerId: string | null;
  visitorLabel: string | null;
  unreadCount: number;
  messageCount: number;
}

/**
 * Notify once per burst, not once per message.
 *
 * `unreadCount` is only reset when someone from the company replies, so a count
 * of exactly one means this message is the first the workspace has not dealt
 * with. A visitor typing five lines in a row produces one notification; the
 * next one arrives after an agent has answered and the visitor writes again.
 */
async function notifyOnFirstUnread(
  tx: Transaction,
  companyId: string,
  updated: NotifiableConversation | undefined,
  preview: string,
  activity: VisitorActivity,
): Promise<void> {
  if (!updated || updated.unreadCount !== 1) return;

  await notifyVisitorActivity(tx, companyId, {
    conversationId: updated.id,
    assignedUserId: updated.assignedUserId,
    visitorName: await visitorNameOf(tx, updated),
    preview,
    // The opening exchange of a brand-new thread reads differently from a reply
    // in one the company has already seen.
    activity: updated.messageCount <= 2 ? activity : "replied",
  });
}

/** The name to show: the customer's once known, the anonymous handle until then. */
async function visitorNameOf(tx: Transaction, row: NotifiableConversation): Promise<string> {
  if (!row.customerId) return row.visitorLabel ?? "A website visitor";

  const [customer] = await tx
    .select({ name: customers.name })
    .from(customers)
    .where(eq(customers.id, row.customerId))
    .limit(1);

  return customer?.name ?? row.visitorLabel ?? "A website visitor";
}

/**
 * Attach a customer to an anonymous conversation.
 *
 * Called when a visitor submits a lead or a ticket — that is the first moment
 * the company learns who it has been talking to, and the thread should stop
 * reading as "Visitor 4f2a" from then on.
 */
export async function attachCustomer(
  tx: Transaction,
  conversationId: string,
  customerId: string,
): Promise<void> {
  await tx
    .update(conversations)
    .set({ customerId, updatedAt: new Date() })
    .where(and(eq(conversations.id, conversationId), sql`${conversations.customerId} IS NULL`));
}

/** Link the lead or ticket a conversation produced, in both directions. */
export async function linkOutcome(
  tx: Transaction,
  conversationId: string,
  link: { leadId?: string; ticketId?: string },
): Promise<void> {
  await tx
    .update(conversations)
    .set({ ...link, updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));
}

/**
 * Mark a conversation as waiting for a human.
 *
 * This is what puts it in the agent's handoff queue and the unassigned badge.
 * A handoff that does not reach the inbox is a visitor left waiting for someone
 * who was never told.
 */
export async function markHandoff(companyId: string, conversationId: string): Promise<void> {
  const now = new Date();

  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(conversations)
      .set({ status: "human_handoff", updatedAt: now, lastMessageAt: now })
      .where(and(eq(conversations.id, conversationId), eq(conversations.companyId, companyId)))
      .returning(NOTIFIABLE);

    if (!updated) return;

    await tx.insert(messages).values({
      id: newId("msg"),
      conversationId,
      companyId,
      role: "system",
      body: "The visitor asked to speak to a person.",
      event: { kind: "handoff_requested", detail: "Requested from the chat widget." },
      at: now,
    });

    // Unconditional, unlike a message: someone explicitly asked for a person,
    // and that is worth saying again even if the thread already had unread
    // messages waiting.
    await notifyVisitorActivity(tx, companyId, {
      conversationId,
      assignedUserId: updated.assignedUserId,
      visitorName: await visitorNameOf(tx, updated),
      preview: "Waiting for someone to join the chat.",
      activity: "handoff",
    });
  });
}

/** Statuses in which a person, not the assistant, owns the conversation. */
const HUMAN_OWNED = ["human_handoff", "escalated"] as const;

export interface ConversationOwnership {
  id: string;
  /** True once a human has taken the thread; the assistant must stay silent. */
  humanOwned: boolean;
  /** Null while it is still queued and nobody has picked it up. */
  agentName: string | null;
}

/**
 * Who owns this conversation right now.
 *
 * The assistant reads this before answering. Making the status the single
 * switch — rather than a flag each answering path has to remember to check —
 * is what stops the bot talking over an agent who has just taken over.
 */
export async function getOwnership(
  tx: Transaction,
  companyId: string,
  conversationId: string,
): Promise<ConversationOwnership | null> {
  const [row] = await tx
    .select({
      id: conversations.id,
      status: conversations.status,
      agentName: users.name,
    })
    .from(conversations)
    .leftJoin(users, eq(users.id, conversations.assignedUserId))
    .where(and(eq(conversations.id, conversationId), eq(conversations.companyId, companyId)))
    .limit(1);

  if (!row) return null;

  return {
    id: row.id,
    humanOwned: (HUMAN_OWNED as readonly string[]).includes(row.status),
    agentName: row.agentName,
  };
}

/**
 * Record a visitor's message without answering it.
 *
 * Used once a human owns the thread: the message still has to reach the inbox,
 * it just must not trigger the assistant.
 */
export async function recordVisitorMessage(
  companyId: string,
  conversationId: string,
  body: string,
): Promise<void> {
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx.insert(messages).values({
      id: newId("msg"),
      conversationId,
      companyId,
      role: "customer",
      body,
      at: now,
    });

    const [updated] = await tx
      .update(conversations)
      .set({
        messageCount: sql`${conversations.messageCount} + 1`,
        // The agent has not read it yet, so it counts as unread even though
        // they are the one handling the thread.
        unreadCount: sql`${conversations.unreadCount} + 1`,
        preview: body.slice(0, 140),
        lastMessageAt: now,
        updatedAt: now,
      })
      .where(eq(conversations.id, conversationId))
      .returning(NOTIFIABLE);

    await notifyOnFirstUnread(tx, companyId, updated, body, "replied");
  });
}

/**
 * The transcript as the *visitor* may see it.
 *
 * Internal notes are excluded. An agent writing "this customer has been a
 * nightmare all week" for their colleagues must never have it surface in the
 * widget, so the filter lives here rather than being left to each caller.
 *
 * The conversation id is the capability: it is 48 bits of randomness and is
 * scoped to the embed key's company, so possessing it is what proves the caller
 * is the visitor whose conversation it is — the same model as a magic link.
 */
export async function getVisibleTranscript(
  companyId: string,
  conversationId: string,
  since?: Date,
) {
  const conditions = [
    eq(messages.conversationId, conversationId),
    eq(messages.companyId, companyId),
    eq(messages.isInternal, false),
  ];
  if (since) conditions.push(gt(messages.at, since));

  const rows = await db
    .select({
      id: messages.id,
      role: messages.role,
      authorName: messages.authorName,
      body: messages.body,
      products: messages.products,
      at: messages.at,
      event: messages.event,
    })
    .from(messages)
    .where(and(...conditions))
    .orderBy(asc(messages.at))
    .limit(200);

  return rows
    // System rows carry internal trace detail; the visitor sees the prose only.
    .filter((row) => row.role !== "system")
    .map((row) => ({
      id: row.id,
      role: row.role === "agent" ? ("agent" as const) : row.role === "customer" ? ("customer" as const) : ("assistant" as const),
      authorName: row.authorName ?? undefined,
      body: row.body,
      products: row.products?.length ? row.products : undefined,
      at: row.at.toISOString(),
    }));
}

export interface KnownVisitor {
  customerId: string;
  name: string;
  email: string | null;
  phone: string | null;
}

/**
 * Who the company already knows this visitor to be.
 *
 * The pre-chat form writes a `customers` row and links it to the conversation,
 * but nothing has ever read it back — so a visitor who gave their name and email
 * before the first message was asked for both again by the lead and ticket
 * forms. Asking twice for something already given reads as not listening, and it
 * is also how a second customer row gets created for the same person.
 */
export async function customerForConversation(
  companyId: string,
  conversationId: string | null | undefined,
): Promise<KnownVisitor | null> {
  if (!conversationId) return null;

  const [row] = await db
    .select({
      customerId: customers.id,
      name: customers.name,
      email: customers.email,
      phone: customers.phone,
    })
    .from(conversations)
    .innerJoin(customers, eq(customers.id, conversations.customerId))
    .where(and(eq(conversations.id, conversationId), eq(conversations.companyId, companyId)))
    .limit(1);

  return row ?? null;
}

/**
 * The customer a widget submission belongs to.
 *
 * Order matters. The conversation's own customer wins, because the visitor may
 * have identified by phone before the form asked for an email — and deriving
 * from the email alone would create a second row for the same person, which
 * `attachCustomer`'s first-write-wins guard would then refuse to re-link,
 * leaving the thread pointing at one record and the lead at another.
 *
 * Details already stored are enriched, never erased: a form that leaves phone
 * blank must not wipe a phone number the visitor gave earlier.
 */
export async function resolveCustomer(
  tx: Transaction,
  companyId: string,
  conversationId: string | undefined,
  details: { name: string; email?: string | null; phone?: string | null; companyName?: string | null },
  statusForNew: "lead" | "active",
): Promise<string> {
  const now = new Date();

  const linked = conversationId
    ? (
        await tx
          .select({ id: conversations.customerId })
          .from(conversations)
          .where(and(eq(conversations.id, conversationId), eq(conversations.companyId, companyId)))
          .limit(1)
      )[0]?.id
    : null;

  const [byEmail] = details.email
    ? await tx
        .select({ id: customers.id })
        .from(customers)
        .where(and(eq(customers.companyId, companyId), sql`lower(${customers.email}) = ${details.email.toLowerCase()}`))
        .limit(1)
    : [undefined];

  const existingId = linked ?? byEmail?.id ?? null;

  if (existingId) {
    await tx
      .update(customers)
      .set({
        name: details.name,
        ...(details.email ? { email: details.email } : {}),
        ...(details.phone ? { phone: details.phone } : {}),
        ...(details.companyName ? { companyName: details.companyName } : {}),
        lastSeenAt: now,
        updatedAt: now,
      })
      .where(eq(customers.id, existingId));
    return existingId;
  }

  const customerId = newId("cus");
  await tx.insert(customers).values({
    id: customerId,
    companyId,
    name: details.name,
    email: details.email ?? null,
    phone: details.phone ?? null,
    companyName: details.companyName ?? null,
    status: statusForNew,
    firstSeenChannel: "chatbot",
    lastSeenAt: now,
  });

  return customerId;
}

/**
 * Record a tool call for the agent's AI trace.
 *
 * Written as a `system` message, which `getVisibleTranscript` filters out — so
 * the arguments and timings reach the inbox and never the customer. Without
 * this an agent picking up a conversation can see that a ticket appeared but
 * not what the assistant did to produce it.
 */
export async function recordToolCall(
  companyId: string,
  conversationId: string,
  trace: { name: string; args: Record<string, unknown>; status: "success" | "error"; durationMs: number; summary: string },
): Promise<void> {
  await db.insert(messages).values({
    id: newId("msg"),
    conversationId,
    companyId,
    role: "system",
    body: `${trace.name} — ${trace.summary}`,
    event: {
      kind: "tool_called",
      detail: trace.summary,
      toolCall: {
        id: newId("tcl"),
        name: trace.name,
        args: trace.args,
        status: trace.status,
        durationMs: trace.durationMs,
        resultSummary: trace.summary,
      },
    },
    at: new Date(),
  });
}
