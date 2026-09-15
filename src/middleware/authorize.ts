import type { NextFunction, Request, Response } from "express";
import { forbidden, unauthorized } from "../core/errors";

/**
 * Authorization.
 *
 * The frontend hides buttons a role cannot use, but that is a convenience.
 * These middlewares are the actual boundary: every state-changing route names
 * the permission it needs, and a request without it is refused regardless of
 * what the UI allowed.
 */

/** The caller must hold this permission (implications already expanded). */
export function requirePermission(...permissions: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const auth = req.auth;
    if (!auth) return next(unauthorized());

    // A super admin has platform-wide authority — except while impersonating a
    // company, where they are held to that company's permission model so an
    // audit trail reads the same as any other actor's.
    if (auth.isSuperAdmin && !auth.impersonating) return next();

    const granted = permissions.every((permission) => auth.permissions.has(permission));
    if (!granted) {
      return next(forbidden(`This action requires the ${permissions.join(" and ")} permission.`));
    }
    next();
  };
}

/** The caller must hold at least one of these permissions. */
export function requireAnyPermission(...permissions: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const auth = req.auth;
    if (!auth) return next(unauthorized());
    if (auth.isSuperAdmin && !auth.impersonating) return next();
    if (permissions.some((permission) => auth.permissions.has(permission))) return next();
    next(forbidden(`This action requires one of: ${permissions.join(", ")}.`));
  };
}

/** Platform-owner-only routes: the super admin console. */
export function requireSuperAdmin(req: Request, _res: Response, next: NextFunction): void {
  const auth = req.auth;
  if (!auth) return next(unauthorized());
  if (!auth.isSuperAdmin) return next(forbidden("This area is restricted to platform administrators."));
  next();
}

/** Platform staff: super admins and support, for read-only platform surfaces. */
export function requirePlatformStaff(req: Request, _res: Response, next: NextFunction): void {
  const auth = req.auth;
  if (!auth) return next(unauthorized());
  if (auth.platformRole === "company_user") {
    return next(forbidden("This area is restricted to platform staff."));
  }
  next();
}
