import { Router } from "express";
import { asyncHandler } from "../../core/http";
import { requireAnyPermission, requirePermission } from "../../middleware/authorize";
import { companyScope } from "../../middleware/company-scope";
import { validateBody } from "../../middleware/validate";
import * as controller from "./tickets.controller";
import {
  addTicketReplySchema,
  assignTicketSchema,
  createTicketSchema,
  setTicketStatusSchema,
  updateTicketSchema,
} from "./tickets.schema";

export const ticketsRouter: Router = Router({ mergeParams: true });

ticketsRouter.use(companyScope);

ticketsRouter.get("/", requirePermission("tickets.view"), asyncHandler(controller.list));
ticketsRouter.get("/summary", requirePermission("tickets.view"), asyncHandler(controller.summary));
ticketsRouter.post("/", requirePermission("tickets.create"), validateBody(createTicketSchema), asyncHandler(controller.create));
ticketsRouter.get("/:ticketId", requirePermission("tickets.view"), asyncHandler(controller.get));
ticketsRouter.patch("/:ticketId", requirePermission("tickets.edit"), validateBody(updateTicketSchema), asyncHandler(controller.update));
// Resolving is its own permission, so a role can reply to tickets without being
// able to declare them finished.
ticketsRouter.post(
  "/:ticketId/status",
  requireAnyPermission("tickets.edit", "tickets.resolve"),
  validateBody(setTicketStatusSchema),
  asyncHandler(controller.setStatus),
);
ticketsRouter.post(
  "/:ticketId/assign",
  requirePermission("tickets.assign"),
  validateBody(assignTicketSchema),
  asyncHandler(controller.assign),
);
ticketsRouter.post(
  "/:ticketId/replies",
  requirePermission("tickets.edit"),
  validateBody(addTicketReplySchema),
  asyncHandler(controller.addReply),
);
ticketsRouter.delete("/:ticketId", requirePermission("tickets.delete"), asyncHandler(controller.remove));
