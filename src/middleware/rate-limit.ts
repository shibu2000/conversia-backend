import rateLimit from "express-rate-limit";
import type { Request } from "express";
import { env } from "../config/env";

/**
 * Rate limiting.
 *
 * Two tiers. The general limiter is generous — it exists to blunt runaway
 * clients and scrapers, not to get in a working user's way. The auth limiter is
 * strict and keyed on the *email being tried* as well as the source address, so
 * distributed guessing against one account is throttled even when each attempt
 * comes from a different IP.
 */
const shared = {
  standardHeaders: "draft-7" as const,
  legacyHeaders: false,
  message: {
    error: { status: 429, code: "rate_limited", message: "Too many requests. Wait a moment and try again." },
  },
};

export const generalLimiter = rateLimit({
  ...shared,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
});

export const authLimiter = rateLimit({
  ...shared,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.AUTH_RATE_LIMIT_MAX,
  // Keyed on the address being tried as well as the source. IPv6 is truncated
  // to its /64 prefix, because a single host is routinely handed a whole /64
  // and could otherwise cycle addresses within it to reset the counter.
  keyGenerator: (req: Request) => {
    const email = typeof req.body?.email === "string" ? req.body.email.toLowerCase().slice(0, 200) : "";
    return `${normaliseIp(req.ip ?? "")}:${email}`;
  },
  message: {
    error: {
      status: 429,
      code: "rate_limited",
      message: "Too many sign-in attempts. Wait a minute before trying again.",
    },
  },
});

/** Public widget endpoints: unauthenticated, so limited per source address. */
export const widgetLimiter = rateLimit({
  ...shared,
  windowMs: 60_000,
  limit: 120,
});

/** Collapse an IPv6 address to its /64 prefix; leave IPv4 untouched. */
function normaliseIp(ip: string): string {
  const address = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (!address.includes(":")) return address;
  return address.split(":").slice(0, 4).join(":");
}
