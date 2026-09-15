import { Router } from "express";
import { asyncHandler } from "../../core/http";
import { requirePermission } from "../../middleware/authorize";
import { companyScope } from "../../middleware/company-scope";
import { validateBody } from "../../middleware/validate";
import * as controller from "./conversations.controller";
import { assignConversationSchema, sendMessageSchema, updateConversationSchema } from "./conversations.schema";

export const conversationsRouter: Router = Router({ mergeParams: true });

conversationsRouter.use(companyScope);

conversationsRouter.get("/", requirePermission("conversations.view"), asyncHandler(controller.list));
conversationsRouter.get("/view-counts", requirePermission("conversations.view"), asyncHandler(controller.viewCounts));
conversationsRouter.get("/:conversationId", requirePermission("conversations.view"), asyncHandler(controller.get));
conversationsRouter.get("/:conversationId/messages", requirePermission("conversations.view"), asyncHandler(controller.messages));
conversationsRouter.post(
  "/:conversationId/messages",
  requirePermission("conversations.edit"),
  validateBody(sendMessageSchema),
  asyncHandler(controller.sendMessage),
);
conversationsRouter.patch(
  "/:conversationId",
  requirePermission("conversations.edit"),
  validateBody(updateConversationSchema),
  asyncHandler(controller.update),
);
conversationsRouter.post(
  "/:conversationId/assign",
  requirePermission("conversations.assign"),
  validateBody(assignConversationSchema),
  asyncHandler(controller.assign),
);
// Taking over assigns the conversation to the agent, so it needs the same
// permission as any other assignment.
conversationsRouter.post(
  "/:conversationId/take-over",
  requirePermission("conversations.assign"),
  asyncHandler(controller.takeOver),
);
conversationsRouter.post(
  "/:conversationId/release",
  requirePermission("conversations.assign"),
  asyncHandler(controller.release),
);

conversationsRouter.delete("/:conversationId", requirePermission("conversations.delete"), asyncHandler(controller.remove));
