import { z } from "zod";

const statusSchema = z.enum(["published", "draft", "disabled", "archived"]);

export const createFAQSetSchema = z.object({
  name: z.string().trim().min(1, "Name the set.").max(120),
  description: z.string().trim().max(500).default(""),
  locale: z.string().trim().max(16).default("en-US"),
});

export const updateFAQSetSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).optional(),
  status: statusSchema.optional(),
  isDefault: z.boolean().optional(),
  locale: z.string().trim().max(16).optional(),
});

export const createFAQCategorySchema = z.object({
  setId: z.string().min(1).max(64),
  parentId: z.string().max(64).nullish(),
  name: z.string().trim().min(1, "Name the category.").max(120),
  description: z.string().trim().max(500).default(""),
});

export const updateFAQCategorySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).optional(),
  status: statusSchema.optional(),
});

export const createFAQSchema = z.object({
  setId: z.string().min(1).max(64),
  categoryId: z.string().min(1, "Choose a category.").max(64),
  question: z.string().trim().min(1, "Write the question.").max(500),
  answer: z.string().trim().min(1, "Write the answer.").max(10_000),
  keywords: z.array(z.string().trim().max(60)).max(30).default([]),
  status: statusSchema.default("draft"),
  priority: z.number().int().min(0).max(10).default(5),
});

export const updateFAQSchema = z.object({
  question: z.string().trim().min(1).max(500).optional(),
  answer: z.string().trim().min(1).max(10_000).optional(),
  keywords: z.array(z.string().trim().max(60)).max(30).optional(),
  status: statusSchema.optional(),
  priority: z.number().int().min(0).max(10).optional(),
  categoryId: z.string().max(64).optional(),
});

/**
 * Reparent or reorder a node.
 *
 * `position` mirrors the tree's drop zones: dropping on the middle of a
 * category nests inside it, dropping near an edge orders it as a sibling.
 */
export const moveFAQNodeSchema = z.object({
  draggedId: z.string().min(1).max(64),
  targetId: z.string().min(1).max(64),
  position: z.enum(["inside", "before", "after"]),
});

export type CreateFAQInput = z.infer<typeof createFAQSchema>;
export type UpdateFAQInput = z.infer<typeof updateFAQSchema>;
