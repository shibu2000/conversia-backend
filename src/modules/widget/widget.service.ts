import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  chatbotConfigs,
  faqSets,
  companySettings,
  conversations,
  customers,
  faqCategories,
  faqs,
  leadAssignmentEvents,
  leads,
  messages,
  notifications,
  products,
  roles,
  ticketTimelineEvents,
  tickets,
  users,
} from "../../db/schema";
import { aiGateway, type AssistantTurnRequest, type AssistantTurnResult } from "../../ai/ai-gateway";
import { notifyNewRecord } from "../notifications/notifications.service";
import { queueLeadEmail } from "../email/lead-notification";
import { wakeEmailWorker } from "../email/worker";
import { logger } from "../../config/logger";
import { notFound, validationError } from "../../core/errors";
import { newId } from "../../core/ids";
import { likePattern } from "../../core/list-query";
import { num } from "../../core/serialize";
import { formatLeadReference, formatTicketReference, nextReference } from "../shared/reference.service";
import {
  attachCustomer,
  customerForConversation,
  getOwnership,
  getVisibleTranscript,
  linkOutcome,
  markHandoff,
  recordToolCall,
  resolveCustomer,
  recordTurn,
  recordVisitorMessage,
  resolveConversation,
} from "./conversation.service";
import type { ProductReference, PublishedChatbotConfig } from "../../db/schema";

/**
 * `publishedConfig` is nullable in the schema but never null past
 * `resolveByEmbedKey`, which refuses an unpublished tenant. This narrows it
 * once instead of at every read site.
 */
function publishedConfigOf(row: typeof chatbotConfigs.$inferSelect): PublishedChatbotConfig {
  return row.publishedConfig!;
}

/**
 * The customer-facing widget's backend.
 *
 * **What is real here, and what is not.**
 *
 * FAQ matching, product search, lead capture, ticket creation and human handoff
 * all run against the same records the company workspace edits. A question
 * answered here is genuinely the answer an administrator published, and a lead
 * captured here appears in the pipeline immediately.
 *
 * Generative AI is *not* simulated. `ask` resolves a turn from curated FAQ
 * content or the product catalogue, and when neither matches it returns
 * `needs_ai_backend` — the widget then shows the company's own fallback message
 * and offers a human. Wiring a real provider means implementing that one branch
 * behind the AI gateway; no other code changes.
 */

/** Resolve a tenant from the public embed key. Published config only. */
export async function resolveByEmbedKey(embedKey: string) {
  const [row] = await db.select().from(chatbotConfigs).where(eq(chatbotConfigs.embedKey, embedKey)).limit(1);

  // The same 404 whether the key is unknown or the config was never published:
  // a distinct error would confirm that a guessed key belongs to a real tenant.
  if (!row || row.status !== "published" || !row.publishedConfig) {
    throw notFound("Widget configuration");
  }
  return row;
}

/**
 * The published config, trimmed for public consumption.
 *
 * The `ai` section is withheld entirely: system prompts, blocked topics, the
 * confidence threshold and the model choice are the company's internal
 * configuration, and the widget script runs on a page anyone can view source on.
 *
 * The lead and ticket sections are trimmed to the parts that describe the forms
 * a customer fills in. Assignment strategy, default assignee and default team
 * are internal routing decisions and stay on the server.
 */
export async function getPublicConfig(embedKey: string) {
  const row = await resolveByEmbedKey(embedKey);
  const published = publishedConfigOf(row);

  return {
    companyId: row.companyId,
    version: row.version,
    identity: published.identity,
    appearance: published.appearance,
    behavior: published.behavior,
    leads: {
      enabled: published.leads.enabled,
      fields: published.leads.fields,
      qualificationQuestions: published.leads.qualificationQuestions,
    },
    tickets: {
      enabled: published.tickets.enabled,
      requiredFields: published.tickets.requiredFields,
      confirmBeforeCreate: published.tickets.confirmBeforeCreate,
    },
    handoff: {
      enabled: published.handoff.enabled,
      queueMessage: published.handoff.queueMessage,
      outsideHoursMessage: published.handoff.outsideHoursMessage,
    },
  };
}

/**
 * Which sites may frame this widget.
 *
 * The embed page is served from Conversia's own origin, so the API cannot tell
 * the host site apart from the iframe by `Origin` — the iframe's requests carry
 * Conversia's origin, not the host's. `frame-ancestors` is the control that
 * actually works here: the browser refuses to render the iframe at all on a
 * page that is not on this list.
 *
 * Returned separately from the config because the proxy needs it before the
 * page renders, and the public config deliberately does not carry the list.
 */
export async function getEmbedPolicy(embedKey: string) {
  const row = await resolveByEmbedKey(embedKey);

  return {
    frameAncestors: row.allowedDomains.flatMap((domain) =>
      // Both schemes and any port: a site is the same site on http or https,
      // and a dev server's port is not a security boundary.
      domain === "localhost" || domain === "127.0.0.1"
        ? [`http://${domain}:*`, `https://${domain}:*`]
        : [`https://${domain}`, `https://*.${domain}`, `http://${domain}:*`],
    ),
  };
}

