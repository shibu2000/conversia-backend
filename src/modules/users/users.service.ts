import { and, asc, count, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  activityEvents,
  companies,
  leads,
  roles,
  teamMembers,
  teams,
  tickets,
  users,
} from "../../db/schema";
import { conflict, forbidden, immutable, notFound, validationError } from "../../core/errors";
import { newId } from "../../core/ids";
import { likePattern, paginate, resolveOrderBy, type ListQuery, type Paginated } from "../../core/list-query";
import { correlatedCount } from "../../core/subquery";
import { ROLE_PRESETS, sanitisePermissions } from "../../core/permissions";
import { deliverAuthLink, issueAuthToken, revokeAllSessions } from "../auth/auth.service";
import type { AuthContext } from "../auth/auth.types";
import { toRole, toUser } from "./users.mapper";
import type { InviteUserInput, UpdateUserInput } from "./users.schema";

const SORT_COLUMNS = {
  name: users.name,
  email: users.email,
  role: roles.name,
  status: users.status,
  lastActive: users.lastActiveAt,
  createdAt: users.createdAt,
  leads: correlatedCount({ from: "leads", as: "l", on: "l.assigned_user_id = users.id" }),
  tickets: correlatedCount({ from: "tickets", as: "t", on: "t.assigned_user_id = users.id" }),
};

/** Assignment counters, as correlated subqueries against indexed columns. */
const assignedLeadCount = correlatedCount({ from: "leads", as: "l", on: "l.assigned_user_id = users.id" });
const assignedTicketCount = correlatedCount({ from: "tickets", as: "t", on: "t.assigned_user_id = users.id" });

