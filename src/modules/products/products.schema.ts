import { z } from "zod";

const aiMetadataSchema = z.object({
  keywords: z.array(z.string().trim().max(60)).max(50).optional(),
  useCases: z.array(z.string().trim().max(60)).max(50).optional(),
  audience: z.array(z.string().trim().max(60)).max(50).optional(),
  talkingPoints: z.array(z.string().trim().max(300)).max(20).optional(),
  /** Excluded from AI recommendations when false. */
  includeInRecommendations: z.boolean().optional(),
});

export const createProductSchema = z.object({
  name: z.string().trim().min(1, "Name the product.").max(200),
  sku: z.string().trim().min(1, "Enter a SKU.").max(64),
  categoryId: z.string().min(1, "Choose a category.").max(64),
  priceUsd: z.number().min(0).max(10_000_000),
  shortDescription: z.string().trim().max(500).optional(),
  description: z.string().trim().max(20_000).optional(),
});

export const updateProductSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  sku: z.string().trim().min(1).max(64).optional(),
  categoryId: z.string().max(64).optional(),
  status: z.enum(["active", "draft", "archived"]).optional(),
  shortDescription: z.string().trim().max(500).optional(),
  description: z.string().trim().max(20_000).optional(),
  priceUsd: z.number().min(0).max(10_000_000).optional(),
  compareAtPriceUsd: z.number().min(0).max(10_000_000).nullish(),
  currency: z.string().trim().length(3).optional(),
  inventoryStatus: z.enum(["in_stock", "low_stock", "out_of_stock", "preorder", "discontinued"]).optional(),
  stockQty: z.number().int().min(0).max(10_000_000).optional(),
  lowStockThreshold: z.number().int().min(0).max(100_000).optional(),
  url: z.string().trim().url().max(500).nullish(),
  images: z
    .array(
      z.object({
        id: z.string().max(64),
        url: z.string().max(1000),
        alt: z.string().max(300),
        isPrimary: z.boolean(),
      }),
    )
    .max(20)
    .optional(),
  attributes: z.array(z.object({ name: z.string().max(80), value: z.string().max(300) })).max(50).optional(),
  aiMetadata: aiMetadataSchema.optional(),
});

export const createProductCategorySchema = z.object({
  name: z.string().trim().min(1).max(120),
  parentId: z.string().max(64).nullish(),
  description: z.string().trim().max(500).optional(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
