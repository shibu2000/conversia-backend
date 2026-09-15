import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import { conversations, customers, leads, teams, tickets, users } from "../../db/schema";
import { toConversation } from "../conversations/conversations.mapper";
import { toLead } from "../leads/leads.mapper";
import { toTicket } from "../tickets/tickets.mapper";

/**
 * The company dashboard.
 *
 * Operational, not decorative: every block answers "what needs attention now"
 * and links into the module that can act on it. The counters and the trend are
 * computed from the same rows, so the chart can never disagree with the numbers
 * printed above it — a derived-looking series that contradicts its own totals is
 * worse than no chart.
 */
export async function getCompanyDashboard(companyId: string) {
  const [conversationStats, leadStats, ticketStats, trend, attention, intents] = await Promise.all([
    conversationOverview(companyId),
    leadOverview(companyId),
    ticketOverview(companyId),
    volumeTrend(companyId),
    needsAttention(companyId),
    intentBreakdown(companyId),
  ]);

  const headline = [
    {
      key: "open_conversations",
      label: "Open conversations",
      value: conversationStats.open,
      goodDirection: "down" as const,
      hint: "Active, waiting, or handed to a human — anything not yet closed.",
    },
    { key: "new_leads", label: "New leads", value: leadStats.new, goodDirection: "up" as const },
    { key: "open_tickets", label: "Open tickets", value: ticketStats.openTotal, goodDirection: "down" as const },
    {
      key: "ai_resolved",
      label: "AI resolved",
      value: conversationStats.aiResolved,
      goodDirection: "up" as const,
      hint: "Conversations the assistant closed with no human involvement.",
    },
    {
      key: "escalations",
      label: "Human escalations",
      value: conversationStats.humanHandoff,
      goodDirection: "down" as const,
      hint: "Some escalation is healthy. A rising trend means a knowledge gap.",
    },
  ];

  return {
    headline,
    conversationOverview: {
      total: conversationStats.total,
      aiResolved: conversationStats.aiResolved,
      humanHandoff: conversationStats.humanHandoff,
      unresolved: conversationStats.unresolved,
    },
    leadOverview: leadStats,
    ticketOverview: ticketStats,
    aiPerformance: {
      resolutionRate: conversationStats.total ? (conversationStats.aiResolved / conversationStats.total) * 100 : 0,
      escalationRate: conversationStats.total ? (conversationStats.humanHandoff / conversationStats.total) * 100 : 0,
      // Failed-question tracking and knowledge-quality scoring are AI-layer
      // measurements. Reporting a number here would be inventing one.
      failedQuestions: null,
      knowledgeQuality: null,
      avgConfidence: conversationStats.avgConfidence * 100,
    },
    volumeTrend: trend,
    needsAttention: attention,
    intentBreakdown: intents,
  };
}

async function conversationOverview(companyId: string) {
  const [row] = await db
    .select({
      total: sql<number>`count(*)`,
      open: sql<number>`count(*) FILTER (WHERE ${conversations.status} IN ('active','waiting_on_customer','human_handoff','escalated'))`,
      aiResolved: sql<number>`count(*) FILTER (WHERE ${conversations.resolvedByAi})`,
      humanHandoff: sql<number>`count(*) FILTER (WHERE ${conversations.status} IN ('human_handoff','escalated'))`,
      unresolved: sql<number>`count(*) FILTER (WHERE ${conversations.status} IN ('active','waiting_on_customer'))`,
      avgConfidence: sql<number>`coalesce(avg(${conversations.aiConfidence}), 0)`,
    })
    .from(conversations)
    .where(eq(conversations.companyId, companyId));

  return {
    total: Number(row?.total ?? 0),
    open: Number(row?.open ?? 0),
    aiResolved: Number(row?.aiResolved ?? 0),
    humanHandoff: Number(row?.humanHandoff ?? 0),
    unresolved: Number(row?.unresolved ?? 0),
    avgConfidence: Number(row?.avgConfidence ?? 0),
  };
}

async function leadOverview(companyId: string) {
  const [row] = await db
    .select({
      new: sql<number>`count(*) FILTER (WHERE ${leads.status} = 'new')`,
      qualified: sql<number>`count(*) FILTER (WHERE ${leads.status} IN ('qualified','proposal'))`,
      converted: sql<number>`count(*) FILTER (WHERE ${leads.status} = 'won')`,
      unassigned: sql<number>`count(*) FILTER (WHERE ${leads.assignedUserId} IS NULL AND ${leads.status} NOT IN ('won','lost'))`,
      pipelineValueUsd: sql<number>`coalesce(sum(${leads.estimatedValueUsd}) FILTER (WHERE ${leads.status} NOT IN ('won','lost')), 0)`,
    })
    .from(leads)
    .where(eq(leads.companyId, companyId));

  return {
    new: Number(row?.new ?? 0),
    qualified: Number(row?.qualified ?? 0),
    converted: Number(row?.converted ?? 0),
    unassigned: Number(row?.unassigned ?? 0),
    pipelineValueUsd: Number(row?.pipelineValueUsd ?? 0),
  };
}

