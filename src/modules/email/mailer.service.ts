import nodemailer, { type Transporter } from "nodemailer";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { companySettings } from "../../db/schema";
import { env } from "../../config/env";
import { decryptSecret } from "../../core/secrets";

/**
 * A workspace's own mail server.
 *
 * Each company sends through its own SMTP host, so the transport is built per
 * tenant from that company's settings and never shared between them — a
 * misconfigured workspace cannot end up relaying through a neighbour's server.
 */

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  fromName: string;
  fromEmail: string;
}

/** The sender's own settings, decrypted. Never leaves the server. */
export async function smtpConfigFor(companyId: string): Promise<SmtpConfig | null> {
  const [row] = await db
    .select()
    .from(companySettings)
    .where(eq(companySettings.companyId, companyId))
    .limit(1);

  if (!row || !row.emailEnabled || !row.smtpHost || !row.smtpFromEmail) return null;

  return {
    host: row.smtpHost,
    port: row.smtpPort,
    secure: row.smtpSecure,
    user: row.smtpUser,
    password: row.smtpPasswordEncrypted ? decryptSecret(row.smtpPasswordEncrypted) : "",
    fromName: row.smtpFromName,
    fromEmail: row.smtpFromEmail,
  };
}

/**
 * Transports are cached for a minute.
 *
 * A queue working through a backlog would otherwise open a fresh connection per
 * message; a minute is short enough that changing the password in the dashboard
 * takes effect while you are still looking at the screen.
 */
const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; config: string; transport: Transporter }>();

function transportFor(companyId: string, config: SmtpConfig): Transporter {
  const fingerprint = `${config.host}:${config.port}:${config.secure}:${config.user}:${config.password}`;
  const hit = cache.get(companyId);
  if (hit && hit.config === fingerprint && Date.now() - hit.at < CACHE_MS) return hit.transport;

  hit?.transport.close();

  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    /**
     * Never hand the password to an unencrypted connection.
     *
     * Without this, a server that simply does not advertise STARTTLS gets the
     * credential in the clear — verified against a stub that offered `AUTH
     * PLAIN` and no TLS: `AUTH PLAIN AG5vcnRod2luZAB…` decodes straight back to
     * the username and password. Encrypting it in the database and then
     * broadcasting it over the wire protects nothing.
     *
     * With `secure` the connection is already TLS from the first byte, so this
     * only applies to the STARTTLS ports. A server that will not upgrade now
     * fails the send instead, which is the correct outcome.
     */
    requireTLS: !config.secure,
    auth: config.user ? { user: config.user, pass: config.password } : undefined,
    // A mail server that accepts the connection and then stops responding must
    // not hold a worker open indefinitely.
    connectionTimeout: env.SMTP_TIMEOUT_MS,
    greetingTimeout: env.SMTP_TIMEOUT_MS,
    socketTimeout: env.SMTP_TIMEOUT_MS,
  });

  cache.set(companyId, { at: Date.now(), config: fingerprint, transport });
  return transport;
}

export interface OutgoingMail {
  to: string;
  toName?: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendMail(companyId: string, config: SmtpConfig, mail: OutgoingMail): Promise<void> {
  await transportFor(companyId, config).sendMail({
    from: config.fromName ? `"${config.fromName}" <${config.fromEmail}>` : config.fromEmail,
    to: mail.toName ? `"${mail.toName}" <${mail.to}>` : mail.to,
    subject: mail.subject,
    text: mail.text,
    ...(mail.html ? { html: mail.html } : {}),
  });
}

/** Prove the settings work, for the dashboard's test button. */
export async function verifyTransport(companyId: string, config: SmtpConfig): Promise<void> {
  await transportFor(companyId, config).verify();
}

/** Drop a cached transport, so re-saved settings are picked up at once. */
export function forgetTransport(companyId: string): void {
  cache.get(companyId)?.transport.close();
  cache.delete(companyId);
}
