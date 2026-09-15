-- Seed the conversation and order reference counters.
--
-- Migration 0001 backfilled the lead and ticket series, which were the only two
-- minted at the time. The widget now creates conversations, and its counter
-- started from the series base — colliding with references the seed had already
-- issued. Same fix, applied to the remaining two series.
--
-- `regexp_replace(... '\D' ...)` strips the prefix ('C-', '#') so the numeric
-- part can be compared; `NULLIF(…, '')` guards a reference with no digits at all.

INSERT INTO "company_counters" ("company_id", "entity", "next_value")
SELECT c.id,
       'conversation',
       COALESCE(MAX(NULLIF(regexp_replace(v.reference, '\D', '', 'g'), ''))::int, 9999) + 1
  FROM "companies" c
  LEFT JOIN "conversations" v ON v.company_id = c.id
 GROUP BY c.id
ON CONFLICT ("company_id", "entity") DO UPDATE
   SET "next_value" = GREATEST("company_counters"."next_value", EXCLUDED."next_value");
--> statement-breakpoint

INSERT INTO "company_counters" ("company_id", "entity", "next_value")
SELECT c.id,
       'order',
       COALESCE(MAX(NULLIF(regexp_replace(o.reference, '\D', '', 'g'), ''))::int, 48199) + 1
  FROM "companies" c
  LEFT JOIN "orders" o ON o.company_id = c.id
 GROUP BY c.id
ON CONFLICT ("company_id", "entity") DO UPDATE
   SET "next_value" = GREATEST("company_counters"."next_value", EXCLUDED."next_value");
