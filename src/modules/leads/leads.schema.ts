import { z } from "zod";

export const createLeadSchema = z.object({
  customerId: z.string().min(1, "Choose a customer.").max(64),
  interest: z.string().trim().min(1, "Describe what the customer wants.").max(2000),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  assignedUserId: z.string().max(64).nullish(),
  estimatedValueUsd: z.number().min(0).max(1_000_000_000).nullish(),
  productIds: z.array(z.string().max(64)).max(50).default([]),
  tags: z.array(z.string().trim().max(40)).max(20).default([]),
  nextFollowUpAt: z.string().datetime().nullish(),
});

export const updateLeadSchema = z.object({
  interest: z.string().trim().min(1).max(2000).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  estimatedValueUsd: z.number().min(0).max(1_000_000_000).nullish(),
  score: z.number().int().min(0).max(100).optional(),
  nextFollowUpAt: z.string().datetime().nullish(),
  tags: z.array(z.string().trim().max(40)).max(20).optional(),
  productIds: z.array(z.string().max(64)).max(50).optional(),
});

/** `lostReason` is required when moving to `lost` — see the service. */
export const setLeadStatusSchema = z.object({
  status: z.enum(["new", "contacted", "qualified", "proposal", "won", "lost"]),
  lostReason: z.string().trim().max(500).optional(),
});

export const assignLeadSchema = z.object({
  userId: z.string().max(64).nullable(),
  method: z.enum(["manual", "auto", "round_robin", "rule"]).default("manual"),
  reason: z.string().trim().max(300).optional(),
});

export const addLeadNoteSchema = z.object({
  body: z.string().trim().min(1, "Write a note.").max(4000),
});

export type CreateLeadInput = z.infer<typeof createLeadSchema>;
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;
