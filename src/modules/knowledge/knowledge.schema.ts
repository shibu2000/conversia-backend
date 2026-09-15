import { z } from "zod";

export const createCollectionSchema = z.object({
  name: z.string().trim().min(1, "Name the collection.").max(120),
  description: z.string().trim().max(500).default(""),
  availableToChatbot: z.boolean().default(true),
});

export const updateCollectionSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).optional(),
  availableToChatbot: z.boolean().optional(),
});

/**
 * Creating a source.
 *
 * Three shapes share one endpoint because the dialog does: an upload (files
 * arrive as multipart), a website crawl, or content typed into the dashboard.
 */
export const createSourceSchema = z.object({
  name: z.string().trim().min(1, "Give this source a name.").max(200),
  type: z.enum(["pdf", "docx", "txt", "website", "manual", "csv"]),
  collectionId: z.string().min(1, "Choose a collection.").max(64),
  origin: z.string().trim().max(500).default(""),
  /** Present for `manual` sources: content written directly in the dashboard. */
  content: z.string().max(200_000).optional(),
  crawl: z
    .object({
      rootUrl: z.string().trim().url("Enter a full URL, including https://").max(500),
      maxDepth: z.coerce.number().int().min(1).max(5).default(3),
      // Zero is the dialog's "never — manual only", not a missing value.
      refreshIntervalHours: z.coerce.number().int().min(0).max(8760).default(168),
    })
    .optional(),
});

export const updateSourceSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  collectionId: z.string().max(64).optional(),
  enabled: z.boolean().optional(),
});

export const retrievalTestSchema = z.object({
  question: z.string().trim().min(1, "Ask a question.").max(1000),
  collectionIds: z.array(z.string().max(64)).max(50).optional(),
  threshold: z.number().min(0).max(1).optional(),
  maxChunks: z.number().int().min(1).max(20).optional(),
});

export type CreateSourceInput = z.infer<typeof createSourceSchema>;
