import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { sendMail, smtpConfigFor } from "./mailer.service";
import { claimDue, markFailed, markSent } from "./outbox.service";

/**
 * The outbox worker.
 *
 * Same shape as the indexing worker: poll, claim with `SKIP LOCKED`, do the
 * work, record the outcome. Kept separate from it because the two fail in
 * different ways and at different speeds — a mail server being briefly
 * unreachable should not hold up indexing, and a large PDF should not delay a
 * lead notification.
 */

const BATCH = 10;

let timer: NodeJS.Timeout | null = null;
let running = false;
let stopped = false;

export function startEmailWorker(): void {
  if (timer) return;
  stopped = false;
  timer = setInterval(() => void tick(), env.EMAIL_WORKER_INTERVAL_MS);
  timer.unref();
  logger.info("Email worker started", { intervalMs: env.EMAIL_WORKER_INTERVAL_MS });
}

export function stopEmailWorker(): void {
  stopped = true;
  if (timer) clearInterval(timer);
  timer = null;
}

/** Nudge the worker so a queued message goes now rather than at the next tick. */
export function wakeEmailWorker(): void {
  if (!stopped) void tick();
}

async function tick(): Promise<void> {
  if (running || stopped) return;
  running = true;

  try {
    const due = await claimDue(BATCH);
    if (due.length === 0) return;

    for (const mail of due) {
      if (stopped) return;

      try {
        const config = await smtpConfigFor(mail.companyId);
        if (!config) {
          // Email was switched off, or the settings were cleared, after this was
          // queued. Not an error worth retrying — there is nothing to retry with.
          await markFailed(mail.id, 99, "Email is not configured for this workspace.");
          continue;
        }

        await sendMail(mail.companyId, config, {
          to: mail.toEmail,
          toName: mail.toName,
          subject: mail.subject,
          text: mail.bodyText,
          html: mail.bodyHtml || undefined,
        });

        await markSent(mail.id);
        logger.info("Sent an email", { companyId: mail.companyId, to: mail.toEmail, subject: mail.subject });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        await markFailed(mail.id, mail.attempts, reason);
        logger.warn("Email send failed", {
          companyId: mail.companyId,
          to: mail.toEmail,
          attempt: mail.attempts + 1,
          error: reason,
        });
      }
    }
  } catch (error) {
    logger.error("Email worker pass failed", { error: error instanceof Error ? error.message : String(error) });
  } finally {
    running = false;
  }
}
