import { and, arrayOverlaps, eq } from "drizzle-orm";
import type { Transaction } from "../../db";
import { notifications, roles, users } from "../../db/schema";
import { newId } from "../../core/ids";

/**
 * Telling the company a visitor is waiting.
 *
 * A conversation that starts on the website is the one event nobody in the
 * workspace has any other way of learning about: there is no inbound email and
 * no assignment. Without a notification the only way to find a waiting visitor
 * is to be looking at the inbox at the moment they arrive.
 */

/**
 * Who works the inbox — the people who can reply or route, not everyone who can
 * read. `conversations.view` alone is the viewer role, and someone who cannot
 * answer a waiting visitor has no use for being told one is waiting.
 */
const CONVERSATION_PERMISSIONS = ["conversations.edit", "conversations.assign"];

/** The same test, for the two record types the widget can create. */
const WORKS_LEADS = ["leads.edit", "leads.assign", "leads.create"];
const WORKS_TICKETS = ["tickets.edit", "tickets.assign", "tickets.resolve"];

/**
 * A ceiling on the fan-out. One visitor message must not write a row for every
 * seat in a large workspace; past a couple of dozen people the inbox itself is
 * the queue, not the bell.
 */
const MAX_RECIPIENTS = 25;

export type VisitorActivity = "started" | "replied" | "handoff";

export interface VisitorActivityInput {
  conversationId: string;
  /** When set, the only person told — it is already their thread. */
  assignedUserId: string | null;
  visitorName: string;
  /** The message itself, trimmed for the notification body. */
  preview: string;
  activity: VisitorActivity;
}

export async function notifyVisitorActivity(
  tx: Transaction,
  companyId: string,
  input: VisitorActivityInput,
): Promise<void> {
  const recipients = await conversationRecipients(tx, companyId, input.assignedUserId);
  if (recipients.length === 0) return;

  const now = new Date();
  const { title, severity } = describe(input.activity, input.visitorName);

  await tx.insert(notifications).values(
    recipients.map((userId) => ({
      id: newId("ntf"),
      companyId,
      userId,
      category: "conversation" as const,
      severity,
      title,
      body: input.preview.slice(0, 140),
      href: `/company/conversations/${input.conversationId}`,
      actorName: input.visitorName,
      at: now,
    })),
  );
}

function describe(activity: VisitorActivity, visitorName: string) {
  if (activity === "handoff") {
    return { title: `${visitorName} asked to speak to a person`, severity: "warning" as const };
  }
  if (activity === "replied") {
    return { title: `${visitorName} replied`, severity: "info" as const };
  }
  return { title: `New conversation from ${visitorName}`, severity: "info" as const };
}

async function conversationRecipients(
  tx: Transaction,
  companyId: string,
  assignedUserId: string | null,
): Promise<string[]> {
  if (assignedUserId) return [assignedUserId];
  return recipientsWithAny(tx, companyId, CONVERSATION_PERMISSIONS);
}

/** Active people in this workspace holding any of these permissions. */
async function recipientsWithAny(
  tx: Transaction,
  companyId: string,
  permissions: string[],
): Promise<string[]> {
  const rows = await tx
    .select({ id: users.id })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(
      and(
        eq(users.companyId, companyId),
        eq(users.status, "active"),
        arrayOverlaps(roles.permissions, permissions),
      ),
    )
    .limit(MAX_RECIPIENTS);

  return rows.map((row) => row.id);
}


export interface NewRecordInput {
  kind: "lead" | "ticket";
  reference: string;
  /** One line of what it is about, for the notification body. */
  summary: string;
  href: string;
  /** Already told, and told something more specific — so left out of the fan-out. */
  assignedUserId: string | null;
  customerName: string;
}

/**
 * Tell the team a record arrived.
 *
 * A lead used to notify its assignee and nobody else, and only when the
 * workspace had `notifyAssignee` on — so a lead that routed to a team rather
 * than a person was announced to no one. A ticket raised from the widget
 * notified nobody at all, ever. Both sat in a list waiting to be noticed.
 *
 * The assignee still gets their own "assigned to you" notification where one
 * was picked; this is the wider "something came in" that reaches whoever works
 * that queue.
 */
export async function notifyNewRecord(
  tx: Transaction,
  companyId: string,
  input: NewRecordInput,
): Promise<void> {
  const permissions = input.kind === "lead" ? WORKS_LEADS : WORKS_TICKETS;
  const recipients = (await recipientsWithAny(tx, companyId, permissions)).filter(
    (userId) => userId !== input.assignedUserId,
  );

  if (recipients.length === 0) return;

  const now = new Date();
  await tx.insert(notifications).values(
    recipients.map((userId) => ({
      id: newId("ntf"),
      companyId,
      userId,
      category: input.kind === "lead" ? ("lead" as const) : ("ticket" as const),
      severity: "info" as const,
      title: input.kind === "lead" ? `New lead from ${input.customerName}` : `New ticket from ${input.customerName}`,
      body: `${input.reference} — ${input.summary.slice(0, 140)}`,
      href: input.href,
      actorName: input.customerName,
      at: now,
    })),
  );
}
