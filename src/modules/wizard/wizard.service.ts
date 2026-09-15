import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db";
import {
  companies,
  faqCategories,
  faqSets,
  faqs,
  websiteAnalyses,
  websiteAnalysisSuggestions,
  wizardStates,
} from "../../db/schema";
import type { WizardStep } from "../../db/schema";
import { aiGateway } from "../../ai/ai-gateway";
import { aiLayerNotImplemented, notFound, validationError } from "../../core/errors";
import { newId } from "../../core/ids";
import { iso, isoRequired } from "../../core/serialize";

/** The twelve onboarding steps, in the order the stepper renders them. */
export const WIZARD_STEPS: Array<Omit<WizardStep, "status" | "completedAt">> = [
  { key: "company", ordinal: "01", title: "Company", description: "Name, website, industry and business hours.", optional: false, milestone: "setup" },
  { key: "users", ordinal: "02", title: "Users", description: "Invite the people who will work in this workspace.", optional: false, milestone: "setup" },
  { key: "chatbot", ordinal: "03", title: "Chatbot", description: "Name the assistant and set its welcome message.", optional: false, milestone: "setup" },
  { key: "faq", ordinal: "04", title: "FAQ", description: "Add the questions customers ask most.", optional: false, milestone: "knowledge" },
  { key: "knowledge", ordinal: "05", title: "Knowledge Base", description: "Upload policies and documents the AI can quote.", optional: false, milestone: "knowledge" },
  { key: "products", ordinal: "06", title: "Products", description: "Import the catalogue so the assistant can recommend items.", optional: true, milestone: "knowledge" },
  { key: "leads", ordinal: "07", title: "Leads", description: "Decide what the assistant collects before creating a lead.", optional: true, milestone: "automation" },
  { key: "tickets", ordinal: "08", title: "Tickets", description: "Set the default category, priority and assignment.", optional: true, milestone: "automation" },
  { key: "ai", ordinal: "09", title: "AI", description: "Choose the model, tone and escalation behaviour.", optional: false, milestone: "automation" },
  { key: "test", ordinal: "10", title: "Test", description: "Ask the assistant real questions and check its sources.", optional: false, milestone: "launch" },
  { key: "install", ordinal: "11", title: "Install", description: "Add the widget snippet to your website.", optional: false, milestone: "launch" },
  { key: "complete", ordinal: "12", title: "Complete", description: "Review what is live and what to do next.", optional: false, milestone: "launch" },
];

export function defaultSteps(): WizardStep[] {
  return WIZARD_STEPS.map((step, index) => ({
    ...step,
    status: index === 0 ? "in_progress" : "not_started",
    completedAt: null,
  }));
}

export async function getState(companyId: string) {
  const [row] = await db.select().from(wizardStates).where(eq(wizardStates.companyId, companyId)).limit(1);
  if (!row) throw notFound("Wizard state", companyId);
  return serialise(row);
}

/**
 * Move to a step, optionally setting its status.
 *
 * Opening a not-yet-started step marks it in progress, so the stepper reflects
 * where someone actually is rather than only what they have finished.
 */
export async function setStep(companyId: string, key: string, status?: WizardStep["status"]) {
  const [row] = await db.select().from(wizardStates).where(eq(wizardStates.companyId, companyId)).limit(1);
  if (!row) throw notFound("Wizard state", companyId);

  const steps = row.steps.map((step) => {
    if (step.key !== key) return step;
    const nextStatus = status ?? (step.status === "not_started" ? "in_progress" : step.status);
    return {
      ...step,
      status: nextStatus,
      completedAt: nextStatus === "complete" ? new Date().toISOString() : null,
    };
  });

  return save(companyId, steps, key);
}

export async function completeStep(companyId: string, key: string) {
  const [row] = await db.select().from(wizardStates).where(eq(wizardStates.companyId, companyId)).limit(1);
  if (!row) throw notFound("Wizard state", companyId);

  const index = row.steps.findIndex((step) => step.key === key);
  if (index === -1) throw notFound("Wizard step", key);

  const steps = [...row.steps];
  steps[index] = { ...steps[index], status: "complete", completedAt: new Date().toISOString() };

  // Advance to the next step and open it, so finishing one lands the reader on
  // the next rather than on a completed screen.
  const next = steps[index + 1];
  if (next && next.status === "not_started") {
    steps[index + 1] = { ...next, status: "in_progress" };
  }

  return save(companyId, steps, next?.key ?? key);
}

export async function skipStep(companyId: string, key: string) {
  const [row] = await db.select().from(wizardStates).where(eq(wizardStates.companyId, companyId)).limit(1);
  if (!row) throw notFound("Wizard state", companyId);

  const index = row.steps.findIndex((step) => step.key === key);
  if (index === -1) throw notFound("Wizard step", key);
  if (!row.steps[index].optional) {
    throw validationError("This step is required and cannot be skipped.");
  }

  const steps = [...row.steps];
  steps[index] = { ...steps[index], status: "skipped", completedAt: null };

  return save(companyId, steps, steps[index + 1]?.key ?? key);
}

/**
 * Website analysis.
 *
 * Crawling a site and proposing FAQ answers from it is an AI-layer capability.
 * Without a gateway registered this refuses with 501 rather than returning
 * invented suggestions — a wizard that fabricates a company's return policy and
 * asks an administrator to approve it is worse than one that does nothing.
 */
export async function analyzeWebsite(companyId: string, url: string) {
  if (!aiGateway().isEnabled()) throw aiLayerNotImplemented("Website analysis");
  return aiGateway().analyzeWebsite({ companyId, url, maxDepth: 3 });
}

