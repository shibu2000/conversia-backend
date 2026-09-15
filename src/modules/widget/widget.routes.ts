import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../../db";
import { chatbotConfigs } from "../../db/schema";
import { eq } from "drizzle-orm";
import { forbidden, validationError } from "../../core/errors";
import { asyncHandler, sendData, sendNoContent } from "../../core/http";
import { widgetLimiter } from "../../middleware/rate-limit";
import { validateBody } from "../../middleware/validate";
import * as service from "./widget.service";

/**
 * Public widget endpoints.
 *
 * These are the only unauthenticated routes in the API. The embed key
 * identifies a tenant but is *not* a secret — it sits in the page source of the
 * customer's website — so every handler here is written on the assumption that
 * anyone can call it:
 *
 *   - reads are limited to published content (published config, published FAQ,
 *     active products flagged for recommendation);
 *   - writes create only customer-initiated records (a lead, a ticket) and can
 *     never read existing ones back;
 *   - the request's `Origin` is checked against the tenant's allowed domains;
 *   - a stricter rate limit applies than anywhere else.
 */
export const widgetRouter: Router = Router();

widgetRouter.use(widgetLimiter);

const embedKeySchema = z.string().regex(/^cv_pk_[a-f0-9]{24}$/, "Invalid embed key.");

/**
 * Verify the calling page is one the company allowed.
 *
 * A browser sets `Origin` on cross-origin requests and cannot be made to lie
 * about it, so this stops a copied embed key from working on someone else's
 * site. It is not a defence against a non-browser client — nothing served here
 * is confidential enough to need one.
 */
async function verifyOrigin(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const embedKey = embedKeySchema.parse(req.params.embedKey ?? req.query.key ?? req.body?.key);
    const origin = req.get("origin");

    const [config] = await db
      .select({ allowedDomains: chatbotConfigs.allowedDomains })
      .from(chatbotConfigs)
      .where(eq(chatbotConfigs.embedKey, embedKey))
      .limit(1);

    // No Origin header means a server-side or same-origin caller; CORS does not
    // apply to those and there is nothing to check against.
    if (config && origin && config.allowedDomains.length > 0) {
      const hostname = safeHostname(origin);
      const allowed = config.allowedDomains.some(
        (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
      );
      if (!allowed) {
        return next(forbidden("This widget is not authorised for this domain."));
      }
    }

    req.params.embedKey = embedKey;
    next();
  } catch (error) {
    next(error instanceof z.ZodError ? validationError("Invalid embed key.") : error);
  }
}

function safeHostname(origin: string): string {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return "";
  }
}

widgetRouter.use("/:embedKey", verifyOrigin);

widgetRouter.get(
  "/:embedKey/config",
  asyncHandler(async (req, res) => {
    sendData(res, await service.getPublicConfig(req.params.embedKey));
  }),
);

/** Read by the app's proxy to set `frame-ancestors` before the page renders. */
widgetRouter.get(
  "/:embedKey/embed-policy",
  asyncHandler(async (req, res) => {
    sendData(res, await service.getEmbedPolicy(req.params.embedKey));
  }),
);

widgetRouter.get(
  "/:embedKey/popular-questions",
  asyncHandler(async (req, res) => {
    const limit = Math.min(12, Math.max(1, Number.parseInt(String(req.query.limit ?? "4"), 10) || 4));
    sendData(res, await service.getPopularQuestions(req.params.embedKey, limit));
  }),
);

widgetRouter.get(
  "/:embedKey/topics",
  asyncHandler(async (req, res) => {
    sendData(res, await service.getTopics(req.params.embedKey));
  }),
);

widgetRouter.get(
  "/:embedKey/answers/:faqId",
  asyncHandler(async (req, res) => {
    sendData(res, await service.getAnswer(req.params.embedKey, req.params.faqId));
  }),
);

widgetRouter.post(
  "/:embedKey/answers/:faqId/rate",
  validateBody(z.object({ helpful: z.boolean() })),
  asyncHandler(async (req, res) => {
    await service.rateAnswer(req.params.embedKey, req.params.faqId, req.body.helpful);
    sendNoContent(res);
  }),
);

