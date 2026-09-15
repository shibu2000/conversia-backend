import { Router } from "express";
import { authenticate } from "./middleware/authenticate";
import { authRouter } from "./modules/auth/auth.routes";
import { analyticsRouter } from "./modules/analytics/analytics.routes";
import { chatbotRouter } from "./modules/chatbot/chatbot.routes";
import { companyRouter, platformCompaniesRouter } from "./modules/companies/companies.routes";
import { conversationsRouter } from "./modules/conversations/conversations.routes";
import { customersRouter } from "./modules/customers/customers.routes";
import { faqsRouter } from "./modules/faqs/faqs.routes";
import { knowledgeRouter } from "./modules/knowledge/knowledge.routes";
import { leadsRouter } from "./modules/leads/leads.routes";
import { notificationsRouter } from "./modules/notifications/notifications.routes";
import { platformRouter } from "./modules/platform/platform.routes";
import { productsRouter } from "./modules/products/products.routes";
import { searchRouter } from "./modules/search/search.routes";
import { ticketsRouter } from "./modules/tickets/tickets.routes";
import { usersRouter, platformUsersRouter } from "./modules/users/users.routes";
import { widgetRouter } from "./modules/widget/widget.routes";
import { wizardRouter } from "./modules/wizard/wizard.routes";

/**
 * The API surface.
 *
 * Three tiers, in order of trust:
 *
 *   `/widget/*`     public. The embedded chat widget runs on a customer's own
 *                   website and has no user session.
 *   `/auth/*`       mixed. Sign-in and reset are public; the rest need a token.
 *   everything else authenticated, and every tenant-scoped router additionally
 *                   mounts `companyScope`, which resolves the company from the
 *                   session and refuses a URL that names a different one.
 *
 * Company-scoped routers are mounted twice: once under `/companies/:companyId/…`
 * (the shape the frontend's service layer calls) and once under a bare path for
 * the current workspace. Both resolve the tenant the same way — from the token.
 */
export const apiRouter: Router = Router();

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------
apiRouter.use("/widget", widgetRouter);

// ---------------------------------------------------------------------------
// Authentication (partly public — the router gates its own routes)
// ---------------------------------------------------------------------------
apiRouter.use("/auth", authRouter);

// ---------------------------------------------------------------------------
// Everything below requires a valid access token.
// ---------------------------------------------------------------------------
apiRouter.use(authenticate);

apiRouter.use("/me/notifications", notificationsRouter);

// Platform (super admin / platform staff)
apiRouter.use("/platform", platformRouter);
apiRouter.use("/platform/companies", platformCompaniesRouter);
apiRouter.use("/platform/users", platformUsersRouter);

// Company-scoped, addressed by explicit company id.
apiRouter.use("/companies/:companyId/conversations", conversationsRouter);
apiRouter.use("/companies/:companyId/customers", customersRouter);
apiRouter.use("/companies/:companyId/leads", leadsRouter);
apiRouter.use("/companies/:companyId/tickets", ticketsRouter);
apiRouter.use("/companies/:companyId/faqs", faqsRouter);
apiRouter.use("/companies/:companyId/knowledge", knowledgeRouter);
apiRouter.use("/companies/:companyId/chatbot-config", chatbotRouter);
apiRouter.use("/companies/:companyId/wizard", wizardRouter);
apiRouter.use("/companies/:companyId/analytics", analyticsRouter);
apiRouter.use("/companies/:companyId/search", searchRouter);
apiRouter.use("/companies/:companyId", usersRouter);
apiRouter.use("/companies/:companyId", productsRouter);
apiRouter.use("/companies/:companyId", companyRouter);

// The same routers for "my workspace", so a client that does not want to thread
// a company id through every call does not have to.
apiRouter.use("/workspace/conversations", conversationsRouter);
apiRouter.use("/workspace/customers", customersRouter);
apiRouter.use("/workspace/leads", leadsRouter);
apiRouter.use("/workspace/tickets", ticketsRouter);
apiRouter.use("/workspace/faqs", faqsRouter);
apiRouter.use("/workspace/knowledge", knowledgeRouter);
apiRouter.use("/workspace/chatbot-config", chatbotRouter);
apiRouter.use("/workspace/wizard", wizardRouter);
apiRouter.use("/workspace/analytics", analyticsRouter);
apiRouter.use("/workspace/search", searchRouter);
apiRouter.use("/workspace", usersRouter);
apiRouter.use("/workspace", productsRouter);
apiRouter.use("/workspace", companyRouter);