/** The company user directory. Always scoped to the caller's own company. */
export async function listUsers(companyId: string, query: ListQuery): Promise<Paginated<ReturnType<typeof toUser>>> {
  const conditions = [eq(users.companyId, companyId)];

  if (query.search) {
    const pattern = likePattern(query.search);
    conditions.push(
      or(ilike(users.name, pattern), ilike(users.email, pattern), ilike(users.title, pattern), ilike(roles.name, pattern))!,
    );
  }
  if (query.filters.status) conditions.push(inArray(users.status, query.filters.status as never));
  if (query.filters.roleId) conditions.push(inArray(users.roleId, query.filters.roleId));
  if (query.filters.teamId) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM ${teamMembers} WHERE ${teamMembers.userId} = ${users.id} AND ${teamMembers.teamId} = ANY(${query.filters.teamId}))`,
    );
  }

  const where = and(...conditions);

  const [[total], rows] = await Promise.all([
    db.select({ value: count() }).from(users).leftJoin(roles, eq(roles.id, users.roleId)).where(where),
    db
      .select({
        id: users.id,
        companyId: users.companyId,
        name: users.name,
        email: users.email,
        avatarUrl: users.avatarUrl,
        platformRole: users.platformRole,
        roleId: users.roleId,
        roleName: roles.name,
        status: users.status,
        title: users.title,
        phone: users.phone,
        timezone: users.timezone,
        lastActiveAt: users.lastActiveAt,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
        assignedLeadCount,
        assignedTicketCount,
      })
      .from(users)
      .leftJoin(roles, eq(roles.id, users.roleId))
      .where(where)
      .orderBy(resolveOrderBy(query, SORT_COLUMNS, "name"))
      .limit(query.pageSize)
      .offset(query.offset),
  ]);

  const teamIds = await teamIdsFor(rows.map((row) => row.id));

  return paginate(
    rows.map((row) =>
      toUser(row, {
        assignedLeadCount: Number(row.assignedLeadCount),
        assignedTicketCount: Number(row.assignedTicketCount),
        teamIds: teamIds.get(row.id) ?? [],
      }),
    ),
    Number(total?.value ?? 0),
    query,
  );
}

/** Every user on the platform — the super-admin directory. */
export async function listAllUsers(query: ListQuery) {
  const conditions = [];

  if (query.search) {
    const pattern = likePattern(query.search);
    conditions.push(or(ilike(users.name, pattern), ilike(users.email, pattern), ilike(companies.name, pattern)));
  }
  if (query.filters.status) conditions.push(inArray(users.status, query.filters.status as never));
  if (query.filters.platformRole) conditions.push(inArray(users.platformRole, query.filters.platformRole as never));
  if (query.filters.companyId) {
    const wanted = query.filters.companyId;
    conditions.push(
      wanted.includes("platform")
        ? or(sql`${users.companyId} IS NULL`, inArray(users.companyId, wanted))
        : inArray(users.companyId, wanted),
    );
  }

  const where = conditions.length ? and(...conditions) : undefined;

  const [[total], rows] = await Promise.all([
    db.select({ value: count() }).from(users).leftJoin(companies, eq(companies.id, users.companyId)).where(where),
    db
      .select({
        id: users.id,
        companyId: users.companyId,
        name: users.name,
        email: users.email,
        avatarUrl: users.avatarUrl,
        platformRole: users.platformRole,
        roleId: users.roleId,
        roleName: roles.name,
        status: users.status,
        title: users.title,
        phone: users.phone,
        timezone: users.timezone,
        lastActiveAt: users.lastActiveAt,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
        companyName: companies.name,
        assignedLeadCount,
        assignedTicketCount,
      })
      .from(users)
      .leftJoin(roles, eq(roles.id, users.roleId))
      .leftJoin(companies, eq(companies.id, users.companyId))
      .where(where)
      .orderBy(query.sortDir === "asc" ? asc(users.name) : desc(users.name))
      .limit(query.pageSize)
      .offset(query.offset),
  ]);

  return paginate(
    rows.map((row) => ({
      ...toUser(row, {
        assignedLeadCount: Number(row.assignedLeadCount),
        assignedTicketCount: Number(row.assignedTicketCount),
      }),
      companyName: row.companyName ?? (row.companyId ? "—" : "Platform"),
    })),
    Number(total?.value ?? 0),
    query,
  );
}

export async function getUser(companyId: string, userId: string) {
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
      status: users.status,
      title: users.title,
      phone: users.phone,
      timezone: users.timezone,
      lastActiveAt: users.lastActiveAt,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      assignedLeadCount,
      assignedTicketCount,
    })
    .from(users)
    .leftJoin(roles, eq(roles.id, users.roleId))
    .where(and(eq(users.id, userId), eq(users.companyId, companyId)))
    .limit(1);

  if (!row) throw notFound("User", userId);

  const teamIds = await teamIdsFor([row.id]);
  return toUser(row, {
    assignedLeadCount: Number(row.assignedLeadCount),
    assignedTicketCount: Number(row.assignedTicketCount),
    teamIds: teamIds.get(row.id) ?? [],
  });
}

/**
 * Invite a user.
 *
 * Creates the account in `invited` with no password and issues a single-use
 * token. The role is checked against this company's roles, so an invitation
 * cannot borrow another tenant's role — which would be a privilege escalation
 * dressed up as a typo.
 */
export async function inviteUser(companyId: string, actor: AuthContext, input: InviteUserInput) {
  const [role] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.id, input.roleId), eq(roles.companyId, companyId)))
    .limit(1);

  if (!role) {
    throw validationError("That role does not exist in this workspace.", { roleId: "Choose a role from this workspace." });
  }

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.companyId, companyId), sql`lower(${users.email}) = ${input.email}`))
    .limit(1);

  if (existing) {
    throw conflict("That email address is already in this workspace.", {
      email: "Already invited or active in this workspace.",
    });
  }

  const userId = newId("usr");

  await db.transaction(async (tx) => {
    await tx.insert(users).values({
      id: userId,
      companyId,
      name: input.name,
      email: input.email,
      platformRole: "company_user",
      roleId: role.id,
      status: "invited",
      title: input.title,
      timezone: "UTC",
    });

    await tx.insert(activityEvents).values({
      id: newId("act"),
      companyId,
      actorId: actor.userId,
      actorName: actor.name,
      action: "user.invited",
      summary: `Invited ${input.name} (${input.email})`,
      targetType: "user",
      targetId: userId,
    });
  });

  const token = await issueAuthToken(userId, "invite", 7 * 24 * 60);
  deliverAuthLink("Invitation", input.email, token);

  return getUser(companyId, userId);
}

export async function updateUser(companyId: string, userId: string, patch: UpdateUserInput) {
  const { teamIds, ...fields } = patch;

  await db.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.companyId, companyId)))
      .limit(1);
    if (!target) throw notFound("User", userId);

    if (Object.keys(fields).length > 0) {
      await tx.update(users).set({ ...fields, updatedAt: new Date() }).where(eq(users.id, userId));
    }

    if (teamIds) {
      // Only teams in this company are accepted — the join table has no
      // company column of its own to constrain against.
      const valid = teamIds.length
        ? await tx
            .select({ id: teams.id })
            .from(teams)
            .where(and(eq(teams.companyId, companyId), inArray(teams.id, teamIds)))
        : [];

      await tx.delete(teamMembers).where(eq(teamMembers.userId, userId));
      if (valid.length > 0) {
        await tx.insert(teamMembers).values(valid.map((team) => ({ teamId: team.id, userId })));
      }
    }
  });

  return getUser(companyId, userId);
}

/**
 * Change a user's role.
 *
 * Refuses to remove the last administrator: a workspace with nobody who can
 * manage users or billing is unrecoverable without support intervention.
 */
export async function changeRole(companyId: string, actor: AuthContext, userId: string, roleId: string) {
  const [role] = await db
    .select({ id: roles.id, slug: roles.slug, name: roles.name })
    .from(roles)
    .where(and(eq(roles.id, roleId), eq(roles.companyId, companyId)))
    .limit(1);

  if (!role) throw validationError("That role does not exist in this workspace.", { roleId: "Choose a valid role." });

  await assertNotLastAdmin(companyId, userId, "change this person's role");

  await db
    .update(users)
    .set({ roleId: role.id, updatedAt: new Date() })
    .where(and(eq(users.id, userId), eq(users.companyId, companyId)));

  await db.insert(activityEvents).values({
    id: newId("act"),
    companyId,
    actorId: actor.userId,
    actorName: actor.name,
    action: "user.role_changed",
    summary: `Changed role to ${role.name}`,
    targetType: "user",
    targetId: userId,
  });

  return getUser(companyId, userId);
}

/**
 * Enable or disable a user.
 *
 * Disabling revokes every live session immediately, rather than waiting for
 * tokens to lapse — otherwise "disable this account" would not actually stop
 * the person using it for up to a token lifetime.
 */
export async function setStatus(companyId: string, actor: AuthContext, userId: string, status: "active" | "invited" | "disabled") {
  if (userId === actor.userId && status === "disabled") {
    throw validationError("You cannot disable your own account.");
  }
  if (status === "disabled") await assertNotLastAdmin(companyId, userId, "disable this person");

  const [updated] = await db
    .update(users)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(users.id, userId), eq(users.companyId, companyId)))
    .returning({ id: users.id });

  if (!updated) throw notFound("User", userId);

  if (status === "disabled") await revokeAllSessions(userId);

  await db.insert(activityEvents).values({
    id: newId("act"),
    companyId,
    actorId: actor.userId,
    actorName: actor.name,
    action: status === "disabled" ? "user.disabled" : "user.enabled",
    summary: status === "disabled" ? "Disabled access" : "Restored access",
    targetType: "user",
    targetId: userId,
  });

  return getUser(companyId, userId);
}

/** Re-send an invitation, replacing any outstanding token. */
export async function resendInvite(companyId: string, userId: string) {
  const [user] = await db
    .select({ id: users.id, email: users.email, status: users.status })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.companyId, companyId)))
    .limit(1);

  if (!user) throw notFound("User", userId);
  if (user.status !== "invited") throw validationError("That user has already accepted their invitation.");

  const token = await issueAuthToken(user.id, "invite", 7 * 24 * 60);
  deliverAuthLink("Invitation", user.email, token);
}

/** Recent activity for one user, assembled from the audit trail. */
export async function getUserActivity(companyId: string, userId: string, limit = 50) {
  const rows = await db
    .select()
    .from(activityEvents)
    .where(and(eq(activityEvents.companyId, companyId), eq(activityEvents.actorId, userId)))
    .orderBy(desc(activityEvents.at))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    actorId: row.actorId ?? userId,
    actorName: row.actorName,
    action: row.action,
    summary: row.summary,
    targetType: row.targetType ?? undefined,
    targetId: row.targetId ?? undefined,
    at: row.at.toISOString(),
  }));
}

/** Assignee options for the lead and ticket pickers: active users only. */
export async function listAssignableUsers(companyId: string) {
  const rows = await db
    .select({
      id: users.id,
      companyId: users.companyId,
      name: users.name,
      email: users.email,
      avatarUrl: users.avatarUrl,
      platformRole: users.platformRole,
      roleId: users.roleId,
      roleName: roles.name,
      status: users.status,
      title: users.title,
      phone: users.phone,
      timezone: users.timezone,
      lastActiveAt: users.lastActiveAt,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      assignedLeadCount,
      assignedTicketCount,
    })
    .from(users)
    .leftJoin(roles, eq(roles.id, users.roleId))
    .where(and(eq(users.companyId, companyId), eq(users.status, "active")))
    .orderBy(asc(users.name));

  const teamIds = await teamIdsFor(rows.map((row) => row.id));
  return rows.map((row) =>
    toUser(row, {
      assignedLeadCount: Number(row.assignedLeadCount),
      assignedTicketCount: Number(row.assignedTicketCount),
      teamIds: teamIds.get(row.id) ?? [],
    }),
  );
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export async function listRoles(companyId: string) {
  const rows = await db
    .select({
      role: roles,
      userCount: correlatedCount({ from: "users", as: "u", on: "u.role_id = roles.id" }),
    })
    .from(roles)
    .where(eq(roles.companyId, companyId))
    .orderBy(asc(roles.createdAt));

  return rows.map((row) => toRole(row.role, Number(row.userCount)));
}

export async function createRole(companyId: string, input: { name: string; description: string; basedOn?: string }) {
  let permissions: string[] = ROLE_PRESETS.viewer;

  if (input.basedOn) {
    const [base] = await db
      .select({ permissions: roles.permissions })
      .from(roles)
      .where(and(eq(roles.id, input.basedOn), eq(roles.companyId, companyId)))
      .limit(1);
    if (base) permissions = base.permissions;
  }

  const id = newId("role");
  await db.insert(roles).values({
    id,
    companyId,
    slug: "custom",
    name: input.name,
    description: input.description,
    isSystem: false,
    permissions: sanitisePermissions(permissions),
  });

  const [created] = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
  return toRole(created!, 0);
}

/**
 * Replace a role's permissions.
 *
 * Unknown keys are dropped rather than rejected, so a client built against a
 * newer catalog cannot write a permission this server does not understand —
 * and a stale client cannot silently strip one it has never heard of, because
 * it sends the full list it was shown.
 */
export async function updateRolePermissions(companyId: string, roleId: string, permissions: string[]) {
  const [role] = await db
    .select({ id: roles.id, isSystem: roles.isSystem, slug: roles.slug })
    .from(roles)
    .where(and(eq(roles.id, roleId), eq(roles.companyId, companyId)))
    .limit(1);

  if (!role) throw notFound("Role", roleId);
  if (role.slug === "company_admin") {
    throw immutable("The Company Admin role always holds every permission and cannot be narrowed.");
  }

  await db
    .update(roles)
    .set({ permissions: sanitisePermissions(permissions), updatedAt: new Date() })
    .where(eq(roles.id, roleId));

  const [updated] = await db
    .select({
      role: roles,
      userCount: correlatedCount({ from: "users", as: "u", on: "u.role_id = roles.id" }),
    })
    .from(roles)
    .where(eq(roles.id, roleId))
    .limit(1);

  return toRole(updated!.role, Number(updated!.userCount));
}

export async function updateRole(companyId: string, roleId: string, patch: { name?: string; description?: string }) {
  const [role] = await db
    .select({ isSystem: roles.isSystem })
    .from(roles)
    .where(and(eq(roles.id, roleId), eq(roles.companyId, companyId)))
    .limit(1);

  if (!role) throw notFound("Role", roleId);
  if (role.isSystem) throw immutable("System roles cannot be renamed.");

  await db.update(roles).set({ ...patch, updatedAt: new Date() }).where(eq(roles.id, roleId));

  const [updated] = await db
    .select({
      role: roles,
      userCount: correlatedCount({ from: "users", as: "u", on: "u.role_id = roles.id" }),
    })
    .from(roles)
    .where(eq(roles.id, roleId))
    .limit(1);

  return toRole(updated!.role, Number(updated!.userCount));
}

export async function deleteRole(companyId: string, roleId: string) {
  const [role] = await db
    .select({
      isSystem: roles.isSystem,
      userCount: correlatedCount({ from: "users", as: "u", on: "u.role_id = roles.id" }),
    })
    .from(roles)
    .where(and(eq(roles.id, roleId), eq(roles.companyId, companyId)))
    .limit(1);

  if (!role) throw notFound("Role", roleId);
  if (role.isSystem) throw immutable("System roles cannot be deleted.");
  if (Number(role.userCount) > 0) {
    throw validationError("Move the people in this role to another role before deleting it.");
  }

  await db.delete(roles).where(eq(roles.id, roleId));
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

export async function listTeams(companyId: string) {
  const rows = await db.select().from(teams).where(eq(teams.companyId, companyId)).orderBy(asc(teams.name));
  if (rows.length === 0) return [];

  const members = await db
    .select({ teamId: teamMembers.teamId, userId: teamMembers.userId })
    .from(teamMembers)
    .where(inArray(teamMembers.teamId, rows.map((row) => row.id)));

  const byTeam = new Map<string, string[]>();
  for (const member of members) {
    const list = byTeam.get(member.teamId) ?? [];
    list.push(member.userId);
    byTeam.set(member.teamId, list);
  }

  return rows.map((row) => ({
    id: row.id,
    companyId: row.companyId,
    name: row.name,
    description: row.description,
    memberIds: byTeam.get(row.id) ?? [],
  }));
}

export async function createTeam(companyId: string, input: { name: string; description: string; memberIds: string[] }) {
  const id = newId("team");

  await db.transaction(async (tx) => {
    await tx.insert(teams).values({ id, companyId, name: input.name, description: input.description });

    if (input.memberIds.length > 0) {
      const valid = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.companyId, companyId), inArray(users.id, input.memberIds)));
      if (valid.length > 0) {
        await tx.insert(teamMembers).values(valid.map((user) => ({ teamId: id, userId: user.id })));
      }
    }
  });

  const [team] = await listTeams(companyId).then((list) => list.filter((entry) => entry.id === id));
  return team;
}

// ---------------------------------------------------------------------------

async function teamIdsFor(userIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (userIds.length === 0) return map;

  const rows = await db
    .select({ userId: teamMembers.userId, teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(inArray(teamMembers.userId, userIds));

  for (const row of rows) {
    const list = map.get(row.userId) ?? [];
    list.push(row.teamId);
    map.set(row.userId, list);
  }
  return map;
}

/** Guard against locking a workspace out of its own administration. */
async function assertNotLastAdmin(companyId: string, userId: string, action: string): Promise<void> {
  const [target] = await db
    .select({ slug: roles.slug })
    .from(users)
    .leftJoin(roles, eq(roles.id, users.roleId))
    .where(and(eq(users.id, userId), eq(users.companyId, companyId)))
    .limit(1);

  if (!target) throw notFound("User", userId);
  if (target.slug !== "company_admin") return;

  const [remaining] = await db
    .select({ value: count() })
    .from(users)
    .leftJoin(roles, eq(roles.id, users.roleId))
    .where(
      and(
        eq(users.companyId, companyId),
        eq(roles.slug, "company_admin"),
        eq(users.status, "active"),
        ne(users.id, userId),
      ),
    );

  if (Number(remaining?.value ?? 0) === 0) {
    throw validationError(
      `This is the last active administrator — promote someone else before you ${action}.`,
    );
  }
}
