import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { db, type Transaction } from "../../db";
import { faqCategories, faqSets, faqs } from "../../db/schema";
import { notFound, validationError } from "../../core/errors";
import { newId, slugify } from "../../core/ids";
import { correlatedCount } from "../../core/subquery";
import { buildFAQTree, toFAQ, toFAQCategory, toFAQSet } from "./faqs.mapper";
import type { CreateFAQInput, UpdateFAQInput } from "./faqs.schema";

/** Counts recomputed from live rows, so an edit is reflected immediately. */
const categoryCount = correlatedCount({ from: "faq_categories", as: "c", on: "c.set_id = faq_sets.id" });
const questionCount = correlatedCount({ from: "faqs", as: "q", on: "q.set_id = faq_sets.id" });
const publishedCount = correlatedCount({ from: "faqs", as: "q", on: "q.set_id = faq_sets.id", and: "q.status = 'published'" });

export async function listSets(companyId: string) {
  const rows = await db
    .select({ set: faqSets, categoryCount, questionCount, publishedCount })
    .from(faqSets)
    .where(eq(faqSets.companyId, companyId))
    // The default set is the one the widget uses, so it leads the list.
    .orderBy(sql`${faqSets.isDefault} DESC`, asc(faqSets.name));

  return rows.map((row) =>
    toFAQSet(row.set, {
      categoryCount: Number(row.categoryCount),
      questionCount: Number(row.questionCount),
      publishedQuestionCount: Number(row.publishedCount),
    }),
  );
}

export async function getSet(companyId: string, setId: string) {
  const [row] = await db
    .select({ set: faqSets, categoryCount, questionCount, publishedCount })
    .from(faqSets)
    .where(and(eq(faqSets.id, setId), eq(faqSets.companyId, companyId)))
    .limit(1);

  if (!row) throw notFound("FAQ set", setId);

  return toFAQSet(row.set, {
    categoryCount: Number(row.categoryCount),
    questionCount: Number(row.questionCount),
    publishedQuestionCount: Number(row.publishedCount),
  });
}

export async function createSet(companyId: string, input: { name: string; description: string; locale: string }) {
  const id = newId("faqset");
  await db.insert(faqSets).values({
    id,
    companyId,
    name: input.name,
    slug: await uniqueSlug(companyId, slugify(input.name)),
    description: input.description,
    status: "draft",
    isDefault: false,
    locale: input.locale,
  });
  return getSet(companyId, id);
}

/**
 * Update a set.
 *
 * Marking one set as default clears the flag on the others in the same
 * transaction. A partial unique index enforces one default per company, so
 * doing this in two steps would transiently violate the constraint.
 */
export async function updateSet(companyId: string, setId: string, patch: Record<string, unknown>) {
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: faqSets.id })
      .from(faqSets)
      .where(and(eq(faqSets.id, setId), eq(faqSets.companyId, companyId)))
      .limit(1);
    if (!existing) throw notFound("FAQ set", setId);

    if (patch.isDefault === true) {
      await tx
        .update(faqSets)
        .set({ isDefault: false })
        .where(and(eq(faqSets.companyId, companyId), eq(faqSets.isDefault, true)));
    }

    await tx.update(faqSets).set({ ...patch, updatedAt: new Date() }).where(eq(faqSets.id, setId));
  });

  return getSet(companyId, setId);
}

/**
 * Delete a set and everything under it.
 *
 * The cascade is in the schema — an orphaned category or question is invisible
 * in the editor but would still be counted by the chatbot's knowledge selection.
 */
export async function deleteSet(companyId: string, setId: string) {
  const [deleted] = await db
    .delete(faqSets)
    .where(and(eq(faqSets.id, setId), eq(faqSets.companyId, companyId)))
    .returning({ id: faqSets.id });

  if (!deleted) throw notFound("FAQ set", setId);
}

