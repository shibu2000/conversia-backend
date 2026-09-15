import type { NextFunction, Request, Response } from "express";
import { forbidden, unauthorized } from "../core/errors";

/**
 * Resolve the tenant for this request.
 *
 * The frontend's service layer calls endpoints shaped like
 * `/companies/:companyId/leads`, so a company id does appear in the URL. It is
 * never the authority. This middleware sets `req.companyId` from the
 * authenticated session, and if the URL names a *different* company the request
 * is refused rather than silently redirected — a mismatch means either a stale
 * tab or an attempt to reach another tenant, and both deserve a hard error.
 *
 * A super admin may address any company, but only by impersonating it (which is
 * carried in their token and recorded), or on the platform-wide routes that are
 * explicitly not tenant-scoped.
 *
 * Every query in every service filters on `req.companyId`. Nothing reads a
 * company id out of a request body.
 */
export function companyScope(req: Request, _res: Response, next: NextFunction): void {
  const auth = req.auth;
  if (!auth) return next(unauthorized());

  const requested = req.params.companyId;
  const sessionCompanyId = auth.companyId;

  if (auth.isSuperAdmin) {
    // Impersonating pins the super admin to one workspace; otherwise they may
    // address whichever company the route names.
    const resolved = auth.impersonating?.companyId ?? requested ?? sessionCompanyId;
    if (!resolved) {
      return next(forbidden("Select a company workspace before using this endpoint."));
    }
    if (auth.impersonating && requested && requested !== auth.impersonating.companyId) {
      return next(forbidden("You are currently working inside a different company workspace."));
    }
    req.companyId = resolved;
    return next();
  }

  if (!sessionCompanyId) {
    return next(forbidden("This account is not attached to a company workspace."));
  }

  if (requested && requested !== sessionCompanyId) {
    // Deliberately the same message whether the company exists or not: telling
    // the caller "that company exists but is not yours" is a disclosure.
    return next(forbidden("You do not have access to that workspace."));
  }

  req.companyId = sessionCompanyId;
  next();
}

/**
 * Read the resolved tenant. Throws rather than returning undefined, so a
 * service can never accidentally run an unscoped query because a route forgot
 * to mount `companyScope`.
 */
export function companyIdOf(req: Request): string {
  const companyId = req.companyId;
  if (!companyId) {
    throw forbidden("This request is not scoped to a company workspace.");
  }
  return companyId;
}

/** The authenticated principal, or a 401. */
export function authOf(req: Request) {
  const auth = req.auth;
  if (!auth) throw unauthorized();
  return auth;
}
