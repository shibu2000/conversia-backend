import { and, asc, count, desc, eq, gte, ilike, inArray, or, sql } from "drizzle-orm";
import { db, type Transaction } from "../../db";
import {
  activityEvents,
  chatbotConfigs,
  companies,
  companySettings,
  companyUsage,
  conversations,
  knowledgeSources,
  leads,
  products,
  teams,
  tickets,
  users,
  wizardStates,
} from "../../db/schema";
import { conflict, notFound, validationError } from "../../core/errors";
import { newEmbedKey, newId, slugify } from "../../core/ids";
import { createSystemRoles, deliverAuthLink, issueAuthToken } from "../auth/auth.service";
import type { AuthContext } from "../auth/auth.types";
import { createDefaultCollections } from "../knowledge/knowledge.service";
import { defaultSteps } from "../wizard/wizard.service";
import { likePattern, paginate, resolveOrderBy, type ListQuery, type Paginated } from "../../core/list-query";
import { correlatedCount } from "../../core/subquery";
import { toCompany, toCompanySettings, type TrendPoint } from "./companies.mapper";
import type { UpdateCompanySettingsInput } from "./companies.schema";
import { encryptionAvailable, encryptSecret } from "../../core/secrets";
import { forgetTransport, sendMail, smtpConfigFor, verifyTransport } from "../email/mailer.service";

const SORT_COLUMNS = {
  name: companies.name,
  status: companies.status,
  plan: companies.plan,
  createdAt: companies.createdAt,
};

/**
 * The platform company directory (super admin only).
 *
 * Per-company counts are computed as correlated subqueries rather than joins:
 * six LEFT JOINs with GROUP BY would multiply rows and force a sort over the
 * whole set, where subqueries hit each table's `company_id` index directly.
 */
export async function listCompanies(query: ListQuery): Promise<Paginated<ReturnType<typeof toCompany>>> {
  const conditions = [];

  if (query.search) {
    const pattern = likePattern(query.search);
    conditions.push(
      or(
        ilike(companies.name, pattern),
        ilike(companies.website, pattern),
        ilike(companies.industry, pattern),
        ilike(companies.primaryContactEmail, pattern),
      ),
    );
  }
  if (query.filters.status) conditions.push(inArray(companies.status, query.filters.status as never));
  if (query.filters.plan) conditions.push(inArray(companies.plan, query.filters.plan as never));
  if (query.filters.industry) conditions.push(inArray(companies.industry, query.filters.industry));
  if (query.filters.country) conditions.push(inArray(companies.country, query.filters.country));

  const where = conditions.length ? and(...conditions) : undefined;

  const [[total], rows] = await Promise.all([
    db.select({ value: count() }).from(companies).where(where),
    db
      .select({
        company: companies,
        usage: companyUsage,
        userCount: correlatedCount({ from: "users", as: "u", on: "u.company_id = companies.id" }),
        conversationCount: correlatedCount({ from: "conversations", as: "cv", on: "cv.company_id = companies.id" }),
        leadCount: correlatedCount({ from: "leads", as: "l", on: "l.company_id = companies.id" }),
        ticketCount: correlatedCount({ from: "tickets", as: "t", on: "t.company_id = companies.id" }),
        productCount: correlatedCount({ from: "products", as: "p", on: "p.company_id = companies.id" }),
        knowledgeSourceCount: correlatedCount({ from: "knowledge_sources", as: "ks", on: "ks.company_id = companies.id" }),
      })
      .from(companies)
      .leftJoin(companyUsage, eq(companyUsage.companyId, companies.id))
      .where(where)
      .orderBy(resolveOrderBy(query, SORT_COLUMNS, "name"))
      .limit(query.pageSize)
      .offset(query.offset),
  ]);

  const items = rows.map((row) =>
    toCompany(
      row.company,
      row.usage,
      {
        userCount: Number(row.userCount),
        conversationCount: Number(row.conversationCount),
        leadCount: Number(row.leadCount),
        ticketCount: Number(row.ticketCount),
        productCount: Number(row.productCount),
        knowledgeSourceCount: Number(row.knowledgeSourceCount),
      },
      { conversations: [], leads: [] },
    ),
  );

  return paginate(items, Number(total?.value ?? 0), query);
}

