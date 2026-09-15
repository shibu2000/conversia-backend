import { eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { companies, leads, roles, teamMembers, tickets, users } from "../../db/schema";
import { notFound } from "../../core/errors";
import { expandPermissions } from "../../core/permissions";
import { ALL_PERMISSION_KEYS } from "../../core/permissions";
import type { AuthContext } from "./auth.types";

/**
 * The `Session` object the whole UI renders against.
 *
 * Mirrors the frontend's `Session` type exactly: the user, the company, the
 * expanded permission list and the impersonation marker. Assembled in one query
 * set because the app shell blocks on it — every extra round trip here is a
 * delay before the first paint.
 */
export interface SessionPayload {
  user: {
    id: string;
    companyId: string | null;
    name: string;
    email: string;
    avatarUrl?: string;
    platformRole: string;
    roleId: string | null;
    roleName: string;
    status: string;
    title?: string;
    phone?: string;
    timezone: string;
    lastActiveAt: string | null;
    assignedLeadCount: number;
    assignedTicketCount: number;
    teamIds: string[];
    createdAt: string;
    updatedAt: string;
  };
  companyId: string | null;
  companyName: string | null;
  permissions: string[];
  isSuperAdmin: boolean;
  impersonating?: { companyId: string; companyName: string };
}

export async function buildSession(auth: AuthContext): Promise<SessionPayload> {
  const [row] = await db
    .select({
      id: users.id,
      companyId: users.companyId,
      name: users.name,
      email: users.email,
      avatarUrl: users.avatarUrl,
      platformRole: users.platformRole,
      roleId: users.roleId,
      roleName: roles.name,
      permissions: roles.permissions,
      status: users.status,
      title: users.title,
      phone: users.phone,
      timezone: users.timezone,
      lastActiveAt: users.lastActiveAt,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      companyName: companies.name,
    })
    .from(users)
    .leftJoin(roles, eq(roles.id, users.roleId))
    .leftJoin(companies, eq(companies.id, users.companyId))
    .where(eq(users.id, auth.userId))
    .limit(1);

  if (!row) throw notFound("User", auth.userId);

  const [counts] = await db
    .select({
      leadCount: sql<number>`(SELECT count(*) FROM ${leads} WHERE ${leads.assignedUserId} = ${auth.userId})`,
      ticketCount: sql<number>`(SELECT count(*) FROM ${tickets} WHERE ${tickets.assignedUserId} = ${auth.userId})`,
    })
    .from(sql`(SELECT 1) AS one`);

  const memberships = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(eq(teamMembers.userId, auth.userId));

  const isSuperAdmin = row.platformRole === "super_admin";

  // A super admin outside a workspace holds every permission. Inside one they
  // hold that workspace's administrator permissions, which `authenticate` has
  // already resolved onto the principal — so the UI hides exactly what the API
  // would refuse.
  const permissions = isSuperAdmin
    ? auth.impersonating
      ? Array.from(auth.permissions)
      : ALL_PERMISSION_KEYS
    : Array.from(expandPermissions(row.permissions ?? []));

  return {
    user: {
      id: row.id,
      companyId: row.companyId,
      name: row.name,
      email: row.email,
      avatarUrl: row.avatarUrl ?? undefined,
      platformRole: row.platformRole,
      roleId: row.roleId,
      roleName: row.roleName ?? (isSuperAdmin ? "Super Admin" : "Platform Support"),
      status: row.status,
      title: row.title ?? undefined,
      phone: row.phone ?? undefined,
      timezone: row.timezone,
      lastActiveAt: row.lastActiveAt?.toISOString() ?? null,
      assignedLeadCount: Number(counts?.leadCount ?? 0),
      assignedTicketCount: Number(counts?.ticketCount ?? 0),
      teamIds: memberships.map((entry) => entry.teamId),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    },
    companyId: auth.impersonating?.companyId ?? row.companyId,
    companyName: auth.impersonating?.companyName ?? row.companyName ?? null,
    permissions,
    isSuperAdmin,
    ...(auth.impersonating ? { impersonating: auth.impersonating } : {}),
  };
}
