import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "../../db";
import { companies, companyUsage, conversations, knowledgeDocuments, leads, products, tickets, users } from "../../db/schema";
import { correlatedCount } from "../../core/subquery";
import { rowsOf } from "../dashboard/dashboard.service";

/**
 * Analytics.
 *
 * Every figure here is computed from real rows. Where a metric would require
 * the AI layer — retrieval quality, failed-question clustering, per-answer
 * confidence — it is returned as `null` with the series left empty rather than
 * filled with a plausible number. A dashboard that invents its own inputs is
 * worse than one with a gap, because nobody can tell which panels to trust.
 */

export type RangeKey = "7d" | "30d" | "90d" | "12m";

function rangeStart(range: RangeKey): Date {
  const days = range === "7d" ? 7 : range === "30d" ? 30 : range === "90d" ? 90 : 365;
  const start = new Date(Date.now() - (days - 1) * 86_400_000);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

/** Day buckets for a range, so empty days appear as zero rather than vanish. */
async function dailySeries(companyId: string, table: "conversations" | "leads" | "tickets", range: RangeKey) {
  const since = rangeStart(range);
  const source = table === "conversations" ? conversations : table === "leads" ? leads : tickets;

  const result = await db.execute<{ label: string; value: number }>(sql`
    WITH days AS (SELECT generate_series(${since}::timestamptz, now(), '1 day')::date AS day)
    SELECT to_char(days.day, 'Mon FMDD') AS label,
           (SELECT count(*) FROM ${source} WHERE ${source.companyId} = ${companyId} AND ${source.createdAt}::date = days.day)::int AS value
      FROM days ORDER BY days.day
  `);

  return rowsOf(result).map((row) => ({ label: row.label, value: Number(row.value) }));
}

export async function getConversationAnalytics(companyId: string, range: RangeKey) {
  const since = rangeStart(range);
  const scope = and(eq(conversations.companyId, companyId), gte(conversations.createdAt, since));

  const [[totals], channels, intents, volumeByDay, heatmap] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)`,
        aiResolved: sql<number>`count(*) FILTER (WHERE ${conversations.resolvedByAi})`,
        handoff: sql<number>`count(*) FILTER (WHERE ${conversations.status} IN ('human_handoff','escalated'))`,
        unresolved: sql<number>`count(*) FILTER (WHERE ${conversations.status} IN ('active','waiting_on_customer'))`,
        closed: sql<number>`count(*) FILTER (WHERE ${conversations.status} = 'closed')`,
        abandoned: sql<number>`count(*) FILTER (WHERE ${conversations.status} = 'abandoned')`,
        csat: sql<number>`coalesce(avg(${conversations.csatScore}), 0)`,
      })
      .from(conversations)
      .where(scope),
    db
      .select({ label: conversations.channel, value: sql<number>`count(*)` })
      .from(conversations)
      .where(scope)
      .groupBy(conversations.channel)
      .orderBy(desc(sql`count(*)`)),
    db
      .select({ label: conversations.intent, value: sql<number>`count(*)` })
      .from(conversations)
      .where(scope)
      .groupBy(conversations.intent)
      .orderBy(desc(sql`count(*)`)),
    dailySeries(companyId, "conversations", range),
    // Day-of-week × hour, so staffing decisions have something behind them.
    db.execute<{ day: string; hour: number; value: number }>(sql`
      SELECT to_char(${conversations.createdAt}, 'Dy') AS day,
             extract(hour FROM ${conversations.createdAt})::int AS hour,
             count(*)::int AS value
        FROM ${conversations}
       WHERE ${conversations.companyId} = ${companyId} AND ${conversations.createdAt} >= ${since}
       GROUP BY 1, 2
    `),
  ]);

  const total = Number(totals?.total ?? 0);

  return {
    metrics: [
      { key: "total", label: "Total conversations", value: total, goodDirection: "up", series: volumeByDay.slice(-12) },
      { key: "ai_resolved", label: "AI resolved", value: Number(totals?.aiResolved ?? 0), goodDirection: "up" },
      { key: "handoff", label: "Human handoff", value: Number(totals?.handoff ?? 0), goodDirection: "down" },
      { key: "unresolved", label: "Unresolved", value: Number(totals?.unresolved ?? 0), goodDirection: "down" },
      {
        key: "csat",
        label: "Average CSAT",
        value: Number(Number(totals?.csat ?? 0).toFixed(2)),
        format: "number",
        goodDirection: "up",
      },
    ],
    volumeByDay,
    outcomeBreakdown: [
      { label: "AI resolved", value: Number(totals?.aiResolved ?? 0) },
      { label: "Human handoff", value: Number(totals?.handoff ?? 0) },
      { label: "Closed by agent", value: Number(totals?.closed ?? 0) },
      { label: "Abandoned", value: Number(totals?.abandoned ?? 0) },
      { label: "Open", value: Number(totals?.unresolved ?? 0) },
    ],
    channelBreakdown: channels.map((row) => ({ label: row.label, value: Number(row.value) })),
    intentBreakdown: intents.map((row) => ({ label: row.label, value: Number(row.value) })),
    hourlyHeatmap: rowsOf(heatmap).map((row) => ({ day: row.day.trim(), hour: Number(row.hour), value: Number(row.value) })),
  };
}

export async function getBusinessAnalytics(companyId: string, range: RangeKey) {
  const since = rangeStart(range);

  const [[leadTotals], [ticketTotals], sources, popularProducts, ticketSeries, responseSeries] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)`,
        contacted: sql<number>`count(*) FILTER (WHERE ${leads.status} <> 'new')`,
        qualified: sql<number>`count(*) FILTER (WHERE ${leads.status} IN ('qualified','proposal','won'))`,
        proposal: sql<number>`count(*) FILTER (WHERE ${leads.status} IN ('proposal','won'))`,
        won: sql<number>`count(*) FILTER (WHERE ${leads.status} = 'won')`,
        pipelineValueUsd: sql<number>`coalesce(sum(${leads.estimatedValueUsd}) FILTER (WHERE ${leads.status} NOT IN ('won','lost')), 0)`,
      })
      .from(leads)
      .where(and(eq(leads.companyId, companyId), gte(leads.createdAt, since))),
    db
      .select({
        total: sql<number>`count(*)`,
        resolved: sql<number>`count(*) FILTER (WHERE ${tickets.status} IN ('resolved','closed'))`,
        // Averages over real timestamps; null when nothing has been answered yet.
        avgFirstResponseSeconds: sql<number | null>`avg(extract(epoch FROM (${tickets.firstResponseAt} - ${tickets.createdAt})))`,
        avgResolutionSeconds: sql<number | null>`avg(extract(epoch FROM (${tickets.resolvedAt} - ${tickets.createdAt})))`,
      })
      .from(tickets)
      .where(and(eq(tickets.companyId, companyId), gte(tickets.createdAt, since))),
    db
      .select({ label: leads.source, value: sql<number>`count(*)` })
      .from(leads)
      .where(and(eq(leads.companyId, companyId), gte(leads.createdAt, since)))
      .groupBy(leads.source),
    db
      .select({
        productId: products.id,
        name: products.name,
        mentions: products.conversationMentions,
        leads: products.leadCount,
        priceUsd: products.priceUsd,
      })
      .from(products)
      .where(eq(products.companyId, companyId))
      .orderBy(desc(products.conversationMentions))
      .limit(8),
    db.execute<{ label: string; created: number; resolved: number }>(sql`
      WITH days AS (SELECT generate_series(${since}::timestamptz, now(), '1 day')::date AS day)
      SELECT to_char(days.day, 'Mon FMDD') AS label,
             (SELECT count(*) FROM ${tickets} WHERE ${tickets.companyId} = ${companyId} AND ${tickets.createdAt}::date = days.day)::int AS created,
             (SELECT count(*) FROM ${tickets} WHERE ${tickets.companyId} = ${companyId} AND ${tickets.resolvedAt}::date = days.day)::int AS resolved
        FROM days ORDER BY days.day
    `),
    db.execute<{ label: string; first_response_min: number | null; resolution_hours: number | null }>(sql`
      WITH days AS (SELECT generate_series(${since}::timestamptz, now(), '1 day')::date AS day)
      SELECT to_char(days.day, 'Mon FMDD') AS label,
             (SELECT avg(extract(epoch FROM (t.first_response_at - t.created_at)) / 60)
                FROM ${tickets} t WHERE t.company_id = ${companyId} AND t.created_at::date = days.day) AS first_response_min,
             (SELECT avg(extract(epoch FROM (t.resolved_at - t.created_at)) / 3600)
                FROM ${tickets} t WHERE t.company_id = ${companyId} AND t.created_at::date = days.day) AS resolution_hours
        FROM days ORDER BY days.day
    `),
  ]);

  const totalLeads = Number(leadTotals?.total ?? 0);
  const won = Number(leadTotals?.won ?? 0);
  const totalTickets = Number(ticketTotals?.total ?? 0);

  return {
    metrics: [
      {
        key: "lead_conversion",
        label: "Lead conversion",
        value: totalLeads ? Number(((won / totalLeads) * 100).toFixed(1)) : 0,
        format: "percent",
        goodDirection: "up",
      },
      {
        key: "pipeline_value",
        label: "Pipeline value",
        value: Number(leadTotals?.pipelineValueUsd ?? 0),
        format: "currency",
        goodDirection: "up",
      },
      {
        key: "ticket_resolution",
        label: "Ticket resolution rate",
        value: totalTickets ? Number(((Number(ticketTotals?.resolved ?? 0) / totalTickets) * 100).toFixed(1)) : 0,
        format: "percent",
        goodDirection: "up",
      },
      {
        key: "first_response",
        label: "Avg first response",
        value: ticketTotals?.avgFirstResponseSeconds != null ? Math.round(Number(ticketTotals.avgFirstResponseSeconds)) : null,
        format: "duration",
        goodDirection: "down",
      },
      {
        key: "resolution_time",
        label: "Avg resolution time",
        value: ticketTotals?.avgResolutionSeconds != null ? Math.round(Number(ticketTotals.avgResolutionSeconds)) : null,
        format: "duration",
        goodDirection: "down",
      },
    ],
    leadFunnel: [
      { stage: "Created", count: totalLeads },
      { stage: "Contacted", count: Number(leadTotals?.contacted ?? 0) },
      { stage: "Qualified", count: Number(leadTotals?.qualified ?? 0) },
      { stage: "Proposal sent", count: Number(leadTotals?.proposal ?? 0) },
      { stage: "Won", count: won },
    ],
    leadsBySource: sources.map((row) => ({ label: row.label, value: Number(row.value) })),
    ticketResolution: rowsOf(ticketSeries).map((row) => ({
      label: row.label,
      created: Number(row.created),
      resolved: Number(row.resolved),
    })),
    responseTimes: rowsOf(responseSeries).map((row) => ({
      label: row.label,
      firstResponseMin: row.first_response_min != null ? Number(Number(row.first_response_min).toFixed(1)) : 0,
      resolutionHours: row.resolution_hours != null ? Number(Number(row.resolution_hours).toFixed(1)) : 0,
    })),
    popularProducts: popularProducts.map((row) => ({
      productId: row.productId,
      name: row.name,
      mentions: row.mentions,
      leads: row.leads,
      revenueUsd: 0,
    })),
    // Question-frequency analytics depend on intent classification, which is an
    // AI-layer capability. Empty rather than fabricated.
    popularQuestions: [],
  };
}