export async function getTree(companyId: string, setId: string) {
  await getSet(companyId, setId);

  const [categories, questions] = await Promise.all([
    db.select().from(faqCategories).where(eq(faqCategories.setId, setId)).orderBy(asc(faqCategories.sortOrder)),
    db.select().from(faqs).where(eq(faqs.setId, setId)).orderBy(asc(faqs.sortOrder)),
  ]);

  return buildFAQTree(categories, questions);
}

export async function listQuestions(companyId: string, setId: string, categoryId?: string) {
  await getSet(companyId, setId);

  const conditions = [eq(faqs.setId, setId), eq(faqs.companyId, companyId)];
  if (categoryId) conditions.push(eq(faqs.categoryId, categoryId));

  const rows = await db.select().from(faqs).where(and(...conditions)).orderBy(asc(faqs.sortOrder));
  return rows.map(toFAQ);
}

export async function getQuestion(companyId: string, faqId: string) {
  const [row] = await db
    .select()
    .from(faqs)
    .where(and(eq(faqs.id, faqId), eq(faqs.companyId, companyId)))
    .limit(1);

  if (!row) throw notFound("FAQ", faqId);
  return toFAQ(row);
}

export async function createCategory(
  companyId: string,
  input: { setId: string; parentId?: string | null; name: string; description: string },
) {
  await getSet(companyId, input.setId);

  let depth = 0;
  if (input.parentId) {
    const [parent] = await db
      .select({ depth: faqCategories.depth, setId: faqCategories.setId })
      .from(faqCategories)
      .where(and(eq(faqCategories.id, input.parentId), eq(faqCategories.companyId, companyId)))
      .limit(1);

    if (!parent || parent.setId !== input.setId) {
      throw validationError("That parent category is not in this set.", { parentId: "Choose a category in this set." });
    }
    depth = parent.depth + 1;
  }

  const [siblings] = await db
    .select({ value: count() })
    .from(faqCategories)
    .where(
      and(
        eq(faqCategories.setId, input.setId),
        input.parentId ? eq(faqCategories.parentId, input.parentId) : sql`${faqCategories.parentId} IS NULL`,
      ),
    );

  const id = newId("faqcat");
  await db.insert(faqCategories).values({
    id,
    companyId,
    setId: input.setId,
    parentId: input.parentId ?? null,
    name: input.name,
    description: input.description,
    sortOrder: Number(siblings?.value ?? 0),
    depth,
    status: "published",
  });

  const [created] = await db.select().from(faqCategories).where(eq(faqCategories.id, id)).limit(1);
  return toFAQCategory(created!);
}

export async function updateCategory(companyId: string, categoryId: string, patch: Record<string, unknown>) {
  const [updated] = await db
    .update(faqCategories)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(faqCategories.id, categoryId), eq(faqCategories.companyId, companyId)))
    .returning();

  if (!updated) throw notFound("FAQ category", categoryId);
  return toFAQCategory(updated);
}

export async function deleteCategory(companyId: string, categoryId: string) {
  const [deleted] = await db
    .delete(faqCategories)
    .where(and(eq(faqCategories.id, categoryId), eq(faqCategories.companyId, companyId)))
    .returning({ id: faqCategories.id });

  if (!deleted) throw notFound("FAQ category", categoryId);
}

export async function createQuestion(companyId: string, input: CreateFAQInput) {
  const [category] = await db
    .select({ id: faqCategories.id, setId: faqCategories.setId })
    .from(faqCategories)
    .where(and(eq(faqCategories.id, input.categoryId), eq(faqCategories.companyId, companyId)))
    .limit(1);

  if (!category || category.setId !== input.setId) {
    throw validationError("That category is not in this set.", { categoryId: "Choose a category from this set." });
  }

  const [siblings] = await db.select({ value: count() }).from(faqs).where(eq(faqs.categoryId, input.categoryId));

  const id = newId("faq");
  await db.insert(faqs).values({
    id,
    companyId,
    setId: input.setId,
    categoryId: input.categoryId,
    question: input.question,
    answer: input.answer,
    keywords: input.keywords,
    status: input.status,
    priority: input.priority,
    sortOrder: Number(siblings?.value ?? 0),
  });

  return getQuestion(companyId, id);
}