/** Popular questions, from the published FAQ sets the config exposes. */
export async function getPopularQuestions(embedKey: string, limit = 4) {
  const row = await resolveByEmbedKey(embedKey);
  const setIds = await publishedSetIds(row);
  if (setIds.length === 0) return [];

  const rows = await db
    .select({ id: faqs.id, question: faqs.question })
    .from(faqs)
    .where(and(eq(faqs.companyId, row.companyId), inArray(faqs.setId, setIds), eq(faqs.status, "published")))
    .orderBy(desc(faqs.matchCount30d))
    .limit(Math.min(limit, 12));

  return rows;
}

/** The browse tree the widget offers when a customer taps a topic. */
export async function getTopics(embedKey: string) {
  const row = await resolveByEmbedKey(embedKey);
  const setIds = await publishedSetIds(row);
  if (setIds.length === 0) return [];

  const [categories, questions] = await Promise.all([
    db
      .select({ id: faqCategories.id, name: faqCategories.name, parentId: faqCategories.parentId })
      .from(faqCategories)
      .where(and(eq(faqCategories.companyId, row.companyId), inArray(faqCategories.setId, setIds), eq(faqCategories.status, "published"))),
    db
      .select({ id: faqs.id, question: faqs.question, categoryId: faqs.categoryId })
      .from(faqs)
      .where(and(eq(faqs.companyId, row.companyId), inArray(faqs.setId, setIds), eq(faqs.status, "published"))),
  ]);

  // Questions roll up to the top-level topic, because the widget shows one flat
  // list of topics rather than a nested tree the customer has to navigate.
  const parentOf = new Map(categories.map((category) => [category.id, category.parentId]));
  const rootOf = (categoryId: string): string => {
    let cursor = categoryId;
    for (let depth = 0; depth < 20; depth += 1) {
      const parent = parentOf.get(cursor);
      if (!parent) return cursor;
      cursor = parent;
    }
    return cursor;
  };

  const byRoot = new Map<string, Array<{ id: string; question: string }>>();
  for (const question of questions) {
    const root = rootOf(question.categoryId);
    const list = byRoot.get(root) ?? [];
    if (list.length < 8) list.push({ id: question.id, question: question.question });
    byRoot.set(root, list);
  }

  return categories
    .filter((category) => category.parentId === null)
    .map((category) => ({ id: category.id, name: category.name, questions: byRoot.get(category.id) ?? [] }))
    .filter((topic) => topic.questions.length > 0);
}

/** One published answer, recording the match the way the real widget reports it. */
export async function getAnswer(embedKey: string, faqId: string) {
  const row = await resolveByEmbedKey(embedKey);
  const setIds = await publishedSetIds(row);

  const [faq] = await db
    .select()
    .from(faqs)
    .where(
      and(
        eq(faqs.id, faqId),
        eq(faqs.companyId, row.companyId),
        eq(faqs.status, "published"),
        setIds.length ? inArray(faqs.setId, setIds) : sql`false`,
      ),
    )
    .limit(1);

  if (!faq) throw notFound("Answer", faqId);

  await db
    .update(faqs)
    .set({ matchCount30d: faq.matchCount30d + 1, lastMatchedAt: new Date() })
    .where(eq(faqs.id, faqId));

  return { id: faq.id, question: faq.question, answer: faq.answer };
}

export async function rateAnswer(embedKey: string, faqId: string, helpful: boolean) {
  const row = await resolveByEmbedKey(embedKey);

  const [faq] = await db
    .select({ id: faqs.id, helpfulCount: faqs.helpfulCount, notHelpfulCount: faqs.notHelpfulCount })
    .from(faqs)
    .where(and(eq(faqs.id, faqId), eq(faqs.companyId, row.companyId)))
    .limit(1);

  if (!faq) throw notFound("Answer", faqId);

  await db
    .update(faqs)
    .set(helpful ? { helpfulCount: faq.helpfulCount + 1 } : { notHelpfulCount: faq.notHelpfulCount + 1 })
    .where(eq(faqs.id, faqId));
}

/**
 * Catalogue search: real inventory, never prose about it.
 *
 * The query is split into terms and scored by how many of them a product
 * matches, because a customer asks "which running shoe do you recommend" rather
 * than typing a keyword. Matching the whole sentence as one pattern finds
 * nothing; matching any single term finds everything. Requiring a real signal —
 * at least one term hit, ranked by hit count — is what makes the result a
 * recommendation instead of a shrug.
 *
 * This is ordinary catalogue search. No model is involved, and none is implied.
 */
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "for", "with", "you", "your", "yours", "do", "does", "did", "is", "are", "was",
  "what", "which", "who", "how", "can", "could", "would", "should", "recommend", "recommendation", "looking",
  "best", "good", "any", "have", "has", "need", "want", "me", "my", "i", "to", "of", "in", "on", "at", "it",
  "show", "sell", "get", "buy", "some", "there", "that", "this", "please", "help", "about",
]);

function searchTerms(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .split(/\s+/)
        .filter((term) => term.length > 2 && !STOP_WORDS.has(term)),
    ),
  ).slice(0, 8);
}

