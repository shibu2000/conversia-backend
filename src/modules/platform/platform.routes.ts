import { desc, eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db";
import { aiProviders, platformHealthChecks } from "../../db/schema";
import { notFound } from "../../core/errors";
import { asyncHandler, sendData } from "../../core/http";
import { iso, isoRequired } from "../../core/serialize";
import { requirePlatformStaff, requireSuperAdmin } from "../../middleware/authorize";
import { validateBody } from "../../middleware/validate";
import { getPlatformAnalytics } from "../analytics/analytics.service";

/**
 * Platform surfaces for the super admin console.
 *
 * The AI provider registry is configuration only — no credentials are stored
 * here and nothing in this codebase calls any of these endpoints. It exists so
 * the AI layer has a place to read its routing from when it is built.
 */
export const platformRouter: Router = Router();

platformRouter.use(requirePlatformStaff);

platformRouter.get(
  "/analytics",
  asyncHandler(async (_req, res) => {
    sendData(res, await getPlatformAnalytics());
  }),
);

platformRouter.get(
  "/health",
  asyncHandler(async (_req, res) => {
    const rows = await db.select().from(platformHealthChecks).orderBy(platformHealthChecks.name);
    sendData(
      res,
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        latencyMs: row.latencyMs,
        uptimePct: Number(row.uptimePct),
        lastCheckedAt: isoRequired(row.lastCheckedAt),
        detail: row.detail,
      })),
    );
  }),
);

platformRouter.get(
  "/ai-providers",
  asyncHandler(async (_req, res) => {
    const rows = await db.select().from(aiProviders).orderBy(desc(aiProviders.isDefault), aiProviders.name);
    sendData(
      res,
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        vendor: row.vendor,
        status: row.status,
        models: row.models,
        isDefault: row.isDefault,
        region: row.region,
        monthlyRequests: Number(row.monthlyRequests),
        monthlySpendUsd: Number(row.monthlySpendUsd),
        lastErrorAt: iso(row.lastErrorAt),
        lastErrorMessage: row.lastErrorMessage,
      })),
    );
  }),
);

const updateProviderSchema = z.object({
  status: z.enum(["connected", "disconnected", "error", "rate_limited"]).optional(),
  isDefault: z.boolean().optional(),
  region: z.string().trim().max(64).optional(),
});

platformRouter.patch(
  "/ai-providers/:providerId",
  requireSuperAdmin,
  validateBody(updateProviderSchema),
  asyncHandler(async (req, res) => {
    const { providerId } = req.params;

    await db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: aiProviders.id }).from(aiProviders).where(eq(aiProviders.id, providerId)).limit(1);
      if (!existing) throw notFound("AI provider", providerId);

      // Exactly one default: clearing the others in the same transaction keeps
      // routing unambiguous at every instant.
      if (req.body.isDefault === true) {
        await tx.update(aiProviders).set({ isDefault: false }).where(eq(aiProviders.isDefault, true));
      }

      await tx.update(aiProviders).set({ ...req.body, updatedAt: new Date() }).where(eq(aiProviders.id, providerId));
    });

    const [row] = await db.select().from(aiProviders).where(eq(aiProviders.id, providerId)).limit(1);
    sendData(res, {
      id: row!.id,
      name: row!.name,
      vendor: row!.vendor,
      status: row!.status,
      models: row!.models,
      isDefault: row!.isDefault,
      region: row!.region,
      monthlyRequests: Number(row!.monthlyRequests),
      monthlySpendUsd: Number(row!.monthlySpendUsd),
      lastErrorAt: iso(row!.lastErrorAt),
      lastErrorMessage: row!.lastErrorMessage,
    });
  }),
);