widgetRouter.get(
  "/:embedKey/products",
  asyncHandler(async (req, res) => {
    const term = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 200) : "";
    if (!term) {
      sendData(res, []);
      return;
    }
    sendData(res, await service.searchProducts(req.params.embedKey, term, 3));
  }),
);

widgetRouter.post(
  "/:embedKey/ask",
  validateBody(
    z.object({
      question: z.string().trim().min(1, "Ask a question.").max(1000),
      /** Continues an existing thread; omitted on the first question. */
      conversationId: z.string().max(64).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    sendData(res, await service.ask(req.params.embedKey, req.body.question, req.body.conversationId));
  }),
);

const leadSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(255),
  phone: z.string().trim().max(40).optional(),
  company: z.string().trim().max(160).optional(),
  interest: z.string().trim().min(1, "Tell us what you are looking for.").max(2000),
  quantity: z.string().trim().max(120).optional(),
  /**
   * Lead fields the workspace configured that have no column of their own.
   *
   * Capped because this is public, unauthenticated input: a widget form can
   * carry a handful of extra questions, not an essay.
   */
  qualificationAnswers: z
    .array(
      z.object({
        question: z.string().trim().min(1).max(200),
        answer: z.string().trim().min(1).max(1000),
      }),
    )
    .max(12)
    .optional(),
  conversationId: z.string().max(64).optional(),
});

widgetRouter.post(
  "/:embedKey/leads",
  validateBody(leadSchema),
  asyncHandler(async (req, res) => {
    sendData(res, await service.submitLead(req.params.embedKey, req.body), 201);
  }),
);

const ticketSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(255),
  orderReference: z.string().trim().max(64).optional(),
  subject: z.string().trim().min(1, "Enter a subject.").max(200),
  description: z.string().trim().min(1, "Describe the problem.").max(5000),
  conversationId: z.string().max(64).optional(),
});

widgetRouter.post(
  "/:embedKey/tickets",
  validateBody(ticketSchema),
  asyncHandler(async (req, res) => {
    sendData(res, await service.submitTicket(req.params.embedKey, req.body), 201);
  }),
);

/**
 * The pre-chat form: who is this visitor?
 *
 * Runs before the first question when the workspace has `requireEmailBeforeChat`
 * on, so the conversation is attributable from its very first line.
 */
widgetRouter.post(
  "/:embedKey/identify",
  validateBody(
    z
      .object({
        name: z.string().trim().min(1, "Enter your name.").max(120),
        email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(255).optional(),
        phone: z.string().trim().max(40).optional(),
        conversationId: z.string().max(64).optional(),
      })
      // One of the two, because a name alone gives the company no way to reply
      // once the visitor closes the tab.
      .refine((value) => Boolean(value.email || value.phone), {
        message: "Enter an email address or a phone number.",
        path: ["email"],
      }),
  ),
  asyncHandler(async (req, res) => {
    sendData(res, await service.identifyVisitor(req.params.embedKey, req.body), 201);
  }),
);

/**
 * The visitor's own transcript, polled while an agent is handling the thread.
 *
 * `since` returns only what is new, so a poll every few seconds costs almost
 * nothing. Internal notes are never included.
 */
widgetRouter.get(
  "/:embedKey/conversations/:conversationId/messages",
  asyncHandler(async (req, res) => {
    const since = typeof req.query.since === "string" ? req.query.since : undefined;
    sendData(res, await service.getTranscript(req.params.embedKey, req.params.conversationId, since));
  }),
);

/**
 * A visitor's message during a live chat.
 *
 * Deliberately separate from `/ask`: once a person owns the conversation the
 * assistant must not answer, and routing these through `/ask` would make that
 * a matter of remembering rather than a matter of which endpoint was called.
 */
widgetRouter.post(
  "/:embedKey/conversations/:conversationId/messages",
  validateBody(z.object({ body: z.string().trim().min(1, "Type a message.").max(4000) })),
  asyncHandler(async (req, res) => {
    sendData(
      res,
      await service.sendVisitorMessage(req.params.embedKey, req.params.conversationId, req.body.body),
      201,
    );
  }),
);

widgetRouter.post(
  "/:embedKey/handoff",
  validateBody(z.object({ conversationId: z.string().max(64).optional() })),
  asyncHandler(async (req, res) => {
    sendData(res, await service.requestHandoff(req.params.embedKey, req.body.conversationId));
  }),
);
