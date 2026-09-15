import { iso, isoRequired } from "../../core/serialize";
import type { faqCategories, faqSets, faqs } from "../../db/schema";

type SetRow = typeof faqSets.$inferSelect;
type CategoryRow = typeof faqCategories.$inferSelect;
type FAQRow = typeof faqs.$inferSelect;

export function toFAQSet(
  row: SetRow,
  counts: { categoryCount: number; questionCount: number; publishedQuestionCount: number },
) {
  return {
    id: row.id,
    companyId: row.companyId,
    name: row.name,
    slug: row.slug,
    description: row.description,
    status: row.status,
    isDefault: row.isDefault,
    locale: row.locale,
    categoryCount: Number(counts.categoryCount),
    questionCount: Number(counts.questionCount),
    publishedQuestionCount: Number(counts.publishedQuestionCount),
    matchCount30d: row.matchCount30d,
    createdAt: isoRequired(row.createdAt),
    updatedAt: isoRequired(row.updatedAt),
  };
}

export function toFAQCategory(row: CategoryRow, questionCount = 0) {
  return {
    id: row.id,
    companyId: row.companyId,
    setId: row.setId,
    parentId: row.parentId,
    name: row.name,
    description: row.description,
    order: row.sortOrder,
    status: row.status,
    questionCount: Number(questionCount),
    depth: row.depth,
    createdAt: isoRequired(row.createdAt),
    updatedAt: isoRequired(row.updatedAt),
  };
}

export function toFAQ(row: FAQRow) {
  return {
    id: row.id,
    companyId: row.companyId,
    setId: row.setId,
    categoryId: row.categoryId,
    question: row.question,
    answer: row.answer,
    keywords: row.keywords,
    status: row.status,
    priority: row.priority,
    order: row.sortOrder,
    matchCount30d: row.matchCount30d,
    helpfulCount: row.helpfulCount,
    notHelpfulCount: row.notHelpfulCount,
    lastMatchedAt: iso(row.lastMatchedAt),
    aiSuggested: row.aiSuggested || undefined,
    createdAt: isoRequired(row.createdAt),
    updatedAt: isoRequired(row.updatedAt),
  };
}

export interface FAQTreeNode {
  id: string;
  kind: "category" | "question";
  name: string;
  parentId: string | null;
  depth: number;
  order: number;
  status: string;
  questionCount?: number;
  children: FAQTreeNode[];
}

/**
 * Build the nested tree the FAQ editor renders.
 *
 * Categories nest arbitrarily deep with questions as leaves. Assembled in
 * memory from two flat queries rather than with a recursive CTE: an FAQ set is
 * a few hundred rows at most, and two indexed reads beat a recursive walk that
 * would still need shaping afterwards.
 */
export function buildFAQTree(categories: CategoryRow[], questions: FAQRow[]): FAQTreeNode[] {
  const byParent = new Map<string | null, CategoryRow[]>();
  for (const category of categories) {
    const list = byParent.get(category.parentId) ?? [];
    list.push(category);
    byParent.set(category.parentId, list);
  }

  const byCategory = new Map<string, FAQRow[]>();
  for (const question of questions) {
    const list = byCategory.get(question.categoryId) ?? [];
    list.push(question);
    byCategory.set(question.categoryId, list);
  }

  function build(parentId: string | null, depth: number): FAQTreeNode[] {
    const siblings = (byParent.get(parentId) ?? []).sort((a, b) => a.sortOrder - b.sortOrder);

    return siblings.map((category) => {
      const children = build(category.id, depth + 1);
      const ownQuestions: FAQTreeNode[] = (byCategory.get(category.id) ?? [])
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((question) => ({
          id: question.id,
          kind: "question" as const,
          name: question.question,
          parentId: category.id,
          depth: depth + 1,
          order: question.sortOrder,
          status: question.status,
          children: [],
        }));

      return {
        id: category.id,
        kind: "category" as const,
        name: category.name,
        parentId,
        depth,
        order: category.sortOrder,
        status: category.status,
        // Includes descendants, which is what a reader expects from a count on
        // a collapsed folder.
        questionCount: ownQuestions.length + children.reduce((sum, child) => sum + (child.questionCount ?? 0), 0),
        children: [...children, ...ownQuestions],
      };
    });
  }

  return build(null, 0);
}
