import { isoRequired, num, numOrNull } from "../../core/serialize";
import type { products } from "../../db/schema";

type ProductRow = typeof products.$inferSelect;

export function toProduct(row: ProductRow, categoryName: string | null) {
  return {
    id: row.id,
    companyId: row.companyId,
    sku: row.sku,
    name: row.name,
    slug: row.slug,
    shortDescription: row.shortDescription,
    description: row.description,
    categoryId: row.categoryId ?? "",
    categoryName: categoryName ?? "Uncategorised",
    status: row.status,
    priceUsd: num(row.priceUsd),
    compareAtPriceUsd: numOrNull(row.compareAtPriceUsd),
    currency: row.currency,
    inventoryStatus: row.inventoryStatus,
    stockQty: row.stockQty,
    lowStockThreshold: row.lowStockThreshold,
    images: row.images,
    attributes: row.attributes,
    rating: numOrNull(row.rating),
    reviewCount: row.reviewCount,
    url: row.url ?? undefined,
    // Flat columns in the database, nested in the API because that is how the
    // product form groups them.
    aiMetadata: {
      keywords: row.aiKeywords,
      useCases: row.aiUseCases,
      audience: row.aiAudience,
      includeInRecommendations: row.aiIncludeInRecommendations,
      talkingPoints: row.aiTalkingPoints,
    },
    leadCount: row.leadCount,
    conversationMentions: row.conversationMentions,
    createdAt: isoRequired(row.createdAt),
    updatedAt: isoRequired(row.updatedAt),
  };
}

export function toProductCategory(row: {
  id: string;
  companyId: string;
  name: string;
  slug: string;
  parentId: string | null;
  description: string;
}, productCount: number) {
  return {
    id: row.id,
    companyId: row.companyId,
    name: row.name,
    slug: row.slug,
    parentId: row.parentId,
    productCount: Number(productCount),
    description: row.description,
  };
}
