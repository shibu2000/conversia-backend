import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

/**
 * Environment contract.
 *
 * Parsed once at boot and validated, so a misconfigured deployment fails
 * immediately with a readable message instead of throwing somewhere deep in a
 * request handler hours later.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  API_PREFIX: z.string().default("/api/v1"),

  // Database — either a full URL or discrete PG* parts.
  DATABASE_URL: z.string().optional(),
  PGHOST: z.string().default("localhost"),
  PGPORT: z.coerce.number().int().positive().default(5432),
  PGDATABASE: z.string().default("conversia"),
  PGUSER: z.string().default("postgres"),
  PGPASSWORD: z.string().optional(),
  PGSSL: z.enum(["true", "false"]).default("false"),
  PG_POOL_MAX: z.coerce.number().int().positive().default(10),

  // Auth
  JWT_ACCESS_SECRET: z.string().min(16, "JWT_ACCESS_SECRET must be at least 16 characters"),
  JWT_REFRESH_SECRET: z.string().min(16, "JWT_REFRESH_SECRET must be at least 16 characters"),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),
  AUTH_COOKIE_NAME: z.string().default("conversia_refresh"),
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SECURE: z.enum(["true", "false"]).default("false"),

  // CORS — comma-separated list of allowed browser origins.
  CORS_ORIGINS: z.string().default("http://localhost:3000"),

  // Uploads
  UPLOAD_DIR: z.string().default("storage/uploads"),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(600),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),

  // Demo seed
  SEED_PASSWORD: z.string().default("Conversia!2026"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error", "silent"]).default("info"),

  /**
   * AI layer.
   *
   * Every key is optional. A deployment with none of them set runs exactly as
   * it did before the layer existed: `isEnabled()` returns false and each
   * surface falls back to its honest "not installed" branch. Making them
   * required would turn a missing model into a boot failure.
   */
  AI_PROVIDER: z.enum(["ollama", "openai", "none"]).default("none"),
  AI_BASE_URL: z.string().optional(),
  AI_API_KEY: z.string().optional(),
  AI_EMBEDDING_MODEL: z.string().optional(),
  /**
   * Must match the width of the `knowledge_chunks.embedding` column. A vector
   * of any other length is refused rather than written, because pgvector would
   * otherwise reject it at insert time with a message nobody can act on.
   */
  AI_EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(768),
  AI_CHAT_MODEL: z.string().optional(),
  /**
   * Per-capability overrides, all optional and each falling back to
   * `AI_PROVIDER`/`AI_BASE_URL`/`AI_API_KEY` when unset.
   *
   * Chat and embeddings do not have to come from the same vendor, and often
   * cannot: a chat aggregator like xKiro offers no embeddings endpoint at all,
   * and an embeddings specialist like Voyage offers no chat endpoint — each is
   * a real, single-purpose vendor, not a partial implementation of the other.
   * `AI_PROVIDER` stays the shared default for a vendor that does both (Ollama,
   * OpenAI); `voyage` only ever appears as an `AI_EMBEDDING_PROVIDER` override,
   * which is why it is not in `AI_PROVIDER`'s own enum — selecting it there
   * would resolve a chat provider that cannot serve chat.
   */
  AI_CHAT_PROVIDER: z.enum(["ollama", "openai"]).optional(),
  AI_CHAT_BASE_URL: z.string().optional(),
  AI_CHAT_API_KEY: z.string().optional(),
  AI_EMBEDDING_PROVIDER: z.enum(["ollama", "openai", "voyage"]).optional(),
  AI_EMBEDDING_BASE_URL: z.string().optional(),
  AI_EMBEDDING_API_KEY: z.string().optional(),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  /** How often the indexing worker looks for claimable documents. */
  AI_WORKER_INTERVAL_MS: z.coerce.number().int().positive().default(2_000),
  AI_WORKER_BATCH: z.coerce.number().int().positive().max(20).default(3),

  /**
   * Encrypts credentials a workspace stores for a third party — today, its SMTP
   * password.
   *
   * Optional, and deliberately without a default: a key committed to a
   * repository protects nothing, and every deployment sharing one is the same
   * as storing the passwords in the clear. Absent, the product runs as before
   * and only the screens that save a credential refuse.
   */
  ENCRYPTION_KEY: z.string().min(32, "ENCRYPTION_KEY must be at least 32 characters").optional(),

  /** Where the dashboard lives, for links inside emails. */
  APP_ORIGIN: z.string().default("http://localhost:3000"),

  /** How long to wait on a mail server before giving up on one send. */
  SMTP_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  EMAIL_WORKER_INTERVAL_MS: z.coerce.number().int().positive().default(5_000),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n");
  // eslint-disable-next-line no-console
  console.error(`Invalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill in the blanks.`);
  process.exit(1);
}

const raw = parsed.data;

/** A resolved provider setting is only as configured as the vendor it names requires. */
function providerReady(provider: "ollama" | "openai" | "voyage", apiKey: string | undefined): boolean {
  return provider === "ollama" || Boolean(apiKey);
}

const chatProvider = raw.AI_CHAT_PROVIDER ?? (raw.AI_PROVIDER === "none" ? undefined : raw.AI_PROVIDER);
const embeddingProvider = raw.AI_EMBEDDING_PROVIDER ?? (raw.AI_PROVIDER === "none" ? undefined : raw.AI_PROVIDER);

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === "production",
  isDevelopment: raw.NODE_ENV === "development",
  pgSsl: raw.PGSSL === "true",
  cookieSecure: raw.COOKIE_SECURE === "true",
  corsOrigins: raw.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean),
  uploadDir: path.isAbsolute(raw.UPLOAD_DIR) ? raw.UPLOAD_DIR : path.resolve(process.cwd(), raw.UPLOAD_DIR),
  /** What `aiProviders()` actually builds, each resolved independently. */
  aiChatProvider: chatProvider,
  aiChatBaseUrl: raw.AI_CHAT_BASE_URL ?? raw.AI_BASE_URL,
  aiChatApiKey: raw.AI_CHAT_API_KEY ?? raw.AI_API_KEY,
  aiEmbeddingProvider: embeddingProvider,
  aiEmbeddingBaseUrl: raw.AI_EMBEDDING_BASE_URL ?? raw.AI_BASE_URL,
  aiEmbeddingApiKey: raw.AI_EMBEDDING_API_KEY ?? raw.AI_API_KEY,
  /**
   * Whether the AI layer has everything it needs. Read synchronously on every
   * widget question, so it must stay a property test and never a health check.
   *
   * `AI_PROVIDER=none` is only the *default* both capabilities fall back to —
   * `chatProvider`/`embeddingProvider` are already `undefined` whenever neither
   * an explicit override nor a non-"none" `AI_PROVIDER` resolved one, so
   * checking them is sufficient. Requiring `AI_PROVIDER !== "none"` on top of
   * that would refuse a deployment that configures chat and embeddings purely
   * through the per-capability overrides, leaving `AI_PROVIDER` at its default.
   */
  aiConfigured:
    Boolean(chatProvider) &&
    Boolean(embeddingProvider) &&
    Boolean(raw.AI_CHAT_MODEL) &&
    Boolean(raw.AI_EMBEDDING_MODEL) &&
    providerReady(chatProvider!, raw.AI_CHAT_API_KEY ?? raw.AI_API_KEY) &&
    providerReady(embeddingProvider!, raw.AI_EMBEDDING_API_KEY ?? raw.AI_API_KEY),
};

export type Env = typeof env;
