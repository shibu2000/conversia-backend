import { eq, sql } from "drizzle-orm";
import type { Request, Response } from "express";
import { env } from "../../config/env";
import { db } from "../../db";
import { companies, users } from "../../db/schema";
import { forbidden, notFound, unauthorized } from "../../core/errors";
import { sendData, sendNoContent } from "../../core/http";
import { authOf } from "../../middleware/company-scope";
import { signAccessToken } from "./token.service";
import * as authService from "./auth.service";
import { buildSession } from "./session.service";
import type { AcceptInviteInput, LoginInput, RegisterInput, ResetPasswordInput } from "./auth.schema";

/**
 * The refresh cookie.
 *
 * httpOnly so script cannot read it, `sameSite: strict` so it is not sent on
 * cross-site navigation, `secure` in production, and scoped by path to the
 * refresh and logout endpoints — the only two routes that need it. The API
 * itself authenticates from the Authorization header, never from this cookie,
 * which is what keeps the whole surface CSRF-resistant.
 */
function setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(env.AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: "strict",
    domain: env.COOKIE_DOMAIN,
    path: `${env.API_PREFIX}/auth`,
    expires: expiresAt,
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(env.AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: "strict",
    domain: env.COOKIE_DOMAIN,
    path: `${env.API_PREFIX}/auth`,
  });
}

function requestContext(req: Request) {
  return { userAgent: req.get("user-agent") ?? undefined, ipAddress: req.ip };
}

export async function login(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body as LoginInput;
  const { tokens, userId } = await authService.login(email, password, requestContext(req));

  setRefreshCookie(res, tokens.refreshToken, tokens.refreshExpiresAt);

  const auth = await loadAuthContext(userId);
  sendData(res, { accessToken: tokens.accessToken, session: await buildSession(auth) });
}

export async function register(req: Request, res: Response): Promise<void> {
  const input = req.body as RegisterInput;
  const { userId } = await authService.register({ ...input, website: input.website || undefined });
  const tokens = await authService.issueSession(userId, requestContext(req));

  setRefreshCookie(res, tokens.refreshToken, tokens.refreshExpiresAt);

  const auth = await loadAuthContext(userId);
  sendData(res, { accessToken: tokens.accessToken, session: await buildSession(auth) }, 201);
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const token = req.cookies?.[env.AUTH_COOKIE_NAME];
  if (typeof token !== "string" || !token) throw unauthorized("No session to refresh.");

  const tokens = await authService.refreshSession(token, requestContext(req));
  setRefreshCookie(res, tokens.refreshToken, tokens.refreshExpiresAt);
  sendData(res, { accessToken: tokens.accessToken });
}

export async function logout(req: Request, res: Response): Promise<void> {
  const token = req.cookies?.[env.AUTH_COOKIE_NAME];
  if (typeof token === "string" && token) await authService.revokeSession(token);
  clearRefreshCookie(res);
  sendNoContent(res);
}

export async function logoutEverywhere(req: Request, res: Response): Promise<void> {
  await authService.revokeAllSessions(authOf(req).userId);
  clearRefreshCookie(res);
  sendNoContent(res);
}

export async function me(req: Request, res: Response): Promise<void> {
  sendData(res, await buildSession(authOf(req)));
}

/**
 * Start a password reset.
 *
 * Always returns 204, whether or not the address exists. A different response
 * for a real address would turn this into an account-existence oracle, and the
 * person who typed the address learns nothing useful from the difference.
 */
export async function forgotPassword(req: Request, res: Response): Promise<void> {
  const { email } = req.body as { email: string };

  const [user] = await db
    .select({ id: users.id, status: users.status })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);

  if (user && user.status === "active") {
    const token = await authService.issueAuthToken(user.id, "password_reset", 60);
    authService.deliverAuthLink("Password reset", email, token);
  }

  sendNoContent(res);
}

export async function resetPassword(req: Request, res: Response): Promise<void> {
  const { token, password } = req.body as ResetPasswordInput;
  const userId = await authService.consumeAuthToken(token, "password_reset");
  await authService.setPassword(userId, password, false);
  sendNoContent(res);
}

/** Accept an invitation: set a password and activate the account. */
export async function acceptInvite(req: Request, res: Response): Promise<void> {
  const { token, password, name } = req.body as AcceptInviteInput;
  const userId = await authService.consumeAuthToken(token, "invite");

  if (name) await db.update(users).set({ name, updatedAt: new Date() }).where(eq(users.id, userId));
  await authService.setPassword(userId, password, true);

  const tokens = await authService.issueSession(userId, requestContext(req));
  setRefreshCookie(res, tokens.refreshToken, tokens.refreshExpiresAt);

  const auth = await loadAuthContext(userId);
  sendData(res, { accessToken: tokens.accessToken, session: await buildSession(auth) });
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };
  await authService.changePassword(authOf(req), currentPassword, newPassword);
  clearRefreshCookie(res);
  sendNoContent(res);
}

/**
 * Enter a company workspace as a super admin.
 *
 * Issues a *new* access token carrying the impersonated tenant, rather than
 * letting the client name a company per request. The impersonation is therefore
 * a deliberate, recorded act with its own token, and every subsequent request
 * is scoped by it.
 */
export async function impersonate(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  if (!auth.isSuperAdmin) throw forbidden("Only platform administrators can enter a company workspace.");

  const { companyId } = req.body as { companyId: string };
  const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company) throw notFound("Company", companyId);

  const accessToken = signAccessToken({ sub: auth.userId, sid: auth.sessionId, cid: auth.companyId, imp: company.id });
  sendData(res, { accessToken });
}

export async function stopImpersonating(req: Request, res: Response): Promise<void> {
  const auth = authOf(req);
  const accessToken = signAccessToken({ sub: auth.userId, sid: auth.sessionId, cid: auth.companyId });
  sendData(res, { accessToken });
}

/** Rebuild the principal after a sign-in, so `/me` can be returned in one call. */
async function loadAuthContext(userId: string) {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      companyId: users.companyId,
      platformRole: users.platformRole,
      roleId: users.roleId,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) throw notFound("User", userId);

  return {
    userId: row.id,
    sessionId: "",
    email: row.email,
    name: row.name,
    companyId: row.companyId,
    platformRole: row.platformRole,
    isSuperAdmin: row.platformRole === "super_admin",
    roleId: row.roleId,
    roleName: "",
    permissions: new Set<string>(),
  };
}
