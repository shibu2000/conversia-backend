import { sql } from "drizzle-orm";
import { closePool, db } from "../index";
import * as schema from "../schema";
import { env } from "../../config/env";
import { logger } from "../../config/logger";
import { newEmbedKey, newId, slugify } from "../../core/ids";
import { ALL_PERMISSION_KEYS, ROLE_PRESETS } from "../../core/permissions";
import { hashPassword } from "../../modules/auth/password.service";
import { defaultSteps } from "../../modules/wizard/wizard.service";
import { Rng, daysAgo, daysAhead, hoursAgo, minutesAgo } from "./random";
import {
  CONVERSATION_OPENERS,
  COUNTRIES,
  CUSTOMER_TAGS,
  FAQ_TREE,
  FIRST_NAMES,
  LAST_NAMES,
  LEAD_INTERESTS,
  POLICY_DOCUMENTS,
  PRODUCT_SEEDS,
  TICKET_SCENARIOS,
} from "./vocab";

/**
 * Demo data.
 *
 * One fully-populated company ("Northwind Retail") plus a handful of thinner
 * tenants, so the super-admin directory has something to page through and —
 * more importantly — so tenant isolation is actually exercised. A single-tenant
 * seed cannot catch a missing `company_id` predicate.
 *
 * Every password is the same and comes from `SEED_PASSWORD`. That is fine for a
 * development fixture and is why `db:seed` refuses to run in production.
 */
const PRIMARY_COMPANY_ID = "cmp_northwind";

