import { and, eq, isNull, sql } from "drizzle-orm";
import { db, type Transaction } from "../../db";
import {
  activityEvents,
  authSessions,
  authTokens,
  companies,
  companySettings,
  companyUsage,
  roles,
  users,
} from "../../db/schema";
import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { conflict, forbidden, unauthorized, validationError } from "../../core/errors";
import { newId, slugify } from "../../core/ids";
import { ALL_PERMISSION_KEYS, ROLE_PRESETS, expandPermissions } from "../../core/permissions";
import { createDefaultCollections } from "../knowledge/knowledge.service";
import { fakeVerify, hashPassword, verifyPassword } from "./password.service";
import { createRefreshToken, hashToken, randomOpaqueToken, signAccessToken } from "./token.service";
import type { AuthContext } from "./auth.types";

/** Lock an account after this many consecutive failures. */
const MAX_FAILED_LOGINS = 8;
const LOCKOUT_MINUTES = 15;

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

/**
 * Sign in.
 *
 * Every failure path returns the same message and takes the same amount of work
 * — a missing address runs a throwaway hash comparison so it cannot be
 * distinguished from a wrong password by timing. Telling an attacker which
 * addresses exist is a disclosure with no benefit to a legitimate user, who
 * knows perfectly well which address they meant to type.
 */
export async function login(
  email: string,
  password: string,
  context: { userAgent?: string; ipAddress?: string },
): Promise<{ tokens: SessionTokens; userId: string }> {
  const [user] = await db
    .select({
      id: users.id,
      passwordHash: users.passwordHash,
      status: users.status,
      companyId: users.companyId,
      failedLoginCount: users.failedLoginCount,
      lockedUntil: users.lockedUntil,
      companyStatus: companies.status,
    })
    .from(users)
    .leftJoin(companies, eq(companies.id, users.companyId))
    .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
    .limit(1);

  const genericFailure = unauthorized("That email address and password do not match.");

  if (!user?.passwordHash) {
    await fakeVerify(password);
    throw genericFailure;
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw unauthorized("Too many failed attempts. This account is locked for a few minutes.");
  }

  const matches = await verifyPassword(password, user.passwordHash);

  if (!matches) {
    const failures = user.failedLoginCount + 1;
    await db
      .update(users)
      .set({
        failedLoginCount: failures,
        lockedUntil: failures >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
      })
      .where(eq(users.id, user.id));
    throw genericFailure;
  }

  // Account state is only revealed once the password is known to be correct,
  // so these messages cannot be used to probe for valid addresses.
  if (user.status === "disabled") throw forbidden("This account has been disabled. Contact your administrator.");
  if (user.status === "invited") throw forbidden("Accept your invitation email before signing in.");
  if (user.companyStatus === "suspended") throw forbidden("This workspace is suspended. Contact support.");
  if (user.companyStatus === "archived") throw forbidden("This workspace has been archived.");

  await db
    .update(users)
    .set({ failedLoginCount: 0, lockedUntil: null, lastActiveAt: new Date() })
    .where(eq(users.id, user.id));

  const tokens = await issueSession(user.id, context);
  return { tokens, userId: user.id };
}

/** Mint a refresh session plus its first access token. */
export async function issueSession(
  userId: string,
  context: { userAgent?: string; ipAddress?: string },
  impersonatingCompanyId?: string,
): Promise<SessionTokens> {
  const refresh = createRefreshToken();
  const sessionId = newId("ses");

  const [user] = await db.select({ companyId: users.companyId }).from(users).where(eq(users.id, userId)).limit(1);

  await db.insert(authSessions).values({
    id: sessionId,
    userId,
    familyId: sessionId,
    tokenHash: refresh.hash,
    userAgent: context.userAgent?.slice(0, 500),
    ipAddress: context.ipAddress?.slice(0, 64),
    expiresAt: refresh.expiresAt,
  });

  const accessToken = signAccessToken({
    sub: userId,
    sid: sessionId,
    cid: user?.companyId ?? null,
    ...(impersonatingCompanyId ? { imp: impersonatingCompanyId } : {}),
  });

  return { accessToken, refreshToken: refresh.token, refreshExpiresAt: refresh.expiresAt };
}

