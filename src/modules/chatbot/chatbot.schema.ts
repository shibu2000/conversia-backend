import { z } from "zod";

const assignmentStrategy = z.enum(["manual", "round_robin", "team", "rule_based"]);

export const identitySchema = z.object({
  botName: z.string().trim().min(1).max(80),
  avatarUrl: z.string().trim().url().max(500).nullable(),
  avatarEmoji: z.string().trim().max(8),
  welcomeMessage: z.string().trim().max(1000),
  inputPlaceholder: z.string().trim().max(200),
  defaultLocale: z.string().trim().max(16),
  supportedLocales: z.array(z.string().max(16)).max(30),
  tagline: z.string().trim().max(200),
});

export const appearanceSchema = z.object({
  theme: z.enum(["light", "dark", "auto"]),
  // Validated as a hex colour: this value is interpolated into the widget's
  // styles, so anything else is a CSS injection vector.
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour such as #2a78d6."),
  position: z.enum(["bottom-right", "bottom-left", "bottom-center"]),
  launcherStyle: z.enum(["bubble", "pill", "bar"]),
  launcherLabel: z.string().trim().max(60),
  widthPx: z.number().int().min(280).max(720),
  heightPx: z.number().int().min(320).max(900),
  cornerRadiusPx: z.number().int().min(0).max(48),
  showBranding: z.boolean(),
  offsetXPx: z.number().int().min(0).max(200),
  offsetYPx: z.number().int().min(0).max(200),
});

export const behaviorSchema = z.object({
  autoOpenDelayMs: z.number().int().min(0).max(600_000),
  showQuickReplies: z.boolean(),
  quickReplies: z.array(z.string().trim().max(120)).max(10),
  persistConversation: z.boolean(),
  requireEmailBeforeChat: z.boolean(),
  offlineMessage: z.string().trim().max(1000),
  respectBusinessHours: z.boolean(),
  typingIndicator: z.boolean(),
  allowFileUpload: z.boolean(),
  allowConversationTranscript: z.boolean(),
});

/** Stored and served as configuration. Nothing here calls a model. */
export const aiConfigSchema = z.object({
  providerId: z.string().max(64),
  model: z.string().max(120),
  personality: z.enum(["professional", "friendly", "enthusiastic", "formal"]),
  responseStyle: z.enum(["concise", "balanced", "detailed"]),
  creativity: z.number().min(0).max(1),
  maxResponseWords: z.number().int().min(20).max(2000),
  allowedTopics: z.array(z.string().trim().max(80)).max(50),
  blockedTopics: z.array(z.string().trim().max(80)).max(50),
  fallbackResponse: z.string().trim().max(1000),
  systemPromptAddendum: z.string().trim().max(4000),
  knowledgeConfidenceThreshold: z.number().min(0).max(1),
  citeSources: z.boolean(),
  enabledTools: z
    .array(
      z.enum([
        "search_products",
        "lookup_order",
        "create_lead",
        "create_ticket",
        "book_appointment",
        "check_availability",
        "escalate_to_human",
      ]),
    )
    .max(20),
});

export const knowledgeConfigSchema = z.object({
  faqSetIds: z.array(z.string().max(64)).max(50),
  collectionIds: z.array(z.string().max(64)).max(50),
  preferFaqOverRag: z.boolean(),
  maxChunksPerAnswer: z.number().int().min(1).max(20),
});

export const leadsConfigSchema = z.object({
  enabled: z.boolean(),
  fields: z
    .array(z.object({ key: z.string().max(40), label: z.string().max(80), required: z.boolean(), enabled: z.boolean() }))
    .max(30),
  qualificationQuestions: z.array(z.string().trim().max(300)).max(20),
  defaultStatus: z.string().max(40),
  defaultAssigneeId: z.string().max(64).nullable(),
  assignmentStrategy,
  notifyAssignee: z.boolean(),
});

export const ticketsConfigSchema = z.object({
  enabled: z.boolean(),
  defaultCategory: z.string().max(40),
  defaultPriority: z.string().max(20),
  assignmentStrategy,
  defaultTeamId: z.string().max(64).nullable(),
  requiredFields: z.array(z.object({ key: z.string().max(40), label: z.string().max(80), required: z.boolean() })).max(30),
  confirmBeforeCreate: z.boolean(),
});

export const handoffConfigSchema = z.object({
  enabled: z.boolean(),
  triggers: z.array(z.enum(["customer_request", "ai_uncertainty", "specific_issue", "always"])).max(10),
  uncertaintyThreshold: z.number().min(0).max(1),
  escalationCategories: z.array(z.string().trim().max(60)).max(30),
  defaultTeamId: z.string().max(64).nullable(),
  assignmentStrategy,
  outsideHoursMessage: z.string().trim().max(1000),
  queueMessage: z.string().trim().max(1000),
});

/** Every section is optional — the editor saves one tab at a time. */
export const updateChatbotConfigSchema = z.object({
  identity: identitySchema.partial().optional(),
  appearance: appearanceSchema.partial().optional(),
  behavior: behaviorSchema.partial().optional(),
  ai: aiConfigSchema.partial().optional(),
  knowledge: knowledgeConfigSchema.partial().optional(),
  leads: leadsConfigSchema.partial().optional(),
  tickets: ticketsConfigSchema.partial().optional(),
  handoff: handoffConfigSchema.partial().optional(),
});

export const addDomainSchema = z.object({
  domain: z.string().trim().min(1, "Enter a domain.").max(253),
});

export type UpdateChatbotConfigInput = z.infer<typeof updateChatbotConfigSchema>;
