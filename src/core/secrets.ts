import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { env } from "../config/env";

/**
 * Storing a credential that has to be read back.
 *
 * Every other secret in this codebase is hashed and never recovered: a password
 * is bcrypted, a refresh token reaches the database only as a SHA-256 digest.
 * An SMTP password cannot work that way — the server has to present it to a mail
 * host — so it is encrypted instead, and the two properties that matter are not
 * about the cipher:
 *
 * - **The key lives in the environment, never in the database.** A dump, a
 *   restored backup, a leaked read replica: none of them contain anything
 *   usable on their own.
 * - **The plaintext never leaves this process.** The settings API reports
 *   whether a password is set, never what it is.
 *
 * GCM rather than CBC because it authenticates as well as encrypts: a tampered
 * ciphertext fails to decrypt rather than yielding plausible bytes that would
 * then be sent to a mail server as a login attempt.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
/** Fixed, and not a secret: it separates this key's use from any other. */
const SALT = "conversia.credential.v1";
const VERSION = "v1";

let cachedKey: Buffer | null = null;

/** Whether credentials can be stored at all on this deployment. */
export function encryptionAvailable(): boolean {
  return Boolean(env.ENCRYPTION_KEY);
}

function key(): Buffer {
  if (cachedKey) return cachedKey;
  if (!env.ENCRYPTION_KEY) {
    // Refusing is the point. Falling back to a built-in key would mean every
    // deployment shares it, which is indistinguishable from no encryption.
    throw new Error("ENCRYPTION_KEY is not set, so credentials cannot be stored.");
  }
  cachedKey = scryptSync(env.ENCRYPTION_KEY, SALT, 32);
  return cachedKey;
}

/** `v1:<iv>:<tag>:<ciphertext>`, each part base64. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(
    ":",
  );
}

export function decryptSecret(stored: string): string {
  const [version, iv, tag, payload] = stored.split(":");
  if (version !== VERSION || !iv || !tag || !payload) {
    // The version prefix exists so a future key rotation can recognise what it
    // is looking at rather than guess.
    throw new Error("Stored credential is not in a format this build understands.");
  }

  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));

  return Buffer.concat([decipher.update(Buffer.from(payload, "base64")), decipher.final()]).toString("utf8");
}