async function ticketOverview(companyId: string) {
  const [row] = await db
    .select({
      open: sql<number>`count(*) FILTER (WHERE ${tickets.status} = 'open')`,
      inProgress: sql<number>`count(*) FILTER (WHERE ${tickets.status} IN ('in_progress','assigned'))`,
      waiting: sql<number>`count(*) FILTER (WHERE ${tickets.status} = 'waiting')`,
      resolved: sql<number>`count(*) FILTER (WHERE ${tickets.status} IN ('resolved','closed'))`,
      slaBreached: sql<number>`count(*) FILTER (WHERE ${tickets.resolvedAt} IS NULL AND ${tickets.slaDueAt} < now())`,
      openTotal: sql<number>`count(*) FILTER (WHERE ${tickets.status} NOT IN ('resolved','closed'))`,
    })
    .from(tickets)
    .where(eq(tickets.companyId, companyId));

  return {
    open: Number(row?.open ?? 0),
    inProgress: Number(row?.inProgress ?? 0),
    waiting: Number(row?.waiting ?? 0),
    resolved: Number(row?.resolved ?? 0),
    slaBreached: Number(row?.slaBreached ?? 0),
    openTotal: Number(row?.openTotal ?? 0),
  };
}

/** Fourteen days of volume, bucketed with `generate_series` so gaps show as zero. */
async function volumeTrend(companyId: string) {
  const since = new Date(Date.now() - 13 * 86_400_000);
  since.setUTCHours(0, 0, 0, 0);

  const result = await db.execute<{ label: string; conversations: number; leads: number; tickets: number }>(sql`
    WITH days AS (SELECT generate_series(${since}::timestamptz, now(), '1 day')::date AS day)
    SELECT to_char(days.day, 'Mon FMDD') AS label,
           (SELECT count(*) FROM ${conversations} WHERE ${conversations.companyId} = ${companyId} AND ${conversations.createdAt}::date = days.day)::int AS conversations,
           (SELECT count(*) FROM ${leads} WHERE ${leads.companyId} = ${companyId} AND ${leads.createdAt}::date = days.day)::int AS leads,
           (SELECT count(*) FROM ${tickets} WHERE ${tickets.companyId} = ${companyId} AND ${tickets.createdAt}::date = days.day)::int AS tickets
      FROM days ORDER BY days.day
  `);

  return rowsOf(result).map((row) => ({
    label: row.label,
    conversations: Number(row.conversations),
    leads: Number(row.leads),
    tickets: Number(row.tickets),
  }));
}

/** The three queues a workspace owner has to clear. Five rows each — enough to act on. */
async function needsAttention(companyId: string) {
  const [unassignedConversations, overdueTickets, staleLeads] = await Promise.all([
    db
      .select({
        conversation: conversations,
        customerName: customers.name,
        customerEmail: customers.email,
        assignedUserName: users.name,
      })
      .from(conversations)
      .leftJoin(customers, eq(customers.id, conversations.customerId))
      .leftJoin(users, eq(users.id, conversations.assignedUserId))
      .where(
        and(
          eq(conversations.companyId, companyId),
          isNull(conversations.assignedUserId),
          sql`${conversations.status} IN ('active','waiting_on_customer','human_handoff','escalated')`,
        ),
      )
      // Oldest first: the conversation waiting longest is the one to pick up.
      .orderBy(conversations.lastMessageAt)
      .limit(5),

    db
      .select({
        ticket: tickets,
        customerName: customers.name,
        customerEmail: customers.email,
        assignedUserName: users.name,
        teamName: teams.name,
      })
      .from(tickets)
      .innerJoin(customers, eq(customers.id, tickets.customerId))
      .leftJoin(users, eq(users.id, tickets.assignedUserId))
      .leftJoin(teams, eq(teams.id, tickets.teamId))
      .where(and(eq(tickets.companyId, companyId), isNull(tickets.resolvedAt), sql`${tickets.slaDueAt} < now()`))
      .orderBy(tickets.slaDueAt)
      .limit(5),

    db
      .select({
        lead: leads,
        customerName: customers.name,
        customerEmail: customers.email,
        customerPhone: customers.phone,
        assignedUserName: users.name,
      })
      .from(leads)
      .innerJoin(customers, eq(customers.id, leads.customerId))
      .leftJoin(users, eq(users.id, leads.assignedUserId))
      .where(
        and(
          eq(leads.companyId, companyId),
          sql`${leads.status} NOT IN ('won','lost')`,
          sql`${leads.nextFollowUpAt} IS NOT NULL AND ${leads.nextFollowUpAt} < now()`,
        ),
      )
      .orderBy(leads.nextFollowUpAt)
      .limit(5),
  ]);

  return {
    unassignedConversations: unassignedConversations.map((row) =>
      toConversation(row.conversation, {
        customerName: row.customerName,
        customerEmail: row.customerEmail,
        assignedUserName: row.assignedUserName,
      }),
    ),
    overdueTickets: overdueTickets.map((row) =>
      toTicket(row.ticket, {
        customerName: row.customerName,
        customerEmail: row.customerEmail,
        assignedUserName: row.assignedUserName,
        teamName: row.teamName,
      }),
    ),
    staleLeads: staleLeads.map((row) =>
      toLead(row.lead, {
        customerName: row.customerName,
        customerEmail: row.customerEmail,
        customerPhone: row.customerPhone,
        assignedUserName: row.assignedUserName,
        assignedUserRole: null,
      }),
    ),
  };
}

async function intentBreakdown(companyId: string) {
  const rows = await db
    .select({ label: conversations.intent, value: sql<number>`count(*)` })
    .from(conversations)
    .where(eq(conversations.companyId, companyId))
    .groupBy(conversations.intent)
    .orderBy(desc(sql`count(*)`));

  return rows.map((row) => ({ label: row.label, value: Number(row.value) }));
}

/** `db.execute` returns a driver result; normalise it to plain rows. */
export function rowsOf<T>(result: { rows?: T[] } | T[]): T[] {
  return Array.isArray(result) ? result : (result.rows ?? []);
}