export async function searchProducts(
  embedKey: string,
  query: string,
  limit = 3,
  /**
   * How strong a match has to be.
   *
   * The weights below make 2 "one keyword matched" and 4 "the product's own
   * name matched". Which floor is right depends entirely on whether the
   * customer's phrasing already said they were shopping.
   */
  minimumScore = 2,
) {
  const row = await resolveByEmbedKey(embedKey);
  const terms = searchTerms(query);
  if (terms.length === 0) return [];

  const patterns = terms.map((term) => `%${term.replace(/[\\%_]/g, (match) => `\\${match}`)}%`);

  // Weighted so a term in the product's name outranks the same term buried in
  // a keyword list: "earbuds" should return the earbuds, not the kettlebell
  // that happens to be tagged "home gym".
  const score = sql<number>`(
    SELECT coalesce(sum(
      CASE WHEN products.name ILIKE pattern THEN 4 ELSE 0 END +
      CASE WHEN products.short_description ILIKE pattern THEN 1 ELSE 0 END +
      CASE WHEN EXISTS (SELECT 1 FROM unnest(products.ai_keywords) AS k WHERE k ILIKE pattern) THEN 2 ELSE 0 END +
      CASE WHEN EXISTS (SELECT 1 FROM unnest(products.ai_use_cases) AS u WHERE u ILIKE pattern) THEN 1 ELSE 0 END
    ), 0)
    FROM unnest(${sql.param(patterns)}::text[]) AS pattern
  )`;

  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      priceUsd: products.priceUsd,
      rating: products.rating,
      url: products.url,
      images: products.images,
      score,
    })
    .from(products)
    .where(
      and(
        eq(products.companyId, row.companyId),
        eq(products.status, "active"),
        eq(products.aiIncludeInRecommendations, true),
        sql`${products.inventoryStatus} <> 'discontinued'`,
        // A single weak brush is not a recommendation; require a real signal.
        sql`${score} >= ${minimumScore}`,
      ),
    )
    .orderBy(desc(score), desc(products.rating))
    .limit(Math.min(limit, 10));

  return rows.map((product) => ({
    productId: product.id,
    name: product.name,
    priceUsd: num(product.priceUsd),
    rating: product.rating ? num(product.rating) : undefined,
    url: product.url ?? undefined,
    imageUrl: product.images.find((image) => image.isPrimary)?.url || undefined,
  }));
}

/** The discriminated outcome of one customer turn. */
export type AssistantTurn =
  | { kind: "faq_answer"; faqId: string; question: string; answer: string; confidence: number; quickReplies: string[] }
  | { kind: "products"; intro: string; products: ProductReference[] }
  | {
      /**
       * A person has taken this conversation over, so the assistant said
       * nothing at all. The visitor's message is recorded and waiting in that
       * person's inbox.
       */
      kind: "agent_handling";
      agentName: string | null;
    }
  | {
      /**
       * A generated answer from the AI layer, grounded in retrieved passages.
       *
       * Produced only when an `AIGateway` is registered. Nothing in this
       * codebase can return this variant — it exists so the widget already
       * knows how to render an AI answer the day that layer is installed.
       */
      kind: "ai_answer";
      answer: string;
      confidence: number;
      citations: Array<{ documentId: string; documentName: string; excerpt: string }>;
    }
  | {
      /**
       * Nothing curated or in the catalogue answered this. Generating a reply
       * needs the AI layer, so the widget shows the company's own fallback and
       * offers a human rather than guessing.
       */
      kind: "needs_ai_backend";
      fallbackMessage: string;
      reason: "no_match" | "below_threshold" | "ai_layer_unavailable";
      offerHandoff: boolean;
    }
  | {
      /**
       * The assistant worked out what the customer wants and filled the form
       * in, but the record is not written until they confirm.
       *
       * Creating a lead or a ticket needs a valid email, and the form is the
       * only thing here that checks one — asked for an address in conversation,
       * the model passed through "priya at example dot com".
       */
      kind: "form_proposed";
      form: "lead" | "ticket";
      prefill: Record<string, string | undefined>;
      message: string;
    };

/**
 * Answer one customer turn.
 *
 * Order matters: a product question goes to the catalogue first, because a
 * recommendation should come from real inventory. Then curated FAQ, matched
 * with Postgres full-text search over the published question and answer text
 * plus a keyword-array check. That is ordinary lexical search over content a
 * person wrote — not semantic retrieval, and not a generated reply.
 *
 * When neither matches, the turn is handed to the AI gateway if one is
 * registered; otherwise it returns `needs_ai_backend` and says so honestly.
 */
/**
 * How strong a curated FAQ match must be to answer a mid-conversation turn.
 *
 * Measured against this workspace's own FAQ set: genuine questions score
 * 0.67–1.00, elliptical follow-ups 0.00–0.70. The two ranges overlap, so this
 * sits where a miss is cheap — a real-but-weak match falls through to retrieval,
 * which answers it anyway.
 */
const FOLLOW_UP_FAQ_FLOOR = 0.75;

/** The score a product scores when the customer used its actual name. */
const PRODUCT_NAME_MATCH = 4;

/** Has this visitor said anything before now? */
async function hasPriorTurns(companyId: string, conversationId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.companyId, companyId),
        eq(messages.role, "customer"),
      ),
    )
    .limit(1);

  return Boolean(row);
}

