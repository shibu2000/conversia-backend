import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { teams, users } from "../../db/schema";
import { validationError } from "../../core/errors";

/**
 * Assignment guards.
 *
 * Leads, tickets and conversations may only be assigned to a user in the same
 * company. The database enforces that with a composite foreign key onto
 * `(id, company_id)`, which makes a cross-tenant assignment unrepresentable.
 * These checks run first so the caller gets a field-level message instead of a
 * constraint violation — the constraint is the guarantee, this is the manners.
 */
export async function assertAssignableUser(companyId: string, userId: string): Promise<{ id: string; name: string; roleName: string | null }> {
  const [user] = await db
    .select({ id: users.id, name: users.name, status: users.status, roleId: users.roleId })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.companyId, companyId)))
    .limit(1);

  if (!user) {
    throw validationError("That person is not part of this workspace.", {
      assignedUserId: "Choose someone from your workspace.",
    });
  }
  if (user.status !== "active") {
    throw validationError("That person's account is not active.", {
      assignedUserId: "Only active users can be assigned work.",
    });
  }

  return { id: user.id, name: user.name, roleName: null };
}

export async function assertAssignableTeam(companyId: string, teamId: string): Promise<{ id: string; name: string }> {
  const [team] = await db
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.companyId, companyId)))
    .limit(1);

  if (!team) {
    throw validationError("That team is not part of this workspace.", { teamId: "Choose a team from your workspace." });
  }
  return team;
}