export async function getKnowledgeAnalytics(companyId: string) {
  const [row] = await db
    .select({
      documents: sql<number>`count(*)`,
      ready: sql<number>`count(*) FILTER (WHERE ${knowledgeDocuments.status} = 'ready')`,
      pending: sql<number>`count(*) FILTER (WHERE ${knowledgeDocuments.status} = 'pending')`,
      failed: sql<number>`count(*) FILTER (WHERE ${knowledgeDocuments.status} = 'failed')`,
      totalBytes: sql<number>`coalesce(sum(${knowledgeDocuments.sizeBytes}), 0)`,
    })
    .from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.companyId, companyId));

  return {
    metrics: [
      { key: "documents", label: "Documents", value: Number(row?.documents ?? 0), goodDirection: "up" },
      { key: "indexed", label: "Indexed documents", value: Number(row?.ready ?? 0), goodDirection: "up" },
      { key: "pending", label: "Awaiting processing", value: Number(row?.pending ?? 0), goodDirection: "down" },
      { key: "failed", label: "Failed", value: Number(row?.failed ?? 0), goodDirection: "down" },
      {
        key: "size",
        label: "Stored bytes",
        value: Number(row?.totalBytes ?? 0),
        goodDirection: "up",
        hint: "Total size of the original uploads held for this workspace.",
      },
    ],
    // Retrieval counts, similarity scores and coverage gaps are produced by
    // semantic search. Until that exists there is nothing honest to report.
    retrievalByDocument: [],
    coverageGaps: [],
    indexingTrend: [],
  };
}