async function main(): Promise<void> {
  if (env.isProduction) {
    throw new Error("db:seed is disabled when NODE_ENV=production. Seed data is for development only.");
  }

  logger.info("Seeding demo data…");
  const rng = new Rng("conversia-seed-v1");
  const passwordHash = await hashPassword(env.SEED_PASSWORD);

  await db.transaction(async (tx) => {
    // Truncate rather than delete: it resets everything the foreign keys
    // cascade to in one statement and is re-runnable.
    await tx.execute(sql`
      TRUNCATE TABLE
        ${schema.companies}, ${schema.users}, ${schema.aiProviders}, ${schema.platformHealthChecks}
      RESTART IDENTITY CASCADE
    `);

    await seedPlatform(tx, passwordHash);

    const primary = await seedPrimaryCompany(tx, rng, passwordHash);
    await seedOtherCompanies(tx, rng, passwordHash);

    logger.info("Seeded the primary workspace", { companyId: primary.companyId, embedKey: primary.embedKey });
  });

  logger.info("Seed complete.");
  logger.info(`Sign in as meera.krishnan@northwindretail.com / ${env.SEED_PASSWORD} (Company Admin)`);
  logger.info(`Platform admin: alex.chen@conversia.ai / ${env.SEED_PASSWORD}`);
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Platform staff, AI provider registry and health checks. */
async function seedPlatform(tx: Tx, passwordHash: string): Promise<void> {
  await tx.insert(schema.users).values([
    {
      id: "usr_platform_owner",
      companyId: null,
      name: "Alex Chen",
      email: "alex.chen@conversia.ai",
      passwordHash,
      platformRole: "super_admin",
      status: "active",
      title: "Platform Owner",
      timezone: "UTC",
      lastActiveAt: minutesAgo(3),
      createdAt: daysAgo(680),
    },
    {
      id: "usr_platform_support",
      companyId: null,
      name: "Isabella Rossi",
      email: "isabella.rossi@conversia.ai",
      passwordHash,
      platformRole: "platform_support",
      status: "active",
      title: "Technical Account Manager",
      timezone: "Europe/Berlin",
      lastActiveAt: hoursAgo(4),
      createdAt: daysAgo(520),
    },
  ]);

  // A registry of providers the future AI layer can route to. No credentials
  // are stored and nothing in this codebase calls any of them.
  await tx.insert(schema.aiProviders).values([
    {
      id: "prov_anthropic",
      name: "Anthropic",
      vendor: "Anthropic",
      status: "disconnected",
      isDefault: true,
      region: "us-east-1",
      models: [
        { id: "claude-opus-5", label: "Claude Opus 5", contextWindow: 1_000_000, inputCostPerMTok: 15, outputCostPerMTok: 75, capabilities: ["chat", "tools", "vision"] },
        { id: "claude-sonnet-5", label: "Claude Sonnet 5", contextWindow: 1_000_000, inputCostPerMTok: 3, outputCostPerMTok: 15, capabilities: ["chat", "tools", "vision"], recommended: true },
        { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", contextWindow: 200_000, inputCostPerMTok: 1, outputCostPerMTok: 5, capabilities: ["chat", "tools"] },
      ],
    },
    {
      id: "prov_embeddings",
      name: "Vector Embeddings",
      vendor: "Voyage AI",
      status: "disconnected",
      isDefault: false,
      region: "us-east-1",
      models: [
        { id: "voyage-3-large", label: "Voyage 3 Large", contextWindow: 32_000, inputCostPerMTok: 0.18, outputCostPerMTok: 0, capabilities: ["embedding"], recommended: true },
        { id: "voyage-rerank-2", label: "Voyage Rerank 2", contextWindow: 16_000, inputCostPerMTok: 0.05, outputCostPerMTok: 0, capabilities: ["reranking"] },
      ],
    },
  ]);

  await tx.insert(schema.platformHealthChecks).values([
    { id: "hc_api", name: "Public API", status: "operational", latencyMs: 84, uptimePct: "99.980", detail: "All regions responding within the 250 ms budget.", lastCheckedAt: minutesAgo(1) },
    { id: "hc_db", name: "Database", status: "operational", latencyMs: 6, uptimePct: "99.995", detail: "Primary healthy; replication lag under 1 second.", lastCheckedAt: minutesAgo(1) },
    { id: "hc_widget", name: "Widget CDN", status: "operational", latencyMs: 31, uptimePct: "99.990", detail: "Edge cache hit rate 97.4%.", lastCheckedAt: minutesAgo(1) },
    { id: "hc_storage", name: "Document Storage", status: "operational", latencyMs: 42, uptimePct: "99.970", detail: "Upload and download paths healthy.", lastCheckedAt: minutesAgo(2) },
    {
      id: "hc_ai",
      name: "AI Inference",
      status: "down",
      latencyMs: 0,
      uptimePct: "0.000",
      // Honest: the AI layer genuinely is not deployed.
      detail: "No AI provider is configured on this deployment. The inference layer has not been installed.",
      lastCheckedAt: minutesAgo(1),
    },
    {
      id: "hc_vector",
      name: "Vector Index",
      status: "down",
      latencyMs: 0,
      uptimePct: "0.000",
      detail: "No vector store is configured. Semantic retrieval is unavailable.",
      lastCheckedAt: minutesAgo(1),
    },
  ]);
}

async function seedPrimaryCompany(tx: Tx, rng: Rng, passwordHash: string) {
  const companyId = PRIMARY_COMPANY_ID;
  const domain = "northwindretail.com";
  const embedKey = newEmbedKey();

  await tx.insert(schema.companies).values({
    id: companyId,
    name: "Northwind Retail",
    slug: "northwind-retail",
    website: `https://www.${domain}`,
    industry: "E-commerce",
    country: "India",
    timezone: "Asia/Kolkata",
    status: "active",
    plan: "scale",
    primaryContactName: "Meera Krishnan",
    primaryContactEmail: `meera.krishnan@${domain}`,
    onboardingProgress: 75,
    createdAt: daysAgo(412),
  });

  // Reference series start past the seeded rows, so the first record created
  // after seeding continues the sequence instead of colliding with one.
  await tx.insert(schema.companyCounters).values([
    { companyId, entity: "lead", nextValue: 4200 + 90 },
    { companyId, entity: "ticket", nextValue: 10_240 + 80 },
    { companyId, entity: "conversation", nextValue: 10_000 + 160 },
  ]);

  await tx.insert(schema.companyUsage).values({
    companyId,
    aiRequestQuota: 120_000,
    conversationQuota: 30_000,
    knowledgeDocumentQuota: 1_000,
    seatQuota: 75,
    seats: 20,
  });

  const weekday = { open: true, from: "09:00", to: "18:00" };
  await tx.insert(schema.companySettings).values({
    companyId,
    businessHours: {
      timezone: "Asia/Kolkata",
      days: {
        "1": weekday, "2": weekday, "3": weekday, "4": weekday, "5": weekday,
        "6": { open: true, from: "10:00", to: "14:00" },
        "7": { open: false, from: "10:00", to: "14:00" },
      },
    },
    supportEmail: `support@${domain}`,
    dataRetentionDays: 730,
    locales: ["en-US", "hi-IN"],
    defaultLocale: "en-US",
  });

  // ----- Roles -------------------------------------------------------------
  const roleIds: Record<string, string> = {};
  const roleDefinitions = [
    { slug: "company_admin" as const, name: "Company Admin", description: "Full access to the workspace, including users, roles, AI configuration and billing." },
    { slug: "manager" as const, name: "Manager", description: "Runs day-to-day operations: assigns work, edits records, reads every report." },
    { slug: "sales" as const, name: "Sales", description: "Works leads and customers. No access to users, knowledge or chatbot configuration." },
    { slug: "support" as const, name: "Support", description: "Handles conversations and tickets, and curates FAQ answers." },
    { slug: "viewer" as const, name: "Viewer", description: "Read-only access for stakeholders who need visibility but should not change anything." },
  ];

  for (const definition of roleDefinitions) {
    const id = `role_${definition.slug}_nw`;
    roleIds[definition.slug] = id;
    await tx.insert(schema.roles).values({
      id,
      companyId,
      slug: definition.slug,
      name: definition.name,
      description: definition.description,
      isSystem: true,
      permissions: definition.slug === "company_admin" ? ALL_PERMISSION_KEYS : ROLE_PRESETS[definition.slug],
      createdAt: daysAgo(412),
    });
  }

  // ----- Users -------------------------------------------------------------
  const userDefinitions = [
    { id: "usr_meera", name: "Meera Krishnan", role: "company_admin", title: "Head of Customer Experience" },
    { id: "usr_dan", name: "Daniel Whitfield", role: "company_admin", title: "Operations Director" },
    { id: "usr_priya", name: "Priya Sharma", role: "manager", title: "Support Manager" },
    { id: "usr_tom", name: "Thomas Brennan", role: "manager", title: "Sales Manager" },
    { id: "usr_nina", name: "Nina Lindqvist", role: "manager", title: "Knowledge Manager" },
    { id: "usr_amit", name: "Amit Sharma", role: "sales", title: "Senior Sales Executive" },
    { id: "usr_kavya", name: "Kavya Reddy", role: "sales", title: "Inside Sales Rep" },
    { id: "usr_marcus", name: "Marcus Okonkwo", role: "sales", title: "Account Manager" },
    { id: "usr_sofia", name: "Sofia Martinez", role: "sales", title: "Sales Executive" },
    { id: "usr_rohit", name: "Rohit Desai", role: "sales", title: "Inside Sales Rep" },
    { id: "usr_zara", name: "Zara Hassan", role: "sales", title: "Sales Executive", status: "invited" as const },
    { id: "usr_james", name: "James Whitfield", role: "support", title: "Support Lead" },
    { id: "usr_ananya", name: "Ananya Iyer", role: "support", title: "Escalation Specialist" },
    { id: "usr_felix", name: "Felix Fischer", role: "support", title: "Support Specialist" },
    { id: "usr_mei", name: "Mei Wang", role: "support", title: "Support Specialist" },
    { id: "usr_omar", name: "Omar Ali", role: "support", title: "Support Specialist" },
    { id: "usr_emma", name: "Emma Costa", role: "support", title: "Support Specialist" },
    { id: "usr_lucas", name: "Lucas Silva", role: "support", title: "Support Specialist", status: "disabled" as const },
    { id: "usr_elena", name: "Elena Novak", role: "viewer", title: "Finance Analyst" },
    { id: "usr_diego", name: "Diego Moreau", role: "viewer", title: "Regional Director" },
  ];

  await tx.insert(schema.users).values(
    userDefinitions.map((definition, index) => {
      const status = definition.status ?? ("active" as const);
      const [first, last] = definition.name.toLowerCase().split(" ");
      return {
        id: definition.id,
        companyId,
        name: definition.name,
        email: `${first}.${last}@${domain}`,
        // Invited users have no password until they accept, which is what makes
        // the invitation flow real rather than decorative.
        passwordHash: status === "invited" ? null : passwordHash,
        platformRole: "company_user" as const,
        roleId: roleIds[definition.role],
        status,
        title: definition.title,
        phone: `+91 98${rng.int(10, 99)} ${rng.int(100000, 999999)}`,
        timezone: "Asia/Kolkata",
        lastActiveAt: status === "invited" ? null : hoursAgo(rng.int(1, 200)),
        createdAt: daysAgo(400 - index * 14),
      };
    }),
  );

  // ----- Teams -------------------------------------------------------------
  const supportUserIds = userDefinitions.filter((user) => user.role === "support").map((user) => user.id);
  const salesUserIds = userDefinitions.filter((user) => user.role === "sales").map((user) => user.id);

  await tx.insert(schema.teams).values([
    { id: "team_support_nw", companyId, name: "Support", description: "First-line support and escalations from the chatbot." },
    { id: "team_sales_nw", companyId, name: "Sales", description: "Owns inbound leads created by the assistant." },
    { id: "team_returns_nw", companyId, name: "Returns & Refunds", description: "Specialist queue for return, refund and warranty tickets." },
  ]);

  await tx.insert(schema.teamMembers).values([
    ...supportUserIds.map((userId) => ({ teamId: "team_support_nw", userId })),
    ...salesUserIds.map((userId) => ({ teamId: "team_sales_nw", userId })),
    ...supportUserIds.slice(0, 3).map((userId) => ({ teamId: "team_returns_nw", userId })),
  ]);

  await tx
    .update(schema.companySettings)
    .set({ defaultLeadOwnerId: "usr_tom", defaultTicketTeamId: "team_support_nw" })
    .where(sql`${schema.companySettings.companyId} = ${companyId}`);

  // ----- Catalogue ---------------------------------------------------------
  const categoryIds: Record<string, string> = {
    Footwear: "pcat_footwear_nw",
    Apparel: "pcat_apparel_nw",
    Fitness: "pcat_fitness_nw",
    Accessories: "pcat_accessories_nw",
    Electronics: "pcat_electronics_nw",
  };

  await tx.insert(schema.productCategories).values([
    { id: categoryIds.Footwear, companyId, name: "Footwear", slug: "footwear", description: "Running, trail and casual shoes." },
    { id: categoryIds.Apparel, companyId, name: "Apparel", slug: "apparel", description: "Technical and everyday clothing." },
    { id: categoryIds.Fitness, companyId, name: "Fitness", slug: "fitness", description: "Home gym and recovery equipment." },
    { id: categoryIds.Accessories, companyId, name: "Accessories", slug: "accessories", description: "Bottles, packs, caps and small gear." },
    { id: categoryIds.Electronics, companyId, name: "Electronics", slug: "electronics", description: "Wearables, audio and bike lights." },
  ]);

  const productIds: string[] = [];
  await tx.insert(schema.products).values(
    PRODUCT_SEEDS.map((seed, index) => {
      const id = `prd_${slugify(seed.name)}`;
      productIds.push(id);
      const stockQty = rng.weighted([[0, 10], [rng.int(1, 9), 15], [rng.int(10, 80), 45], [rng.int(81, 420), 30]]);
      const status = rng.weighted<"active" | "draft" | "archived">([["active", 84], ["draft", 10], ["archived", 6]]);
      const inventoryStatus =
        stockQty === 0 ? "out_of_stock" : stockQty <= 10 ? "low_stock" : ("in_stock" as const);
      const priceUsd = Number((seed.price / 83).toFixed(2));

      return {
        id,
        companyId,
        sku: `NW-${String(index + 1).padStart(4, "0")}`,
        name: seed.name,
        slug: slugify(seed.name),
        shortDescription: `${seed.keywords[0][0].toUpperCase()}${seed.keywords[0].slice(1)} ${seed.category.toLowerCase()} built for everyday use.`,
        description: `The ${seed.name} is part of our ${seed.category.toLowerCase()} range, designed around what customers ask for most: ${seed.keywords.join(", ")}.\n\nIt ships in recyclable packaging and carries our standard two-year manufacturing warranty.`,
        categoryId: categoryIds[seed.category],
        status,
        priceUsd: String(priceUsd),
        compareAtPriceUsd: rng.bool(0.3) ? String(Number((priceUsd * rng.float(1.15, 1.4)).toFixed(2))) : null,
        inventoryStatus: inventoryStatus as never,
        stockQty,
        images: [{ id: `img_${index}_1`, url: "", alt: `${seed.name} — main product photo`, isPrimary: true }],
        attributes: [
          { name: "Material", value: rng.pick(["Recycled polyester", "Merino wool", "Anodised aluminium", "EVA foam"]) },
          { name: "Weight", value: `${rng.int(120, 1400)} g` },
          { name: "Warranty", value: "2 years" },
        ],
        rating: status === "draft" ? null : String(rng.float(3.4, 4.9, 1)),
        reviewCount: status === "draft" ? 0 : rng.int(6, 840),
        url: `https://www.${domain}/products/${slugify(seed.name)}`,
        aiKeywords: [...seed.keywords],
        aiUseCases: rng.sample(["daily training", "gifting", "travel", "commuting", "competition", "beginners"], rng.int(2, 4)),
        aiAudience: rng.sample(["runners", "hikers", "gym-goers", "commuters", "students"], rng.int(1, 3)),
        aiTalkingPoints: [`Customers pick this for its ${seed.keywords[0]}.`, "Two-year warranty and free returns within 30 days."],
        aiIncludeInRecommendations: status === "active",
        leadCount: rng.int(0, 34),
        conversationMentions: rng.int(2, 210),
        createdAt: daysAgo(rng.int(40, 620)),
      };
    }),
  );

  // ----- Customers ---------------------------------------------------------
  const customerIds: string[] = [];
  const customerRows = Array.from({ length: 120 }, (_, index) => {
    const first = rng.pick(FIRST_NAMES);
    const last = rng.pick(LAST_NAMES);
    const id = `cus_${String(index + 1).padStart(4, "0")}`;
    customerIds.push(id);
    const country = rng.pick(COUNTRIES);
    const status = rng.weighted<"customer" | "lead" | "active" | "churned" | "blocked">([
      ["customer", 44], ["lead", 26], ["active", 18], ["churned", 9], ["blocked", 3],
    ]);
    const orderCount = status === "customer" ? rng.int(1, 12) : status === "churned" ? rng.int(1, 5) : 0;

    return {
      id,
      companyId,
      name: `${first} ${last}`,
      email: rng.bool(0.9) ? `${first.toLowerCase()}.${last.toLowerCase()}${index}@example.com` : null,
      phone: rng.bool(0.62) ? `+91 ${rng.int(700, 999)} ${rng.int(100000, 999999)}` : null,
      companyName: rng.bool(0.22) ? `${rng.pick(["Acme", "Vertex", "Lumina", "Orbit", "Pinnacle"])} ${rng.pick(["Ltd", "Group", "Labs"])}` : null,
      country: country.name,
      locale: country.locale,
      status,
      tags: rng.sample(CUSTOMER_TAGS, rng.int(0, 3)),
      firstSeenChannel: rng.weighted<"chatbot" | "website" | "manual" | "import" | "api" | "email">([
        ["chatbot", 58], ["website", 20], ["manual", 9], ["import", 8], ["api", 3], ["email", 2],
      ]),
      lastSeenAt: hoursAgo(rng.int(1, 2000)),
      lifetimeValueUsd: String((orderCount * rng.float(24, 310)).toFixed(2)),
      createdAt: daysAgo(rng.int(2, 700)),
      _orderCount: orderCount,
    };
  });

  await tx.insert(schema.customers).values(customerRows.map(({ _orderCount, ...row }) => row));

  // ----- Orders ------------------------------------------------------------
  const orderRows: Array<typeof schema.orders.$inferInsert> = [];
  let orderSequence = 48_200;
  for (const customer of customerRows) {
    for (let index = 0; index < customer._orderCount; index += 1) {
      orderSequence += rng.int(1, 9);
      const items = rng.sample(PRODUCT_SEEDS, rng.int(1, 3)).map((seed) => ({
        productId: `prd_${slugify(seed.name)}`,
        name: seed.name,
        qty: rng.int(1, 3),
        priceUsd: Number((seed.price / 83).toFixed(2)),
      }));
      orderRows.push({
        id: `ord_${orderSequence}`,
        companyId,
        customerId: customer.id,
        reference: `#${orderSequence}`,
        status: rng.weighted([["delivered", 52], ["shipped", 16], ["paid", 12], ["pending", 8], ["cancelled", 7], ["refunded", 5]]),
        totalUsd: String(items.reduce((sum, item) => sum + item.priceUsd * item.qty, 0).toFixed(2)),
        itemCount: items.reduce((sum, item) => sum + item.qty, 0),
        items,
        placedAt: daysAgo(rng.int(1, 400)),
      });
    }
  }
  if (orderRows.length > 0) await tx.insert(schema.orders).values(orderRows);

  // ----- Bookings ----------------------------------------------------------
  await tx.insert(schema.bookings).values(
    rng.sample(customerIds, 20).map((customerId, index) => {
      const future = rng.bool(0.55);
      return {
        id: `bkg_${String(index + 1).padStart(3, "0")}`,
        companyId,
        customerId,
        reference: `BK-${2400 + index}`,
        type: rng.pick(["Gait analysis", "Bike fitting", "Product consultation", "Warranty inspection"]),
        status: future
          ? rng.weighted<"confirmed" | "requested">([["confirmed", 70], ["requested", 30]])
          : rng.weighted<"completed" | "cancelled" | "no_show">([["completed", 66], ["cancelled", 20], ["no_show", 14]]),
        scheduledFor: future ? daysAhead(rng.int(1, 21)) : daysAgo(rng.int(1, 60)),
        durationMinutes: rng.pick([30, 45, 60]),
        assignedUserId: rng.pick([...supportUserIds, null]),
        location: rng.pick(["Bengaluru — Indiranagar store", "Mumbai — Lower Parel store", "Video call"]),
      };
    }),
  );

  // ----- Conversations -----------------------------------------------------
  const conversationRows: Array<typeof schema.conversations.$inferInsert> = [];
  const messageRows: Array<typeof schema.messages.$inferInsert> = [];
  const agentIds = [...supportUserIds, "usr_priya", "usr_tom"];

  for (let index = 0; index < 160; index += 1) {
    const id = `cnv_${String(index + 1).padStart(4, "0")}`;
    const customerId = rng.pick(customerIds);
    const intent = rng.weighted<string>([
      ["faq", 26], ["order_status", 18], ["product_discovery", 14], ["support_issue", 13],
      ["lead_capture", 9], ["pricing", 6], ["complaint", 5], ["booking", 4], ["small_talk", 3], ["unknown", 2],
    ]);
    const status = rng.weighted<string>([
      ["closed", 30], ["active", 18], ["human_handoff", 14], ["waiting_on_customer", 12],
      ["escalated", 10], ["abandoned", 16],
    ]);
    const needsHuman = status === "human_handoff" || status === "escalated";
    const assignedUserId = needsHuman || rng.bool(0.22) ? rng.pick(agentIds) : null;
    const startedHoursAgo = rng.int(1, 24 * 45);
    const opener = rng.pick(CONVERSATION_OPENERS[intent] ?? CONVERSATION_OPENERS.unknown);

    // Customer turns only. There are no assistant messages in this dataset
    // because no assistant has answered anything — writing canned "AI replies"
    // would be exactly the fabrication this build is meant to avoid.
    const messageCount = rng.int(1, 3);
    for (let turn = 0; turn < messageCount; turn += 1) {
      messageRows.push({
        id: `${id}_m${turn + 1}`,
        conversationId: id,
        companyId,
        role: "customer",
        body: turn === 0 ? opener : rng.pick(["Any update on this?", "Thanks, that helps.", "Can someone call me back?"]),
        at: hoursAgo(startedHoursAgo - turn),
      });
    }

    if (assignedUserId) {
      messageRows.push({
        id: `${id}_agent`,
        conversationId: id,
        companyId,
        role: "agent",
        authorId: assignedUserId,
        authorName: userDefinitions.find((user) => user.id === assignedUserId)?.name ?? "Agent",
        body: "Thanks for getting in touch — I am looking into this now and will come back to you shortly.",
        deliveryStatus: "sent",
        at: hoursAgo(Math.max(1, startedHoursAgo - messageCount - 1)),
      });
    }

    const lastAt = hoursAgo(Math.max(1, startedHoursAgo - messageCount));
    conversationRows.push({
      id,
      companyId,
      reference: `C-${10_000 + index}`,
      customerId,
      channel: rng.weighted([["web_widget", 74], ["whatsapp", 11], ["email", 8], ["mobile_sdk", 5], ["api", 2]]),
      status: status as never,
      intent: intent as never,
      subject: SUBJECTS[intent] ?? "General enquiry",
      preview: opener.slice(0, 140),
      assignedUserId,
      messageCount: messageCount + (assignedUserId ? 1 : 0),
      unreadCount: status === "active" ? rng.int(0, 3) : 0,
      // No conversation is marked AI-resolved: nothing has been resolved by an
      // assistant, because there is no assistant yet.
      resolvedByAi: false,
      aiConfidence: "0",
      csatScore: status === "closed" && rng.bool(0.5) ? rng.int(3, 5) : null,
      firstResponseSeconds: assignedUserId ? rng.int(60, 3600) : null,
      lastMessageAt: lastAt,
      tags: rng.sample(["urgent", "vip", "repeat", "escalation", "bulk", "warranty"], rng.int(0, 2)),
      createdAt: hoursAgo(startedHoursAgo),
      updatedAt: lastAt,
    });
  }

  await tx.insert(schema.conversations).values(conversationRows);
  await tx.insert(schema.messages).values(messageRows);

  // ----- Leads -------------------------------------------------------------
  const leadRows: Array<typeof schema.leads.$inferInsert> = [];
  const leadAssignmentRows: Array<typeof schema.leadAssignmentEvents.$inferInsert> = [];
  const leadNoteRows: Array<typeof schema.leadNotes.$inferInsert> = [];
  const leadProductRows: Array<typeof schema.leadProducts.$inferInsert> = [];

  for (let index = 0; index < 90; index += 1) {
    const id = `lead_${String(index + 1).padStart(4, "0")}`;
    const status = rng.weighted<string>([["new", 24], ["contacted", 22], ["qualified", 19], ["proposal", 13], ["won", 12], ["lost", 10]]);
    // New leads are often unassigned on purpose — that queue is what the Leads
    // page exists to work through.
    const assigned = status === "new" ? rng.bool(0.42) : true;
    const ownerId = assigned ? rng.pick(salesUserIds.filter((userId) => userId !== "usr_zara")) : null;
    const createdDaysAgo = rng.int(0, 120);

    leadRows.push({
      id,
      companyId,
      reference: `L-${4200 + index}`,
      customerId: rng.pick(customerIds),
      interest: rng.pick(LEAD_INTERESTS),
      status: status as never,
      priority: rng.weighted([["medium", 40], ["high", 27], ["low", 22], ["urgent", 11]]),
      source: rng.weighted([["website", 34], ["manual", 33], ["import", 18], ["api", 15]]),
      assignedUserId: ownerId,
      estimatedValueUsd: rng.bool(0.72) ? String(rng.int(400, 48_000)) : null,
      score: status === "won" ? rng.int(78, 98) : status === "lost" ? rng.int(8, 44) : rng.int(20, 92),
      qualificationAnswers: [
        { question: "What quantity do you need?", answer: rng.pick(["50–100 units", "150 units", "250+ units", "Not sure yet"]) },
        { question: "When do you need it by?", answer: rng.pick(["Within 2 weeks", "Next month", "This quarter"]) },
      ],
      lastActivityAt: hoursAgo(rng.int(1, Math.max(2, createdDaysAgo * 24))),
      nextFollowUpAt: status === "won" || status === "lost" ? null : rng.bool(0.62) ? daysAhead(rng.int(-4, 14)) : null,
      tags: rng.sample(["bulk", "enterprise", "referral", "renewal", "inbound"], rng.int(0, 2)),
      lostReason: status === "lost" ? rng.pick(["Price too high", "Went with a competitor", "No budget this cycle", "No response"]) : null,
      createdAt: daysAgo(createdDaysAgo),
    });

    for (const productId of rng.sample(productIds, rng.int(0, 2))) {
      leadProductRows.push({ leadId: id, productId });
    }

    if (ownerId) {
      const ownerName = userDefinitions.find((user) => user.id === ownerId)!.name;
      leadAssignmentRows.push({
        id: `lah_${index}_1`,
        leadId: id,
        companyId,
        toUserId: ownerId,
        toUserName: ownerName,
        byUserId: "usr_tom",
        byUserName: "Thomas Brennan",
        method: "manual",
        at: daysAgo(createdDaysAgo),
      });
    }

    if (rng.bool(0.42)) {
      const authorId = ownerId ?? rng.pick(salesUserIds);
      leadNoteRows.push({
        id: `lnote_${index}_1`,
        leadId: id,
        companyId,
        authorId,
        authorName: userDefinitions.find((user) => user.id === authorId)?.name ?? "Sales",
        body: rng.pick([
          "Left a voicemail; trying again tomorrow morning.",
          "Wants pricing for 250 units, not 150 — asked finance for the tier-2 sheet.",
          "Procurement sign-off expected next week. Following up Tuesday.",
          "Budget confirmed. Sending the proposal today.",
        ]),
        at: hoursAgo(rng.int(2, Math.max(3, createdDaysAgo * 24))),
      });
    }
  }

  await tx.insert(schema.leads).values(leadRows);
  if (leadProductRows.length > 0) await tx.insert(schema.leadProducts).values(leadProductRows);
  if (leadAssignmentRows.length > 0) await tx.insert(schema.leadAssignmentEvents).values(leadAssignmentRows);
  if (leadNoteRows.length > 0) await tx.insert(schema.leadNotes).values(leadNoteRows);

  // ----- Tickets -----------------------------------------------------------
  const ticketRows: Array<typeof schema.tickets.$inferInsert> = [];
  const timelineRows: Array<typeof schema.ticketTimelineEvents.$inferInsert> = [];
  const ticketAssignmentRows: Array<typeof schema.ticketAssignmentEvents.$inferInsert> = [];
  const activeSupportIds = supportUserIds.filter((userId) => userId !== "usr_lucas");

  for (let index = 0; index < 80; index += 1) {
    const id = `tkt_${String(index + 1).padStart(4, "0")}`;
    const scenario = TICKET_SCENARIOS[index % TICKET_SCENARIOS.length];
    const status = rng.weighted<string>([
      ["resolved", 27], ["open", 18], ["in_progress", 17], ["closed", 15], ["assigned", 13], ["waiting", 10],
    ]);
    const agentId = status === "open" ? null : rng.pick(activeSupportIds);
    const agentName = agentId ? userDefinitions.find((user) => user.id === agentId)!.name : null;
    const createdHoursAgo = rng.int(1, 24 * 90);
    const priority = rng.weighted<"low" | "medium" | "high" | "urgent">([["medium", 38], ["high", 28], ["low", 22], ["urgent", 12]]);
    const slaHours = { urgent: 4, high: 8, medium: 24, low: 72 }[priority];
    const resolved = status === "resolved" || status === "closed";
    const customerId = rng.pick(customerIds);

    ticketRows.push({
      id,
      companyId,
      reference: `#${10_240 + index}`,
      subject: scenario.subject,
      description: scenario.description,
      customerId,
      category: scenario.category,
      priority,
      status: status as never,
      assignedUserId: agentId,
      teamId: agentId ? "team_support_nw" : null,
      orderReference: rng.bool(0.7) ? `#${rng.int(48_200, 49_400)}` : null,
      // Filed by a person or through the widget's form — never by an assistant.
      createdByAi: false,
      slaDueAt: new Date(Date.now() - (createdHoursAgo - slaHours) * 3_600_000),
      firstResponseAt: agentId ? hoursAgo(createdHoursAgo - rng.int(1, 3)) : null,
      resolvedAt: resolved ? hoursAgo(rng.int(1, Math.max(2, createdHoursAgo - 1))) : null,
      reopenCount: rng.weighted([[0, 84], [1, 12], [2, 4]]),
      tags: rng.sample(["vip", "repeat-issue", "courier", "warranty", "billing"], rng.int(0, 2)),
      csatScore: resolved && rng.bool(0.58) ? rng.int(2, 5) : null,
      createdAt: hoursAgo(createdHoursAgo),
    });

    const customerName = customerRows.find((customer) => customer.id === customerId)?.name ?? "Customer";

    timelineRows.push({
      id: `tev_${index}_1`,
      ticketId: id,
      companyId,
      kind: "customer_message",
      actorId: null,
      actorName: customerName,
      actorType: "customer",
      body: scenario.customerMessage,
      at: hoursAgo(createdHoursAgo),
    });

    timelineRows.push({
      id: `tev_${index}_2`,
      ticketId: id,
      companyId,
      kind: "created",
      actorId: null,
      actorName: "Chat widget",
      actorType: "system",
      body: "Ticket created from the chat widget.",
      at: hoursAgo(createdHoursAgo),
    });

    if (agentId && agentName) {
      ticketAssignmentRows.push({
        id: `tah_${index}_1`,
        ticketId: id,
        companyId,
        toUserId: agentId,
        toUserName: agentName,
        byUserId: "usr_priya",
        byUserName: "Priya Sharma",
        at: hoursAgo(createdHoursAgo - 0.5),
      });

      timelineRows.push({
        id: `tev_${index}_3`,
        ticketId: id,
        companyId,
        kind: "assigned",
        actorId: "usr_priya",
        actorName: "Priya Sharma",
        actorType: "agent",
        body: `Assigned to ${agentName}.`,
        at: hoursAgo(createdHoursAgo - 0.5),
      });

      timelineRows.push({
        id: `tev_${index}_4`,
        ticketId: id,
        companyId,
        kind: "agent_reply",
        actorId: agentId,
        actorName: agentName,
        actorType: "agent",
        body: scenario.agentReply,
        at: hoursAgo(Math.max(1, createdHoursAgo - rng.int(1, 4))),
      });

      if (rng.bool(0.4)) {
        timelineRows.push({
          id: `tev_${index}_5`,
          ticketId: id,
          companyId,
          kind: "internal_note",
          actorId: agentId,
          actorName: agentName,
          actorType: "agent",
          body: scenario.internalNote,
          isInternal: true,
          at: hoursAgo(Math.max(1, createdHoursAgo - rng.int(1, 5))),
        });
      }

      if (resolved) {
        timelineRows.push({
          id: `tev_${index}_6`,
          ticketId: id,
          companyId,
          kind: "resolved",
          actorId: agentId,
          actorName: agentName,
          actorType: "agent",
          body: scenario.resolution,
          at: hoursAgo(Math.max(1, rng.int(1, Math.max(2, createdHoursAgo - 1)))),
        });
      }
    }
  }

  await tx.insert(schema.tickets).values(ticketRows);
  await tx.insert(schema.ticketTimelineEvents).values(timelineRows);
  if (ticketAssignmentRows.length > 0) await tx.insert(schema.ticketAssignmentEvents).values(ticketAssignmentRows);

  // ----- FAQ ---------------------------------------------------------------
  const faqSetIds = await seedFAQ(tx, companyId, rng);

  // ----- Knowledge ---------------------------------------------------------
  const collectionIds = await seedKnowledge(tx, companyId);

  // ----- Chatbot config ----------------------------------------------------
  await seedChatbotConfig(tx, companyId, embedKey, domain, faqSetIds, collectionIds);

  // ----- Wizard ------------------------------------------------------------
  const steps = defaultSteps().map((step, index) => {
    if (index < 5) return { ...step, status: "complete" as const, completedAt: daysAgo(14 - index).toISOString() };
    if (index === 5) return { ...step, status: "skipped" as const, completedAt: null };
    if (index === 6) return { ...step, status: "in_progress" as const, completedAt: null };
    return step;
  });

  await tx.insert(schema.wizardStates).values({
    companyId,
    currentStepKey: "leads",
    steps,
    startedAt: daysAgo(16),
    lastSavedAt: hoursAgo(3),
  });

  // ----- Notifications -----------------------------------------------------
  await tx.insert(schema.notifications).values([
    {
      id: "ntf_001",
      companyId,
      userId: "usr_meera",
      category: "assignment",
      severity: "info",
      title: "New lead assigned to you",
      body: "L-4231 — bulk order pricing for 200+ units. Follow-up due tomorrow.",
      read: false,
      href: "/company/leads",
      actorName: "Priya Sharma",
      at: minutesAgo(4),
    },
    {
      id: "ntf_002",
      companyId,
      userId: "usr_meera",
      category: "ticket",
      severity: "warning",
      title: "Ticket requires attention",
      body: "An urgent ticket is past its 4-hour SLA and still unassigned.",
      read: false,
      href: "/company/tickets",
      at: minutesAgo(22),
    },
    {
      id: "ntf_003",
      companyId,
      userId: "usr_meera",
      category: "conversation",
      severity: "warning",
      title: "Conversation escalated",
      body: "A customer asked for a human after two unresolved turns about a duplicate charge.",
      read: false,
      href: "/company/conversations",
      at: minutesAgo(41),
    },
    {
      id: "ntf_004",
      companyId,
      userId: "usr_meera",
      category: "knowledge",
      severity: "info",
      title: "Documents awaiting processing",
      body: "Uploaded documents are stored but not yet indexed — the processing pipeline is not installed on this deployment.",
      read: false,
      href: "/company/knowledge-base",
      at: hoursAgo(2),
    },
    {
      id: "ntf_005",
      companyId,
      userId: "usr_meera",
      category: "billing",
      severity: "info",
      title: "Billing period starts",
      body: "A new billing period has begun for this workspace.",
      read: true,
      href: "/company/settings",
      at: daysAgo(2),
    },
  ]);

  // ----- Activity ----------------------------------------------------------
  await tx.insert(schema.activityEvents).values([
    {
      id: newId("act"),
      companyId,
      actorId: "usr_meera",
      actorName: "Meera Krishnan",
      action: "company.created",
      summary: "Created the Northwind Retail workspace",
      targetType: "company",
      targetId: companyId,
      at: daysAgo(412),
    },
    {
      id: newId("act"),
      companyId,
      actorId: "usr_nina",
      actorName: "Nina Lindqvist",
      action: "knowledge.uploaded",
      summary: "Uploaded the customer policy pack",
      targetType: "knowledge_source",
      at: daysAgo(9),
    },
  ]);

  return { companyId, embedKey };
}

const SUBJECTS: Record<string, string> = {
  faq: "Question about policy",
  product_discovery: "Help choosing a product",
  order_status: "Where is my order",
  support_issue: "Problem with an order",
  lead_capture: "Bulk order enquiry",
  booking: "Booking a session",
  pricing: "Pricing question",
  complaint: "Complaint",
  small_talk: "General enquiry",
  unknown: "Unclassified enquiry",
};

interface FAQSeedNode {
  name: string;
  children?: FAQSeedNode[];
  questions?: Array<{ q: string; a: string; keywords: string[]; status?: "draft" | "published"; priority?: number }>;
}

async function seedFAQ(tx: Tx, companyId: string, rng: Rng): Promise<string[]> {
  const setDefinitions = [
    { id: "faqset_support_nw", name: "Customer Support", tree: "support", description: "Shipping, returns, refunds and order questions — the set the widget uses by default.", isDefault: true },
    { id: "faqset_sales_nw", name: "Sales", tree: "sales", description: "Wholesale, bulk pricing and corporate gifting enquiries.", isDefault: false },
    { id: "faqset_product_nw", name: "Product", tree: "product", description: "Sizing, materials and warranty questions about specific products.", isDefault: false },
  ];

  const categoryRows: Array<typeof schema.faqCategories.$inferInsert> = [];
  const questionRows: Array<typeof schema.faqs.$inferInsert> = [];

  for (const definition of setDefinitions) {
    await tx.insert(schema.faqSets).values({
      id: definition.id,
      companyId,
      name: definition.name,
      slug: slugify(definition.name),
      description: definition.description,
      status: "published",
      isDefault: definition.isDefault,
      createdAt: daysAgo(400),
    });

    const walk = (node: FAQSeedNode, parentId: string | null, depth: number, order: number): void => {
      const categoryId = `faqcat_${slugify(`${definition.id}-${node.name}-${depth}-${order}`)}`;
      categoryRows.push({
        id: categoryId,
        companyId,
        setId: definition.id,
        parentId,
        name: node.name,
        sortOrder: order,
        depth,
        status: "published",
        createdAt: daysAgo(400 - depth * 12 - order),
      });

      (node.questions ?? []).forEach((question, questionIndex) => {
        const status = question.status ?? "published";
        const matches = status === "published" ? rng.int(4, 480) : 0;
        questionRows.push({
          id: `faq_${slugify(question.q).slice(0, 42)}`,
          companyId,
          setId: definition.id,
          categoryId,
          question: question.q,
          answer: question.a,
          keywords: question.keywords,
          status,
          priority: question.priority ?? 5,
          sortOrder: questionIndex,
          matchCount30d: matches,
          helpfulCount: Math.round(matches * rng.float(0.3, 0.72)),
          notHelpfulCount: Math.round(matches * rng.float(0.01, 0.11)),
          lastMatchedAt: matches > 0 ? hoursAgo(rng.int(1, 240)) : null,
          createdAt: daysAgo(rng.int(60, 400)),
        });
      });

      (node.children ?? []).forEach((child, childIndex) => walk(child, categoryId, depth + 1, childIndex));
    };

    (FAQ_TREE[definition.tree as keyof typeof FAQ_TREE] as FAQSeedNode[]).forEach((node, index) => walk(node, null, 0, index));
  }

  await tx.insert(schema.faqCategories).values(categoryRows);
  await tx.insert(schema.faqs).values(questionRows);

  return setDefinitions.map((definition) => definition.id);
}

/**
 * Knowledge sources and documents.
 *
 * The demo's policy text is real prose and is stored as each document's
 * extracted content. A seed cannot write genuine PDF and Word binaries, so
 * there is no `storageKey` — but the *content* is there, which means these
 * documents index for real rather than standing as rows describing files that
 * do not exist.
 *
 * Everything lands in `pending`. No document is marked `ready`, no chunks are
 * created and no vector counts are set, because that work has not been done —
 * running the indexer is what does it, and the Knowledge Base screens show
 * exactly that state until then.
 */
async function seedKnowledge(tx: Tx, companyId: string): Promise<string[]> {
  const collections = [
    { id: "kbc_policies_nw", name: "Policies", description: "Customer-facing policy documents: returns, shipping, warranty.", availableToChatbot: true },
    { id: "kbc_products_nw", name: "Product Documentation", description: "Spec sheets, care guides and sizing charts for the catalogue.", availableToChatbot: true },
    { id: "kbc_sales_nw", name: "Sales Collateral", description: "Wholesale guide, pricing tiers and gifting brochure.", availableToChatbot: true },
    { id: "kbc_internal_nw", name: "Internal — HR & Ops", description: "Staff handbook and internal runbooks. Deliberately withheld from the chatbot.", availableToChatbot: false },
  ];

  await tx.insert(schema.knowledgeCollections).values(collections.map((collection) => ({ ...collection, companyId })));

  const sources = [
    { id: "kbs_policies_nw", collectionId: "kbc_policies_nw", name: "Customer policy pack", type: "pdf" as const, origin: "policy-pack-2026.pdf", documents: ["return-policy.pdf", "shipping-policy.pdf"] },
    { id: "kbs_warranty_nw", collectionId: "kbc_policies_nw", name: "Warranty terms", type: "docx" as const, origin: "warranty-terms.docx", documents: ["warranty-terms.docx"] },
    { id: "kbs_wholesale_nw", collectionId: "kbc_sales_nw", name: "Wholesale guide", type: "pdf" as const, origin: "wholesale-guide.pdf", documents: ["wholesale-guide.pdf"] },
    { id: "kbs_website_nw", collectionId: "kbc_policies_nw", name: "northwindretail.com", type: "website" as const, origin: "https://www.northwindretail.com", documents: [] },
    { id: "kbs_tone_nw", collectionId: "kbc_sales_nw", name: "Brand voice notes", type: "manual" as const, origin: "Written in the dashboard", documents: [] },
  ];

  const documentRows: Array<typeof schema.knowledgeDocuments.$inferInsert> = [];

  for (const source of sources) {
    await tx.insert(schema.knowledgeSources).values({
      id: source.id,
      companyId,
      collectionId: source.collectionId,
      name: source.name,
      type: source.type,
      // Pending, not ready: these files exist but nothing has processed them.
      status: "pending",
      origin: source.origin,
      sizeBytes: source.documents.reduce((sum, name) => sum + Buffer.byteLength(POLICY_DOCUMENTS[name] ?? ""), 0),
      enabled: source.collectionId !== "kbc_internal_nw",
      crawl:
        source.type === "website"
          ? { rootUrl: source.origin, maxDepth: 3, pagesDiscovered: 0, pagesIndexed: 0, refreshIntervalHours: 168, lastCrawlAt: null }
          : null,
      addedById: "usr_nina",
      addedByName: "Nina Lindqvist",
      createdAt: daysAgo(20),
    });

    const names = source.documents.length > 0 ? source.documents : [source.name];
    for (const name of names) {
      const text = POLICY_DOCUMENTS[name] ?? "";
      documentRows.push({
        id: `doc_${slugify(name).slice(0, 40)}`,
        companyId,
        sourceId: source.id,
        name,
        mimeType:
          source.type === "pdf" ? "application/pdf"
          : source.type === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : source.type === "website" ? "text/html"
          : "text/plain",
        sizeBytes: Buffer.byteLength(text),
        status: "pending",
        progress: 0,
        extractedText:
          source.type === "manual"
            ? "Write plainly. Acknowledge a problem before explaining the next step. Never promise a delivery date the shipping policy does not allow."
            : text,
        embeddingStatus: "pending",
        indexStatus: "pending",
        pipeline: [
          { stage: "upload", status: "ready", startedAt: daysAgo(20).toISOString(), finishedAt: daysAgo(20).toISOString(), detail: "File received and stored." },
          { stage: "extract", status: "pending", startedAt: null, finishedAt: null, detail: "Waiting for the processing pipeline." },
          { stage: "chunk", status: "pending", startedAt: null, finishedAt: null, detail: "Waiting for extraction." },
          { stage: "embed", status: "pending", startedAt: null, finishedAt: null, detail: "Waiting for chunking." },
          { stage: "index", status: "pending", startedAt: null, finishedAt: null, detail: "Waiting for embeddings." },
        ],
        createdAt: daysAgo(20),
      });
    }
  }

  await tx.insert(schema.knowledgeDocuments).values(documentRows);
  return collections.filter((collection) => collection.availableToChatbot).map((collection) => collection.id);
}

async function seedChatbotConfig(
  tx: Tx,
  companyId: string,
  embedKey: string,
  domain: string,
  faqSetIds: string[],
  collectionIds: string[],
): Promise<void> {
  const config = {
    identity: {
      botName: "Northwind Assistant",
      avatarUrl: null,
      avatarEmoji: "🧭",
      welcomeMessage: "Hi! I can help with orders, returns, sizing and finding the right product. What do you need?",
      inputPlaceholder: "Ask about an order, a product, or a return…",
      defaultLocale: "en-US",
      supportedLocales: ["en-US", "hi-IN"],
      tagline: "Usually replies instantly",
    },
    appearance: {
      theme: "auto" as const,
      primaryColor: "#2a78d6",
      position: "bottom-right" as const,
      launcherStyle: "pill" as const,
      launcherLabel: "Need help?",
      widthPx: 384,
      heightPx: 600,
      cornerRadiusPx: 16,
      showBranding: true,
      offsetXPx: 24,
      offsetYPx: 24,
    },
    behavior: {
      autoOpenDelayMs: 0,
      showQuickReplies: true,
      quickReplies: ["Track my order", "Return policy", "Find a product", "Talk to support"],
      persistConversation: true,
      requireEmailBeforeChat: false,
      offlineMessage: "Our team is offline right now. Leave your question and an email and we will reply first thing tomorrow.",
      respectBusinessHours: true,
      typingIndicator: true,
      allowFileUpload: true,
      allowConversationTranscript: true,
    },
    // Configuration for a layer that does not exist yet. Stored, served to the
    // editor, and read by nothing else.
    ai: {
      providerId: "prov_anthropic",
      model: "claude-sonnet-5",
      personality: "friendly" as const,
      responseStyle: "balanced" as const,
      creativity: 0.3,
      maxResponseWords: 120,
      allowedTopics: ["orders", "returns", "shipping", "products", "sizing", "warranty", "payments"],
      blockedTopics: ["competitor comparisons", "medical advice", "legal advice", "employee details"],
      fallbackResponse: "I do not have a confident answer for that. Would you like me to pass this to a colleague who can help?",
      systemPromptAddendum: "Always quote prices in Indian rupees. If a customer is upset, acknowledge it before explaining the next step.",
      knowledgeConfidenceThreshold: 0.65,
      citeSources: true,
      enabledTools: ["search_products", "create_lead", "create_ticket", "escalate_to_human"],
    },
    knowledge: { faqSetIds, collectionIds, preferFaqOverRag: true, maxChunksPerAnswer: 4 },
    leads: {
      enabled: true,
      fields: [
        { key: "name", label: "Name", required: true, enabled: true },
        { key: "email", label: "Email", required: true, enabled: true },
        { key: "phone", label: "Phone", required: false, enabled: true },
        { key: "company", label: "Company", required: false, enabled: false },
        { key: "product_interest", label: "Product interest", required: true, enabled: true },
        { key: "quantity", label: "Quantity", required: false, enabled: true },
      ],
      qualificationQuestions: ["What quantity do you need?", "When do you need it by?", "Is this for a business or personal use?"],
      defaultStatus: "new",
      defaultAssigneeId: null,
      assignmentStrategy: "round_robin" as const,
      notifyAssignee: true,
    },
    tickets: {
      enabled: true,
      defaultCategory: "order_issue",
      defaultPriority: "medium",
      assignmentStrategy: "team" as const,
      defaultTeamId: "team_support_nw",
      requiredFields: [
        { key: "order_reference", label: "Order reference", required: true },
        { key: "description", label: "What went wrong", required: true },
      ],
      confirmBeforeCreate: true,
    },
    handoff: {
      enabled: true,
      triggers: ["customer_request", "ai_uncertainty", "specific_issue"] as Array<"customer_request" | "ai_uncertainty" | "specific_issue">,
      uncertaintyThreshold: 0.65,
      escalationCategories: ["complaint", "billing", "product_defect"],
      defaultTeamId: "team_support_nw",
      assignmentStrategy: "round_robin" as const,
      outsideHoursMessage: "Our team works 9 am–6 pm IST, Monday to Saturday. Leave your question and we will reply when we are back.",
      queueMessage: "Connecting you to a colleague — you are next in the queue.",
    },
  };

  await tx.insert(schema.chatbotConfigs).values({
    id: "cbc_northwind",
    companyId,
    status: "published",
    version: 1,
    publishedAt: daysAgo(6),
    publishedById: "usr_meera",
    publishedByName: "Meera Krishnan",
    // There are staged edits to publish, which is what the Chatbot page's
    // primary call to action depends on.
    hasUnpublishedChanges: true,
    ...config,
    publishedConfig: config,
    embedKey,
    allowedDomains: [domain, `www.${domain}`, `shop.${domain}`],
    verifiedDomains: [domain, `www.${domain}`],
    lastPingAt: null,
    createdAt: daysAgo(400),
  });

  await tx.insert(schema.chatbotConfigVersions).values({
    id: newId("cbv"),
    companyId,
    version: 1,
    config,
    publishedById: "usr_meera",
    publishedByName: "Meera Krishnan",
    publishedAt: daysAgo(6),
  });
}

/**
 * Thinner tenants.
 *
 * These exist so the super-admin directory has something real to page through
 * and, more importantly, so multi-tenant isolation is genuinely exercised: a
 * missing `company_id` predicate is invisible against a single-tenant dataset.
 */
async function seedOtherCompanies(tx: Tx, rng: Rng, passwordHash: string): Promise<void> {
  const names = [
    "Lumen Health", "Atlas Logistics", "Verdant Foods", "Kestrel Finance", "Solstice Travel",
    "Ironbark Tools", "Meridian Learning", "Cobalt Telecom", "Harborview Realty", "Quartz Analytics",
    "Juniper Apparel", "Beacon Insurance", "Nimbus Cloud", "Terra Outdoors", "Halcyon Hotels",
  ];

  for (const [index, name] of names.entries()) {
    const slug = slugify(name);
    const companyId = `cmp_${slug.replace(/-/g, "_")}`;
    const domain = `${slug.replace(/-/g, "")}.com`;
    const country = rng.pick(COUNTRIES);
    const status = rng.weighted<"active" | "trial" | "onboarding" | "suspended" | "archived">([
      ["active", 62], ["trial", 16], ["onboarding", 11], ["suspended", 6], ["archived", 5],
    ]);
    const plan = rng.weighted<"starter" | "growth" | "scale" | "enterprise">([
      ["starter", 34], ["growth", 38], ["scale", 20], ["enterprise", 8],
    ]);

    await tx.insert(schema.companies).values({
      id: companyId,
      name,
      slug,
      website: `https://www.${domain}`,
      industry: rng.pick(["E-commerce", "SaaS", "Financial Services", "Healthcare", "Logistics", "Travel & Hospitality"]),
      country: country.name,
      timezone: country.timezone,
      status,
      plan,
      primaryContactName: `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`,
      primaryContactEmail: `ops@${domain}`,
      onboardingProgress: status === "onboarding" ? rng.int(15, 75) : 100,
      createdAt: daysAgo(rng.int(12, 900)),
    });

    const quota = { starter: 5_000, growth: 25_000, scale: 120_000, enterprise: 500_000 }[plan];
    await tx.insert(schema.companyUsage).values({
      companyId,
      aiRequestQuota: quota,
      conversationQuota: quota / 5,
      seatQuota: { starter: 5, growth: 20, scale: 75, enterprise: 400 }[plan],
    });

    await tx.insert(schema.companySettings).values({
      companyId,
      supportEmail: `support@${domain}`,
      businessHours: {
        timezone: country.timezone,
        days: Object.fromEntries(
          ["1", "2", "3", "4", "5", "6", "7"].map((day) => [
            day,
            { open: day !== "7", from: "09:00", to: "18:00" },
          ]),
        ),
      },
    });

    const adminRoleId = `role_admin_${slug}`;
    await tx.insert(schema.roles).values([
      { id: adminRoleId, companyId, slug: "company_admin", name: "Company Admin", description: "Full access to the workspace.", isSystem: true, permissions: ALL_PERMISSION_KEYS },
      { id: `role_support_${slug}`, companyId, slug: "support", name: "Support", description: "Handles conversations and tickets.", isSystem: true, permissions: ROLE_PRESETS.support },
      { id: `role_viewer_${slug}`, companyId, slug: "viewer", name: "Viewer", description: "Read-only access.", isSystem: true, permissions: ROLE_PRESETS.viewer },
    ]);

    const userCount = rng.int(2, 6);
    await tx.insert(schema.users).values(
      Array.from({ length: userCount }, (_, userIndex) => {
        const first = rng.pick(FIRST_NAMES);
        const last = rng.pick(LAST_NAMES);
        return {
          id: `usr_${slug}_${userIndex}`,
          companyId,
          name: `${first} ${last}`,
          email: `${first.toLowerCase()}.${last.toLowerCase()}@${domain}`,
          passwordHash,
          platformRole: "company_user" as const,
          roleId: userIndex === 0 ? adminRoleId : `role_support_${slug}`,
          status: "active" as const,
          timezone: country.timezone,
          lastActiveAt: hoursAgo(rng.int(1, 700)),
          createdAt: daysAgo(rng.int(5, 700)),
        };
      }),
    );

    // A minimal chatbot config per tenant, so the widget endpoint has a valid
    // key for more than one company to test isolation against.
    await tx.insert(schema.chatbotConfigs).values({
      id: `cbc_${slug}`,
      companyId,
      status: "draft",
      version: 1,
      hasUnpublishedChanges: true,
      identity: {
        botName: `${name} Assistant`, avatarUrl: null, avatarEmoji: "💬",
        welcomeMessage: "Hi! How can we help?", inputPlaceholder: "Type your question…",
        defaultLocale: "en-US", supportedLocales: ["en-US"], tagline: "We usually reply quickly",
      },
      appearance: {
        theme: "auto", primaryColor: "#2a78d6", position: "bottom-right", launcherStyle: "bubble",
        launcherLabel: "Chat", widthPx: 384, heightPx: 600, cornerRadiusPx: 16,
        showBranding: true, offsetXPx: 24, offsetYPx: 24,
      },
      behavior: {
        autoOpenDelayMs: 0, showQuickReplies: false, quickReplies: [], persistConversation: true,
        requireEmailBeforeChat: false, offlineMessage: "We are offline right now.", respectBusinessHours: true,
        typingIndicator: true, allowFileUpload: false, allowConversationTranscript: false,
      },
      ai: {
        providerId: "prov_anthropic", model: "claude-sonnet-5", personality: "professional",
        responseStyle: "balanced", creativity: 0.3, maxResponseWords: 120, allowedTopics: [],
        blockedTopics: [], fallbackResponse: "Let me pass you to a colleague.", systemPromptAddendum: "",
        knowledgeConfidenceThreshold: 0.65, citeSources: true, enabledTools: [],
      },
      knowledge: { faqSetIds: [], collectionIds: [], preferFaqOverRag: true, maxChunksPerAnswer: 4 },
      leads: { enabled: false, fields: [], qualificationQuestions: [], defaultStatus: "new", defaultAssigneeId: null, assignmentStrategy: "manual", notifyAssignee: false },
      tickets: { enabled: false, defaultCategory: "other", defaultPriority: "medium", assignmentStrategy: "manual", defaultTeamId: null, requiredFields: [], confirmBeforeCreate: true },
      handoff: { enabled: true, triggers: ["customer_request"], uncertaintyThreshold: 0.65, escalationCategories: [], defaultTeamId: null, assignmentStrategy: "manual", outsideHoursMessage: "We are closed.", queueMessage: "Connecting you…" },
      embedKey: newEmbedKey(),
      allowedDomains: [domain],
    });

    await tx.insert(schema.wizardStates).values({
      companyId,
      currentStepKey: "company",
      steps: defaultSteps(),
    });
  }
}

main()
  .then(closePool)
  .catch(async (error: Error) => {
    logger.error(`Seed failed: ${error.message}`, { stack: error.stack });
    await closePool();
    process.exit(1);
  });
