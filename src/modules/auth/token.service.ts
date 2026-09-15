import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../../config/env";
import { unauthorized } from "../../core/errors";
import type { AccessTokenPayload } from "./auth.types";

/**
 * Token handling.
 *
 * Access tokens are short-lived JWTs sent in `Authorization: Bearer`. Refresh
 * tokens are opaque random strings in an httpOnly cookie — the API itself never
 * authenticates from a cookie, which is what makes it CSRF-resistant: a
 * cross-site form post carries the cookie but cannot set the header.
 *
 * Only the SHA-256 digest of a refresh token reaches the database, so a dump of
 * `auth_sessions` cannot be replayed as a login.
 */
export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL,
    issuer: "conversia",
    audience: "conversia-api",
    algorithm: "HS256",
  } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET, {
      issuer: "conversia",
      audience: "conversia-api",
      // Pinning the algorithm defeats the "alg: none" and HS/RS confusion
      // attacks that come from trusting the header's own claim.
      algorithms: ["HS256"],
    }) as AccessTokenPayload;
  } catch (error) {
    const expired = error instanceof jwt.TokenExpiredError;
    throw unauthorized(expired ? "Your session has expired. Sign in again." : "Invalid access token.");
  }
}

export function createRefreshToken(): { token: string; hash: string; expiresAt: Date } {
  const token = randomBytes(48).toString("base64url");
  return {
    token,
    hash: hashToken(token),
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
  };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function randomOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Constant-time comparison, for anything compared against a stored secret. */
export function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
