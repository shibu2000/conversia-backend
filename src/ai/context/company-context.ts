import { eq } from "drizzle-orm";
import { db } from "../../db";
import {
  chatbotConfigs,
  companies,
  companySettings,
  type BusinessHours,
  type ChatbotAIConfig,
  type ChatbotKnowledgeConfig,
  type LeadCaptureConfig,
  type TicketAutomationConfig,
} from "../../db/schema";

/**
 * What the assistant knows about the business it works for.
 *
 * Every line is read from a column. That is the whole point: these are the only
 * facts the model is allowed to state without a retrieved passage behind it, so
 * each one has to be something the company itself wrote down. A return window
 * or a delivery time is not here and never will be — those are what retrieval is
 * for, and a model that will not guess at them is the product's main promise.
 *
 * Without this the assistant knows nothing between one vector search and the
 * next, which is why it could not answer "hello".
 */

export interface CompanyContext {
  companyName: string;
  botName: string;
  /** The prose block prepended to every system prompt. */
  profile: string;
  ai: ChatbotAIConfig;
  knowledge: ChatbotKnowledgeConfig;
  /** What the assistant may actually do, so a tool is never offered when its feature is off. */
  leads: LeadCaptureConfig;
  tickets: TicketAutomationConfig;
  /** Shown verbatim if the model is unreachable, so a greeting never fails. */
  welcomeMessage: string;
}

/**
 * Cached because it is read on every turn and changes perhaps monthly.
 *
 * A minute is short enough that editing the bot's name in the dashboard feels
 * immediate, and long enough that a busy widget is not re-reading four tables a
 * second.
 */
const TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: CompanyContext }>();

export async function companyContext(companyId: string): Promise<CompanyContext | null> {
  const hit = cache.get(companyId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const [row] = await db
    .select({
      name: companies.name,
      industry: companies.industry,
      country: companies.country,
      identity: chatbotConfigs.identity,
      published: chatbotConfigs.publishedConfig,
      ai: chatbotConfigs.ai,
      knowledge: chatbotConfigs.knowledge,
      leads: chatbotConfigs.leads,
      tickets: chatbotConfigs.tickets,
      handoff: chatbotConfigs.handoff,
      businessHours: companySettings.businessHours,
      supportEmail: companySettings.supportEmail,
    })
    .from(chatbotConfigs)
    .innerJoin(companies, eq(companies.id, chatbotConfigs.companyId))
    .leftJoin(companySettings, eq(companySettings.companyId, chatbotConfigs.companyId))
    .where(eq(chatbotConfigs.companyId, companyId))
    .limit(1);

  if (!row) return null;

  // The published document governs what a customer meets. A draft may hold a
  // persona nobody has approved.
  const identity = row.published?.identity ?? row.identity;
  const value: CompanyContext = {
    companyName: row.name,
    botName: identity.botName,
    ai: row.published?.ai ?? row.ai,
    knowledge: row.published?.knowledge ?? row.knowledge,
    leads: row.published?.leads ?? row.leads,
    tickets: row.published?.tickets ?? row.tickets,
    welcomeMessage: identity.welcomeMessage,
    profile: buildProfile({
      botName: identity.botName,
      companyName: row.name,
      industry: row.industry,
      country: row.country,
      businessHours: row.businessHours,
      supportEmail: row.supportEmail ?? "",
      capabilities: capabilitiesOf({
        leads: (row.published?.leads ?? row.leads)?.enabled,
        tickets: (row.published?.tickets ?? row.tickets)?.enabled,
        handoff: (row.published?.handoff ?? row.handoff)?.enabled,
      }),
    }),
  };

  cache.set(companyId, { at: Date.now(), value });
  return value;
}

/** Called when the config is republished, so an edit is not held for a minute. */
export function forgetCompanyContext(companyId: string): void {
  cache.delete(companyId);
}

function buildProfile(input: {
  botName: string;
  companyName: string;
  industry: string;
  country: string;
  businessHours: BusinessHours | null;
  supportEmail: string;
  capabilities: string[];
}): string {
  const lines = [`You are ${input.botName}, the assistant for ${input.companyName}.`];

  // "the E-commerce sector" rather than "an E-commerce business": industry names
  // come from a free-text column, and no article rule gets both "an E-commerce"
  // and "a SaaS" right.
  const where = [
    input.industry && `operates in the ${input.industry} sector`,
    input.country && `is based in ${input.country}`,
  ].filter(Boolean);
  if (where.length > 0) lines.push(`${input.companyName} ${where.join(" and ")}.`);

  const hours = describeHours(input.businessHours);
  if (hours) lines.push(`The team is available ${hours}.`);
  if (input.supportEmail) lines.push(`The support address is ${input.supportEmail}.`);
  if (input.capabilities.length > 0) lines.push(`You can help with ${sentenceList(input.capabilities)}.`);

  return lines.join("\n");
}

/**
 * Only what is switched on.
 *
 * Offering to raise a ticket for a workspace that has ticket creation disabled
 * would have the assistant promising something the next step cannot deliver.
 */
function capabilitiesOf(enabled: { leads?: boolean; tickets?: boolean; handoff?: boolean }): string[] {
  const capabilities = ["answering questions about the company", "finding products in the catalogue"];
  if (enabled.leads) capabilities.push("passing on a sales enquiry");
  if (enabled.tickets) capabilities.push("raising a support ticket");
  if (enabled.handoff) capabilities.push("connecting someone to a colleague");
  return capabilities;
}

const WEEKDAYS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/**
 * Business hours as a sentence.
 *
 * Consecutive days that share the same hours are collapsed into a range, because
 * "Monday to Saturday, 9am to 6pm" is what a person would say and seven listed
 * days is not.
 */
function describeHours(hours: BusinessHours | null): string {
  const days = hours?.days;
  if (!days) return "";

  const open = [1, 2, 3, 4, 5, 6, 7]
    .map((day) => ({ day, ...days[String(day)] }))
    .filter((entry) => entry.open && entry.from && entry.to);

  if (open.length === 0) return "";

  const runs: Array<{ from: number; to: number; open: string; close: string }> = [];
  for (const entry of open) {
    const last = runs[runs.length - 1];
    if (last && last.to === entry.day - 1 && last.open === entry.from && last.close === entry.to) {
      last.to = entry.day;
    } else {
      runs.push({ from: entry.day, to: entry.day, open: entry.from!, close: entry.to! });
    }
  }

  const zone = hours?.timezone ? ` ${hours.timezone}` : "";
  return sentenceList(
    runs.map((run) => {
      const span = run.from === run.to ? WEEKDAYS[run.from] : `${WEEKDAYS[run.from]} to ${WEEKDAYS[run.to]}`;
      return `${span}, ${run.open}–${run.close}${zone}`;
    }),
  );
}

function sentenceList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
