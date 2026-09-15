import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { authTokenPurposeEnum, platformRoleEnum, roleSlugEnum, userStatusEnum } from "./enums";

/**
 * Roles are per-company. Permissions are stored as a text array of canonical
 * keys (`leads.assign`), validated against the server-side catalog before they
 * are written — a role can never grant a permission the catalog does not define.
 */
export const roles = pgTable(
  "roles",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id").references(() => companies.id, { onDelete: "cascade" }),
    slug: roleSlugEnum("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    /** System roles cannot be renamed or deleted. */
    isSystem: boolean("is_system").notNull().default(false),
    permissions: text("permissions").array().notNull().default(sql`'{}'::text[]`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("roles_company_idx").on(table.companyId),
    // One system role per slug per company; custom roles are unconstrained.
    uniqueIndex("roles_company_slug_idx").on(table.companyId, table.slug).where(sql`is_system`),
  ],
);

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id").references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    /** Null until an invitation is accepted or a password is set. */
    passwordHash: text("password_hash"),
    avatarUrl: text("avatar_url"),
    platformRole: platformRoleEnum("platform_role").notNull().default("company_user"),
    roleId: text("role_id").references(() => roles.id, { onDelete: "set null" }),
    status: userStatusEnum("status").notNull().default("invited"),
    title: text("title"),
    phone: text("phone"),
    timezone: text("timezone").notNull().default("UTC"),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
    /** Consecutive failed sign-ins, reset on success. Drives lockout. */
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    /** Set when repeated failures lock the account; cleared on a successful reset. */
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // An address is unique inside a workspace; platform staff are unique
    // globally. Two partial indexes express both rules without colliding.
    uniqueIndex("users_company_email_idx")
      .on(table.companyId, sql`lower(${table.email})`)
      .where(sql`company_id IS NOT NULL`),
    uniqueIndex("users_platform_email_idx")
      .on(sql`lower(${table.email})`)
      .where(sql`company_id IS NULL`),
    index("users_company_idx").on(table.companyId),
    index("users_role_idx").on(table.roleId),
    index("users_status_idx").on(table.companyId, table.status),
    index("users_name_trgm_idx").using("gin", sql`${table.name} gin_trgm_ops`),
    // Target for the composite foreign keys that keep assignment inside one
    // company. See `leads` and `tickets`.
    unique("users_id_company_key").on(table.id, table.companyId),
  ],
);

export const teams = pgTable(
  "teams",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("teams_company_idx").on(table.companyId),
    unique("teams_id_company_key").on(table.id, table.companyId),
  ],
);

export const teamMembers = pgTable(
  "team_members",
  {
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.teamId, table.userId] }), index("team_members_user_idx").on(table.userId)],
);

/**
 * Refresh-token sessions.
 *
 * Only the SHA-256 digest of the token is stored, so a database dump cannot be
 * replayed as a login. `rotatedTo` implements refresh-token rotation with reuse
 * detection: presenting a token that has already been rotated means the token
 * leaked, and the whole session family is revoked.
 */
export const authSessions = pgTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    /**
     * The sign-in this row descends from. A rotation inherits it, so one
     * browser's whole chain shares a family id.
     *
     * Revocation is family-scoped because that is the unit a person means: one
     * sign-out ends one device, and it must end it immediately — including the
     * access tokens minted for rows earlier in the chain, which have their own
     * expiry and would otherwise outlive the sign-out by up to a token lifetime.
     */
    familyId: text("family_id").notNull(),
    /** Session id this one was rotated into; set once the token is spent. */
    rotatedTo: text("rotated_to"),
    userAgent: text("user_agent"),
    ipAddress: text("ip_address"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("auth_sessions_user_idx").on(table.userId),
    index("auth_sessions_expiry_idx").on(table.expiresAt),
    index("auth_sessions_family_idx").on(table.familyId),
  ],
);

/** Single-use tokens for invitations and password resets. Digest only. */
export const authTokens = pgTable(
  "auth_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: authTokenPurposeEnum("purpose").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("auth_tokens_user_purpose_idx").on(table.userId, table.purpose)],
);

/**
 * Append-only activity trail.
 *
 * Powers the user activity feed and gives every assignment, status change and
 * publish an accountable actor. Nothing updates or deletes rows here.
 */
export const activityEvents = pgTable(
  "activity_events",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id").references(() => companies.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
    actorName: text("actor_name").notNull(),
    /** Dotted verb, e.g. `lead.assigned`. */
    action: text("action").notNull(),
    summary: text("summary").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("activity_company_at_idx").on(table.companyId, table.at.desc()),
    index("activity_actor_at_idx").on(table.actorId, table.at.desc()),
    index("activity_target_idx").on(table.targetType, table.targetId),
  ],
);

export const usersRelations = relations(users, ({ one, many }) => ({
  company: one(companies, { fields: [users.companyId], references: [companies.id] }),
  role: one(roles, { fields: [users.roleId], references: [roles.id] }),
  teamMemberships: many(teamMembers),
}));

export const rolesRelations = relations(roles, ({ one, many }) => ({
  company: one(companies, { fields: [roles.companyId], references: [companies.id] }),
  users: many(users),
}));

export const teamsRelations = relations(teams, ({ one, many }) => ({
  company: one(companies, { fields: [teams.companyId], references: [companies.id] }),
  members: many(teamMembers),
}));

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
  team: one(teams, { fields: [teamMembers.teamId], references: [teams.id] }),
  user: one(users, { fields: [teamMembers.userId], references: [users.id] }),
}));
