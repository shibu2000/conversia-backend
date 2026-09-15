import { iso, isoRequired, num } from "../../core/serialize";
import type { companies, companySettings, companyUsage } from "../../db/schema";

type CompanyRow = typeof companies.$inferSelect;
type UsageRow = typeof companyUsage.$inferSelect | null;
type SettingsRow = typeof companySettings.$inferSelect;

export interface CompanyCounts {
  userCount: number;
  conversationCount: number;
  leadCount: number;
  ticketCount: number;
  productCount: number;
  knowledgeSourceCount: number;
}

export interface TrendPoint {
  label: string;
  value: number;
}

/** Shape the frontend's `Company` type expects. */
export function toCompany(
  row: CompanyRow,
  usage: UsageRow,
  counts: CompanyCounts,
  trends: { conversations: TrendPoint[]; leads: TrendPoint[] },
) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    logoUrl: row.logoUrl ?? undefined,
    website: row.website,
    industry: row.industry,
    country: row.country,
    timezone: row.timezone,
    status: row.status,
    plan: row.plan,
    primaryContactName: row.primaryContactName,
    primaryContactEmail: row.primaryContactEmail,
    onboardingProgress: row.onboardingProgress,
    ...counts,
    usage: {
      aiRequests: num(usage?.aiRequests),
      aiRequestQuota: num(usage?.aiRequestQuota),
      conversations: num(usage?.conversations),
      conversationQuota: num(usage?.conversationQuota),
      knowledgeDocuments: num(usage?.knowledgeDocuments),
      knowledgeDocumentQuota: num(usage?.knowledgeDocumentQuota),
      seats: num(usage?.seats),
      seatQuota: num(usage?.seatQuota),
      tokensIn: num(usage?.tokensIn),
      tokensOut: num(usage?.tokensOut),
      estimatedCostUsd: num(usage?.estimatedCostUsd),
      periodStart: usage ? isoRequired(usage.periodStart) : isoRequired(new Date()),
      periodEnd: usage ? isoRequired(usage.periodEnd) : isoRequired(new Date()),
    },
    trends,
    createdAt: isoRequired(row.createdAt),
    updatedAt: isoRequired(row.updatedAt),
  };
}

export function toCompanySettings(row: SettingsRow) {
  return {
    companyId: row.companyId,
    businessHours: row.businessHours,
    supportEmail: row.supportEmail,
    defaultLeadOwnerId: row.defaultLeadOwnerId,
    defaultTicketTeamId: row.defaultTicketTeamId,
    dataRetentionDays: row.dataRetentionDays,
    locales: row.locales,
    defaultLocale: row.defaultLocale,
    email: {
      enabled: row.emailEnabled,
      smtpHost: row.smtpHost,
      smtpPort: row.smtpPort,
      smtpSecure: row.smtpSecure,
      smtpUser: row.smtpUser,
      /**
       * Whether a password is stored, never the password.
       *
       * This mapper is the only thing standing between the column and the
       * browser, so the redaction lives here rather than in a caller that could
       * forget. A field that rendered the value would put the credential in the
       * page source and in anything that logs a response.
       */
      smtpPasswordSet: Boolean(row.smtpPasswordEncrypted),
      smtpFromName: row.smtpFromName,
      smtpFromEmail: row.smtpFromEmail,
      leadNotificationEmail: row.leadNotificationEmail,
    },
  };
}