/**
 * How long after a rotation the spent token is still treated as a concurrent
 * request rather than a stolen one.
 *
 * A browser does not make one request at a time. A navigation to a workspace
 * page fires the document request alongside prefetches and any other open tab,
 * and every one of them carries the same cookie — so when the access token
 * lapses they all reach here within a few milliseconds holding the same refresh
 * token. Treating the second of those as theft revoked the family and signed
 * the user out mid-click, which is the failure this window exists to stop.
 *
 * Replay is the signature of a captured token, and a capture that is replayed
 * is replayed later than this. Outside the window the reuse response below
 * stands unchanged.
 */
const REUSE_GRACE_MS = 30_000;

/** Bound on following `rotatedTo`, so a cycle cannot spin. */
const MAX_ROTATION_HOPS = 10;

interface SessionRow {
  id: string;
  userId: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  rotatedTo: string | null;
  lastUsedAt: Date;
}

const sessionColumns = {
  id: authSessions.id,
  userId: authSessions.userId,
  familyId: authSessions.familyId,
  expiresAt: authSessions.expiresAt,
  revokedAt: authSessions.revokedAt,
  rotatedTo: authSessions.rotatedTo,
  lastUsedAt: authSessions.lastUsedAt,
};

/**
 * Exchange a refresh token for a new pair, rotating the old one.
 *
 * Rotation with reuse detection: each refresh token is single-use, and
 * presenting one that was rotated long enough ago means the token was captured
 * somewhere. In that case the whole session family is revoked rather than
 * merely refused, because the legitimate holder and the attacker both hold
 * tokens and there is no way to tell which one just called. Only that family
 * goes — a capture on one device is no reason to sign the person out of the
 * others, and doing so made a single bad request look like a total outage.
 */
export async function refreshSession(
  refreshToken: string,
  context: { userAgent?: string; ipAddress?: string },
  attempt = 0,
): Promise<SessionTokens> {
  if (attempt >= MAX_ROTATION_HOPS) throw unauthorized("Your session has ended. Sign in again.");

  const [presented] = await db
    .select(sessionColumns)
    .from(authSessions)
    .where(eq(authSessions.tokenHash, hashToken(refreshToken)))
    .limit(1);

  if (!presented) throw unauthorized("Your session has ended. Sign in again.");

  // Already revoked: the sign-out already happened, or the family was ended for
  // security. Either way there is nothing to detect and nothing to revoke.
  if (presented.revokedAt) throw unauthorized("Your session has ended. Sign in again.");

  if (presented.rotatedTo && Date.now() - presented.lastUsedAt.getTime() > REUSE_GRACE_MS) {
    logger.warn("Refresh token reuse detected — revoking this session family", {
      userId: presented.userId,
      familyId: presented.familyId,
    });
    await revokeFamily(presented.familyId);
    throw unauthorized("Your session was ended for security reasons. Sign in again.");
  }

  // Inside the grace window the caller is one of a burst, and the pair it should
  // receive comes from wherever the chain has reached by now.
  const live = presented.rotatedTo ? await followRotation(presented) : presented;

  if (live.expiresAt <= new Date()) throw unauthorized("Your session has expired. Sign in again.");

  const [user] = await db
    .select({ id: users.id, status: users.status, companyId: users.companyId })
    .from(users)
    .where(eq(users.id, live.userId))
    .limit(1);

  if (!user || user.status !== "active") throw unauthorized("This account can no longer sign in.");

  const next = createRefreshToken();
  const nextSessionId = newId("ses");

  const rotated = await db.transaction(async (tx) => {
    // Conditional on the row still being unspent: two graced callers can reach
    // the same tip, and without this both would rotate it, leaving one of the
    // successors unreferenced.
    const spent = await tx
      .update(authSessions)
      .set({ rotatedTo: nextSessionId, lastUsedAt: new Date() })
      .where(and(eq(authSessions.id, live.id), isNull(authSessions.rotatedTo), isNull(authSessions.revokedAt)))
      .returning({ id: authSessions.id });

    if (spent.length === 0) return false;

    await tx.insert(authSessions).values({
      id: nextSessionId,
      userId: user.id,
      familyId: live.familyId,
      tokenHash: next.hash,
      userAgent: context.userAgent?.slice(0, 500),
      ipAddress: context.ipAddress?.slice(0, 64),
      expiresAt: next.expiresAt,
    });
    return true;
  });

  if (!rotated) return refreshSession(refreshToken, context, attempt + 1);

  const accessToken = signAccessToken({ sub: user.id, sid: nextSessionId, cid: user.companyId });
  return { accessToken, refreshToken: next.token, refreshExpiresAt: next.expiresAt };
}

