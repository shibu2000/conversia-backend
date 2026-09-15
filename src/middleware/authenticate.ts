import { and, eq } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { db } from "../db";
import { authSessions, companies, roles, users } from "../db/schema";
import { unauthorized } from "../core/errors";
import { expandPermissions } from "../core/permissions";
import type { AuthContext } from "../modules/auth/auth.types";
import { verifyAccessToken } from "../modules/auth/token.service";

/**
 * Resolve the caller from the access token.
 *
 * Permissions are read from the database on every request rather than baked
 * into the token. A JWT stays valid until it expires, so permissions carried
 * inside one would take a full token lifetime to revoke — meaning "remove this
 * person's access" would not actually remove it. The cost is one indexed join;
 * the benefit is that a revocation is immediate.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw unauthorized();

    const payload = verifyAccessToken(header.slice(7).trim());

    const [row] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        companyId: users.companyId,
        platformRole: users.platformRole,
        status: users.status,
        roleId: users.roleId,
        roleName: roles.name,
        permissions: roles.permissions,
        sessionRevokedAt: authSessions.revokedAt,
        sessionExpiresAt: authSessions.expiresAt,
      })
      .from(users)
      .leftJoin(roles, eq(roles.id, users.roleId))
      .leftJoin(authSessions, eq(authSessions.id, payload.sid))
      .where(eq(users.id, payload.sub))
      .limit(1);

    if (!row) throw unauthorized("Your account no longer exists.");
    if (row.status === "disabled") throw unauthorized("This account has been disabled.");
    if (row.status === "invited") throw unauthorized("Accept your invitation before signing in.");

    /**
     * A revoked or expired refresh session invalidates its access tokens too,
     * so signing out takes effect at once rather than whenever the last access
     * token happens to lapse. Revocation is family-wide, which is what makes
     * that immediate for a chain that has rotated several times.
     *
     * Rotation itself is deliberately not a failure here. It only says the
     * refresh token was exchanged, which happens routinely and says nothing
     * about the access token in hand — that one carries its own short expiry.
     * Rejecting it meant a browser that refreshed twice in the same moment,
     * which is what a page load plus its prefetches does, threw away a token it
     * had just been issued and reported the session as ended.
     */
    const sessionValid =
      row.sessionExpiresAt !== null && row.sessionExpiresAt > new Date() && row.sessionRevokedAt === null;
    if (!sessionValid) throw unauthorized("Your session has ended. Sign in again.");

    const isSuperAdmin = row.platformRole === "super_admin";

    const auth: AuthContext = {
      userId: row.id,
      sessionId: payload.sid,
      email: row.email,
      name: row.name,
      companyId: row.companyId,
      platformRole: row.platformRole,
      isSuperAdmin,
      roleId: row.roleId,
      roleName: row.roleName ?? (isSuperAdmin ? "Super Admin" : "Platform Support"),
      permissions: expandPermissions(row.permissions ?? []),
    };

    // A super admin working inside a company workspace carries that tenant in
    // the token, not in the URL — so impersonation is explicit, auditable, and
    // cannot be assumed by editing a request.
    //
    // Inside a workspace they take on that company's administrator permissions
    // rather than their platform-wide authority. They hold no role of their own
    // in the tenant, so without this they would have no permissions at all; and
    // borrowing the workspace's own role means every action they take is
    // expressible in that workspace's permission model and reads the same in
    // its audit trail as any other administrator's.
    if (isSuperAdmin && payload.imp) {
      const [company] = await db
        .select({ id: companies.id, name: companies.name })
        .from(companies)
        .where(eq(companies.id, payload.imp))
        .limit(1);

      if (company) {
        auth.impersonating = { companyId: company.id, companyName: company.name };
        auth.companyId = company.id;

        const [adminRole] = await db
          .select({ permissions: roles.permissions })
          .from(roles)
          .where(and(eq(roles.companyId, company.id), eq(roles.slug, "company_admin")))
          .limit(1);

        auth.permissions = expandPermissions(adminRole?.permissions ?? []);
        auth.roleName = "Company Admin (platform access)";
      }
    }

    req.auth = auth;
    next();
  } catch (error) {
    next(error);
  }
}

/** Attach the principal when a token is present, but never reject. */
export function optionalAuthenticate(req: Request, res: Response, next: NextFunction): void {
  if (!req.headers.authorization) {
    next();
    return;
  }
  void authenticate(req, res, () => next());
}
