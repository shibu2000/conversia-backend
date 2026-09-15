import { z } from "zod";

export const conversationViewSchema = z.enum([
  "all",
  "active",
  "unassigned",
  "assigned_to_me",
  "ai_resolved",
  "human_handoff",
  "leads",
  "tickets",
]);

export const sendMessageSchema = z.object({
  body: z.string().trim().min(1, "Write a message.").max(10_000),
  /** Internal notes are visible to the team, never to the customer. */
  isInternal: z.boolean().default(false),
});

export const updateConversationSchema = z.object({
  status: z
    .enum(["active", "waiting_on_customer", "ai_resolved", "human_handoff", "escalated", "closed", "abandoned"])
    .optional(),
  intent: z
    .enum([
      "faq",
      "product_discovery",
      "order_status",
      "support_issue",
      "lead_capture",
      "booking",
      "pricing",
      "complaint",
      "small_talk",
      "unknown",
    ])
    .optional(),
  subject: z.string().trim().max(200).optional(),
  tags: z.array(z.string().trim().max(40)).max(20).optional(),
  csatScore: z.number().int().min(1).max(5).nullish(),
});

/** `null` unassigns; a string must name a user in the same company. */
export const assignConversationSchema = z.object({
  userId: z.string().max(64).nullable(),
});

export type ConversationView = z.infer<typeof conversationViewSchema>;
