import type { Config } from "drizzle-kit";
import { env } from "./src/config/env";

/**
 * drizzle-kit reads the TypeScript schema and emits SQL migrations into
 * `drizzle/`. Migrations are generated, reviewed and committed — never applied
 * straight from the schema against a real database, so a production deploy
 * always runs SQL someone has read.
 */
export default {
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: env.DATABASE_URL
    ? { url: env.DATABASE_URL }
    : {
        host: env.PGHOST,
        port: env.PGPORT,
        database: env.PGDATABASE,
        user: env.PGUSER,
        password: env.PGPASSWORD,
        ssl: env.pgSsl,
      },
  verbose: true,
  strict: true,
} satisfies Config;
