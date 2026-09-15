import { Router } from "express";
import { asyncHandler } from "../../core/http";
import { requirePermission } from "../../middleware/authorize";
import { companyScope } from "../../middleware/company-scope";
import { validateBody } from "../../middleware/validate";
import * as controller from "./chatbot.controller";
import { addDomainSchema, updateChatbotConfigSchema } from "./chatbot.schema";

export const chatbotRouter: Router = Router({ mergeParams: true });

chatbotRouter.use(companyScope);

chatbotRouter.get("/", requirePermission("chatbot.view"), asyncHandler(controller.get));
chatbotRouter.patch("/", requirePermission("chatbot.configure"), validateBody(updateChatbotConfigSchema), asyncHandler(controller.update));
// Publishing is its own permission: changing a draft and putting it in front of
// customers are different levels of trust.
chatbotRouter.post("/publish", requirePermission("chatbot.publish"), asyncHandler(controller.publish));
chatbotRouter.get("/versions", requirePermission("chatbot.view"), asyncHandler(controller.versions));
chatbotRouter.post("/domains", requirePermission("chatbot.configure"), validateBody(addDomainSchema), asyncHandler(controller.addDomain));
chatbotRouter.delete("/domains/:domain", requirePermission("chatbot.configure"), asyncHandler(controller.removeDomain));
chatbotRouter.post("/rotate-key", requirePermission("chatbot.publish"), asyncHandler(controller.rotateKey));
