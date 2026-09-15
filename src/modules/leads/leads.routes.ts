import { Router } from "express";
import { asyncHandler } from "../../core/http";
import { requirePermission } from "../../middleware/authorize";
import { companyScope } from "../../middleware/company-scope";
import { validateBody } from "../../middleware/validate";
import * as controller from "./leads.controller";
import { addLeadNoteSchema, assignLeadSchema, createLeadSchema, setLeadStatusSchema, updateLeadSchema } from "./leads.schema";

export const leadsRouter: Router = Router({ mergeParams: true });

leadsRouter.use(companyScope);

leadsRouter.get("/", requirePermission("leads.view"), asyncHandler(controller.list));
leadsRouter.get("/summary", requirePermission("leads.view"), asyncHandler(controller.summary));
leadsRouter.post("/", requirePermission("leads.create"), validateBody(createLeadSchema), asyncHandler(controller.create));
leadsRouter.get("/:leadId", requirePermission("leads.view"), asyncHandler(controller.get));
leadsRouter.patch("/:leadId", requirePermission("leads.edit"), validateBody(updateLeadSchema), asyncHandler(controller.update));
leadsRouter.post(
  "/:leadId/status",
  requirePermission("leads.edit"),
  validateBody(setLeadStatusSchema),
  asyncHandler(controller.setStatus),
);
// Assignment has its own permission: a salesperson may edit their own leads
// without being able to move work onto someone else's desk.
leadsRouter.post("/:leadId/assign", requirePermission("leads.assign"), validateBody(assignLeadSchema), asyncHandler(controller.assign));
leadsRouter.post("/:leadId/notes", requirePermission("leads.edit"), validateBody(addLeadNoteSchema), asyncHandler(controller.addNote));
leadsRouter.delete("/:leadId", requirePermission("leads.delete"), asyncHandler(controller.remove));
