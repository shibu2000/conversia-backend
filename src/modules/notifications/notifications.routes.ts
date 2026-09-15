import { and, count, desc, eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../../db";
import { notifications } from "../../db/schema";
import { notFound } from "../../core/errors";
import { asyncHandler, sendData, sendNoContent } from "../../core/http";
import { isoRequired } from "../../core/serialize";
import { authOf } from "../../middleware/company-scope";

/**
 * Notifications belong to a *user*, not a company.
 *
 * Every query filters on the authenticated user id, so there is no route here
 * that can read someone else's notifications — including a colleague in the
 * same workspace.
 */
export const notificationsRouter: Router = Router();

const categorySchema = z
  .enum(["assignment", "conversation", "ticket", "lead", "knowledge", "chatbot", "system", "billing", "all"])
  .optional();

notificationsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const auth = authOf(req);
    const category = categorySchema.catch(undefined).parse(req.query.category);
    const unreadOnly = req.query.unreadOnly === "true";
    const limit = Math.min(200, Math.max(1, Number.parseInt(String(req.query.limit ?? "100"), 10) || 100));

    const conditions = [eq(notifications.userId, auth.userId)];
    if (category && category !== "all") conditions.push(eq(notifications.category, category));
    if (unreadOnly) conditions.push(eq(notifications.read, false));

    const rows = await db
      .select()
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.at))
      .limit(limit);

    sendData(
      res,
      rows.map((row) => ({
        id: row.id,
        companyId: row.companyId,
        userId: row.userId,
        category: row.category,
        severity: row.severity,
        title: row.title,
        body: row.body,
        read: row.read,
        at: isoRequired(row.at),
        href: row.href ?? undefined,
        actorName: row.actorName ?? undefined,
      })),
    );
  }),
);

notificationsRouter.get(
  "/unread-count",
  asyncHandler(async (req, res) => {
    const auth = authOf(req);
    const [row] = await db
      .select({ value: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, auth.userId), eq(notifications.read, false)));

    sendData(res, { count: Number(row?.value ?? 0) });
  }),
);

notificationsRouter.post(
  "/:notificationId/read",
  asyncHandler(async (req, res) => {
    const auth = authOf(req);
    const read = req.body?.read !== false;

    const [updated] = await db
      .update(notifications)
      .set({ read })
      // The user predicate is what stops one person marking another's
      // notification read by guessing an id.
      .where(and(eq(notifications.id, req.params.notificationId), eq(notifications.userId, auth.userId)))
      .returning();

    if (!updated) throw notFound("Notification", req.params.notificationId);

    sendData(res, {
      id: updated.id,
      companyId: updated.companyId,
      userId: updated.userId,
      category: updated.category,
      severity: updated.severity,
      title: updated.title,
      body: updated.body,
      read: updated.read,
      at: isoRequired(updated.at),
      href: updated.href ?? undefined,
      actorName: updated.actorName ?? undefined,
    });
  }),
);

notificationsRouter.post(
  "/read-all",
  asyncHandler(async (req, res) => {
    const auth = authOf(req);
    await db
      .update(notifications)
      .set({ read: true })
      .where(and(eq(notifications.userId, auth.userId), eq(notifications.read, false)));
    sendNoContent(res);
  }),
);
