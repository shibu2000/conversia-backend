import { eq } from "drizzle-orm";
import type { Transaction } from "../../db";
import { companySettings, customers, users } from "../../db/schema";
import { queueEmail } from "./outbox.service";
import { leadEmail, type LeadMail } from "./templates";

/**
 * Who hears about a new lead by email.
 *
 * The assignee, because it is theirs — and the workspace's own lead address,
 * because most leads have no assignee: routing is per-workspace and
 * `pickAssignee` only implements round robin, so a company set to `team` or
 * `manual` produces leads owned by nobody. Without the second address those
 * would email no one at all, which is the situation this is meant to end.
 *
 * Deliberately not the whole team. The in-app notification already reaches
 * everyone who works leads; an inbox copy for each of them is how a team learns
 * to filter the sender into a folder.
 */
export async function queueLeadEmail(
  tx: Transaction,
  companyId: string,
  lead: Omit<LeadMail, "customerEmail" | "customerName" | "customerPhone" | "companyName"> & {
    customerId: string;
    assignedUserId: string | null;
  },
): Promise<void> {
  const [settings] = await tx
    .select({ inbox: companySettings.leadNotificationEmail })
    .from(companySettings)
    .where(eq(companySettings.companyId, companyId))
    .limit(1);

  const [customer] = await tx
    .select({ name: customers.name, email: customers.email, phone: customers.phone, company: customers.companyName })
    .from(customers)
    .where(eq(customers.id, lead.customerId))
    .limit(1);

  const [assignee] = lead.assignedUserId
    ? await tx
        .select({ name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, lead.assignedUserId))
        .limit(1)
    : [undefined];

  const recipients = [
    ...(assignee ? [{ to: assignee.email, toName: assignee.name }] : []),
    ...(settings?.inbox ? [{ to: settings.inbox, toName: "" }] : []),
  // The assignee may well be the address on file; one person, one email.
  ].filter(
    (entry, index, all) => all.findIndex((other) => other.to.toLowerCase() === entry.to.toLowerCase()) === index,
  );

  if (recipients.length === 0) return;

  const { subject, text, html } = leadEmail({
    ...lead,
    customerName: customer?.name ?? "A website visitor",
    customerEmail: customer?.email ?? "",
    customerPhone: customer?.phone ?? undefined,
    companyName: customer?.company ?? undefined,
  });

  await queueEmail(
    tx,
    companyId,
    recipients.map((recipient) => ({ ...recipient, subject, text, html })),
  );
}
