ALTER TABLE "auth_sessions" ADD COLUMN "family_id" text;
--> statement-breakpoint
WITH RECURSIVE "chain" AS (
  SELECT "s"."id", "s"."id" AS "family_id", "s"."rotated_to"
  FROM "auth_sessions" "s"
  WHERE NOT EXISTS (SELECT 1 FROM "auth_sessions" "p" WHERE "p"."rotated_to" = "s"."id")
  UNION ALL
  SELECT "n"."id", "chain"."family_id", "n"."rotated_to"
  FROM "auth_sessions" "n"
  JOIN "chain" ON "n"."id" = "chain"."rotated_to"
)
UPDATE "auth_sessions" "s"
SET "family_id" = "chain"."family_id"
FROM "chain"
WHERE "chain"."id" = "s"."id";
--> statement-breakpoint
UPDATE "auth_sessions" SET "family_id" = "id" WHERE "family_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "auth_sessions" ALTER COLUMN "family_id" SET NOT NULL;
--> statement-breakpoint
CREATE INDEX "auth_sessions_family_idx" ON "auth_sessions" USING btree ("family_id");
