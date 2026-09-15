import { and, eq, inArray, sql } from "drizzle-orm";
import { db, type Transaction } from "../../db";
import { companySettings, emailOutbox } from "../../db/schema";
import { newId } from "../../core/ids";

/**
 * Queueing mail rather than sending it.
 *
 * The row is written in the same transaction as whatever prompted it, so a lead
 * and its notification either both exist or neither does — and the visitor
 * waiting on the widget never waits on a mail server. Everything after that is
 * the worker's problem.
 */

export interface QueuedMail {
  to: string;
  toName?: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Queue mail for a company, if it has email switched on.
 *
 * Returns how many rows were written, which is zero for a workspace that has
 * not configured a mail server. Silently writing rows nothing will ever send
 * would fill the table with work that can only fail.
 */
export async function queueEmail(tx: Transaction, companyId: string, messages: QueuedMail[]): Promise<number> {
  const wanted = messages.filter((message) => message.to.trim());
  if (wanted.length === 0) return 0;

  const [settings] = await tx
    .select({ enabled: companySettings.emailEnabled, host: companySettings.smtpHost })
    .from(companySettings)
    .where(eq(companySettings.companyId, companyId))
    .limit(1);

  if (!settings?.enabled || !settings.host) return 0;

  await tx.insert(emailOutbox).values(
    wanted.map((message) => ({
      id: newId("eml"),
      companyId,
      toEmail: message.to.trim(),
      toName: message.toName ?? "",
      subject: message.subject,
      bodyText: message.text,
      bodyHtml: message.html ?? "",
    })),
  );

  return wanted.length;
}

/** How long a claim is trusted before another worker may take the row. */
const STALE_CLAIM_MINUTES = 5;

export interface ClaimedMail {
  id: string;
  companyId: string;
  toEmail: string;
  toName: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  attempts: number;
}

/**
 * Take the next batch, atomically.
 *
 * `FOR UPDATE SKIP LOCKED` is what lets two API instances poll the same table
 * without either sending the same message twice.
 */
export async function claimDue(batch: number): Promise<ClaimedMail[]> {
  const { rows } = await db.execute<{
    id: string;
    company_id: string;
    to_email: string;
    to_name: string;
    subject: string;
    body_text: string;
    body_html: string;
    attempts: number;
  }>(sql`
    UPDATE email_outbox
    SET status = 'sending', claimed_at = now()
    WHERE id IN (
      SELECT id FROM email_outbox
      WHERE send_after <= now()
        AND (
          status = 'pending'
          OR (status = 'sending' AND claimed_at < now() - ${sql.raw(`interval '${STALE_CLAIM_MINUTES} minutes'`)})
        )
      ORDER BY send_after
      LIMIT ${batch}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, company_id, to_email, to_name, subject, body_text, body_html, attempts
  `);

  return rows.map((row) => ({
    id: row.id,
    companyId: row.company_id,
    toEmail: row.to_email,
    toName: row.to_name,
    subject: row.subject,
    bodyText: row.body_text,
    bodyHtml: row.body_html,
    attempts: Number(row.attempts),
  }));
}

export async function markSent(id: string): Promise<void> {
  await db
    .update(emailOutbox)
    .set({ status: "sent", sentAt: new Date(), claimedAt: null, lastError: null })
    .where(eq(emailOutbox.id, id));
}

/** Three attempts, backing off 2, 4 then 8 minutes. */
const MAX_ATTEMPTS = 3;

/**
 * Record a failure and decide whether to try again.
 *
 * The reason is kept verbatim. "Invalid login: 535 authentication failed" tells
 * an administrator what to change; a row that merely says it failed tells them
 * to go looking.
 */
export async function markFailed(id: string, attempts: number, reason: string): Promise<void> {
  const next = attempts + 1;
  const giveUp = next >= MAX_ATTEMPTS;

  await db
    .update(emailOutbox)
    .set({
      status: giveUp ? "failed" : "pending",
      attempts: next,
      lastError: reason.slice(0, 500),
      claimedAt: null,
      sendAfter: giveUp ? new Date() : new Date(Date.now() + 2 ** next * 60_000),
    })
    .where(eq(emailOutbox.id, id));
}

/** Anything still waiting, for the dashboard to show what is stuck. */
export function pendingCount(companyId: string) {
  return db
    .select({ status: emailOutbox.status, count: sql<number>`count(*)::int` })
    .from(emailOutbox)
    .where(and(eq(emailOutbox.companyId, companyId), inArray(emailOutbox.status, ["pending", "sending", "failed"])))
    .groupBy(emailOutbox.status);
}
