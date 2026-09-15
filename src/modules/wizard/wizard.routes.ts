import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../core/http";
import { sendData } from "../../core/http";
import { requirePermission } from "../../middleware/authorize";
import { companyIdOf, companyScope } from "../../middleware/company-scope";
import { validateBody } from "../../middleware/validate";
import * as service from "./wizard.service";

const stepKeySchema = z.enum([
  "company",
  "users",
  "chatbot",
  "faq",
  "knowledge",
  "products",
  "leads",
  "tickets",
  "ai",
  "test",
  "install",
  "complete",
]);

const setStepSchema = z.object({
  key: stepKeySchema,
  status: z.enum(["not_started", "in_progress", "complete", "skipped"]).optional(),
});

const analyzeSchema = z.object({ url: z.string().trim().url("Enter a full URL, including https://").max(500) });

const reviewSuggestionSchema = z.object({
  decision: z.enum(["accepted", "rejected", "edited"]),
  editedBody: z.string().max(10_000).optional(),
});

export const wizardRouter: Router = Router({ mergeParams: true });

wizardRouter.use(companyScope);

wizardRouter.get(
  "/",
  requirePermission("settings.view"),
  asyncHandler(async (req, res) => {
    sendData(res, await service.getState(companyIdOf(req)));
  }),
);

wizardRouter.patch(
  "/",
  requirePermission("settings.edit"),
  validateBody(setStepSchema),
  asyncHandler(async (req, res) => {
    sendData(res, await service.setStep(companyIdOf(req), req.body.key, req.body.status));
  }),
);

wizardRouter.post(
  "/steps/:key/complete",
  requirePermission("settings.edit"),
  asyncHandler(async (req, res) => {
    sendData(res, await service.completeStep(companyIdOf(req), stepKeySchema.parse(req.params.key)));
  }),
);

wizardRouter.post(
  "/steps/:key/skip",
  requirePermission("settings.edit"),
  asyncHandler(async (req, res) => {
    sendData(res, await service.skipStep(companyIdOf(req), stepKeySchema.parse(req.params.key)));
  }),
);

wizardRouter.get(
  "/website-analysis",
  requirePermission("settings.view"),
  asyncHandler(async (req, res) => {
    sendData(res, await service.getLatestAnalysis(companyIdOf(req)));
  }),
);

/**
 * Reviewing a suggestion is a human decision on a stored row, so it is fully
 * implemented — accepting an FAQ proposal creates a real draft FAQ. Only the
 * *producing* of suggestions needs the AI layer.
 */
wizardRouter.post(
  "/suggestions/:suggestionId",
  requirePermission("settings.edit"),
  validateBody(reviewSuggestionSchema),
  asyncHandler(async (req, res) => {
    sendData(
      res,
      await service.reviewSuggestion(
        companyIdOf(req),
        req.params.suggestionId,
        req.body.decision,
        req.body.editedBody,
      ),
    );
  }),
);

wizardRouter.post(
  "/suggestions/review-all",
  requirePermission("settings.edit"),
  validateBody(z.object({ decision: z.enum(["accepted", "rejected"]) })),
  asyncHandler(async (req, res) => {
    sendData(res, await service.reviewAllSuggestions(companyIdOf(req), req.body.decision));
  }),
);

// Returns 501 until the AI layer is installed — see `src/ai/ai-gateway.ts`.
wizardRouter.post(
  "/analyze-website",
  requirePermission("settings.edit"),
  validateBody(analyzeSchema),
  asyncHandler(async (req, res) => {
    sendData(res, await service.analyzeWebsite(companyIdOf(req), req.body.url));
  }),
);
