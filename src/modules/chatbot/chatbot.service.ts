import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { activityEvents, chatbotConfigVersions, chatbotConfigs, notifications } from "../../db/schema";
import { conflict, notFound, validationError } from "../../core/errors";
import { newEmbedKey, newId } from "../../core/ids";
import { iso, isoRequired } from "../../core/serialize";
import type { AuthContext } from "../auth/auth.types";
import type { UpdateChatbotConfigInput } from "./chatbot.schema";

type ConfigRow = typeof chatbotConfigs.$inferSelect;

/** Shape the frontend's `ChatbotConfig` type expects. */
export function toChatbotConfig(row: ConfigRow) {
  return {
    id: row.id,
    companyId: row.companyId,
    status: row.status,
    version: row.version,
    publishedAt: iso(row.publishedAt),
    publishedByName: row.publishedByName,
    hasUnpublishedChanges: row.hasUnpublishedChanges,
    identity: row.identity,
    appearance: row.appearance,
    behavior: row.behavior,
    ai: row.ai,
    knowledge: row.knowledge,
    leads: row.leads,
    tickets: row.tickets,
    handoff: row.handoff,
    installation: {
      embedKey: row.embedKey,
      allowedDomains: row.allowedDomains,
      verifiedDomains: row.verifiedDomains,
      lastPingAt: iso(row.lastPingAt),
    },
  };
}

export async function getConfig(companyId: string) {
  const [row] = await db.select().from(chatbotConfigs).where(eq(chatbotConfigs.companyId, companyId)).limit(1);
  if (!row) throw notFound("Chatbot config", companyId);
  return toChatbotConfig(row);
}

/**
 * Save the draft.
 *
 * Nothing here reaches the embedded widget. The widget is served
 * `publishedConfig`, which only `publish` writes — that separation is the whole
 * point of the publish banner, and it means an experiment in the editor cannot
 * change what a customer sees mid-conversation.
 *
 * Sections merge rather than replace, because the editor saves one tab at a
 * time and a whole-document PUT would let a stale tab silently revert another.
 */
export async function updateConfig(companyId: string, patch: UpdateChatbotConfigInput) {
  const [current] = await db.select().from(chatbotConfigs).where(eq(chatbotConfigs.companyId, companyId)).limit(1);
  if (!current) throw notFound("Chatbot config", companyId);

  await db
    .update(chatbotConfigs)
    .set({
      ...(patch.identity ? { identity: { ...current.identity, ...patch.identity } } : {}),
      ...(patch.appearance ? { appearance: { ...current.appearance, ...patch.appearance } } : {}),
      ...(patch.behavior ? { behavior: { ...current.behavior, ...patch.behavior } } : {}),
      ...(patch.ai ? { ai: { ...current.ai, ...patch.ai } } : {}),
      ...(patch.knowledge ? { knowledge: { ...current.knowledge, ...patch.knowledge } } : {}),
      ...(patch.leads ? { leads: { ...current.leads, ...patch.leads } } : {}),
      ...(patch.tickets ? { tickets: { ...current.tickets, ...patch.tickets } } : {}),
      ...(patch.handoff ? { handoff: { ...current.handoff, ...patch.handoff } } : {}),
      hasUnpublishedChanges: true,
      updatedAt: new Date(),
    })
    .where(eq(chatbotConfigs.companyId, companyId));

  return getConfig(companyId);
}

/**
 * Publish the draft to the live widget.
 *
 * Freezes the current draft into `publishedConfig` and keeps an immutable copy
 * in `chatbot_config_versions`, so "who changed the handoff threshold, and to
 * what" has an answer months later.
 */
export async function publishConfig(companyId: string, auth: AuthContext) {
  const [current] = await db.select().from(chatbotConfigs).where(eq(chatbotConfigs.companyId, companyId)).limit(1);
  if (!current) throw notFound("Chatbot config", companyId);

  const now = new Date();
  const version = current.version + 1;
  const snapshot = {
    identity: current.identity,
    appearance: current.appearance,
    behavior: current.behavior,
    ai: current.ai,
    knowledge: current.knowledge,
    leads: current.leads,
    tickets: current.tickets,
    handoff: current.handoff,
  };

  await db.transaction(async (tx) => {
    await tx
      .update(chatbotConfigs)
      .set({
        status: "published",
        version,
        publishedAt: now,
        publishedById: auth.userId,
        publishedByName: auth.name,
        hasUnpublishedChanges: false,
        publishedConfig: snapshot,
        updatedAt: now,
      })
      .where(eq(chatbotConfigs.companyId, companyId));

    await tx.insert(chatbotConfigVersions).values({
      id: newId("cbv"),
      companyId,
      version,
      config: snapshot,
      publishedById: auth.userId,
      publishedByName: auth.name,
      publishedAt: now,
    });

    await tx.insert(activityEvents).values({
      id: newId("act"),
      companyId,
      actorId: auth.userId,
      actorName: auth.name,
      action: "chatbot.published",
      summary: `Published chatbot configuration version ${version}`,
      targetType: "chatbot_config",
      targetId: current.id,
      at: now,
    });
  });

  return getConfig(companyId);
}