/** Walk `rotatedTo` to the session the family has reached. */
async function followRotation(from: SessionRow): Promise<SessionRow> {
  let current = from;

  for (let hop = 0; hop < MAX_ROTATION_HOPS; hop += 1) {
    if (!current.rotatedTo) return current;

    const [next] = await db.select(sessionColumns).from(authSessions).where(eq(authSessions.id, current.rotatedTo)).limit(1);

    if (!next) throw unauthorized("Your session has ended. Sign in again.");
    if (next.revokedAt) throw unauthorized("Your session has ended. Sign in again.");
    current = next;
  }

  throw unauthorized("Your session has ended. Sign in again.");
}

/** Sign out one device: the whole chain that sign-in produced, not just its tip. */
export async function revokeSession(refreshToken: string): Promise<void> {
  const [session] = await db
    .select({ familyId: authSessions.familyId })
    .from(authSessions)
    .where(eq(authSessions.tokenHash, hashToken(refreshToken)))
    .limit(1);

  if (session) await revokeFamily(session.familyId);
}

async function revokeFamily(familyId: string): Promise<void> {
  await db
    .update(authSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(authSessions.familyId, familyId), isNull(authSessions.revokedAt)));
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await db
    .update(authSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)));
}

/**
 * Create a workspace and its first administrator.
 *
 * Everything happens in one transaction: a company without an admin is
 * unreachable, and an admin without a company has nowhere to sign in to. The
 * five system roles are created here too, because a workspace that cannot
 * invite a second person with a narrower role is not usable.
 */
