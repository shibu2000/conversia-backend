import { z } from "zod";

export const inviteUserSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(255),
  roleId: z.string().min(1, "Choose a role.").max(64),
  title: z.string().trim().max(120).optional(),
});

/**
 * Self-service profile edits.
 *
 * `status` and `roleId` are deliberately absent: changing either is a
 * privilege operation with its own endpoint and its own permission, so they
 * cannot ride along inside a profile save.
 */
export const updateUserSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  title: z.string().trim().max(120).nullish(),
  phone: z.string().trim().max(40).nullish(),
  timezone: z.string().trim().max(64).optional(),
  avatarUrl: z.string().trim().url().max(500).nullish(),
  teamIds: z.array(z.string().max(64)).max(20).optional(),
});

export const changeUserRoleSchema = z.object({ roleId: z.string().min(1).max(64) });

export const setUserStatusSchema = z.object({ status: z.enum(["active", "invited", "disabled"]) });

export const createRoleSchema = z.object({
  name: z.string().trim().min(1, "Name the role.").max(80),
  description: z.string().trim().max(400).default(""),
  /** Copy permissions from an existing role as a starting point. */
  basedOn: z.string().max(64).optional(),
});

export const updateRoleSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(400).optional(),
});

export const updateRolePermissionsSchema = z.object({
  permissions: z.array(z.string().max(64)).max(200),
});

export const createTeamSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(400).default(""),
  memberIds: z.array(z.string().max(64)).max(500).default([]),
});

export type InviteUserInput = z.infer<typeof inviteUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
