import { Router } from "express";
import { asyncHandler } from "../../core/http";
import { requirePermission } from "../../middleware/authorize";
import { companyScope } from "../../middleware/company-scope";
import { validateBody } from "../../middleware/validate";
import * as controller from "./faqs.controller";
import {
  createFAQCategorySchema,
  createFAQSchema,
  createFAQSetSchema,
  moveFAQNodeSchema,
  updateFAQCategorySchema,
  updateFAQSchema,
  updateFAQSetSchema,
} from "./faqs.schema";

/**
 * FAQ: curated, human-authored answers.
 *
 * A separate module from Knowledge Base on purpose — these are answers an
 * administrator wrote and published, served verbatim, not passages retrieved
 * from an ingested document.
 */
export const faqsRouter: Router = Router({ mergeParams: true });

faqsRouter.use(companyScope);

faqsRouter.get("/sets", requirePermission("faq.view"), asyncHandler(controller.listSets));
faqsRouter.post("/sets", requirePermission("faq.create"), validateBody(createFAQSetSchema), asyncHandler(controller.createSet));
faqsRouter.get("/sets/:setId", requirePermission("faq.view"), asyncHandler(controller.getSet));
faqsRouter.patch("/sets/:setId", requirePermission("faq.edit"), validateBody(updateFAQSetSchema), asyncHandler(controller.updateSet));
faqsRouter.delete("/sets/:setId", requirePermission("faq.delete"), asyncHandler(controller.deleteSet));
faqsRouter.get("/sets/:setId/tree", requirePermission("faq.view"), asyncHandler(controller.getTree));
faqsRouter.get("/sets/:setId/questions", requirePermission("faq.view"), asyncHandler(controller.listQuestions));

faqsRouter.post("/categories", requirePermission("faq.create"), validateBody(createFAQCategorySchema), asyncHandler(controller.createCategory));
faqsRouter.patch(
  "/categories/:categoryId",
  requirePermission("faq.edit"),
  validateBody(updateFAQCategorySchema),
  asyncHandler(controller.updateCategory),
);
faqsRouter.delete("/categories/:categoryId", requirePermission("faq.delete"), asyncHandler(controller.deleteCategory));

faqsRouter.post("/questions", requirePermission("faq.create"), validateBody(createFAQSchema), asyncHandler(controller.createQuestion));
faqsRouter.get("/questions/:faqId", requirePermission("faq.view"), asyncHandler(controller.getQuestion));
faqsRouter.patch("/questions/:faqId", requirePermission("faq.edit"), validateBody(updateFAQSchema), asyncHandler(controller.updateQuestion));
faqsRouter.delete("/questions/:faqId", requirePermission("faq.delete"), asyncHandler(controller.deleteQuestion));

faqsRouter.post("/move", requirePermission("faq.edit"), validateBody(moveFAQNodeSchema), asyncHandler(controller.move));
