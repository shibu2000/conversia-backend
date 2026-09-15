import { randomBytes } from "node:crypto";

/**
 * Prefixed identifiers (`lead_a91f3c2b8d40`).
 *
 * The frontend treats ids as opaque strings and puts several of them in URLs, so
 * a readable prefix makes a log line or a support ticket legible without a
 * lookup. Twelve hex characters is 48 bits of randomness — ample for a
 * per-tenant record space, and short enough to read aloud.
 */
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString("hex")}`;
}

/** URL-safe slug for company, product and FAQ-set slugs. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");
}

/** Public embed key for the chat widget. Not a secret; identifies a tenant. */
export function newEmbedKey(): string {
  return `cv_pk_${randomBytes(12).toString("hex")}`;
}