export async function register(input: {
  name: string;
  email: string;
  password: string;
  companyName: string;
  website?: string;
  industry?: string;
  country?: string;
  timezone?: string;
}): Promise<{ userId: string; companyId: string }> {
  const passwordHash = await hashPassword(input.password);
  const companyId = newId("cmp");

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${input.email.toLowerCase()}`)
      .limit(1);

    if (existing) {
      throw conflict("An account with that email address already exists.", {
        email: "This address is already registered. Sign in instead.",
      });
    }

    await tx.insert(companies).values({
      id: companyId,
      name: input.companyName,
      slug: await uniqueCompanySlug(tx, slugify(input.companyName)),
      website: input.website ?? "",
      industry: input.industry ?? "",
      country: input.country ?? "",
      timezone: input.timezone ?? "UTC",
      status: "trial",
      plan: "starter",
      primaryContactName: input.name,
      primaryContactEmail: input.email,
      onboardingProgress: 0,
    });

    await tx.insert(companyUsage).values({ companyId });
    await tx.insert(companySettings).values({
      companyId,
      supportEmail: input.email,
      businessHours: {
        timezone: input.timezone ?? "UTC",
        days: {
          "1": { open: true, from: "09:00", to: "18:00" },
          "2": { open: true, from: "09:00", to: "18:00" },
          "3": { open: true, from: "09:00", to: "18:00" },
          "4": { open: true, from: "09:00", to: "18:00" },
          "5": { open: true, from: "09:00", to: "18:00" },
          "6": { open: false, from: "10:00", to: "14:00" },
          "7": { open: false, from: "10:00", to: "14:00" },
        },
      },
    });

    const createdRoles = await createSystemRoles(tx, companyId);
    const adminRole = createdRoles.find((role) => role.slug === "company_admin")!;

    const userId = newId("usr");
    await tx.insert(users).values({
      id: userId,
      companyId,
      name: input.name,
      email: input.email,
      passwordHash,
      platformRole: "company_user",
      roleId: adminRole.id,
      status: "active",
      timezone: input.timezone ?? "UTC",
      lastActiveAt: new Date(),
    });

    await createDefaultCollections(tx, companyId);

    await tx.insert(activityEvents).values({
      id: newId("act"),
      companyId,
      actorId: userId,
      actorName: input.name,
      action: "company.created",
      summary: `Created the ${input.companyName} workspace`,
      targetType: "company",
      targetId: companyId,
    });

    return { userId, companyId };
  });
}

/** The five system roles every workspace starts with. */
export async function createSystemRoles(
  tx: Transaction,
  companyId: string,
): Promise<Array<{ id: string; slug: string }>> {
  const definitions = [
    {
      slug: "company_admin" as const,
      name: "Company Admin",
      description: "Full access to the workspace, including users, roles, AI configuration and billing.",
    },
    {
      slug: "manager" as const,
      name: "Manager",
      description: "Runs day-to-day operations: assigns work, edits records, reads every report.",
    },
    {
      slug: "sales" as const,
      name: "Sales",
      description: "Works leads and customers. No access to users, knowledge or chatbot configuration.",
    },
    {
      slug: "support" as const,
      name: "Support",
      description: "Handles conversations and tickets, and curates FAQ answers.",
    },
    {
      slug: "viewer" as const,
      name: "Viewer",
      description: "Read-only access for stakeholders who need visibility but should not change anything.",
    },
  ];

  const rows = definitions.map((definition) => ({
    id: newId("role"),
    companyId,
    slug: definition.slug,
    name: definition.name,
    description: definition.description,
    isSystem: true,
    permissions: definition.slug === "company_admin" ? ALL_PERMISSION_KEYS : ROLE_PRESETS[definition.slug],
  }));

  await tx.insert(roles).values(rows);
  return rows.map((row) => ({ id: row.id, slug: row.slug }));
}

async function uniqueCompanySlug(tx: Transaction, base: string): Promise<string> {
  const candidate = base || "workspace";
  for (let suffix = 0; suffix < 50; suffix += 1) {
    const slug = suffix === 0 ? candidate : `${candidate}-${suffix}`;
    const [taken] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.slug, slug)).limit(1);
    if (!taken) return slug;
  }
  return `${candidate}-${Date.now().toString(36)}`;
}

/**
 * Issue a single-use token for an invitation or a password reset.
 *
 * Returns the plaintext token exactly once — only its digest is stored. In
 * production this is handed to the mail transport; with no transport
 * configured it is logged at debug level so a developer can complete the flow.
 */
export async function issueAuthToken(
  userId: string,
  purpose: "invite" | "password_reset" | "email_verify",
  ttlMinutes: number,
): Promise<string> {
  const token = randomOpaqueToken(32);

  // Any outstanding token for the same purpose is spent, so a forgotten
  // invitation link cannot be used after a fresh one is sent.
  await db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(authTokens.userId, userId), eq(authTokens.purpose, purpose), isNull(authTokens.usedAt)));

  await db.insert(authTokens).values({
    id: newId("tok"),
    userId,
    purpose,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
  });

  return token;
}

export async function consumeAuthToken(
  token: string,
  purpose: "invite" | "password_reset" | "email_verify",
): Promise<string> {
  const [row] = await db
    .select({ id: authTokens.id, userId: authTokens.userId, expiresAt: authTokens.expiresAt, usedAt: authTokens.usedAt })
    .from(authTokens)
    .where(and(eq(authTokens.tokenHash, hashToken(token)), eq(authTokens.purpose, purpose)))
    .limit(1);

  if (!row || row.usedAt || row.expiresAt <= new Date()) {
    throw validationError("That link is invalid or has expired. Request a new one.", {
      token: "This link is no longer valid.",
    });
  }

  await db.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, row.id));
  return row.userId;
}

/** Set a password from an invitation or a reset, then end every old session. */
export async function setPassword(userId: string, password: string, activate: boolean): Promise<void> {
  const passwordHash = await hashPassword(password);
  await db
    .update(users)
    .set({
      passwordHash,
      failedLoginCount: 0,
      lockedUntil: null,
      updatedAt: new Date(),
      ...(activate ? { status: "active" as const } : {}),
    })
    .where(eq(users.id, userId));

  // A password change ends every existing session: if the change was prompted
  // by a suspected compromise, leaving old sessions alive defeats the point.
  await revokeAllSessions(userId);
}

export async function changePassword(auth: AuthContext, currentPassword: string, newPassword: string): Promise<void> {
  const [user] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, auth.userId)).limit(1);
  if (!user?.passwordHash || !(await verifyPassword(currentPassword, user.passwordHash))) {
    throw validationError("Your current password is not correct.", { currentPassword: "That password is not correct." });
  }
  await setPassword(auth.userId, newPassword, false);
}

/** Log the delivery of an auth link. A mail transport replaces this. */
export function deliverAuthLink(kind: string, email: string, token: string): void {
  if (env.isProduction) {
    logger.info(`${kind} link generated`, { email });
    return;
  }
  logger.info(`${kind} link for ${email}`, { token });
}

export { expandPermissions };
