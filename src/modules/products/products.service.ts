import { and, asc, count, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "../../db";
import { productCategories, products } from "../../db/schema";
import { conflict, notFound, validationError } from "../../core/errors";
import { newId, slugify } from "../../core/ids";
import { correlatedCount } from "../../core/subquery";
import { likePattern, paginate, resolveOrderBy, type ListQuery, type Paginated } from "../../core/list-query";
import { toProduct, toProductCategory } from "./products.mapper";
import type { CreateProductInput, UpdateProductInput } from "./products.schema";

const SORT_COLUMNS = {
  name: products.name,
  sku: products.sku,
  price: products.priceUsd,
  stock: products.stockQty,
  category: productCategories.name,
  status: products.status,
  rating: products.rating,
  mentions: products.conversationMentions,
  updatedAt: products.updatedAt,
};

export async function listProducts(companyId: string, query: ListQuery): Promise<Paginated<ReturnType<typeof toProduct>>> {
  const conditions: SQL[] = [eq(products.companyId, companyId)];

  if (query.search) {
    const pattern = likePattern(query.search);
    conditions.push(
      or(
        ilike(products.name, pattern),
        ilike(products.sku, pattern),
        ilike(products.shortDescription, pattern),
        ilike(productCategories.name, pattern),
        // Array containment against the GIN index, so keyword search stays fast.
        sql`EXISTS (SELECT 1 FROM unnest(${products.aiKeywords}) AS keyword WHERE keyword ILIKE ${pattern})`,
      )!,
    );
  }
  if (query.filters.status) conditions.push(inArray(products.status, query.filters.status as never));
  if (query.filters.categoryId) conditions.push(inArray(products.categoryId, query.filters.categoryId));
  if (query.filters.inventoryStatus) conditions.push(inArray(products.inventoryStatus, query.filters.inventoryStatus as never));

  const where = and(...conditions);

  const [[total], rows] = await Promise.all([
    db
      .select({ value: count() })
      .from(products)
      .leftJoin(productCategories, eq(productCategories.id, products.categoryId))
      .where(where),
    db
      .select({ product: products, categoryName: productCategories.name })
      .from(products)
      .leftJoin(productCategories, eq(productCategories.id, products.categoryId))
      .where(where)
      .orderBy(resolveOrderBy(query, SORT_COLUMNS, "name"))
      .limit(query.pageSize)
      .offset(query.offset),
  ]);

  return paginate(rows.map((row) => toProduct(row.product, row.categoryName)), Number(total?.value ?? 0), query);
}

export async function getProduct(companyId: string, productId: string) {
  const [row] = await db
    .select({ product: products, categoryName: productCategories.name })
    .from(products)
    .leftJoin(productCategories, eq(productCategories.id, products.categoryId))
    .where(and(eq(products.id, productId), eq(products.companyId, companyId)))
    .limit(1);

  if (!row) throw notFound("Product", productId);
  return toProduct(row.product, row.categoryName);
}

export async function createProduct(companyId: string, input: CreateProductInput) {
  await assertCategory(companyId, input.categoryId);

  const [duplicate] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.companyId, companyId), sql`lower(${products.sku}) = ${input.sku.toLowerCase()}`))
    .limit(1);

  if (duplicate) {
    throw conflict("A product with that SKU already exists.", { sku: "This SKU is already in your catalogue." });
  }

  const id = newId("prd");
  await db.insert(products).values({
    id,
    companyId,
    sku: input.sku,
    name: input.name,
    slug: slugify(input.name),
    shortDescription: input.shortDescription ?? "",
    description: input.description ?? "",
    categoryId: input.categoryId,
    status: "draft",
    priceUsd: String(input.priceUsd),
    // A new product starts out of stock and excluded from recommendations:
    // opting a half-finished listing into the catalogue by default is how a
    // placeholder ends up quoted to a customer.
    inventoryStatus: "out_of_stock",
    aiIncludeInRecommendations: false,
  });

  return getProduct(companyId, id);
}

export async function updateProduct(companyId: string, productId: string, patch: UpdateProductInput) {
  if (patch.categoryId) await assertCategory(companyId, patch.categoryId);

  const { aiMetadata, priceUsd, compareAtPriceUsd, name, ...fields } = patch;

  const [updated] = await db
    .update(products)
    .set({
      ...fields,
      ...(name !== undefined ? { name, slug: slugify(name) } : {}),
      ...(priceUsd !== undefined ? { priceUsd: String(priceUsd) } : {}),
      ...(compareAtPriceUsd !== undefined
        ? { compareAtPriceUsd: compareAtPriceUsd === null ? null : String(compareAtPriceUsd) }
        : {}),
      ...(aiMetadata
        ? {
            ...(aiMetadata.keywords !== undefined ? { aiKeywords: aiMetadata.keywords } : {}),
            ...(aiMetadata.useCases !== undefined ? { aiUseCases: aiMetadata.useCases } : {}),
            ...(aiMetadata.audience !== undefined ? { aiAudience: aiMetadata.audience } : {}),
            ...(aiMetadata.talkingPoints !== undefined ? { aiTalkingPoints: aiMetadata.talkingPoints } : {}),
            ...(aiMetadata.includeInRecommendations !== undefined
              ? { aiIncludeInRecommendations: aiMetadata.includeInRecommendations }
              : {}),
          }
        : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(products.id, productId), eq(products.companyId, companyId)))
    .returning({ id: products.id });

  if (!updated) throw notFound("Product", productId);
  return getProduct(companyId, productId);
}

export async function deleteProduct(companyId: string, productId: string) {
  const [deleted] = await db
    .delete(products)
    .where(and(eq(products.id, productId), eq(products.companyId, companyId)))
    .returning({ id: products.id });

  if (!deleted) throw notFound("Product", productId);
}

export async function listCategories(companyId: string) {
  const rows = await db
    .select({
      category: productCategories,
      productCount: correlatedCount({ from: "products", as: "p", on: "p.category_id = product_categories.id" }),
    })
    .from(productCategories)
    .where(eq(productCategories.companyId, companyId))
    .orderBy(asc(productCategories.name));

  return rows.map((row) => toProductCategory(row.category, Number(row.productCount)));
}

export async function createCategory(
  companyId: string,
  input: { name: string; parentId?: string | null; description?: string },
) {
  if (input.parentId) await assertCategory(companyId, input.parentId);

  const id = newId("pcat");
  await db.insert(productCategories).values({
    id,
    companyId,
    name: input.name,
    slug: slugify(input.name),
    parentId: input.parentId ?? null,
    description: input.description ?? "",
  });

  const [created] = await db.select().from(productCategories).where(eq(productCategories.id, id)).limit(1);
  return toProductCategory(created!, 0);
}

/** A category id arrives from the client, so it is checked against this tenant. */
async function assertCategory(companyId: string, categoryId: string): Promise<void> {
  const [category] = await db
    .select({ id: productCategories.id })
    .from(productCategories)
    .where(and(eq(productCategories.id, categoryId), eq(productCategories.companyId, companyId)))
    .limit(1);

  if (!category) {
    throw validationError("That category is not in this workspace.", { categoryId: "Choose a category from your catalogue." });
  }
}