export async function updateQuestion(companyId: string, faqId: string, patch: UpdateFAQInput) {
  if (patch.categoryId) {
    const [category] = await db
      .select({ id: faqCategories.id })
      .from(faqCategories)
      .where(and(eq(faqCategories.id, patch.categoryId), eq(faqCategories.companyId, companyId)))
      .limit(1);
    if (!category) {
      throw validationError("That category is not in this workspace.", { categoryId: "Choose a valid category." });
    }
  }

  const [updated] = await db
    .update(faqs)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(faqs.id, faqId), eq(faqs.companyId, companyId)))
    .returning({ id: faqs.id });

  if (!updated) throw notFound("FAQ", faqId);
  return getQuestion(companyId, faqId);
}

export async function deleteQuestion(companyId: string, faqId: string) {
  const [deleted] = await db
    .delete(faqs)
    .where(and(eq(faqs.id, faqId), eq(faqs.companyId, companyId)))
    .returning({ id: faqs.id });

  if (!deleted) throw notFound("FAQ", faqId);
}

/**
 * Reparent or reorder a node in the tree.
 *
 * Two rules make this safe rather than merely functional: a question can only
 * live inside a category, and a category can never be moved inside its own
 * subtree — the second would detach that whole branch from the root and make it
 * unreachable in the editor while still being served to the widget.
 */
export async function moveNode(
  companyId: string,
  draggedId: string,
  targetId: string,
  position: "inside" | "before" | "after",
) {
  await db.transaction(async (tx) => {
    const [draggedCategory] = await tx
      .select()
      .from(faqCategories)
      .where(and(eq(faqCategories.id, draggedId), eq(faqCategories.companyId, companyId)))
      .limit(1);

    const [draggedFAQ] = draggedCategory
      ? [undefined]
      : await tx
          .select()
          .from(faqs)
          .where(and(eq(faqs.id, draggedId), eq(faqs.companyId, companyId)))
          .limit(1);

    if (!draggedCategory && !draggedFAQ) throw notFound("FAQ node", draggedId);

    const [targetCategory] = await tx
      .select()
      .from(faqCategories)
      .where(and(eq(faqCategories.id, targetId), eq(faqCategories.companyId, companyId)))
      .limit(1);

    const [targetFAQ] = targetCategory
      ? [undefined]
      : await tx
          .select()
          .from(faqs)
          .where(and(eq(faqs.id, targetId), eq(faqs.companyId, companyId)))
          .limit(1);

    if (draggedFAQ) {
      const newCategoryId =
        position === "inside" && targetCategory ? targetCategory.id : (targetFAQ?.categoryId ?? targetCategory?.id);
      if (!newCategoryId) return;

      await tx
        .update(faqs)
        .set({ categoryId: newCategoryId, updatedAt: new Date() })
        .where(eq(faqs.id, draggedId));

      await reorderQuestions(tx, newCategoryId, draggedId, targetFAQ?.id, position);
      return;
    }

    if (!draggedCategory) return;

    if (targetCategory) {
      // Walk up from the target: if we meet the dragged node, the move would
      // make the dragged subtree its own ancestor.
      let cursor: typeof targetCategory | undefined = targetCategory;
      while (cursor) {
        if (cursor.id === draggedCategory.id) {
          throw validationError("A category cannot be moved inside itself.");
        }
        if (!cursor.parentId) break;
        const parentId: string = cursor.parentId;
        [cursor] = await tx.select().from(faqCategories).where(eq(faqCategories.id, parentId)).limit(1);
      }
    }

    const newParentId = position === "inside" && targetCategory ? targetCategory.id : (targetCategory?.parentId ?? null);

    await tx
      .update(faqCategories)
      .set({ parentId: newParentId, updatedAt: new Date() })
      .where(eq(faqCategories.id, draggedId));

    await reorderCategories(tx, draggedCategory.setId, newParentId, draggedId, targetCategory?.id, position);
    await recomputeDepths(tx, draggedCategory.setId);
  });
}

