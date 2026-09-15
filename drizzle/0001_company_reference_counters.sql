CREATE TABLE "company_counters" (
	"company_id" text NOT NULL,
	"entity" text NOT NULL,
	"next_value" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "company_counters_company_id_entity_pk" PRIMARY KEY("company_id","entity")
);
--> statement-breakpoint
ALTER TABLE "company_counters" ADD CONSTRAINT "company_counters_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Seed each counter past the highest reference already issued, so the series
-- continues rather than colliding with a reference that is already in use.
INSERT INTO "company_counters" ("company_id", "entity", "next_value")
SELECT c.id,
       'lead',
       COALESCE(MAX(NULLIF(regexp_replace(l.reference, '\D', '', 'g'), ''))::int, 4199) + 1
  FROM "companies" c
  LEFT JOIN "leads" l ON l.company_id = c.id
 GROUP BY c.id
ON CONFLICT DO NOTHING;--> statement-breakpoint

INSERT INTO "company_counters" ("company_id", "entity", "next_value")
SELECT c.id,
       'ticket',
       COALESCE(MAX(NULLIF(regexp_replace(t.reference, '\D', '', 'g'), ''))::int, 10239) + 1
  FROM "companies" c
  LEFT JOIN "tickets" t ON t.company_id = c.id
 GROUP BY c.id
ON CONFLICT DO NOTHING;
