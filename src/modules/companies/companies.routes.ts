import { z } from "zod";
import { Router } from "express";
import { asyncHandler } from "../../core/http";
import { requirePermission, requireSuperAdmin } from "../../middleware/authorize";
import { companyScope } from "../../middleware/company-scope";
import { validateBody } from "../../middleware/validate";
import * as controller from "./companies.controller";
import {
  createCompanySchema,
  setCompanyStatusSchema,
  updateCompanyPlatformSchema,
  updateCompanySchema,
  updateCompanySettingsSchema,
} from "./companies.schema";

/**
 * Platform-level company administration. Super admin only — this is the
 * cross-tenant surface, so it is deliberately not `companyScope`d.
 */
export const platformCompaniesRouter: Router = Router();

platformCompaniesRouter.use(requireSuperAdmin);
platformCompaniesRouter.get("/", asyncHandler(controller.list));
platformCompaniesRouter.get("/filter-options", asyncHandler(controller.filterOptions));
platformCompaniesRouter.post("/", validateBody(createCompanySchema), asyncHandler(controller.create));
platformCompaniesRouter.get("/:companyId", asyncHandler(controller.get));
platformCompaniesRouter.patch("/:companyId", validateBody(updateCompanyPlatformSchema), asyncHandler(controller.updateAsPlatform));
platformCompaniesRouter.post("/:companyId/status", validateBody(setCompanyStatusSchema), asyncHandler(controller.setStatus));

/**
 * The company's own profile and settings.
 *
 * Mounted under `/companies/:companyId`, but `companyScope` resolves the tenant
 * from the session and refuses a mismatch — the path parameter is a routing
 * convenience, never the authority.
 */
export const companyRouter: Router = Router({ mergeParams: true });

companyRouter.use(companyScope);
companyRouter.get("/", requirePermission("settings.view"), asyncHandler(controller.getOwn));
companyRouter.patch("/", requirePermission("settings.edit"), validateBody(updateCompanySchema), asyncHandler(controller.update));
companyRouter.get("/settings", requirePermission("settings.view"), asyncHandler(controller.getSettings));
/**
 * Sending a test is a write: it uses the workspace's credentials and puts a real
 * message on a real mail server, so it takes the same permission as changing
 * them rather than the read permission of viewing them.
 */
companyRouter.post(
  "/settings/email/test",
  requirePermission("settings.edit"),
  validateBody(z.object({ to: z.string().trim().email("Enter an address to send the test to.") })),
  asyncHandler(controller.testEmail),
);

companyRouter.patch(
  "/settings",
  requirePermission("settings.edit"),
  validateBody(updateCompanySettingsSchema),
  asyncHandler(controller.updateSettings),
);