export async function ask(
  embedKey: string,
  question: string,
  conversationId?: string,
): Promise<AssistantTurn & { conversationId: string }> {
  const row = await resolveByEmbedKey(embedKey);
  const published = publishedConfigOf(row);
  const setIds = await publishedSetIds(row);

  // Before answering anything: has a person taken this thread over? If so the
  // assistant stays out of it entirely. This is the single check that stops the
  // bot talking over an agent mid-conversation — the answering paths below are
  // never reached, rather than each having to remember to hold back.
  let continuing = false;
  /** Set when the assistant used a tool, so the agent's trace can record it. */
  let toolTrace: AssistantTurnResult["trace"] = undefined;
  /** The best curated answer, handed to the model as context rather than as a verdict. */
  let faqCandidate: AssistantTurnRequest["faqCandidate"] = null;

  if (conversationId) {
    const ownership = await db.transaction((tx) => getOwnership(tx, row.companyId, conversationId));

    if (ownership?.humanOwned) {
      await recordVisitorMessage(row.companyId, conversationId, question);
      return { kind: "agent_handling", agentName: ownership.agentName, conversationId };
    }

    continuing = Boolean(ownership) && (await hasPriorTurns(row.companyId, conversationId));
  }

  const outcome = await resolveTurn();

  // The exchange is written after the answer is decided, in one transaction, so
  // the inbox never shows a question with no reply beside it.
  const session = await db.transaction(async (tx) => {
    const resolved = await resolveConversation(tx, row.companyId, conversationId, published.identity.defaultLocale);
    await recordTurn(tx, row.companyId, resolved.id, {
      question,
      answer:
        outcome.kind === "faq_answer" || outcome.kind === "ai_answer"
          ? outcome.answer
          : outcome.kind === "products"
            ? outcome.intro
            : outcome.kind === "form_proposed"
              ? outcome.message
              : outcome.fallbackMessage,
      outcome: outcome.kind,
      products: outcome.kind === "products" ? outcome.products : undefined,
      faqId: outcome.kind === "faq_answer" ? outcome.faqId : undefined,
    });
    return resolved.id;
  });

  // After the exchange is written, so the trace sits beside the turn it explains.
  if (toolTrace) await recordToolCall(row.companyId, session, toolTrace);

  return { ...outcome, conversationId: session };

  /**
   * The answer itself. Unchanged by persistence — it just got a home.
   *
   * `agent_handling` is excluded: that path returns above, before this runs, so
   * the narrower type keeps the mapping below exhaustive without a cast.
   */
  async function resolveTurn(): Promise<Exclude<AssistantTurn, { kind: "agent_handling" }>> {
  /**
   * The catalogue only answers on its own when there is no model to ask.
   *
   * This regex was the product-intent detector, and it cannot be one: "the bike
   * light I received is damaged" scores exactly as well against the catalogue
   * as "tell me about the bike light", because a complaint about a thing names
   * the thing. With the AI layer on, the catalogue is a tool the model calls
   * when it judges the customer is shopping.
   */
  const looksLikeProductSearch =
    !aiGateway().isEnabled() && /recommend|looking for|which|best|suggest|show me|do you (sell|have)/i.test(question);
  if (looksLikeProductSearch) {
    const matches = await searchProducts(embedKey, question, 3);
    if (matches.length > 0) {
      return {
        kind: "products",
        intro: `Here ${matches.length === 1 ? "is" : "are"} ${matches.length} ${matches.length === 1 ? "item" : "items"} from our catalogue that match:`,
        products: matches,
      };
    }
  }

  if (setIds.length > 0) {
    const [match] = await db
      .select({
        id: faqs.id,
        question: faqs.question,
        answer: faqs.answer,
        matchCount30d: faqs.matchCount30d,
        // Rank combines text relevance with the curator's own priority, so a
        // question an administrator marked important wins a close call.
        rank: sql<number>`ts_rank(${faqs.searchVector}, websearch_to_tsquery('english', ${question})) + (${faqs.priority}::float / 100)`,
        // The text match on its own. `rank` folds in the curator's priority,
        // which should break a tie but must not lift a weak match over the bar.
        textRank: sql<number>`ts_rank(${faqs.searchVector}, websearch_to_tsquery('english', ${question}))`,
      })
      .from(faqs)
      .where(
        and(
          eq(faqs.companyId, row.companyId),
          inArray(faqs.setId, setIds),
          eq(faqs.status, "published"),
          or(
            sql`${faqs.searchVector} @@ websearch_to_tsquery('english', ${question})`,
            /**
             * Keywords match whole words, not substrings.
             *
             * As a bare `ILIKE '%keyword%'` this fired on any word merely
             * containing the keyword: "track" inside "Pulse Fitness Tracker",
             * "fit" inside "Fitness", "fee" inside "coffee". Those matches carry
             * a `ts_rank` of zero and still won the ordering, so a product
             * question was answered with a delivery FAQ.
             *
             * Done by padding both sides rather than with a regex: the keyword
             * is curator-entered text, and feeding it to a regex engine would
             * make a stray bracket either an error or a wildcard.
             */
            sql`EXISTS (
              SELECT 1 FROM unnest(${faqs.keywords}) AS keyword
              WHERE ' ' || regexp_replace(lower(${question}), '[^a-z0-9]+', ' ', 'g') || ' '
                    LIKE '% ' || lower(keyword) || ' %'
            )`,
          ),
        ),
      )
      .orderBy(desc(sql`ts_rank(${faqs.searchVector}, websearch_to_tsquery('english', ${question})) + (${faqs.priority}::float / 100)`))
      .limit(1);

    /**
     * Mid-conversation, a curated answer has to be a clear match to win.
     *
     * "How long do I have?" asked after a question about returns ranks 0.61
     * against the delivery FAQ — enough to win today, and it answers a question
     * the customer did not ask. A first message has no context to lose, so the
     * bar only rises once there is a conversation to be a follow-up *of*.
     *
     * Falling through is cheap: the knowledge layer resolves the question
     * against what was already said and usually answers it better. The floor
     * sits below every genuine match measured here (0.67–1.00) and above the
     * ambiguous ones (0.61–0.70) — they overlap, so a weak-but-real match is
     * answered by retrieval instead of by the FAQ, which is no loss.
     */
    /**
     * With the model on, a curated answer is offered to it as context and it
     * decides. Without one, the old rule stands: a clear match answers, and
     * mid-conversation the bar rises so an ambiguous follow-up does not get
     * answered from the wrong FAQ.
     */
    if (match && aiGateway().isEnabled()) {
      faqCandidate = { id: match.id, question: match.question, answer: match.answer, rank: Number(match.textRank ?? 0) };
    }

    const decisive = !continuing || Number(match?.textRank ?? 0) >= FOLLOW_UP_FAQ_FLOOR;

    if (match && decisive && !aiGateway().isEnabled()) {
      await db
        .update(faqs)
        .set({ matchCount30d: match.matchCount30d + 1, lastMatchedAt: new Date() })
        .where(eq(faqs.id, match.id));

      return {
        kind: "faq_answer",
        faqId: match.id,
        question: match.question,
        answer: match.answer,
        // A lexical rank, reported as what it is. Not a model's confidence.
        confidence: Math.min(0.99, Number(match.rank)),
        quickReplies: published.behavior?.showQuickReplies ? (published.behavior.quickReplies ?? []).slice(0, 3) : [],
      };
    }
  }

  /**
   * Last resort before giving up: the question may name a product without being
   * phrased as a request ("is the Trailstride waterproof?").
   *
   * Nothing in the wording said this was shopping, so the catalogue only gets
   * to answer when the product's own *name* was used — score 4. At the usual
   * floor of 2 a single keyword wins, and "my tracking link is not working"
   * returns a fitness tracker because one of its keywords is "sleep tracking":
   * a complaint answered with a product, ahead of the support ticket the
   * customer actually needed.
   */
  const lateMatches = aiGateway().isEnabled() ? [] : await searchProducts(embedKey, question, 3, PRODUCT_NAME_MATCH);
  if (lateMatches.length > 0) {
    return {
      kind: "products",
      intro: `Here ${lateMatches.length === 1 ? "is" : "are"} ${lateMatches.length} ${lateMatches.length === 1 ? "item" : "items"} from our catalogue that match:`,
      products: lateMatches,
    };
  }

  // ─── The AI layer's turn ────────────────────────────────────────────────
  //
  // Everything above answered from content a person wrote or a catalogue row
  // that exists. This is the only point where a generated answer belongs, and
  // it is reached only when nothing curated matched.
  //
  // `isEnabled()` is false until an implementation is registered, so today the
  // pipeline falls straight through to the honest fallback below. Registering
  // a gateway turns this branch on with no other change anywhere.
  if (aiGateway().isEnabled()) {
    try {
      const generated = await aiGateway().answer({
        companyId: row.companyId,
        conversationId: conversationId ?? null,
        question,
        locale: published.identity.defaultLocale,
        embedKey,
        faqCandidate,
      });

      // Captured whatever the outcome, so a tool that ran and then failed to
      // produce an answer still shows up in the agent's trace.
      toolTrace = generated.trace;

      // The company's own confidence threshold still governs an answer drawn
      // from knowledge. A model that is unsure should hand over to a person
      // rather than guess — that decision stays here, with the configuration,
      // not inside the provider.
      //
      // A conversational turn is exempt: "hello" has nothing to retrieve, and
      // holding a greeting to a similarity threshold would be measuring the
      // wrong thing and refusing every one of them.
      // An answer resting on an identifier the customer quoted is judged on
      // whether that identifier was found, not on a similarity score that does
      // not measure it.
      const answered =
        generated.kind === "conversational" || generated.exactTermMatch
          ? generated.answer.length > 0
          : generated.confidence >= (published.ai?.knowledgeConfidenceThreshold ?? 0.65);

      /**
       * A tool acted. What comes back is not prose to be judged by a similarity
       * score — it is products to render, a filled form to confirm, or a record
       * that now exists.
       */
      if (generated.kind === "tool" && generated.tool) {
        const tool = generated.tool;

        if (tool.kind === "products") {
          return {
            kind: "products",
            intro: `Here ${tool.products.length === 1 ? "is" : "are"} ${tool.products.length} ${tool.products.length === 1 ? "item" : "items"} from our catalogue that match:`,
            products: tool.products,
          };
        }

        if (tool.kind === "proposal") {
          return { kind: "form_proposed", form: tool.form, prefill: tool.prefill, message: tool.message };
        }

        return { kind: "ai_answer", answer: tool.message, confidence: 1, citations: [] };
      }

      /**
       * The model answered from the curated FAQ. It reads as a curated answer
       * to the customer — rating buttons and all — because that is what it is,
       * and the FAQ gets credited so the analytics still show which questions
       * are being asked.
       */
      if (answered && generated.faqId && faqCandidate) {
        await db
          .update(faqs)
          .set({ matchCount30d: sql`${faqs.matchCount30d} + 1`, lastMatchedAt: new Date() })
          .where(eq(faqs.id, generated.faqId));

        return {
          kind: "faq_answer",
          faqId: generated.faqId,
          question: faqCandidate.question,
          answer: generated.answer,
          confidence: Math.min(0.99, faqCandidate.rank),
          quickReplies: published.behavior?.showQuickReplies ? (published.behavior.quickReplies ?? []).slice(0, 3) : [],
        };
      }

      if (answered) {
        return {
          kind: "ai_answer",
          answer: generated.answer,
          confidence: generated.confidence,
          citations: generated.citations.map((chunk) => ({
            documentId: chunk.documentId,
            documentName: chunk.documentName,
            excerpt: chunk.excerpt,
          })),
        };
      }
    } catch (error) {
      // A provider outage must not take the widget down with it. The visitor
      // gets the company's fallback and the offer of a human, which is the same
      // thing they would get from a low-confidence answer.
      logger.error("AI gateway failed to answer", {
        companyId: row.companyId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    kind: "needs_ai_backend",
    fallbackMessage:
      published.ai?.fallbackResponse ??
      "I do not have a confident answer for that. Would you like me to pass this to a colleague who can help?",
    reason: aiGateway().isEnabled() ? "below_threshold" : "ai_layer_unavailable",
    offerHandoff: Boolean(published.handoff?.enabled),
  };
  }
}

/**
 * Capture a lead from the widget.
 *
 * Writes a real customer and a real lead into the workspace, honouring the
 * configured assignment strategy, and notifies the owner. Round-robin is
 * computed from the current lead count so work spreads evenly without needing a
 * cursor column.
 */
export async function submitLead(
  embedKey: string,
  input: {
    name: string;
    email: string;
    phone?: string;
    company?: string;
    interest: string;
    quantity?: string;
    qualificationAnswers?: Array<{ question: string; answer: string }>;
    conversationId?: string;
  },
) {
  const row = await resolveByEmbedKey(embedKey);
  const published = publishedConfigOf(row);

  if (!published.leads?.enabled) {
    throw validationError("Lead capture is turned off for this workspace.");
  }

  const companyId = row.companyId;
  const now = new Date();

  const assignee = await pickAssignee(companyId, published.leads.assignmentStrategy, published.leads.defaultAssigneeId, "sales");

  const leadId = newId("lead");
  let reference = "";

  // The quantity has its own column and its own question; everything else the
  // workspace chose to ask arrives already labelled. Built once, because the
  // lead row and the email about it both carry it.
  const qualificationAnswers = [
    ...(input.quantity ? [{ question: "What quantity do you need?", answer: input.quantity }] : []),
    ...(input.qualificationAnswers ?? []),
  ];

  await db.transaction(async (tx) => {
    reference = await nextReference(tx, companyId, "lead", formatLeadReference);

    const customerId = await resolveCustomer(
      tx,
      companyId,
      input.conversationId,
      { name: input.name, email: input.email, phone: input.phone, companyName: input.company },
      "lead",
    );

    // The conversation this came out of is the context an agent needs when
    // they pick the lead up, so both sides are linked and the thread stops
    // reading as anonymous.
    if (input.conversationId) {
      await attachCustomer(tx, input.conversationId, customerId);
      await linkOutcome(tx, input.conversationId, { leadId });
    }

    await tx.insert(leads).values({
      id: leadId,
      companyId,
      reference,
      customerId,
      conversationId: input.conversationId ?? null,
      interest: input.interest,
      // The workspace's configured starting status, not a hardcoded one.
      status: (published.leads.defaultStatus ?? "new") as never,
      priority: "medium",
      source: "ai_chatbot",
      assignedUserId: assignee?.id ?? null,
      qualificationAnswers,
      tags: ["inbound"],
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    });

    if (assignee) {
      await tx.insert(leadAssignmentEvents).values({
        id: newId("lah"),
        leadId,
        companyId,
        toUserId: assignee.id,
        toUserName: assignee.name,
        byUserId: null,
        byUserName: "Chat widget",
        method: published.leads.assignmentStrategy === "round_robin" ? "round_robin" : "auto",
        reason: "Captured by the chat widget",
        at: now,
      });

      if (published.leads.notifyAssignee) {
        await tx.insert(notifications).values({
          id: newId("ntf"),
          companyId,
          userId: assignee.id,
          category: "assignment",
          severity: "info",
          title: "New lead assigned to you",
          body: `${reference} — ${input.interest.slice(0, 140)}`,
          href: `/company/leads/${leadId}`,
          at: now,
        });
      }
    }

    // And the rest of the team, whether or not anyone was assigned. A lead that
    // routed to a team rather than to a person used to reach nobody's bell.
    await notifyNewRecord(tx, companyId, {
      kind: "lead",
      reference,
      summary: input.interest,
      href: `/company/leads/${leadId}`,
      assignedUserId: assignee?.id ?? null,
      customerName: input.name,
    });

    // Queued inside the transaction: a lead and the email about it either both
    // exist or neither does, and nothing the visitor is waiting on touches SMTP.
    await queueLeadEmail(tx, companyId, {
      reference,
      interest: input.interest,
      qualification: qualificationAnswers,
      leadId,
      source: "Chat widget",
      customerId,
      assignedUserId: assignee?.id ?? null,
    });
  });

  // Only shortens the wait; a missed nudge costs one polling interval.
  wakeEmailWorker();

  return { leadReference: reference };
}

/** File a support ticket from the widget. */
export async function submitTicket(
  embedKey: string,
  input: {
    name: string;
    email: string;
    orderReference?: string;
    subject: string;
    description: string;
    conversationId?: string;
    /** True when a tool filed it rather than the visitor's own form. */
    createdByAi?: boolean;
  },
) {
  const row = await resolveByEmbedKey(embedKey);
  const published = publishedConfigOf(row);

  if (!published.tickets?.enabled) {
    throw validationError("Ticket creation is turned off for this workspace.");
  }

  const companyId = row.companyId;
  const now = new Date();
  const priority = (published.tickets.defaultPriority ?? "medium") as "low" | "medium" | "high" | "urgent";
  const slaHours = { urgent: 4, high: 8, medium: 24, low: 72 }[priority] ?? 24;
  const ticketId = newId("tkt");
  let reference = "";

  const assignee = await pickAssignee(
    companyId,
    published.tickets.assignmentStrategy,
    null,
    "support",
    "ticket",
  );

  await db.transaction(async (tx) => {
    reference = await nextReference(tx, companyId, "ticket", formatTicketReference);

    const customerId = await resolveCustomer(
      tx,
      companyId,
      input.conversationId,
      { name: input.name, email: input.email },
      "active",
    );

    if (input.conversationId) {
      await attachCustomer(tx, input.conversationId, customerId);
      await linkOutcome(tx, input.conversationId, { ticketId });
    }

    await tx.insert(tickets).values({
      id: ticketId,
      companyId,
      reference,
      subject: input.subject,
      description: input.description,
      customerId,
      conversationId: input.conversationId ?? null,
      category: (published.tickets.defaultCategory ?? "other") as never,
      priority,
      status: "open",
      teamId: published.tickets.defaultTeamId ?? null,
      // Routed like any other ticket. Leaving these unassigned meant every
      // ticket the widget produced sat in nobody's queue while the workspace's
      // configured strategy was ignored.
      assignedUserId: assignee?.id ?? null,
      orderReference: input.orderReference ?? null,
      createdByAi: input.createdByAi ?? false,
      slaDueAt: new Date(now.getTime() + slaHours * 3_600_000),
      createdAt: now,
      updatedAt: now,
    });

    await notifyNewRecord(tx, companyId, {
      kind: "ticket",
      reference,
      summary: input.subject,
      href: `/company/tickets/${ticketId}`,
      assignedUserId: assignee?.id ?? null,
      customerName: input.name,
    });

    if (assignee) {
      await tx.insert(notifications).values({
        id: newId("ntf"),
        companyId,
        userId: assignee.id,
        category: "assignment",
        severity: "info",
        title: "New ticket assigned to you",
        body: `${reference} — ${input.subject.slice(0, 140)}`,
        href: `/company/tickets/${ticketId}`,
        at: now,
      });
    }

    await tx.insert(ticketTimelineEvents).values([
      {
        id: newId("tev"),
        ticketId,
        companyId,
        kind: "customer_message",
        actorId: null,
        actorName: input.name,
        actorType: "customer",
        body: input.description,
        at: now,
      },
      {
        id: newId("tev"),
        ticketId,
        companyId,
        kind: "created",
        actorId: null,
        actorName: "Chat widget",
        actorType: "system",
        body: "Ticket created from the chat widget.",
        meta: { channel: "web_widget" },
        at: now,
      },
    ]);
  });

  return { ticketReference: reference };
}

/**
 * Request a human.
 *
 * Reports whether agents are actually available, computed from the company's
 * configured business hours in its own timezone — telling a customer someone
 * will be right with them at 2 am is how a support queue loses trust.
 */
export async function requestHandoff(embedKey: string, conversationId?: string) {
  const row = await resolveByEmbedKey(embedKey);
  const published = publishedConfigOf(row);

  const [settings] = await db.select().from(companySettings).where(eq(companySettings.companyId, row.companyId)).limit(1);

  const timezone = settings?.businessHours?.timezone ?? "UTC";
  const now = new Date();
  const local = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(now);

  const weekdayName = local.find((part) => part.type === "weekday")?.value ?? "Mon";
  const hour = Number(local.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(local.find((part) => part.type === "minute")?.value ?? "0");
  const isoWeekday = String(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(weekdayName) + 1);

  const hours = settings?.businessHours?.days?.[isoWeekday];
  const minutesNow = hour * 60 + minute;
  const withinHours = hours?.open
    ? minutesNow >= toMinutes(hours.from) && minutesNow < toMinutes(hours.to)
    : false;

  const agentsAvailable = published.behavior?.respectBusinessHours ? withinHours : true;

  // Move the thread into the handoff queue whether or not anyone is on shift.
  // Outside hours the visitor is told to expect a reply later, and the request
  // still has to be waiting in the inbox when the team comes back.
  if (conversationId && published.handoff?.enabled) {
    await markHandoff(row.companyId, conversationId);
  }

  return {
    accepted: Boolean(published.handoff?.enabled),
    queueMessage: published.handoff?.queueMessage ?? "",
    agentsAvailable,
    outsideHoursMessage: published.handoff?.outsideHoursMessage ?? "",
    queuePosition: agentsAvailable ? 1 : 0,
  };
}

// ---------------------------------------------------------------------------

/**
 * FAQ sets the widget may answer from.
 *
 * Two conditions, both required: the chatbot config selects the set, *and* the
 * set itself is published. The config decides which sets are in scope; the set's
 * own status is the author's switch for whether its content is ready to face
 * customers. Honouring only the first meant a set an administrator had left in
 * draft was still answering live — the badge said "Draft" while it was serving.
 */
async function publishedSetIds(row: typeof chatbotConfigs.$inferSelect): Promise<string[]> {
  const selected = row.publishedConfig?.knowledge?.faqSetIds ?? [];
  if (selected.length === 0) return [];

  const rows = await db
    .select({ id: faqSets.id })
    .from(faqSets)
    .where(and(eq(faqSets.companyId, row.companyId), inArray(faqSets.id, selected), eq(faqSets.status, "published")));

  return rows.map((entry) => entry.id);
}

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

/** Resolve an assignee from the configured strategy, scoped to this company. */
async function pickAssignee(
  companyId: string,
  strategy: string,
  defaultAssigneeId: string | null,
  roleSlug: string,
  /**
   * What the rotation counts. Leads and tickets each advance their own turn —
   * counting leads to place a ticket made the two rotations interfere, so a
   * busy sales week could park every ticket on the same person.
   */
  rotateOn: "lead" | "ticket" = "lead",
): Promise<{ id: string; name: string } | null> {
  if (strategy === "round_robin") {
    const candidates = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .leftJoin(roles, eq(roles.id, users.roleId))
      .where(and(eq(users.companyId, companyId), eq(users.status, "active"), eq(roles.slug, roleSlug as never)))
      .orderBy(users.id);

    if (candidates.length === 0) return null;

    const [row] =
      rotateOn === "ticket"
        ? await db.select({ value: sql<number>`count(*)` }).from(tickets).where(eq(tickets.companyId, companyId))
        : await db.select({ value: sql<number>`count(*)` }).from(leads).where(eq(leads.companyId, companyId));

    return candidates[Number(row?.value ?? 0) % candidates.length];
  }

  if (defaultAssigneeId) {
    const [user] = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(and(eq(users.id, defaultAssigneeId), eq(users.companyId, companyId), eq(users.status, "active")))
      .limit(1);
    return user ?? null;
  }

  return null;
}


/**
 * The visitor's view of their own conversation.
 *
 * Polled by the widget while a person is handling the thread, so an agent's
 * reply actually reaches the visitor. Internal notes never appear here.
 */
export async function getTranscript(embedKey: string, conversationId: string, since?: string) {
  const row = await resolveByEmbedKey(embedKey);
  const ownership = await db.transaction((tx) => getOwnership(tx, row.companyId, conversationId));
  if (!ownership) throw notFound("Conversation", conversationId);

  const sinceDate = since ? new Date(since) : undefined;

  return {
    messages: await getVisibleTranscript(
      row.companyId,
      conversationId,
      sinceDate && !Number.isNaN(sinceDate.getTime()) ? sinceDate : undefined,
    ),
    humanOwned: ownership.humanOwned,
    agentName: ownership.agentName,
  };
}

/**
 * A visitor's message during a live chat with an agent.
 *
 * Separate from `ask` because it must never trigger an answer: the assistant is
 * out of this conversation, and the message is simply delivered to the inbox.
 */
export async function sendVisitorMessage(embedKey: string, conversationId: string, body: string) {
  const row = await resolveByEmbedKey(embedKey);
  const ownership = await db.transaction((tx) => getOwnership(tx, row.companyId, conversationId));
  if (!ownership) throw notFound("Conversation", conversationId);

  await recordVisitorMessage(row.companyId, conversationId, body);
  return { humanOwned: ownership.humanOwned, agentName: ownership.agentName };
}

/**
 * Identify the visitor before the conversation starts.
 *
 * The pre-chat form most chat widgets open with. It exists for the company's
 * benefit as much as the visitor's: a transcript with no way to reply to the
 * person who wrote it is close to useless, and asking afterwards — once they
 * have their answer and have gone — rarely works.
 *
 * An existing customer with the same address is reused rather than duplicated,
 * so a returning visitor's conversations accumulate on one profile instead of
 * fragmenting across a dozen near-identical records.
 */
export async function identifyVisitor(
  embedKey: string,
  input: { name: string; email?: string; phone?: string; conversationId?: string },
) {
  const row = await resolveByEmbedKey(embedKey);
  const published = publishedConfigOf(row);
  const companyId = row.companyId;
  const now = new Date();

  return db.transaction(async (tx) => {
    const conversation = await resolveConversation(
      tx,
      companyId,
      input.conversationId,
      published.identity.defaultLocale,
    );

    const [existing] = input.email
      ? await tx
          .select({ id: customers.id })
          .from(customers)
          .where(and(eq(customers.companyId, companyId), sql`lower(${customers.email}) = ${input.email.toLowerCase()}`))
          .limit(1)
      : [undefined];

    const customerId = existing?.id ?? newId("cus");

    if (existing) {
      // Only touch what the visitor just told us. Overwriting a stored name or
      // phone with a blank from this form would quietly erase real data.
      await tx
        .update(customers)
        .set({
          name: input.name,
          ...(input.phone ? { phone: input.phone } : {}),
          lastSeenAt: now,
          updatedAt: now,
        })
        .where(eq(customers.id, customerId));
    } else {
      await tx.insert(customers).values({
        id: customerId,
        companyId,
        name: input.name,
        email: input.email ?? null,
        phone: input.phone ?? null,
        status: "lead",
        firstSeenChannel: "chatbot",
        lastSeenAt: now,
      });
    }

    await attachCustomer(tx, conversation.id, customerId);

    return { conversationId: conversation.id, customerId };
  });
}
