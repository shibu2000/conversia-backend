export type PlatformRole = "super_admin" | "platform_support" | "company_user";

/**
 * The authenticated principal.
 *
 * `companyId` here comes from the access token, never from a URL, body or
 * header. Handlers that need a tenant read `req.companyId`, which `companyScope`
 * derives from this — a request cannot widen its own tenancy.
 */
export interface AuthContext {
  userId: string;
  sessionId: string;
  email: string;
  name: string;
  companyId: string | null;
  platformRole: PlatformRole;
  isSuperAdmin: boolean;
  roleId: string | null;
  roleName: string;
  /** Already expanded: `leads.edit` implies `leads.view`. */
  permissions: Set<string>;
  /** Set while a super admin is working inside a company workspace. */
  impersonating?: { companyId: string; companyName: string };
}

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  cid: string | null;
  /** Company a super admin is currently impersonating. */
  imp?: string;
}