export async function getCompany(companyId: string) {
  const [row] = await db
    .select({ company: companies, usage: companyUsage })
    .from(companies)
    .leftJoin(companyUsage, eq(companyUsage.companyId, companies.id))
    .where(eq(companies.id, companyId))
    .limit(1);

  if (!row) throw notFound("Company", companyId);

  const [counts, trends] = await Promise.all([companyCounts(companyId), companyTrends(companyId)]);
  return toCompany(row.company, row.usage, counts, trends);
}

export async function companyCounts(companyId: string) {
  const [row] = await db
    .select({
      userCount: sql<number>`(SELECT count(*) FROM ${users} WHERE ${users.companyId} = ${companyId})`,
      conversationCount: sql<number>`(SELECT count(*) FROM ${conversations} WHERE ${conversations.companyId} = ${companyId})`,
      leadCount: sql<number>`(SELECT count(*) FROM ${leads} WHERE ${leads.companyId} = ${companyId})`,
      ticketCount: sql<number>`(SELECT count(*) FROM ${tickets} WHERE ${tickets.companyId} = ${companyId})`,
      productCount: sql<number>`(SELECT count(*) FROM ${products} WHERE ${products.companyId} = ${companyId})`,
      knowledgeSourceCount: sql<number>`(SELECT count(*) FROM ${knowledgeSources} WHERE ${knowledgeSources.companyId} = ${companyId})`,
    })
    .from(sql`(SELECT 1) AS one`);

  return {
    userCount: Number(row?.userCount ?? 0),
    conversationCount: Number(row?.conversationCount ?? 0),
    leadCount: Number(row?.leadCount ?? 0),
    ticketCount: Number(row?.ticketCount ?? 0),
    productCount: Number(row?.productCount ?? 0),
    knowledgeSourceCount: Number(row?.knowledgeSourceCount ?? 0),
  };
}

/**
 * Thirty-day conversation and lead trends.
 *
 * Bucketed from the actual rows with `generate_series` so every day appears
 * even when nothing happened — a sparkline that silently drops empty days
 * misreports the shape of the trend.
 */
export async function companyTrends(companyId: string): Promise<{ conversations: TrendPoint[]; leads: TrendPoint[] }> {
  const since = new Date(Date.now() - 29 * 86_400_000);
  since.setUTCHours(0, 0, 0, 0);

  const rows = await db.execute<{ label: string; conversations: number; leads: number }>(sql`
    WITH days AS (
      SELECT generate_series(${since}::timestamptz, now(), '1 day')::date AS day
    )
    SELECT to_char(days.day, 'Mon FMDD') AS label,
           (SELECT count(*) FROM ${conversations}
             WHERE ${conversations.companyId} = ${companyId}
               AND ${conversations.createdAt}::date = days.day)::int AS conversations,
           (SELECT count(*) FROM ${leads}
             WHERE ${leads.companyId} = ${companyId}
               AND ${leads.createdAt}::date = days.day)::int AS leads
      FROM days
     ORDER BY days.day
  `);

  const list = rows.rows ?? (rows as unknown as Array<{ label: string; conversations: number; leads: number }>);
  return {
    conversations: list.map((row) => ({ label: row.label, value: Number(row.conversations) })),
    leads: list.map((row) => ({ label: row.label, value: Number(row.leads) })),
  };
}

export async function updateCompany(companyId: string, patch: Record<string, unknown>) {
  const [updated] = await db
    .update(companies)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(companies.id, companyId))
    .returning({ id: companies.id });

  if (!updated) throw notFound("Company", companyId);
  return getCompany(companyId);
}

export async function getSettings(companyId: string) {
  const [row] = await db.select().from(companySettings).where(eq(companySettings.companyId, companyId)).limit(1);
  if (!row) throw notFound("Company settings", companyId);
  return toCompanySettings(row);
}

/**
 * Update company settings.
 *
 * The two id fields are validated against this company's own users and teams
 * before they are written. Without that check a caller could point the default
 * lead owner at a user in another tenant — the id is not a foreign key, because
 * the column has to tolerate the referenced user being removed.
 */
