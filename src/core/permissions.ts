/**
 * The server-side permission catalog.
 *
 * This mirrors `src/constants/permissions.ts` in the frontend, and that
 * duplication is deliberate: the frontend copy hides buttons, this copy decides
 * what actually happens. If they ever drift, the server wins — a hidden button
 * is a convenience, an enforced permission is the security boundary.
 */
export const PERMISSION_RESOURCES = [
  "conversations",
  "customers",
  "leads",
  "tickets",
  "products",
  "faq",
  "knowledge",
  "chatbot",
  "analytics",
  "users",
  "roles",
  "settings",
] as const;

export type PermissionResource = (typeof PERMISSION_RESOURCES)[number];
export type PermissionKey = string;

interface PermissionDefinition {
  key: PermissionKey;
  /** Permissions this one implies — granting `edit` grants `view`. */
  implies?: PermissionKey[];
}

const CATALOG: PermissionDefinition[] = [
  { key: "conversations.view" },
  { key: "conversations.edit", implies: ["conversations.view"] },
  { key: "conversations.assign", implies: ["conversations.view"] },
  { key: "conversations.delete", implies: ["conversations.view"] },

  { key: "customers.view" },
  { key: "customers.create", implies: ["customers.view"] },
  { key: "customers.edit", implies: ["customers.view"] },
  { key: "customers.delete", implies: ["customers.view"] },
  { key: "customers.export", implies: ["customers.view"] },

  { key: "leads.view" },
  { key: "leads.create", implies: ["leads.view"] },
  { key: "leads.edit", implies: ["leads.view"] },
  { key: "leads.assign", implies: ["leads.view"] },
  { key: "leads.delete", implies: ["leads.view"] },

  { key: "tickets.view" },
  { key: "tickets.create", implies: ["tickets.view"] },
  { key: "tickets.edit", implies: ["tickets.view"] },
  { key: "tickets.assign", implies: ["tickets.view"] },
  { key: "tickets.resolve", implies: ["tickets.view"] },
  { key: "tickets.delete", implies: ["tickets.view"] },

  { key: "products.view" },
  { key: "products.create", implies: ["products.view"] },
  { key: "products.edit", implies: ["products.view"] },
  { key: "products.delete", implies: ["products.view"] },

  { key: "faq.view" },
  { key: "faq.create", implies: ["faq.view"] },
  { key: "faq.edit", implies: ["faq.view"] },
  { key: "faq.delete", implies: ["faq.view"] },

  { key: "knowledge.view" },
  { key: "knowledge.upload", implies: ["knowledge.view"] },
  { key: "knowledge.edit", implies: ["knowledge.view"] },
  { key: "knowledge.reindex", implies: ["knowledge.view"] },
  { key: "knowledge.delete", implies: ["knowledge.view"] },

  { key: "chatbot.view" },
  { key: "chatbot.configure", implies: ["chatbot.view"] },
  { key: "chatbot.publish", implies: ["chatbot.configure", "chatbot.view"] },

  { key: "analytics.view" },
  { key: "analytics.export", implies: ["analytics.view"] },

  { key: "users.view" },
  { key: "users.invite", implies: ["users.view"] },
  { key: "users.edit", implies: ["users.view"] },
  { key: "users.disable", implies: ["users.view"] },

  { key: "roles.view" },
  { key: "roles.create", implies: ["roles.view"] },
  { key: "roles.edit", implies: ["roles.view"] },
  { key: "roles.delete", implies: ["roles.view"] },

  { key: "settings.view" },
  { key: "settings.edit", implies: ["settings.view"] },
];

export const ALL_PERMISSION_KEYS: PermissionKey[] = CATALOG.map((entry) => entry.key);

const VALID = new Set(ALL_PERMISSION_KEYS);
const IMPLIED_BY = new Map<PermissionKey, PermissionKey[]>(CATALOG.map((entry) => [entry.key, entry.implies ?? []]));

/** Expand a granted list to include everything those permissions imply. */
export function expandPermissions(granted: readonly PermissionKey[]): Set<PermissionKey> {
  const resolved = new Set<PermissionKey>();
  const queue = [...granted];
  while (queue.length > 0) {
    const key = queue.pop()!;
    if (resolved.has(key)) continue;
    resolved.add(key);
    for (const implied of IMPLIED_BY.get(key) ?? []) {
      if (!resolved.has(implied)) queue.push(implied);
    }
  }
  return resolved;
}

/** Drop anything not in the catalog — a role cannot grant an invented permission. */
export function sanitisePermissions(keys: readonly string[]): PermissionKey[] {
  return Array.from(new Set(keys.filter((key) => VALID.has(key))));
}

export function isPermissionKey(key: string): boolean {
  return VALID.has(key);
}

/** Default permission sets for the five system roles. */
export const ROLE_PRESETS: Record<string, PermissionKey[]> = {
  company_admin: ALL_PERMISSION_KEYS,
  manager: [
    "conversations.view", "conversations.edit", "conversations.assign",
    "customers.view", "customers.edit", "customers.export",
    "leads.view", "leads.create", "leads.edit", "leads.assign",
    "tickets.view", "tickets.create", "tickets.edit", "tickets.assign", "tickets.resolve",
    "products.view", "products.edit",
    "faq.view", "faq.create", "faq.edit",
    "knowledge.view", "knowledge.upload", "knowledge.reindex",
    "chatbot.view",
    "analytics.view", "analytics.export",
    "users.view",
    "roles.view",
    "settings.view",
  ],
  sales: [
    "conversations.view", "conversations.edit",
    "customers.view", "customers.create", "customers.edit",
    "leads.view", "leads.create", "leads.edit",
    "products.view",
    "analytics.view",
  ],
  support: [
    "conversations.view", "conversations.edit", "conversations.assign",
    "customers.view", "customers.edit",
    "tickets.view", "tickets.create", "tickets.edit", "tickets.assign", "tickets.resolve",
    "faq.view", "faq.create", "faq.edit",
    "knowledge.view", "knowledge.upload",
    "products.view",
    "analytics.view",
  ],
  viewer: [
    "conversations.view",
    "customers.view",
    "leads.view",
    "tickets.view",
    "products.view",
    "faq.view",
    "knowledge.view",
    "chatbot.view",
    "analytics.view",
  ],
};
