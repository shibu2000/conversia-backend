import { z } from "zod";

export const updateCompanySchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  website: z.string().trim().url("Enter a full URL, including https://").max(255).optional().or(z.literal("")),
  industry: z.string().trim().max(120).optional(),
  country: z.string().trim().max(120).optional(),
  timezone: z.string().trim().max(64).optional(),
  logoUrl: z.string().trim().url().max(500).nullish(),
  primaryContactName: z.string().trim().max(120).optional(),
  primaryContactEmail: z.string().trim().email().max(255).optional(),
  onboardingProgress: z.number().int().min(0).max(100).optional(),
});

/** Plan and status are platform decisions, not company self-service. */
export const updateCompanyPlatformSchema = updateCompanySchema.extend({
  status: z.enum(["active", "trial", "suspended", "onboarding", "archived"]).optional(),
  plan: z.enum(["starter", "growth", "scale", "enterprise"]).optional(),
});

/**
 * Provisioning a company from the platform console.
 *
 * The admin's details are required: a company without an administrator is
 * unreachable, so the two are created together or not at all.
 */
export const createCompanySchema = z.object({
  name: z.string().trim().min(1, "Enter the company name.").max(160),
  website: z.string().trim().url("Enter a full URL, including https://").max(255).optional().or(z.literal("")),
  industry: z.string().trim().max(120).optional(),
  country: z.string().trim().max(120).optional(),
  timezone: z.string().trim().max(64).optional(),
  plan: z.enum(["starter", "growth", "scale", "enterprise"]).default("starter"),
  status: z.enum(["active", "trial", "onboarding"]).default("trial"),
  adminName: z.string().trim().min(1, "Enter the administrator's name.").max(120),
  adminEmail: z.string().trim().toLowerCase().email("Enter a valid email address.").max(255),
});

export const setCompanyStatusSchema = z.object({
  status: z.enum(["active", "trial", "suspended", "onboarding", "archived"]),
});

const businessDaySchema = z.object({
  open: z.boolean(),
  from: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM."),
  to: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM."),
});

export const updateCompanySettingsSchema = z.object({
  businessHours: z
    .object({
      timezone: z.string().trim().max(64),
      // Keyed by ISO weekday, "1" = Monday.
      days: z.record(z.enum(["1", "2", "3", "4", "5", "6", "7"]), businessDaySchema),
    })
    .optional(),
  supportEmail: z.string().trim().email().max(255).optional(),
  defaultLeadOwnerId: z.string().max(64).nullish(),
  defaultTicketTeamId: z.string().max(64).nullish(),
  dataRetentionDays: z.number().int().min(30).max(3650).optional(),
  locales: z.array(z.string().max(16)).max(20).optional(),
  defaultLocale: z.string().max(16).optional(),

  /**
   * The workspace's mail server.
   *
   * `smtpPassword` is write-only: absent means leave the stored one alone, and
   * `null` clears it. There is no way to read one back out.
   */
  email: z
    .object({
      enabled: z.boolean().optional(),
      smtpHost: z.string().trim().max(255).optional(),
      smtpPort: z.number().int().min(1).max(65535).optional(),
      smtpSecure: z.boolean().optional(),
      smtpUser: z.string().trim().max(255).optional(),
      smtpPassword: z.string().max(500).nullish(),
      smtpFromName: z.string().trim().max(120).optional(),
      smtpFromEmail: z.union([z.string().trim().email().max(255), z.literal("")]).optional(),
      leadNotificationEmail: z.union([z.string().trim().email().max(255), z.literal("")]).optional(),
    })
    .optional(),
});

export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;
export type UpdateCompanySettingsInput = z.infer<typeof updateCompanySettingsSchema>;
