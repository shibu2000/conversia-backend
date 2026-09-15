import { Router } from "express";
import { asyncHandler } from "../../core/http";
import { requirePermission, requireSuperAdmin } from "../../middleware/authorize";
import { companyScope } from "../../middleware/company-scope";
import { validateBody } from "../../middleware/validate";
import * as controller from "./users.controller";
import {
  changeUserRoleSchema,
  createRoleSchema,
  createTeamSchema,
  inviteUserSchema,
  setUserStatusSchema,
  updateRolePermissionsSchema,
  updateRoleSchema,
  updateUserSchema,
} from "./users.schema";

/** Company users, roles and teams. Every route is tenant-scoped. */
export const usersRouter: Router = Router({ mergeParams: true });

usersRouter.use(companyScope);

usersRouter.get("/users", requirePermission("users.view"), asyncHandler(controller.list));
usersRouter.get("/users/assignable", requirePermission("users.view"), asyncHandler(controller.assignable));
usersRouter.post("/users", requirePermission("users.invite"), validateBody(inviteUserSchema), asyncHandler(controller.invite));
usersRouter.get("/users/:userId", requirePermission("users.view"), asyncHandler(controller.get));
usersRouter.patch("/users/:userId", requirePermission("users.edit"), validateBody(updateUserSchema), asyncHandler(controller.update));
usersRouter.post(
  "/users/:userId/role",
  requirePermission("users.edit"),
  validateBody(changeUserRoleSchema),
  asyncHandler(controller.changeRole),
);
usersRouter.post(
  "/users/:userId/status",
  requirePermission("users.disable"),
  validateBody(setUserStatusSchema),
  asyncHandler(controller.setStatus),
);
usersRouter.post("/users/:userId/resend-invite", requirePermission("users.invite"), asyncHandler(controller.resendInvite));
usersRouter.get("/users/:userId/activity", requirePermission("users.view"), asyncHandler(controller.activity));

usersRouter.get("/roles", requirePermission("roles.view"), asyncHandler(controller.listRoles));
usersRouter.post("/roles", requirePermission("roles.create"), validateBody(createRoleSchema), asyncHandler(controller.createRole));
usersRouter.patch("/roles/:roleId", requirePermission("roles.edit"), validateBody(updateRoleSchema), asyncHandler(controller.updateRole));
usersRouter.put(
  "/roles/:roleId/permissions",
  requirePermission("roles.edit"),
  validateBody(updateRolePermissionsSchema),
  asyncHandler(controller.updateRolePermissions),
);
usersRouter.delete("/roles/:roleId", requirePermission("roles.delete"), asyncHandler(controller.deleteRole));

usersRouter.get("/teams", requirePermission("users.view"), asyncHandler(controller.listTeams));
usersRouter.post("/teams", requirePermission("users.edit"), validateBody(createTeamSchema), asyncHandler(controller.createTeam));

/** The cross-tenant user directory in the super admin console. */
export const platformUsersRouter: Router = Router();
platformUsersRouter.use(requireSuperAdmin);
platformUsersRouter.get("/", asyncHandler(controller.listAll));
