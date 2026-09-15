import { sql } from "drizzle-orm";
import type { Transaction } from "../../db";
import { companyCounters } from "../../db/schema";

/**
 * Mint the next human-facing reference for a company.
 *
 * `UPDATE … RETURNING` on the counter row is a single atomic statement: it
 * takes a row lock held for the rest of the transaction, so two concurrent
 * creates serialise here instead of both reading the same value. The upsert
 * covers companies provisioned before this table existed and any created since.
 *
 * This replaced deriving references from `count(*)`, which broke twice over —
 * deleting a record made the next one collide with a reference still in use,
 * and concurrent creates raced. Both surfaced to the user as "that record
 * already exists" when they were trying to create something new.
 *
 * Gaps are acceptable: a rolled-back transaction burns a number. References
 * need to be unique and increasing, not contiguous.
 */
export async function nextReference(
  tx: Transaction,
  companyId: string,
  entity: "lead" | "ticket" | "conversation" | "order",
  format: (value: number) => string,
): Promise<string> {
  const start = STARTING_VALUES[entity];

  const [row] = await tx
    .insert(companyCounters)
    .values({ companyId, entity, nextValue: start + 1 })
    .onConflictDoUpdate({
      target: [companyCounters.companyId, companyCounters.entity],
      set: { nextValue: sql`${companyCounters.nextValue} + 1` },
    })
    .returning({ nextValue: companyCounters.nextValue });

  // On insert the row holds the *next* value, so the one just claimed is one
  // below it; on update `RETURNING` gives the incremented value for the same
  // reason. Both paths therefore read back the same way.
  return format(row!.nextValue - 1);
}

/** Where each series begins, so demo and production data read alike. */
const STARTING_VALUES = {
  lead: 4200,
  ticket: 10_240,
  conversation: 10_000,
  order: 48_200,
} as const;

export const formatLeadReference = (value: number) => `L-${value}`;
export const formatTicketReference = (value: number) => `#${value}`;
export const formatConversationReference = (value: number) => `C-${value}`;
