import { Router } from "express";
import { z } from "zod";
import { asyncHandler, sendData } from "../../core/http";
import { aiLayerNotImplemented } from "../../core/errors";
import { requirePermission } from "../../middleware/authorize";
import { companyIdOf, companyScope } from "../../middleware/company-scope";
import { getCompanyDashboard } from "../dashboard/dashboard.service";
import * as service from "./analytics.service";

const rangeSchema = z.enum(["7d", "30d", "90d", "12m"]).catch("30d");

/** Dashboard and analytics. Read-only, and gated on `analytics.view`. */
export const analyticsRouter: Router = Router({ mergeParams: true });

analyticsRouter.use(companyScope);

analyticsRouter.get(
  "/dashboard",
  requirePermission("analytics.view"),
  asyncHandler(async (req, res) => {
    sendData(res, await getCompanyDashboard(companyIdOf(req)));
  }),
);

analyticsRouter.get(
  "/conversations",
  requirePermission("analytics.view"),
  asyncHandler(async (req, res) => {
    sendData(res, await service.getConversationAnalytics(companyIdOf(req), rangeSchema.parse(req.query.range)));
  }),
);

analyticsRouter.get(
  "/business",
  requirePermission("analytics.view"),
  asyncHandler(async (req, res) => {
    sendData(res, await service.getBusinessAnalytics(companyIdOf(req), rangeSchema.parse(req.query.range)));
  }),
);

analyticsRouter.get(
  "/knowledge",
  requirePermission("analytics.view"),
  asyncHandler(async (req, res) => {
    sendData(res, await service.getKnowledgeAnalytics(companyIdOf(req)));
  }),
);

/**
 * AI analytics — resolution rates, confidence, tool calls, failed questions.
 *
 * Every figure on this panel is a measurement of the AI layer. With no such
 * layer there is nothing to measure, so this returns 501 rather than a screen
 * of zeroes that would read as "the assistant answered nothing" instead of
 * "there is no assistant yet".
 */
analyticsRouter.get(
  "/ai",
  requirePermission("analytics.view"),
  asyncHandler(async () => {
    throw aiLayerNotImplemented("AI analytics");
  }),
);