// ---------------------------------------------------------------------------

async function reorderQuestions(
  tx: Transaction,
  categoryId: string,
  draggedId: string,
  targetId: string | undefined,
  position: "inside" | "before" | "after",
): Promise<void> {
  const siblings = await tx
    .select({ id: faqs.id })
    .from(faqs)
    .where(eq(faqs.categoryId, categoryId))
    .orderBy(asc(faqs.sortOrder));

  const ordered = siblings.map((row) => row.id).filter((id) => id !== draggedId);
  const targetIndex = targetId ? ordered.indexOf(targetId) : ordered.length - 1;
  const insertAt = position === "before" ? Math.max(0, targetIndex) : targetIndex + 1;
  ordered.splice(insertAt, 0, draggedId);

  for (const [index, id] of ordered.entries()) {
    await tx.update(faqs).set({ sortOrder: index }).where(eq(faqs.id, id));
  }
}

async function reorderCategories(
  tx: Transaction,
  setId: string,
  parentId: string | null,
  draggedId: string,
  targetId: string | undefined,
  position: "inside" | "before" | "after",
): Promise<void> {
  const siblings = await tx
    .select({ id: faqCategories.id })
    .from(faqCategories)
    .where(
      and(
        eq(faqCategories.setId, setId),
        parentId ? eq(faqCategories.parentId, parentId) : sql`${faqCategories.parentId} IS NULL`,
      ),
    )
    .orderBy(asc(faqCategories.sortOrder));

  const ordered = siblings.map((row) => row.id).filter((id) => id !== draggedId);
  const targetIndex = targetId ? ordered.indexOf(targetId) : -1;
  const insertAt = position === "before" ? Math.max(0, targetIndex) : targetIndex + 1;
  ordered.splice(insertAt, 0, draggedId);

  for (const [index, id] of ordered.entries()) {
    await tx.update(faqCategories).set({ sortOrder: index }).where(eq(faqCategories.id, id));
  }
}

/** Depth is denormalised for rendering, so it is rebuilt after every move. */
async function recomputeDepths(tx: Transaction, setId: string): Promise<void> {
  const all = await tx
    .select({ id: faqCategories.id, parentId: faqCategories.parentId })
    .from(faqCategories)
    .where(eq(faqCategories.setId, setId));

  const byParent = new Map<string | null, string[]>();
  for (const row of all) {
    const list = byParent.get(row.parentId) ?? [];
    list.push(row.id);
    byParent.set(row.parentId, list);
  }

  const updates: Array<{ id: string; depth: number }> = [];
  const walk = (parentId: string | null, depth: number): void => {
    for (const id of byParent.get(parentId) ?? []) {
      updates.push({ id, depth });
      walk(id, depth + 1);
    }
  };
  walk(null, 0);

  for (const update of updates) {
    await tx.update(faqCategories).set({ depth: update.depth }).where(eq(faqCategories.id, update.id));
  }
}

async function uniqueSlug(companyId: string, base: string): Promise<string> {
  const candidate = base || "faq-set";
  for (let suffix = 0; suffix < 50; suffix += 1) {
    const slug = suffix === 0 ? candidate : `${candidate}-${suffix}`;
    const [taken] = await db
      .select({ id: faqSets.id })
      .from(faqSets)
      .where(and(eq(faqSets.companyId, companyId), eq(faqSets.slug, slug)))
      .limit(1);
    if (!taken) return slug;
  }
  return `${candidate}-${Date.now().toString(36)}`;
}