export async function getLatestAnalysis(companyId: string) {
  const [analysis] = await db
    .select()
    .from(websiteAnalyses)
    .where(eq(websiteAnalyses.companyId, companyId))
    .orderBy(websiteAnalyses.startedAt)
    .limit(1);

  if (!analysis) return null;

  const suggestions = await db
    .select()
    .from(websiteAnalysisSuggestions)
    .where(eq(websiteAnalysisSuggestions.analysisId, analysis.id));

  return {
    id: analysis.id,
    url: analysis.url,
    status: analysis.status,
    progress: analysis.progress,
    startedAt: isoRequired(analysis.startedAt),
    finishedAt: iso(analysis.finishedAt),
    pagesCrawled: analysis.pagesCrawled,
    findings: analysis.findings,
    suggestions: suggestions.map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      body: row.body,
      sourceUrl: row.sourceUrl,
      confidence: Number(row.confidence),
      status: row.status,
      editedBody: row.editedBody ?? undefined,
    })),
    errorMessage: analysis.errorMessage,
  };
}

/**
 * Review one AI-proposed onboarding suggestion.
 *
 * The proposing is the AI layer's job; the *reviewing* is not, and it is
 * implemented here in full. Accepting an FAQ suggestion creates a real,
 * unpublished FAQ in the default set — so the reader can go and look at the
 * result in the FAQ module rather than taking the wizard's word for it. It
 * lands as a draft because a machine proposal should not go live to customers
 * on one click.
 */
export async function reviewSuggestion(
  companyId: string,
  suggestionId: string,
  decision: "accepted" | "rejected" | "edited",
  editedBody?: string,
) {
  const [suggestion] = await db
    .select()
    .from(websiteAnalysisSuggestions)
    .where(and(eq(websiteAnalysisSuggestions.id, suggestionId), eq(websiteAnalysisSuggestions.companyId, companyId)))
    .limit(1);

  if (!suggestion) throw notFound("Suggestion", suggestionId);

  const body = decision === "edited" && editedBody !== undefined ? editedBody : suggestion.body;

  await db.transaction(async (tx) => {
    await tx
      .update(websiteAnalysisSuggestions)
      .set({ status: decision, editedBody: decision === "edited" ? editedBody : null })
      .where(eq(websiteAnalysisSuggestions.id, suggestionId));

    if ((decision === "accepted" || decision === "edited") && suggestion.kind === "faq") {
      const [set] = await tx
        .select({ id: faqSets.id })
        .from(faqSets)
        .where(and(eq(faqSets.companyId, companyId), eq(faqSets.isDefault, true)))
        .limit(1);
      if (!set) return;

      const [category] = await tx
        .select({ id: faqCategories.id })
        .from(faqCategories)
        .where(and(eq(faqCategories.setId, set.id), isNull(faqCategories.parentId)))
        .orderBy(faqCategories.sortOrder)
        .limit(1);
      if (!category) return;

      await tx.insert(faqs).values({
        id: newId("faq"),
        companyId,
        setId: set.id,
        categoryId: category.id,
        question: suggestion.title,
        answer: body,
        keywords: suggestion.title
          .toLowerCase()
          .replace(/[^\w\s]/g, "")
          .split(/\s+/)
          .filter((word) => word.length > 3)
          .slice(0, 10),
        status: "draft",
        priority: 5,
        aiSuggested: true,
      });
    }
  });

  const [updated] = await db
    .select()
    .from(websiteAnalysisSuggestions)
    .where(eq(websiteAnalysisSuggestions.id, suggestionId))
    .limit(1);

  return {
    id: updated!.id,
    kind: updated!.kind,
    title: updated!.title,
    body: updated!.body,
    sourceUrl: updated!.sourceUrl,
    confidence: Number(updated!.confidence),
    status: updated!.status,
    editedBody: updated!.editedBody ?? undefined,
  };
}

/** Accept or reject every still-pending suggestion in the latest analysis. */
export async function reviewAllSuggestions(companyId: string, decision: "accepted" | "rejected") {
  const analysis = await getLatestAnalysis(companyId);
  if (!analysis) throw notFound("Website analysis", companyId);

  for (const suggestion of analysis.suggestions) {
    if (suggestion.status === "pending") {
      await reviewSuggestion(companyId, suggestion.id, decision);
    }
  }

  return getLatestAnalysis(companyId);
}

// ---------------------------------------------------------------------------

async function save(companyId: string, steps: WizardStep[], currentStepKey: string) {
  const counted = steps.filter((step) => step.status !== "skipped");
  const done = counted.filter((step) => step.status === "complete").length;
  const allSettled = steps.every((step) => step.status === "complete" || step.status === "skipped");
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(wizardStates)
      .set({ steps, currentStepKey, lastSavedAt: now, completedAt: allSettled ? now : null })
      .where(eq(wizardStates.companyId, companyId));

    // Onboarding progress is shown on the company record too, so it is kept in
    // step rather than recomputed differently in two places.
    await tx
      .update(companies)
      .set({
        onboardingProgress: counted.length ? Math.round((done / counted.length) * 100) : 0,
        updatedAt: now,
      })
      .where(eq(companies.id, companyId));
  });

  return getState(companyId);
}

function serialise(row: typeof wizardStates.$inferSelect) {
  const counted = row.steps.filter((step) => step.status !== "skipped");
  const done = counted.filter((step) => step.status === "complete").length;

  return {
    companyId: row.companyId,
    currentStepKey: row.currentStepKey,
    steps: row.steps,
    progress: counted.length ? Math.round((done / counted.length) * 100) : 0,
    startedAt: isoRequired(row.startedAt),
    lastSavedAt: isoRequired(row.lastSavedAt),
    completedAt: iso(row.completedAt),
  };
}