export async function listVersions(companyId: string) {
  const rows = await db
    .select({
      id: chatbotConfigVersions.id,
      version: chatbotConfigVersions.version,
      publishedByName: chatbotConfigVersions.publishedByName,
      publishedAt: chatbotConfigVersions.publishedAt,
    })
    .from(chatbotConfigVersions)
    .where(eq(chatbotConfigVersions.companyId, companyId))
    .orderBy(chatbotConfigVersions.version);

  return rows.map((row) => ({
    id: row.id,
    version: row.version,
    publishedByName: row.publishedByName,
    publishedAt: isoRequired(row.publishedAt),
  }));
}

/**
 * Add a domain the widget may be embedded on.
 *
 * Normalised to a bare hostname and validated: this list is the allowlist the
 * widget endpoint checks an `Origin` against, so a malformed entry is either
 * dead weight or an accidental wildcard.
 */
export async function addDomain(companyId: string, domain: string) {
  const normalised = normaliseDomain(domain);

  const [current] = await db
    .select({ allowedDomains: chatbotConfigs.allowedDomains })
    .from(chatbotConfigs)
    .where(eq(chatbotConfigs.companyId, companyId))
    .limit(1);

  if (!current) throw notFound("Chatbot config", companyId);
  if (current.allowedDomains.includes(normalised)) {
    throw conflict("That domain is already allowed.", { domain: "Already in the list." });
  }
  if (current.allowedDomains.length >= 50) {
    throw validationError("You can allow at most 50 domains.");
  }

  await db
    .update(chatbotConfigs)
    .set({ allowedDomains: [...current.allowedDomains, normalised], hasUnpublishedChanges: true, updatedAt: new Date() })
    .where(eq(chatbotConfigs.companyId, companyId));

  return getConfig(companyId);
}

export async function removeDomain(companyId: string, domain: string) {
  const [current] = await db
    .select({ allowedDomains: chatbotConfigs.allowedDomains, verifiedDomains: chatbotConfigs.verifiedDomains })
    .from(chatbotConfigs)
    .where(eq(chatbotConfigs.companyId, companyId))
    .limit(1);

  if (!current) throw notFound("Chatbot config", companyId);

  await db
    .update(chatbotConfigs)
    .set({
      allowedDomains: current.allowedDomains.filter((entry) => entry !== domain),
      verifiedDomains: current.verifiedDomains.filter((entry) => entry !== domain),
      hasUnpublishedChanges: true,
      updatedAt: new Date(),
    })
    .where(eq(chatbotConfigs.companyId, companyId));

  return getConfig(companyId);
}

/**
 * Rotate the embed key.
 *
 * Invalidates every existing installation immediately — which is the point, and
 * why domain verification is cleared at the same time. A key that keeps working
 * after rotation would make rotation useless as a response to a leak.
 */
export async function rotateEmbedKey(companyId: string, auth: AuthContext) {
  await db
    .update(chatbotConfigs)
    .set({ embedKey: newEmbedKey(), verifiedDomains: [], lastPingAt: null, updatedAt: new Date() })
    .where(eq(chatbotConfigs.companyId, companyId));

  await db.insert(activityEvents).values({
    id: newId("act"),
    companyId,
    actorId: auth.userId,
    actorName: auth.name,
    action: "chatbot.key_rotated",
    summary: "Rotated the widget embed key",
    targetType: "chatbot_config",
  });

  return getConfig(companyId);
}

/**
 * Normalise a domain to a bare hostname.
 *
 * The port is stripped: a browser's `Origin` carries one, but a site is the
 * same site on any port, and asking an administrator to list `:3000` and
 * `:3001` separately would be a trap.
 *
 * `localhost` and loopback addresses are accepted even though they have no TLD,
 * because testing the widget against a local dev server is the first thing
 * anyone does after installing it. Allowing them costs nothing in production —
 * no real site is served from a visitor's own loopback.
 */
function normaliseDomain(input: string): string {
  const trimmed = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "");

  const isLoopback = trimmed === "localhost" || trimmed === "127.0.0.1" || trimmed === "[::1]" || trimmed === "::1";
  const isDomain = /^[a-z0-9.-]+\.[a-z]{2,}$/.test(trimmed);

  if (!isLoopback && !isDomain) {
    throw validationError("Enter a domain, for example shop.example.com.", {
      domain: "Enter a domain such as shop.example.com, or localhost while testing.",
    });
  }
  return trimmed;
}

/** The snippet shown on the installation tab. */
export function buildEmbedSnippet(config: ReturnType<typeof toChatbotConfig>, widgetOrigin: string): string {
  return `<!-- ${config.identity.botName} — paste before </body> -->
<script>
  (function (w, d, k) {
    w.ConversiaSettings = { key: k, locale: ${JSON.stringify(config.identity.defaultLocale)} };
    var s = d.createElement("script");
    s.src = ${JSON.stringify(`${widgetOrigin}/widget/v1.js`)};
    s.async = true;
    d.head.appendChild(s);
  })(window, document, ${JSON.stringify(config.installation.embedKey)});
</script>`;
}