export async function updateSettings(companyId: string, patch: UpdateCompanySettingsInput) {
  if (patch.defaultLeadOwnerId) {
    const [owner] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, patch.defaultLeadOwnerId), eq(users.companyId, companyId)))
      .limit(1);
    if (!owner) {
      throw validationError("That user is not part of this workspace.", {
        defaultLeadOwnerId: "Choose someone from your workspace.",
      });
    }
  }

  if (patch.defaultTicketTeamId) {
    const [team] = await db
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.id, patch.defaultTicketTeamId), eq(teams.companyId, companyId)))
      .limit(1);
    if (!team) {
      throw validationError("That team is not part of this workspace.", {
        defaultTicketTeamId: "Choose a team from your workspace.",
      });
    }
  }

  // `email` is a nested object in the request and flat columns in the table, so
  // it is translated rather than spread. The password is handled separately
  // because it is the one field that is written but never read back.
  const { email, ...rest } = patch;

  const [row] = await db
    .update(companySettings)
    .set({ ...rest, ...emailColumns(email), updatedAt: new Date() })
    .where(eq(companySettings.companyId, companyId))
    .returning();

  if (!row) throw notFound("Company settings", companyId);

  // Settings changed, so a cached transport built from the old ones is stale.
  if (email) forgetTransport(companyId);

  return toCompanySettings(row);
}

/**
 * The email block, flattened.
 *
 * `smtpPassword` follows the rule the API promises: absent leaves the stored one
 * alone, `null` clears it, a string replaces it. It is encrypted here, at the
 * only point it exists in plaintext on the server.
 */
function emailColumns(email: UpdateCompanySettingsInput["email"]) {
  if (!email) return {};

  const columns: Record<string, unknown> = {};
  if (email.enabled !== undefined) columns.emailEnabled = email.enabled;
  if (email.smtpHost !== undefined) columns.smtpHost = email.smtpHost;
  if (email.smtpPort !== undefined) columns.smtpPort = email.smtpPort;
  if (email.smtpSecure !== undefined) columns.smtpSecure = email.smtpSecure;
  if (email.smtpUser !== undefined) columns.smtpUser = email.smtpUser;
  if (email.smtpFromName !== undefined) columns.smtpFromName = email.smtpFromName;
  if (email.smtpFromEmail !== undefined) columns.smtpFromEmail = email.smtpFromEmail;
  if (email.leadNotificationEmail !== undefined) columns.leadNotificationEmail = email.leadNotificationEmail;

  if (email.smtpPassword === null) {
    columns.smtpPasswordEncrypted = null;
  } else if (typeof email.smtpPassword === "string" && email.smtpPassword.length > 0) {
    if (!encryptionAvailable()) {
      // Storing it in the clear instead would be the worse failure, and a silent
      // one. Say why, so the deployment can be fixed.
      throw validationError(
        "This deployment cannot store mail credentials: ENCRYPTION_KEY is not configured.",
        { smtpPassword: "Ask an administrator to set ENCRYPTION_KEY on the server." },
      );
    }
    columns.smtpPasswordEncrypted = encryptSecret(email.smtpPassword);
  }

  return columns;
}

/** Distinct values, so the directory's filter dropdowns are data-driven. */
export async function filterOptions() {
  const [industries, countries] = await Promise.all([
    db.selectDistinct({ value: companies.industry }).from(companies).orderBy(asc(companies.industry)),
    db.selectDistinct({ value: companies.country }).from(companies).orderBy(asc(companies.country)),
  ]);

  return {
    industries: industries.map((row) => row.value).filter(Boolean),
    countries: countries.map((row) => row.value).filter(Boolean),
  };
}

/**
 * Provision a company from the platform console.
 *
 * Everything lands in one transaction: the company, its usage row and settings,
 * the five system roles, an invited administrator, a draft chatbot config and a
 * fresh wizard state. A company missing any of those is a workspace nobody can
 * finish setting up, and provisioning that half-succeeds is worse than one that
 * fails cleanly.
 *
 * The administrator is created as `invited` with no password and is sent a
 * single-use invitation link — the platform never sets a password on someone
 * else's behalf.
 */
