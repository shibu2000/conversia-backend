import { z } from "zod";

const categorySchema = z.enum([
  "order_issue",
  "delivery",
  "returns",
  "refund",
  "product_defect",
  "billing",
  "account",
  "technical",
  "other",
]);

const prioritySchema = z.enum(["low", "medium", "high", "urgent"]);

export const createTicketSchema = z.object({
  customerId: z.string().min(1, "Choose a customer.").max(64),
  subject: z.string().trim().min(1, "Enter a subject.").max(200),
  description: z.string().trim().min(1, "Describe the problem.").max(10_000),
  category: categorySchema.default("other"),
  priority: prioritySchema.default("medium"),
  assignedUserId: z.string().max(64).nullish(),
  teamId: z.string().max(64).nullish(),
  orderReference: z.string().trim().max(64).nullish(),
  tags: z.array(z.string().trim().max(40)).max(20).default([]),
});

export const updateTicketSchema = z.object({
  subject: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(10_000).optional(),
  category: categorySchema.optional(),
  priority: prioritySchema.optional(),
  status: z.enum(["open", "assigned", "in_progress", "waiting", "resolved", "closed"]).optional(),
  tags: z.array(z.string().trim().max(40)).max(20).optional(),
  csatScore: z.number().int().min(1).max(5).nullish(),
});

export const setTicketStatusSchema = z.object({
  status: z.enum(["open", "assigned", "in_progress", "waiting", "resolved", "closed"]),
});

export const assignTicketSchema = z.object({
  userId: z.string().max(64).nullable(),
  teamId: z.string().max(64).nullish(),
});

export const addTicketReplySchema = z.object({
  body: z.string().trim().min(1, "Write a reply.").max(10_000),
  isInternal: z.boolean().default(false),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;