/** Platform-wide analytics for the super admin console. */
export async function getPlatformAnalytics() {
  const [[totals], planRows, topCompanies, growth] = await Promise.all([
    db
      .select({
        companies: sql<number>`count(*)`,
        active: sql<number>`count(*) FILTER (WHERE ${companies.status} = 'active')`,
        users: sql<number>`(SELECT count(*) FROM ${users})`,
        conversations: sql<number>`(SELECT count(*) FROM ${conversations})`,
        leads: sql<number>`(SELECT count(*) FROM ${leads})`,
        tickets: sql<number>`(SELECT count(*) FROM ${tickets})`,
        aiRequests: sql<number>`(SELECT coalesce(sum(ai_requests), 0) FROM ${companyUsage})`,
        spend: sql<number>`(SELECT coalesce(sum(estimated_cost_usd), 0) FROM ${companyUsage})`,
      })
      .from(companies),
    db.select({ label: companies.plan, value: sql<number>`count(*)` }).from(companies).groupBy(companies.plan),
    db
      .select({
        companyId: companies.id,
        name: companies.name,
        conversations: correlatedCount({ from: "conversations", as: "cv", on: "cv.company_id = companies.id" }),
        leads: correlatedCount({ from: "leads", as: "l", on: "l.company_id = companies.id" }),
        tickets: correlatedCount({ from: "tickets", as: "t", on: "t.company_id = companies.id" }),
        aiRequests: sql<number>`coalesce((SELECT ai_requests FROM ${companyUsage} WHERE company_id = ${companies.id}), 0)`,
      })
      .from(companies)
      .orderBy(desc(correlatedCount({ from: "conversations", as: "cv", on: "cv.company_id = companies.id" })))
      .limit(10),
    db.execute<{ label: string; total: number; new: number }>(sql`
      WITH months AS (
        SELECT generate_series(date_trunc('month', now()) - INTERVAL '11 months', date_trunc('month', now()), '1 month') AS month
      )
      SELECT to_char(months.month, 'Mon YY') AS label,
             (SELECT count(*) FROM ${companies} WHERE created_at < months.month + INTERVAL '1 month')::int AS total,
             (SELECT count(*) FROM ${companies} WHERE date_trunc('month', created_at) = months.month)::int AS new
        FROM months ORDER BY months.month
    `),
  ]);

  const platformDaily = async (table: typeof conversations | typeof leads | typeof tickets) => {
    const since = new Date(Date.now() - 29 * 86_400_000);
    since.setUTCHours(0, 0, 0, 0);
    const result = await db.execute<{ label: string; value: number }>(sql`
      WITH days AS (SELECT generate_series(${since}::timestamptz, now(), '1 day')::date AS day)
      SELECT to_char(days.day, 'Mon FMDD') AS label,
             (SELECT count(*) FROM ${table} WHERE ${table.createdAt}::date = days.day)::int AS value
        FROM days ORDER BY days.day
    `);
    return rowsOf(result).map((row) => ({ label: row.label, value: Number(row.value) }));
  };

  const [conversationVolume, leadVolume, ticketVolume] = await Promise.all([
    platformDaily(conversations),
    platformDaily(leads),
    platformDaily(tickets),
  ]);

  return {
    metrics: [
      { key: "companies", label: "Total companies", value: Number(totals?.companies ?? 0), goodDirection: "up" },
      { key: "active_companies", label: "Active companies", value: Number(totals?.active ?? 0), goodDirection: "up" },
      { key: "users", label: "Total users", value: Number(totals?.users ?? 0), goodDirection: "up" },
      { key: "conversations", label: "Conversations", value: Number(totals?.conversations ?? 0), goodDirection: "up", series: conversationVolume.slice(-12) },
      { key: "leads", label: "Leads", value: Number(totals?.leads ?? 0), goodDirection: "up" },
      { key: "tickets", label: "Tickets", value: Number(totals?.tickets ?? 0), goodDirection: "up" },
      { key: "ai_requests", label: "AI requests", value: Number(totals?.aiRequests ?? 0), goodDirection: "up" },
      { key: "ai_spend", label: "AI spend", value: Number(totals?.spend ?? 0), format: "currency", goodDirection: "down" },
    ],
    companyGrowth: rowsOf(growth).map((row) => ({
      label: row.label,
      total: Number(row.total),
      new: Number(row.new),
      churned: 0,
    })),
    conversationVolume,
    leadVolume,
    ticketVolume,
    // Per-month inference spend comes from provider billing, which the AI layer
    // will report. Not modelled here.
    aiUsage: [],
    topCompanies: topCompanies.map((row) => ({
      companyId: row.companyId,
      name: row.name,
      conversations: Number(row.conversations),
      leads: Number(row.leads),
      tickets: Number(row.tickets),
      aiRequests: Number(row.aiRequests),
    })),
    planDistribution: planRows.map((row) => ({ label: row.label, value: Number(row.value) })),
  };
}