export async function createCompany(
  actor: AuthContext,
  input: {
    name: string;
    website?: string;
    industry?: string;
    country?: string;
    timezone?: string;
    plan: "starter" | "growth" | "scale" | "enterprise";
    status: "active" | "trial" | "onboarding";
    adminName: string;
    adminEmail: string;
  },
) {
  const quota = PLAN_QUOTAS[input.plan];
  const companyId = newId("cmp");
  const adminUserId = newId("usr");
  const timezone = input.timezone || "UTC";

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${input.adminEmail} AND ${users.companyId} IS NULL`)
      .limit(1);

    if (existing) {
      throw conflict("That address belongs to a platform account.", {
        adminEmail: "Use a different address for the company administrator.",
      });
    }

    await tx.insert(companies).values({
      id: companyId,
      name: input.name,
      slug: await uniqueSlug(tx, slugify(input.name)),
      website: input.website ?? "",
      industry: input.industry ?? "",
      country: input.country ?? "",
      timezone,
      status: input.status,
      plan: input.plan,
      primaryContactName: input.adminName,
      primaryContactEmail: input.adminEmail,
      onboardingProgress: 0,
    });

    await tx.insert(companyUsage).values({
      companyId,
      aiRequestQuota: quota.ai,
      conversationQuota: quota.conversations,
      knowledgeDocumentQuota: quota.documents,
      seatQuota: quota.seats,
      seats: 1,
    });

    const weekday = { open: true, from: "09:00", to: "18:00" };
    await tx.insert(companySettings).values({
      companyId,
      supportEmail: input.adminEmail,
      businessHours: {
        timezone,
        days: {
          "1": weekday,
          "2": weekday,
          "3": weekday,
          "4": weekday,
          "5": weekday,
          "6": { open: false, from: "10:00", to: "14:00" },
          "7": { open: false, from: "10:00", to: "14:00" },
        },
      },
    });

    const createdRoles = await createSystemRoles(tx, companyId);
    const adminRole = createdRoles.find((role) => role.slug === "company_admin")!;

    await tx.insert(users).values({
      id: adminUserId,
      companyId,
      name: input.adminName,
      email: input.adminEmail,
      // No password: they set one by accepting the invitation.
      passwordHash: null,
      platformRole: "company_user",
      roleId: adminRole.id,
      status: "invited",
      timezone,
    });

    await tx.insert(chatbotConfigs).values({
      id: newId("cbc"),
      companyId,
      status: "draft",
      version: 1,
      hasUnpublishedChanges: true,
      ...defaultChatbotConfig(input.name),
      embedKey: newEmbedKey(),
      allowedDomains: input.website ? [hostnameOf(input.website)].filter(Boolean) : [],
    });

    await createDefaultCollections(tx, companyId);
    await tx.insert(wizardStates).values({ companyId, currentStepKey: "company", steps: defaultSteps() });

    await tx.insert(activityEvents).values({
      id: newId("act"),
      companyId,
      actorId: actor.userId,
      actorName: actor.name,
      action: "company.provisioned",
      summary: `Provisioned ${input.name} on the ${input.plan} plan`,
      targetType: "company",
      targetId: companyId,
    });
  });

  const token = await issueAuthToken(adminUserId, "invite", 7 * 24 * 60);
  deliverAuthLink("Invitation", input.adminEmail, token);

  return getCompany(companyId);
}

const PLAN_QUOTAS = {
  starter: { ai: 5_000, conversations: 1_000, documents: 50, seats: 5 },
  growth: { ai: 25_000, conversations: 6_000, documents: 250, seats: 20 },
  scale: { ai: 120_000, conversations: 30_000, documents: 1_000, seats: 75 },
  enterprise: { ai: 500_000, conversations: 150_000, documents: 5_000, seats: 400 },
} as const;

async function uniqueSlug(tx: Transaction, base: string): Promise<string> {
  const candidate = base || "workspace";
  for (let suffix = 0; suffix < 50; suffix += 1) {
    const slug = suffix === 0 ? candidate : `${candidate}-${suffix}`;
    const [taken] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.slug, slug)).limit(1);
    if (!taken) return slug;
  }
  return `${candidate}-${Date.now().toString(36)}`;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** A neutral starting configuration the new workspace can edit and publish. */
function defaultChatbotConfig(companyName: string) {
  return {
    identity: {
      botName: `${companyName} Assistant`,
      avatarUrl: null,
      avatarEmoji: "💬",
      welcomeMessage: "Hi! How can we help?",
      inputPlaceholder: "Type your question…",
      defaultLocale: "en-US",
      supportedLocales: ["en-US"],
      tagline: "We usually reply quickly",
    },
    appearance: {
      theme: "auto" as const,
      primaryColor: "#2a78d6",
      position: "bottom-right" as const,
      launcherStyle: "bubble" as const,
      launcherLabel: "Chat",
      widthPx: 384,
      heightPx: 600,
      cornerRadiusPx: 16,
      showBranding: true,
      offsetXPx: 24,
      offsetYPx: 24,
    },
    behavior: {
      autoOpenDelayMs: 0,
      showQuickReplies: false,
      quickReplies: [],
      persistConversation: true,
      requireEmailBeforeChat: false,
      offlineMessage: "We are offline right now. Leave a message and we will reply.",
      respectBusinessHours: true,
      typingIndicator: true,
      allowFileUpload: false,
      allowConversationTranscript: false,
    },
    ai: {
      providerId: "",
      model: "",
      personality: "professional" as const,
      responseStyle: "balanced" as const,
      creativity: 0.3,
      maxResponseWords: 120,
      allowedTopics: [],
      blockedTopics: [],
      fallbackResponse: "I do not have a confident answer for that. Would you like me to pass this to a colleague?",
      systemPromptAddendum: "",
      knowledgeConfidenceThreshold: 0.65,
      citeSources: true,
      enabledTools: [],
    },
    knowledge: { faqSetIds: [], collectionIds: [], preferFaqOverRag: true, maxChunksPerAnswer: 4 },
    leads: {
      enabled: false,
      fields: [
        { key: "name", label: "Name", required: true, enabled: true },
        { key: "email", label: "Email", required: true, enabled: true },
      ],
      qualificationQuestions: [],
      defaultStatus: "new",
      defaultAssigneeId: null,
      assignmentStrategy: "manual" as const,
      notifyAssignee: true,
    },
    tickets: {
      enabled: false,
      defaultCategory: "other",
      defaultPriority: "medium",
      assignmentStrategy: "manual" as const,
      defaultTeamId: null,
      requiredFields: [],
      confirmBeforeCreate: true,
    },
    handoff: {
      enabled: true,
      triggers: ["customer_request"] as Array<"customer_request">,
      uncertaintyThreshold: 0.65,
      escalationCategories: [],
      defaultTeamId: null,
      assignmentStrategy: "manual" as const,
      outsideHoursMessage: "We are closed right now.",
      queueMessage: "Connecting you to a colleague…",
    },
  };
}


/**
 * Prove the mail settings work, by using them.
 *
 * Configuring SMTP blind is miserable, and the failures are all indistinguishable
 * from the outside: a wrong port, a wrong password and a blocked connection each
 * just mean "no email arrived". So this verifies the connection, sends one real
 * message, and — on failure — hands back what the mail server actually said. A
 * generic "could not send" would leave the administrator guessing among the
 * three.
 */
export async function sendTestEmail(companyId: string, to: string) {
  const config = await smtpConfigFor(companyId);
  if (!config) {
    throw validationError("Set a mail server and a from-address first, and turn email on.", {
      smtpHost: "Email is not configured for this workspace yet.",
    });
  }

  try {
    await verifyTransport(companyId, config);
    await sendMail(companyId, config, {
      to,
      subject: "Conversia test email",
      text: [
        "This is a test from your Conversia workspace.",
        "",
        `Sent through ${config.host}:${config.port} as ${config.fromEmail}.`,
        "If you are reading this, new-lead notifications will reach you.",
      ].join("\n"),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw validationError(`The mail server refused: ${reason}`, { smtpHost: reason.slice(0, 200) });
  }

  return { sent: true, to };
}
